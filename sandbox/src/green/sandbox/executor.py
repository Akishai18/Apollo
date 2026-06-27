"""The trusted side of the sandbox.

An executor owns a locked-down child process running the strategy (see
runner.py) and speaks a JSON-line protocol with it — never pickle, which would
hand untrusted bytes a code path back into this process. `SandboxedStrategy`
wraps an executor in the `Strategy` contract so the engine and the overfit gate
run sandboxed code without knowing it: same loop, same gate, the strategy just
lives elsewhere.

Why this completes the lookahead guarantee: the parent forwards exactly one bar
per tick — the view's present, enumerated through the same `MarketView` that is
already physically sliced. Future data never crosses the process boundary, so
even adversarial code has nothing to inspect.

The protocol is the seam. `_PipeExecutor` owns it; subclasses differ only in how
they *launch* and *kill* the child:

- `SubprocessExecutor` — a locked-down child process (rlimits). The robust v1.
- `DockerExecutor` — the same protocol over `docker run -i --network=none`
  (read-only fs, hard memory cap, dropped capabilities). The production wall.

Because both speak the identical protocol, hardening is a swap, not a rewrite.
"""

from __future__ import annotations

import contextlib
import json
import os
import select
import signal
import subprocess
import sys
import tempfile
import time
import uuid
import weakref
from abc import ABC, abstractmethod
from typing import IO, Any, NoReturn, cast

from pydantic import BaseModel, ConfigDict, ValidationError

from green.core.marketview import MarketView
from green.core.models import Order
from green.core.strategy import Strategy


class SandboxLimits(BaseModel):
    model_config = ConfigDict(frozen=True)

    init_seconds: float = 10.0  # budget to exec source + construct the strategy
    tick_seconds: float = 1.0  # wall-clock budget per on_tick
    cpu_seconds: int = 30  # kernel CPU budget for the whole run (RLIMIT_CPU)
    memory_bytes: int = 512 * 1024 * 1024  # RLIMIT_AS / container --memory
    max_orders_per_tick: int = 100
    max_line_bytes: int = 1_000_000  # protocol frame size cap


class SandboxError(Exception):
    """Base: anything that went wrong on the other side of the boundary."""


class StrategyCrash(SandboxError):
    """The strategy raised, failed to build, or its process died."""


class StrategyTimeout(SandboxError):
    """The strategy exceeded its wall-clock budget and was killed."""


class ProtocolViolation(SandboxError):
    """The child sent something that is not valid protocol — treated as hostile."""


class StrategyExecutor(ABC):
    """Where untrusted code actually runs. The seam between 'sandboxed at all'
    and 'how hard the wall is' (subprocess+rlimits now, Docker later)."""

    @abstractmethod
    def start(self, source: str, class_name: str | None, params: dict[str, Any]) -> None: ...

    @abstractmethod
    def tick(self, now: int, bar: dict[str, dict[str, float]]) -> list[Order]: ...

    @abstractmethod
    def close(self) -> None: ...


