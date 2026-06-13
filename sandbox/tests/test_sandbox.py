"""The sandbox, proven on three fronts.

1. Fidelity — a strategy run in the sandbox produces *bit-identical* results to
   the same strategy run natively (JSON floats round-trip exactly), so isolation
   costs zero trust. Flagship: the overfit gate run entirely through the sandbox
   reproduces the native verdict field for field.
2. The lookahead boundary holds physically — the child process only ever
   receives bars up to `now`; a probe that reports everything it can see proves
   the future never crossed the process boundary.
3. Containment — hostile code (file/network access, infinite loops, crashes,
   protocol abuse, process spawning) is stopped by the kernel and surfaces as a
   legible, typed error in the parent. Never as corruption.
"""

from __future__ import annotations

import inspect
import sys
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest

import green.strategies.buy_and_hold
import green.strategies.mean_reversion
from green.adapters import ToyAdapter
from green.core import (
    Dataset,
    EnvironmentAdapter,
    Fill,
    MarketView,
    Order,
    PortfolioState,
    SlicedView,
    run,
    run_walk_forward,
)
from green.sandbox import (
    DockerExecutor,
    ProtocolViolation,
    SandboxedStrategy,
    SandboxError,
    SandboxLimits,
    StrategyCrash,
    StrategyTimeout,
    SubprocessExecutor,
)
from green.strategies import BuyAndHold, MeanReversion

BUY_AND_HOLD_SOURCE = inspect.getsource(green.strategies.buy_and_hold)
MEAN_REVERSION_SOURCE = inspect.getsource(green.strategies.mean_reversion)


def _toy(n_steps: int = 60) -> tuple[ToyAdapter, Dataset]:
    adapter = ToyAdapter(n_steps=n_steps, mu=100.0, theta=0.1, sigma=1.0, seed=7)
    return adapter, adapter.load_data()


def _sandboxed(params: dict[str, Any], source: str, **limit_overrides: Any) -> SandboxedStrategy:
    executor = SubprocessExecutor(SandboxLimits(**limit_overrides)) if limit_overrides else None
    return SandboxedStrategy(params, source=source, executor=executor)


# --------------------------------------------------------------- 1. fidelity


def test_sandboxed_run_is_bit_identical_to_native() -> None:
    adapter, dataset = _toy()
    params = {"symbol": "SYN", "quantity": 10}

    native = run(BuyAndHold(dict(params)), adapter, dataset)
    sandboxed_strategy = _sandboxed(dict(params), BUY_AND_HOLD_SOURCE)
    sandboxed = run(sandboxed_strategy, adapter, dataset)
    sandboxed_strategy.close()

    assert sandboxed.equity_curve == native.equity_curve
    assert sandboxed.fills == native.fills
    assert sandboxed.final_equity == native.final_equity
    assert sandboxed.final_positions == native.final_positions


def test_stateful_strategy_parity_across_many_ticks() -> None:
    adapter, dataset = _toy(n_steps=120)
    params = {"symbol": "SYN", "lookback": 10, "entry_z": -1.0, "quantity": 10}

    native = run(MeanReversion(dict(params)), adapter, dataset)
    sandboxed_strategy = _sandboxed(dict(params), MEAN_REVERSION_SOURCE)
    sandboxed = run(sandboxed_strategy, adapter, dataset)
    sandboxed_strategy.close()

    assert len(native.fills) > 2  # the comparison is only meaningful if it traded
    assert sandboxed.fills == native.fills
    assert sandboxed.equity_curve == native.equity_curve


