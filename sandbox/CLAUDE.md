# sandbox — the untrusted-code boundary

Running untrusted, possibly LLM-generated Python on our servers is the real new
infra cost of being a web platform. This layer contains it — and it *completes*
the lookahead guarantee: the strategy runs in another process that only ever
receives bars up to `now`, so the future never crosses the process boundary.

## Dependency rule

`green-sandbox` depends on **green-core only**. It must never import adapters,
api, validation, or the generator.

## Threat model

- The **only** untrusted code is the strategy source (its imports, class body,
  `__init__`, and `on_tick`). The engine, adapters, recorder, and gate are
  trusted and run normally in the parent.
- The boundary is drawn tightly around the strategy: the parent forwards one
  bar per tick and validates the orders that come back. Nothing else crosses.
- Strategies enter as **source-code strings**, never as objects. The protocol
  is JSON lines — **never pickle** (unpickling untrusted bytes is RCE).

## How it works (executor.py = trusted parent, runner.py = untrusted child)

```
SandboxedStrategy (a Strategy — engine/gate can't tell)
    └─ StrategyExecutor (the seam)
         └─ SubprocessExecutor ── JSON lines ──> python -s -P -m green.sandbox.runner
                                                   1. steal real stdout (protocol fd),
                                                      point sys.stdout at stderr
                                                   2. read init (source/params/limits)
                                                   3. setrlimit lockdown
                                                   4. exec source, serve ticks
```

Child lockdown is **kernel-level**, not monkeypatching: RLIMIT_CPU, RLIMIT_AS
(best-effort on macOS), a file-size budget for the captured stderr,
RLIMIT_NPROC=0, and the key trick — an **RLIMIT_NOFILE ceiling** at the highest
open fd with every free slot below it plugged, so *any* new file or socket open
fails with EMFILE. Modules a strategy legitimately needs (math, statistics,
collections, itertools, green.core) are pre-imported before lockdown; anything
else fails to import — contained, legibly.

Parent-side enforcement: per-init and per-tick wall-clock deadlines
(select-based reads), frame-size cap, max-orders-per-tick cap,
`Order.model_validate` on everything the child returns, SIGKILL of the whole
process group on timeout/violation, child stderr tail attached to crashes.

## Invariants (do not weaken)

- Determinism: child env is built from scratch (`PYTHONHASHSEED=0`, nothing
  inherited); same source + params + bars ⇒ same orders.
- Fidelity: a sandboxed run must be **bit-identical** to the native run (JSON
  floats round-trip exactly). The flagship test runs the whole walk-forward
  gate through `SandboxedStrategy` and asserts verdict equality — keep it.
- `SandboxedStrategy` is **single-run**: the child accumulates history, so
  reuse across runs would be a state leak. It refuses; the gate constructs a
  fresh instance per run anyway.
- Failures are typed and legible: `StrategyCrash` / `StrategyTimeout` /
  `ProtocolViolation` (all `SandboxError`). Never let child garbage surface as
  parent corruption.

## Hardening path

- v1: `SubprocessExecutor` — process separation + rlimits. A hostile-*strategy*
  wall (good against misbehaving/adversarial strategy code).
- Production wall: `DockerExecutor` (built) speaks the **same protocol** over
  `docker run -i --network=none --read-only --cap-drop=ALL
  --security-opt=no-new-privileges --memory --pids-limit` (see `sandbox/Dockerfile`;
  build from the repo root). Both share the `_PipeExecutor` base, so the
  transports can't drift; the runner's setrlimit lockdown still applies inside
  the container (defense in depth). This is the wall against an interpreter
  0-day, not just a hostile strategy. Daemon-gated tests cover it; CI/macOS
  without a daemon skip them.
- Later, multi-user scale: gVisor / Firecracker microVMs or a managed runner.
