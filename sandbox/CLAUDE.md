# sandbox — the untrusted-code boundary

Running untrusted, possibly LLM-generated Python on our servers is the real new
infra cost of being a web platform. This layer contains it.

## Threat model

- The **only** untrusted code is `Strategy.on_tick`. The engine, adapters,
  recorder, and validation are trusted and run normally.
- Draw the sandbox tightly around just the strategy call — that keeps it fast and
  keeps the trusted parts simple.

## Isolation requirements

- No network. No filesystem access (or strictly read-only, scoped).
- CPU, memory, and wall-clock limits; kill infinite loops via timeout.
- Deterministic where possible (no clock/entropy leakage that breaks repro).

## Implementation seam

Expose a `StrategyExecutor` interface so the engine never hard-codes *how*
`on_tick` runs:

- v1: **Docker** container per run (no net, read-only fs, resource caps).
- Production-impressive path: **gVisor** or **Firecracker** microVMs, or a
  managed runner (Modal/e2b). Implement when we go multi-user.

For the Phase 1 skeleton the executor may run in-process (the boundary is just
the `on_tick` call) — but the seam exists from the start so hardening is a swap,
not a rewrite.
