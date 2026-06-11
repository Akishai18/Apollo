"""The untrusted side of the sandbox — runs as `python -s -P -m green.sandbox.runner`
inside its own process, locked down before a single line of strategy source executes.

Order of operations is the security argument:

1. Steal the real stdout (the protocol channel) and point `sys.stdout` at stderr,
   so nothing the strategy prints can ever forge a protocol frame.
2. Read the init frame (source, params, limits) while the process is still free.
3. Lock the kernel down with setrlimit: CPU budget, address-space cap, a file-size
   budget (the only writable regular file is the captured stderr), no child
   processes, and — the key trick — an RLIMIT_NOFILE ceiling at the highest fd
   already open, so every *new* file or socket open fails with EMFILE. No new
   fds means no network and no filesystem reads/writes, enforced by the kernel,
   not by patching builtins.
4. Only then `exec` the strategy source and start serving ticks.

Modules the strategy may legitimately need (math, statistics, green.core, ...)
are imported *before* lockdown so they are served from sys.modules without
touching the filesystem. Anything else fails to import — contained, legibly.

The lookahead guarantee gets stronger here, not weaker: this process only ever
receives bars up to `now`, one per tick. The future never crosses the process
boundary, so even hostile code has nothing to find.
"""

from __future__ import annotations

import collections
import contextlib
import fcntl
import itertools
import json
import math
import os
import resource
import signal
import statistics
import sys
import traceback
from typing import IO, Any, cast

import green.core
from green.core.marketview import MarketView
from green.core.models import Order
from green.core.strategy import Strategy

# Modules a strategy may legitimately use, imported pre-lockdown so they are
# served from sys.modules without filesystem access. Anything outside this
# cache fails to import once the fd ceiling is in place.
_PRELOADED = (collections, itertools, math, statistics, green.core)

_STDERR_BUDGET_BYTES = 10 * 1024 * 1024


def _list_open_fds(limit: int = 256) -> list[int]:
    """Probe (not enumerate via /dev/fd, which would itself open an fd)."""
    open_fds: list[int] = []
    for fd in range(limit):
        try:
            fcntl.fcntl(fd, fcntl.F_GETFD)
        except OSError:
            continue
        open_fds.append(fd)
    return open_fds


def _nofile_ceiling() -> int:
    """Ceiling for RLIMIT_NOFILE: highest open fd + 1, with every free slot
    below it plugged with /dev/null first. Existing fds (stdin, protocol,
    stderr) keep working; there is no allocatable slot left, so every new
    open()/socket() fails with EMFILE — at the kernel, not in Python."""
    open_fds = _list_open_fds()
    top = max(open_fds)
    while len(open_fds) < top + 1:
        os.open(os.devnull, os.O_RDONLY)  # lands in the lowest free slot
        open_fds = _list_open_fds()
    return top + 1


def _lockdown(limits: dict[str, Any]) -> None:
    """Best-effort kernel lockdown. Each limit is independent: a platform that
    rejects one (e.g. RLIMIT_AS on macOS) still gets all the others."""
    cpu_seconds = int(limits["cpu_seconds"])
    memory_bytes = int(limits["memory_bytes"])

    # Exceeding the file-size budget should surface as a contained OSError,
    # not a silent SIGXFSZ kill.
    with contextlib.suppress(AttributeError, OSError, ValueError):
        signal.signal(signal.SIGXFSZ, signal.SIG_IGN)

    for res_name, value in (
        ("RLIMIT_CPU", cpu_seconds),
        ("RLIMIT_AS", memory_bytes),
        ("RLIMIT_FSIZE", _STDERR_BUDGET_BYTES),
        ("RLIMIT_NPROC", 0),
        ("RLIMIT_NOFILE", _nofile_ceiling()),
    ):
        try:
            res_id = getattr(resource, res_name)
            resource.setrlimit(res_id, (value, value))
        except (AttributeError, OSError, ValueError):
            continue