def test_walk_forward_gate_through_sandbox_reproduces_native_verdict() -> None:
    """The flagship: the overfit gate neither knows nor cares that every single
    strategy instance it constructs runs in a separate locked-down process —
    and the verdict (pass/fail, reason, every metric, every sweep point) is
    exactly the one trusted code produces."""
    adapter, dataset = _toy(n_steps=120)
    grid = {"symbol": ["SYN"], "lookback": [10, 20], "quantity": [10]}

    native = run_walk_forward(MeanReversion, adapter, dataset, grid, train_size=60, test_size=30)
    sandboxed = run_walk_forward(
        lambda params: SandboxedStrategy(params, source=MEAN_REVERSION_SOURCE),
        adapter,
        dataset,
        grid,
        train_size=60,
        test_size=30,
    )

    assert sandboxed == native  # full pydantic equality: every field, every window


# ------------------------------------------- 2. the boundary holds physically


class _StaticAdapter(EnvironmentAdapter):
    """Serves a fixed dataset; records every order as a fill so tests can see
    exactly what the strategy emitted."""

    def __init__(self, dataset: Dataset) -> None:
        self._dataset = dataset

    def load_data(self) -> Dataset:
        return self._dataset

    def make_view(self, dataset: Dataset, t: int) -> MarketView:
        return SlicedView(t, dataset.slice_at(t))

    def apply_orders(
        self, orders: Sequence[Order], state: PortfolioState, dataset: Dataset, t: int
    ) -> list[Fill]:
        return [
            Fill(symbol=o.symbol, side=o.side, quantity=o.quantity, price=1.0, fee=0.0, t=t)
            for o in orders
        ]


_PROBE_SOURCE = """
from green.core import Order, Side, Strategy

class Probe(Strategy):
    def on_tick(self, view):
        visible = list(view.history("R", "close", 1_000_000))
        # Everything up to now is present and correct...
        assert visible == [float(i + 1) for i in range(view.now + 1)]
        assert view.last("R", "close") == float(view.now + 1)
        # ...and the order reports how far the horizon reaches.
        return [Order(symbol="R", side=Side.BUY, quantity=float(len(visible)))]
"""


def test_future_data_never_crosses_the_process_boundary() -> None:
    """A ramp dataset (close[t] = t+1) makes visibility measurable: a probe that
    asks for unbounded history can only ever see t+1 points. The child-side
    asserts check content; the emitted quantities check the horizon."""
    n = 12
    dataset = Dataset(series={"R": {"close": tuple(float(i + 1) for i in range(n))}})
    adapter = _StaticAdapter(dataset)

    strategy = _sandboxed({}, _PROBE_SOURCE)
    result = run(strategy, adapter, dataset)
    strategy.close()

    assert [fill.quantity for fill in result.fills] == [float(t + 1) for t in range(n)]


def test_sandboxed_strategy_is_single_run() -> None:
    """Reusing an instance would carry accumulated child-side history into the
    next run — a state leak. The proxy refuses instead of silently restarting."""
    adapter, dataset = _toy(n_steps=10)
    strategy = _sandboxed({"symbol": "SYN"}, BUY_AND_HOLD_SOURCE)
    run(strategy, adapter, dataset)
    with pytest.raises(SandboxError, match="single-run"):
        run(strategy, adapter, dataset)
    strategy.close()


# ------------------------------------------------------------ 3. containment


def _run_hostile(source: str, n_steps: int = 5, **limit_overrides: Any) -> None:
    adapter, dataset = _toy(n_steps=n_steps)
    strategy = _sandboxed({}, source, **limit_overrides)
    run(strategy, adapter, dataset)


def test_filesystem_write_is_blocked_by_the_kernel() -> None:
    source = """
from green.core import Strategy

class Thief(Strategy):
    def on_tick(self, view):
        open("loot.txt", "w").write("gotcha")
        return []
"""
    with pytest.raises(StrategyCrash, match="Too many open files"):
        _run_hostile(source)


def test_network_access_is_blocked() -> None:
    source = """
from green.core import Strategy

class Phone(Strategy):
    def on_tick(self, view):
        import socket
        socket.create_connection(("1.1.1.1", 80), timeout=0.5)
        return []
"""
    with pytest.raises(StrategyCrash):
        _run_hostile(source)