class _PipeExecutor(StrategyExecutor):
    """All the JSON-line protocol machinery, shared by every concrete executor.

    Subclasses implement only `_spawn` (how the child is launched) and
    `_force_kill` (how it is hard-killed). Everything else — framing, deadlines,
    order validation, legible typed failures — lives here so the two transports
    cannot drift apart."""

    def __init__(self, limits: SandboxLimits | None = None) -> None:
        self.limits = limits or SandboxLimits()
        self._proc: subprocess.Popen[bytes] | None = None
        self._workdir: tempfile.TemporaryDirectory[str] | None = None
        self._stderr_path = ""
        self._buffer = b""

    # ----------------------------------------------------------- subclass API

    @abstractmethod
    def _spawn(self, stderr_file: IO[bytes]) -> subprocess.Popen[bytes]:
        """Launch the child with stdin/stdout pipes and stderr to `stderr_file`."""
        ...

    @abstractmethod
    def _force_kill(self, proc: subprocess.Popen[bytes]) -> None:
        """Hard-kill the child (and anything it spawned) and reap it."""
        ...

    # ------------------------------------------------------------- lifecycle

    def start(self, source: str, class_name: str | None, params: dict[str, Any]) -> None:
        if self._proc is not None:
            raise SandboxError("executor already started")
        # The protocol failure paths (_crash/_violation/_timeout) clean up before
        # they raise; this guard catches the *other* failures — a Popen that
        # won't launch, set_blocking, etc. — so a half-started child or its temp
        # dir is never orphaned. close() is idempotent, so double-cleanup is safe.
        try:
            self._workdir = tempfile.TemporaryDirectory(prefix="green-sandbox-")
            self._stderr_path = os.path.join(self._workdir.name, "stderr.log")
            with open(self._stderr_path, "wb") as stderr_file:
                self._proc = self._spawn(stderr_file)
            os.set_blocking(self._stdout_fd(), False)

            self._send(
                {
                    "type": "init",
                    "source": source,
                    "class_name": class_name,
                    "params": params,
                    "limits": self.limits.model_dump(),
                }
            )
            message = self._read_message(
                time.monotonic() + self.limits.init_seconds, what="strategy init"
            )
            if message.get("type") == "error":
                self._crash(f"strategy failed to initialize:\n{message.get('message', '')}")
            if message.get("type") != "ready":
                self._violation(f"expected ready frame, got {message.get('type')!r}")
        except SandboxError:
            raise  # already cleaned up by _crash/_violation/_timeout
        except BaseException:
            self.close()
            raise

    def tick(self, now: int, bar: dict[str, dict[str, float]]) -> list[Order]:
        if self._proc is None:
            raise SandboxError("executor not started")
        self._send({"type": "tick", "now": now, "bar": bar})
        message = self._read_message(
            time.monotonic() + self.limits.tick_seconds, what=f"on_tick(t={now})"
        )
        if message.get("type") == "error":
            self._crash(f"strategy crashed at t={now}:\n{message.get('message', '')}")
        if message.get("type") != "orders":
            self._violation(f"expected orders frame, got {message.get('type')!r}")

        raw_orders = message.get("orders")
        if not isinstance(raw_orders, list):
            self._violation("orders frame without a list of orders")
        raw_orders = cast("list[Any]", raw_orders)
        if len(raw_orders) > self.limits.max_orders_per_tick:
            self._violation(
                f"{len(raw_orders)} orders in one tick (limit {self.limits.max_orders_per_tick})"
            )
        try:
            return [Order.model_validate(raw) for raw in raw_orders]
        except ValidationError as exc:
            self._violation(f"order failed validation: {exc}")

    def close(self) -> None:
        proc, self._proc = self._proc, None
        if proc is not None:
            if proc.poll() is None:
                try:
                    assert proc.stdin is not None
                    proc.stdin.write(b'{"type": "end"}\n')
                    proc.stdin.flush()
                    proc.wait(timeout=1.0)
                except (OSError, subprocess.TimeoutExpired):
                    self._force_kill(proc)
            if proc.stdin is not None:
                proc.stdin.close()
            if proc.stdout is not None:
                proc.stdout.close()
        if self._workdir is not None:
            self._workdir.cleanup()
            self._workdir = None

    # ------------------------------------------------------------------ wire

    def _stdout_fd(self) -> int:
        assert self._proc is not None and self._proc.stdout is not None
        return self._proc.stdout.fileno()

    def _send(self, message: dict[str, Any]) -> None:
        assert self._proc is not None and self._proc.stdin is not None
        try:
            self._proc.stdin.write(json.dumps(message).encode() + b"\n")
            self._proc.stdin.flush()
        except OSError:
            self._crash("strategy process is gone (write failed)")

    def _read_message(self, deadline: float, *, what: str) -> dict[str, Any]:
        fd = self._stdout_fd()
        while True:
            newline = self._buffer.find(b"\n")
            if newline >= 0:
                line, self._buffer = self._buffer[:newline], self._buffer[newline + 1 :]
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    self._violation("child wrote a non-JSON protocol line")
                if not isinstance(parsed, dict):
                    self._violation("protocol frame is not an object")
                return cast("dict[str, Any]", parsed)

            if len(self._buffer) > self.limits.max_line_bytes:
                self._violation("protocol line exceeds size cap")

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self._timeout(what)
            ready, _, _ = select.select([fd], [], [], remaining)
            if not ready:
                self._timeout(what)
            try:
                chunk = os.read(fd, 65536)
            except BlockingIOError:  # spurious wakeup
                continue
            if chunk == b"":
                self._crash(f"strategy process died during {what}")
            self._buffer += chunk

    # ----------------------------------------------------------------- death

    def _kill_then_close(self) -> None:
        """For hostile/hung children: no graceful end frame, hard-kill first."""
        if self._proc is not None:
            self._force_kill(self._proc)
        self.close()

    def _stderr_tail(self, max_bytes: int = 2000) -> str:
        try:
            with open(self._stderr_path, "rb") as f:
                return f.read()[-max_bytes:].decode(errors="replace")
        except OSError:
            return ""

    def _crash(self, message: str) -> NoReturn:
        tail = self._stderr_tail()
        self.close()
        raise StrategyCrash(message + (f"\n--- child stderr ---\n{tail}" if tail else ""))

    def _timeout(self, what: str) -> NoReturn:
        self._kill_then_close()
        raise StrategyTimeout(
            f"{what} exceeded its wall-clock budget; the strategy process was killed"
        )

    def _violation(self, message: str) -> NoReturn:
        self._kill_then_close()
        raise ProtocolViolation(message)