class _ChildView(MarketView):
    """The strategy's window inside the sandbox. It accumulates exactly the bars
    the parent has sent — history and present; the future was never transmitted."""

    def __init__(self) -> None:
        self._now = -1
        self._series: dict[str, dict[str, list[float]]] = {}

    def push(self, now: int, bar: dict[str, dict[str, float]]) -> None:
        self._now = now
        for symbol, fields in bar.items():
            series = self._series.setdefault(symbol, {})
            for field, value in fields.items():
                series.setdefault(field, []).append(value)

    @property
    def now(self) -> int:
        return self._now

    def history(self, symbol: str, field: str, lookback: int) -> list[float]:
        if lookback <= 0:
            raise ValueError("lookback must be positive")
        return self._series[symbol][field][-lookback:]

    def last(self, symbol: str, field: str) -> float:
        return self._series[symbol][field][-1]

    def symbols(self) -> tuple[str, ...]:
        return tuple(self._series)

    def fields(self, symbol: str) -> tuple[str, ...]:
        return tuple(self._series[symbol])


def _send(proto: IO[str], message: dict[str, Any]) -> None:
    proto.write(json.dumps(message) + "\n")
    proto.flush()


def _discover(namespace: dict[str, Any], class_name: str | None) -> type[Strategy]:
    if class_name is not None:
        candidate = namespace.get(class_name)
        if not (isinstance(candidate, type) and issubclass(candidate, Strategy)):
            raise TypeError(f"{class_name!r} is not a Strategy subclass in the submitted source")
        return candidate

    defined = [
        obj
        for obj in namespace.values()
        if isinstance(obj, type)
        and issubclass(obj, Strategy)
        and obj is not Strategy
        and obj.__module__ == "strategy"  # defined here, not merely imported
    ]
    if len(defined) != 1:
        raise TypeError(
            f"expected exactly one Strategy subclass in the submitted source, found {len(defined)}"
        )
    return defined[0]


def _serve(proto: IO[str]) -> None:
    init = cast("dict[str, Any]", json.loads(sys.stdin.readline()))
    if init.get("type") != "init":
        raise ValueError("first frame must be init")

    _lockdown(cast("dict[str, Any]", init["limits"]))

    # ---- nothing above this line ran untrusted code; everything below does ----
    namespace: dict[str, Any] = {"__name__": "strategy"}
    exec(compile(cast("str", init["source"]), "<strategy>", "exec"), namespace)
    strategy_cls = _discover(namespace, cast("str | None", init.get("class_name")))
    strategy = strategy_cls(cast("dict[str, Any]", init["params"]))

    _send(proto, {"type": "ready"})

    view = _ChildView()
    while True:
        line = sys.stdin.readline()
        if not line:  # parent went away
            return
        message = cast("dict[str, Any]", json.loads(line))
        kind = message.get("type")
        if kind == "end":
            return
        if kind != "tick":
            raise ValueError(f"unexpected frame type {kind!r}")

        view.push(cast("int", message["now"]), cast("dict[str, dict[str, float]]", message["bar"]))
        # Untrusted code's return value is claims, not types — check at runtime.
        returned = cast("object", strategy.on_tick(view))
        if not isinstance(returned, list):
            raise TypeError("on_tick must return list[Order]")
        orders: list[Order] = []
        for item in cast("list[object]", returned):
            if not isinstance(item, Order):
                raise TypeError("on_tick must return list[Order]")
            orders.append(item)
        _send(proto, {"type": "orders", "orders": [o.model_dump(mode="json") for o in orders]})


def main() -> int:
    # The protocol channel is a private dup of the real stdout; sys.stdout is
    # rebound to stderr so strategy print() output cannot forge frames.
    proto = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    sys.stdout = sys.stderr

    try:
        _serve(proto)
    except BaseException:
        tail = traceback.format_exc(limit=5)[-2000:]
        with contextlib.suppress(OSError):
            _send(proto, {"type": "error", "message": tail})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