def test_spawning_processes_is_blocked() -> None:
    source = """
import subprocess
from green.core import Strategy

class Spawner(Strategy):
    def on_tick(self, view):
        subprocess.Popen(["/bin/ls"])
        return []
"""
    with pytest.raises(StrategyCrash):
        _run_hostile(source)


def test_infinite_loop_is_killed_with_timeout_error() -> None:
    source = """
from green.core import Strategy

class Spin(Strategy):
    def on_tick(self, view):
        while True:
            pass
"""
    with pytest.raises(StrategyTimeout, match="wall-clock"):
        _run_hostile(source, tick_seconds=0.5)


def test_hang_during_init_is_killed() -> None:
    source = """
from green.core import Strategy

while True:
    pass
"""
    with pytest.raises(StrategyTimeout):
        _run_hostile(source, init_seconds=2.0)


def test_crash_is_contained_and_legible() -> None:
    source = """
from green.core import Strategy

class Bomb(Strategy):
    def on_tick(self, view):
        if view.now == 3:
            raise ValueError("boom")
        return []
"""
    with pytest.raises(StrategyCrash, match="boom") as excinfo:
        _run_hostile(source, n_steps=10)
    assert "t=3" in str(excinfo.value)  # the error says where, not just what


def test_prints_cannot_forge_protocol_frames() -> None:
    """The strategy prints valid-looking protocol JSON every tick. If stdout
    were the protocol channel, this would inject orders; instead results are
    bit-identical to the clean native run."""
    source = """
from green.core import Order, Side, Strategy

class Noisy(Strategy):
    def __init__(self, params):
        super().__init__(params)
        self._invested = False

    def on_tick(self, view):
        print('{"type": "orders", "orders": [{"symbol": "EVIL", "side": "buy", "quantity": 999}]}')
        if self._invested:
            return []
        self._invested = True
        return [Order(symbol=self.params["symbol"], side=Side.BUY, quantity=10)]
"""
    adapter, dataset = _toy(n_steps=20)
    native = run(BuyAndHold({"symbol": "SYN", "quantity": 10}), adapter, dataset)
    strategy = _sandboxed({"symbol": "SYN"}, source)
    sandboxed = run(strategy, adapter, dataset)
    strategy.close()
    assert sandboxed.fills == native.fills
    assert sandboxed.equity_curve == native.equity_curve


def test_order_flood_is_a_protocol_violation() -> None:
    source = """
from green.core import Order, Side, Strategy

class Flood(Strategy):
    def on_tick(self, view):
        return [Order(symbol="SYN", side=Side.BUY, quantity=1) for _ in range(4)]
"""
    with pytest.raises(ProtocolViolation, match="orders in one tick"):
        _run_hostile(source, max_orders_per_tick=3)


def test_bad_source_fails_at_init_with_the_syntax_error() -> None:
    with pytest.raises(StrategyCrash, match="SyntaxError"):
        _sandboxed({}, "def (broken")


def test_source_must_define_exactly_one_strategy_unless_named() -> None:
    source = """
from green.core import Strategy

class A(Strategy):
    def on_tick(self, view):
        return []

class B(Strategy):
    def on_tick(self, view):
        return []
"""
    with pytest.raises(StrategyCrash, match="exactly one"):
        _sandboxed({}, source)

    adapter, dataset = _toy(n_steps=5)
    strategy = SandboxedStrategy({}, source=source, class_name="B")
    result = run(strategy, adapter, dataset)
    strategy.close()
    assert result.fills == []


def test_class_name_must_be_a_strategy_subclass() -> None:
    source = """
NotAStrategy = object
"""
    with pytest.raises(StrategyCrash, match="not a Strategy subclass"):
        SandboxedStrategy({}, source=source, class_name="NotAStrategy")