class SubprocessExecutor(_PipeExecutor):
    """v1: the strategy runs in a separate Python process locked down with
    setrlimit (see runner.py). Robust against a hostile *strategy*; the hard
    container wall is `DockerExecutor`."""

    def _spawn(self, stderr_file: IO[bytes]) -> subprocess.Popen[bytes]:
        assert self._workdir is not None
        # -s/-P: no user site-packages, no cwd on sys.path. The env is built from
        # scratch (nothing inherited); the hash seed is pinned so the child is
        # deterministic. New session => one killpg reaps the whole group.
        return subprocess.Popen(
            [sys.executable, "-s", "-P", "-m", "green.sandbox.runner"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=stderr_file,
            cwd=self._workdir.name,
            env={"PYTHONHASHSEED": "0"},
            start_new_session=True,
        )

    def _force_kill(self, proc: subprocess.Popen[bytes]) -> None:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGKILL)  # pgid == pid (new session)
        proc.wait()


class DockerExecutor(_PipeExecutor):
    """The production wall: the strategy runs inside a container with no network,
    a read-only root filesystem, a hard memory cap, dropped capabilities, and a
    PID limit. Same JSON protocol over the container's stdin/stdout — the rest of
    the system cannot tell the difference (sandboxed runs stay bit-identical).

    The runner's own setrlimit lockdown still applies inside the container:
    defense in depth, container walls plus kernel rlimits.
    """

    def __init__(
        self,
        limits: SandboxLimits | None = None,
        *,
        image: str = "green-sandbox:latest",
        docker_bin: str = "docker",
        cpus: float = 1.0,
        pids_limit: int = 64,
    ) -> None:
        super().__init__(limits)
        self.image = image
        self.docker_bin = docker_bin
        self.cpus = cpus
        self.pids_limit = pids_limit
        self._container = ""

    @classmethod
    def is_available(cls, docker_bin: str = "docker", image: str = "green-sandbox:latest") -> bool:
        """True if a Docker daemon and the sandbox image are available."""
        try:
            result = subprocess.run(
                [docker_bin, "info"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return False
        if result.returncode != 0:
            return False
        try:
            image_result = subprocess.run(
                [docker_bin, "image", "inspect", image],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return False
        return image_result.returncode == 0

    def _build_command(self, container: str) -> list[str]:
        """The hardened `docker run` invocation — the wall this executor promises.
        Extracted so it is assertable without a daemon."""
        memory = str(self.limits.memory_bytes)
        return [
            self.docker_bin,
            "run",
            "--rm",
            "-i",
            "--name",
            container,
            "--network=none",  # no network namespace at all
            "--read-only",  # immutable root filesystem
            "--cap-drop=ALL",  # no Linux capabilities
            "--security-opt=no-new-privileges",
            f"--memory={memory}",
            f"--memory-swap={memory}",  # == memory => swap disabled, hard cap
            f"--cpus={self.cpus}",
            f"--pids-limit={self.pids_limit}",
            self.image,
            "python",
            "-s",
            "-P",
            "-m",
            "green.sandbox.runner",
        ]

    def _spawn(self, stderr_file: IO[bytes]) -> subprocess.Popen[bytes]:
        self._container = f"green-sandbox-{uuid.uuid4().hex}"
        # The docker *client* inherits the host env (DOCKER_HOST etc.); isolation
        # is the container, not the client process.
        return subprocess.Popen(
            self._build_command(self._container),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=stderr_file,
        )

    def _force_kill(self, proc: subprocess.Popen[bytes]) -> None:
        # Killing the `docker run` client does not stop the container — name it
        # and `docker kill` it. --rm then reaps it.
        with contextlib.suppress(OSError, subprocess.SubprocessError):
            subprocess.run(
                [self.docker_bin, "kill", self._container],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
                check=False,
            )
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=10)


class SandboxedStrategy(Strategy):
    """A `Strategy` whose on_tick happens in another, locked-down process.

    Drop-in for the engine and the gate: `run_walk_forward` with a factory of
    `SandboxedStrategy` validates untrusted source with the exact same machinery
    as trusted code. One instance == one run (the gate already constructs a
    fresh strategy per run); reuse across runs is refused, because the child
    keeps accumulated history and silently restarting it would hide state leaks.
    """

    def __init__(
        self,
        params: dict[str, Any],
        *,
        source: str,
        class_name: str | None = None,
        executor: StrategyExecutor | None = None,
    ) -> None:
        super().__init__(params)
        self._executor = executor or SubprocessExecutor()
        self._next = 0
        self._executor.start(source, class_name, params)
        self._finalizer = weakref.finalize(self, self._executor.close)

    def on_tick(self, view: MarketView) -> list[Order]:
        if view.now != self._next:
            raise SandboxError(
                f"SandboxedStrategy is single-run: expected tick {self._next}, "
                f"got {view.now}. Construct a fresh instance per run."
            )
        self._next += 1
        bar = {
            symbol: {field: view.last(symbol, field) for field in view.fields(symbol)}
            for symbol in view.symbols()
        }
        return self._executor.tick(view.now, bar)

    def close(self) -> None:
        self._finalizer()
