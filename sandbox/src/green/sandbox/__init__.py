"""green.sandbox — process isolation around untrusted strategy code.

The third differentiator: `on_tick` runs in a separate, kernel-locked-down
process; only a JSON-line protocol crosses the boundary. Depends on green-core
only (the cardinal rule), and the engine never knows it's running sandboxed
code — `SandboxedStrategy` is just a `Strategy`.
"""

from green.sandbox.executor import (
    ProtocolViolation,
    SandboxedStrategy,
    SandboxError,
    SandboxLimits,
    StrategyCrash,
    StrategyExecutor,
    StrategyTimeout,
    SubprocessExecutor,
)

__all__ = [
    "ProtocolViolation",
    "SandboxError",
    "SandboxLimits",
    "SandboxedStrategy",
    "StrategyCrash",
    "StrategyExecutor",
    "StrategyTimeout",
    "SubprocessExecutor",
]