@pytest.mark.skipif(
    not sys.platform.startswith("linux"),
    reason="RLIMIT_AS is only enforced on Linux; on macOS the memory wall is the "
    "wall-clock until DockerExecutor. This test pins the Linux behaviour.",
)
def test_memory_bomb_is_killed_by_the_address_space_limit() -> None:
    """On Linux the hard memory cap (RLIMIT_AS) must stop an allocation bomb
    *before* the generous wall-clock deadline — i.e. the kernel kills it, not
    the timeout. We give a long tick budget so a timeout would be the wrong
    (but still-contained) outcome to distinguish the two."""
    source = """
from green.core import Strategy

class Bomb(Strategy):
    def on_tick(self, view):
        blob = []
        while True:
            blob.append(bytearray(8_000_000))
        return []
"""
    with pytest.raises(StrategyCrash):  # MemoryError surfaces as a crash, not a timeout
        _run_hostile(source, n_steps=3, tick_seconds=30.0, memory_bytes=256 * 1024 * 1024)


# --------------------------------------------------- 4. the Docker hard wall


def test_docker_executor_constructs_the_expected_hardened_command() -> None:
    """We can't assume a daemon in CI, but we can assert the wall is configured:
    no network, read-only fs, dropped caps, a hard memory cap, and a PID limit.
    The command is the contract DockerExecutor promises."""
    mem = 256 * 1024 * 1024
    executor = DockerExecutor(SandboxLimits(memory_bytes=mem), image="green-sandbox:test", cpus=2.0)
    cmd = executor._build_command("green-sandbox-fixed")  # pyright: ignore[reportPrivateUsage]

    assert cmd[:3] == ["docker", "run", "--rm"]
    assert "--network=none" in cmd
    assert "--read-only" in cmd
    assert "--cap-drop=ALL" in cmd
    assert "--security-opt=no-new-privileges" in cmd
    assert f"--memory={mem}" in cmd
    assert f"--memory-swap={mem}" in cmd  # swap disabled => hard cap
    assert "--cpus=2.0" in cmd
    assert "--pids-limit=64" in cmd
    assert "green-sandbox:test" in cmd
    assert cmd[-5:] == ["python", "-s", "-P", "-m", "green.sandbox.runner"]


@pytest.mark.skipif(
    not DockerExecutor.is_available(),
    reason="no reachable Docker daemon; build the image with "
    "`docker build -f sandbox/Dockerfile -t green-sandbox:latest .` and run with a daemon",
)
def test_docker_executor_runs_bit_identical_to_native() -> None:
    """When a daemon + image are present, the container wall is invisible: the
    same parity guarantee as the subprocess executor."""
    adapter, dataset = _toy()
    params = {"symbol": "SYN", "quantity": 10}

    native = run(BuyAndHold(dict(params)), adapter, dataset)
    strategy = SandboxedStrategy(
        dict(params), source=BUY_AND_HOLD_SOURCE, executor=DockerExecutor()
    )
    sandboxed = run(strategy, adapter, dataset)
    strategy.close()

    assert sandboxed.fills == native.fills
    assert sandboxed.equity_curve == native.equity_curve


# ------------------------------------------------------- 5. parallel-safety


def test_concurrent_sandboxes_stay_isolated_and_correct() -> None:
    """Each SandboxedStrategy owns its own process; running several at once (as
    the async job runner will) must not cross-contaminate. Each gets a distinct
    quantity and must produce exactly its own fills."""
    adapter, dataset = _toy(n_steps=40)

    def run_one(quantity: int) -> list[float]:
        strategy = _sandboxed({"symbol": "SYN", "quantity": quantity}, BUY_AND_HOLD_SOURCE)
        result = run(strategy, adapter, dataset)
        strategy.close()
        return [fill.quantity for fill in result.fills]

    quantities = [1, 2, 3, 4, 5, 6, 7, 8]
    with ThreadPoolExecutor(max_workers=len(quantities)) as pool:
        results = list(pool.map(run_one, quantities))

    # Each run bought exactly its own quantity, once — no bleed between processes.
    assert results == [[float(q)] for q in quantities]
