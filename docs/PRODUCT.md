# Apollo Product Spec

**Status:** working product definition  
**Last updated:** 2026-06-25  
**Codename:** project-green  

Apollo is a strategy development and validation workbench for algorithmic
trading. A user brings an idea, prompt, or code. Apollo turns it into a runnable
strategy, tests it honestly, explains the evidence, and refuses to treat the
strategy as credible until it survives validation.

The core product is not "AI writes trading code." The core product is:

> Can this strategy be trusted after it has been tested without lookahead and
> checked for overfit?

Natural-language generation is the on-ramp. The validation layer is the product.

---

## 1. Product Thesis

Most strategy tools make it too easy to believe a backtest. They show a nice
equity curve, let users tweak parameters until the chart looks good, and leave
the hardest question unanswered: did the strategy discover a repeatable edge, or
did the user just fit noise?

Apollo should be built around a stricter loop:

```text
Idea -> Strategy Draft -> Backtest -> Visualize -> Validate -> Decision
```

Each step has a different job:

- **Builder** turns intent into a concrete strategy artifact.
- **Backtest** lets the user experiment and debug behavior.
- **Visualizer** explains where performance came from.
- **Validation** decides whether the strategy survives unseen data.

The product should make this distinction obvious. Backtests are exploratory.
Validation is authoritative.

---

## 2. What Apollo Is

Apollo is:

- A workbench for developing algorithmic trading strategies.
- A validator that checks generated or hand-written strategies through the same
  trust pipeline.
- A reporting system that explains evidence: equity, drawdown, trades,
  walk-forward windows, parameter sweeps, retention, and failure reasons.
- A secure execution environment for untrusted strategy code.
- A general platform, not a competition-specific bot builder.

Apollo is not:

- A broker or live-trading execution platform at launch.
- A signal marketplace.
- A black-box "buy/sell" recommendation app.
- A guarantee that a passing strategy will make money in live markets.
- A tool that treats LLM output as trustworthy without testing it.

The strongest positioning:

> Apollo is where trading strategies go before they are trusted.

---

## 3. Users And Jobs

### Strategy Builder

The user has an idea but may not want to write all the code.

Job:
- Describe a strategy.
- Get a runnable implementation.
- See the assumptions Apollo made.
- Iterate quickly when the strategy fails or needs refinement.

Apollo must help them move from vague intent to explicit strategy logic.

### Code-First Researcher

The user can write Python and wants a rigorous testing harness.

Job:
- Paste or edit a `Strategy` subclass.
- Configure parameters and data.
- Run backtests and validation.
- Inspect evidence deeply.

Apollo must not hide the machine from this user.

### Skeptical Evaluator

The user wants to know whether a strategy deserves more attention.

Job:
- Review a run.
- Understand why it passed or failed.
- Compare strategy equity against benchmark behavior.
- Share or export the evidence.

Apollo must make the verdict legible and defensible.

---

## 4. Product Objects

These are the objects the product should organize around. Some exist today as
API/core objects; some are product-level concepts we should add.

### Strategy

The durable identity of an idea.

Examples:
- "AAPL mean reversion"
- "SPY moving-average crossover"
- "Nasdaq momentum rotation"

A strategy owns versions, runs, reports, and notes.

### Strategy Draft

A working version of a strategy.

Contains:
- Source code.
- Prompt or origin.
- Generated rationale.
- Assumptions.
- Default parameters.
- Editable parameter grid.
- Validation readiness state.

Drafts are allowed to be incomplete. They are where the user and AI collaborate.

### Strategy Version

A frozen draft at a point in time.

Used when:
- A run starts.
- A report is created.
- A validation verdict is attached.

This prevents later edits from changing the meaning of old evidence.

### Run

A single execution of a strategy version.

Run kinds:
- `backtest`: exploratory, user-configured.
- `validation`: stricter, verdict-producing.

Current code has `RunRequest`, `RunResponse`, `RunSummary`, and persisted run
state. Product-wise, we should make run kind explicit so the UI can avoid
blurring exploratory backtests with validation verdicts.

### Report

The human-readable evidence package for a run.

Contains:
- Verdict or run status.
- Key metrics.
- Equity and drawdown.
- Benchmark comparison.
- Walk-forward windows.
- Parameter sweep.
- Integrity checks.
- Trades.
- Source and config.

Reports should be bookmarkable and shareable.

### Validation Verdict

The formal trust decision.

States:
- `passed`: strategy survived the gate.
- `rejected`: strategy failed a specific rule.
- `inconclusive`: not enough data or evidence to make the call.
- `error`: strategy or infrastructure failed.

Current core supports pass/reject/error. Product-wise, `inconclusive` is useful
because "not enough evidence" is different from "bad strategy."

### Evidence Bundle

The structured data behind the report.

Includes:
- Equity series.
- Benchmark series.
- Drawdown series.
- OOS split markers.
- Window metrics.
- Sweep grids.
- Trade records.
- Integrity findings.

The visualizer should render from this object.

---

## 5. The Four Main Features

### 5.1 Builder

Builder is the chat-plus-editor surface. It is the first screen for most users.

#### Definition

Builder converts a strategy idea into a concrete, inspectable, runnable strategy
draft.

#### User capabilities

The user can:
- Describe a strategy in plain English.
- Paste existing Python strategy code.
- Ask Apollo to modify a strategy.
- See generated code.
- See assumptions and default parameters.
- Turn prompt numbers into sweepable parameters.
- Fix validation or syntax errors with AI assistance.
- Send the draft to Backtest or Validation.

#### Product rules

- Generated code is never trusted.
- Every generated strategy must pass static validation before running.
- The builder must expose assumptions, not hide them.
- The user should always be able to inspect and edit code.
- Prompt values should become defaults, not hardcoded constants, where possible.

#### Output

Builder produces a `StrategyDraft`.

Minimum target fields:

```text
id
strategy_id
version_number
title
source
prompt
rationale
assumptions[]
default_params
param_grid
class_name
created_at
updated_at
```

#### UI direction

Builder should feel like a strategy terminal, not a generic chat app:
- Chat input at the bottom.
- Code/build log in the main pane.
- Evidence/readiness panel on the side.
- Clear handoff buttons: Backtest, Validate, Save Version.

---

### 5.2 Backtest

Backtest is the lab.

#### Definition

Backtest runs a strategy against a selected data environment with explicit
configuration. It answers whether the strategy behaved well under that specific
configuration.

#### User capabilities

The user can:
- Edit strategy source.
- Select a template or draft.
- Configure data adapter, symbol, seed, date range, or synthetic series.
- Set starting cash and execution assumptions.
- Define train/test window sizes.
- Define parameter grids.
- Run the strategy.
- See progress while it runs.
- Inspect result metrics and logs.
- Push a promising result into Validation.

#### Product rules

- A backtest is not proof.
- A good backtest should invite validation, not declare victory.
- The UI should label backtests as exploratory.
- Backtests should still use the same sandbox and lookahead-safe engine.

#### Output

Backtest produces a `Run` with kind `backtest` and a report-style evidence
bundle. It may show a verdict-like status, but it should not be presented as a
formal trust decision unless the validation gate was run.

#### UI direction

The current backtester should continue moving toward the reference-report look:
- Thin header.
- Compact config panels.
- Code editor plus parameter grid.
- Right-side setup/integrity rail.
- Inline report after run.
- No decorative marketing surfaces.

---

### 5.3 Visualizer

Visualizer is the investigation layer.

#### Definition

Visualizer explains how and where a strategy made or lost money. It turns run
data into evidence the user can reason about.

#### User capabilities

The user can:
- View equity, drawdown, and benchmark lines.
- Toggle in-sample and out-of-sample periods.
- Inspect walk-forward windows.
- Inspect parameter-sweep heatmaps.
- Review trade records.
- Compare strategy behavior across versions or runs.
- Identify whether returns came from a narrow regime or broad robustness.

#### Product rules

- Visualizer should not be a separate data source. It renders the same evidence
  bundle used by reports.
- Every chart should answer a product question.
- Visuals should show uncertainty and fragility, not just performance.

#### Output

Visualizer does not create strategy logic by itself. It creates understanding:
annotations, selected windows, comparisons, and eventually saved observations.

#### UI direction

Visualizer should exist in two forms:

- Embedded inside reports and backtest results.
- Dedicated route for deeper inspection, likely `/app/visualizer`.

The dedicated route should let a user choose:
- Strategy.
- Version.
- Run.
- Chart mode.
- Comparison run.

---

### 5.4 Validation

Validation is the trust gate.

#### Definition

Validation runs the stricter walk-forward overfit gate and returns a formal,
legible decision about whether the strategy's edge survived out-of-sample.

#### User capabilities

The user can:
- Submit a strategy version to validation.
- Choose validation settings where appropriate.
- See queued, running, and completed states.
- Receive a pass, reject, inconclusive, or error result.
- Understand the exact reason for failure.
- Feed rejection reasons back into Builder.
- Save, share, or export the validation report.

#### Product rules

- Validation is the authoritative step.
- Validation must use the sandbox.
- Validation must preserve the lookahead-by-construction guarantee.
- Validation must show the train/OOS split clearly.
- A pass is not a trading recommendation; it is permission to continue research.
- A rejection should be actionable, not just negative.

#### Output

Validation produces:
- `ValidationVerdict`.
- Evidence bundle.
- Frozen strategy version.
- Shareable report.

#### UI direction

Validation should feel final and audit-like:
- Report first.
- Reason first.
- Evidence underneath.
- Source/config available.
- Clear next action: refine, re-run, archive, export.

---

## 6. Core Workflow

### Primary flow: natural language to validated strategy

```text
1. User opens Builder.
2. User describes a strategy.
3. Apollo generates a StrategyDraft.
4. Static checks run.
5. User reviews assumptions, code, and parameter grid.
6. User runs Backtest.
7. Apollo streams progress and displays report.
8. User opens Visualizer to inspect behavior.
9. User submits the frozen version to Validation.
10. Apollo runs the walk-forward gate.
11. Apollo returns pass/reject/inconclusive with evidence.
12. User decides: refine, save, export, or archive.
```

### Code-first flow

```text
1. User opens Backtest or Builder.
2. User pastes Strategy code.
3. Apollo detects class, validates imports, and extracts parameters.
4. User configures data and parameter grid.
5. User runs Backtest.
6. User inspects Visualizer.
7. User promotes a frozen version to Validation.
```

### Failed validation flow

```text
1. Validation rejects a strategy.
2. Report gives the reason: OOS collapse, insufficient trades, never profitable,
   unstable parameters, or integrity issue.
3. User clicks Refine.
4. Builder receives the strategy, config, and rejection reason.
5. Apollo proposes a specific edit.
6. User creates a new draft version.
7. The loop restarts.
```

This loop is the product's strongest compounding behavior.

---

## 7. State Model

Strategy-level lifecycle:

```text
empty
  -> draft
  -> runnable
  -> backtested
  -> investigated
  -> validated | rejected | inconclusive
  -> archived | exported
```

Run-level lifecycle:

```text
queued -> generating -> running -> completed
queued -> running -> completed
queued -> running -> error
```

Current API already supports:
- `queued`
- `generating`
- `running`
- `completed`
- `error`

Recommended additions:
- `Run.kind`: `backtest | validation`
- `Run.source_version_id`
- `Run.evidence`
- `Verdict.status`: `passed | rejected | inconclusive | error`

---

## 8. Information Architecture

Current routes:

- `/app`: Builder/workspace.
- `/app/backtest`: Backtest lab.
- `/app/dashboard`: Overview.
- `/app/strategies`: Strategy/run library.
- `/app/runs/[id]`: Report permalink.
- `/app/settings`: Account and billing.

Recommended product IA:

- `/app`: Builder.
- `/app/backtest`: Backtest lab.
- `/app/visualizer`: Deep evidence explorer.
- `/app/validation`: Validation queue and results.
- `/app/strategies`: Strategy library.
- `/app/strategies/[id]`: Strategy detail with versions and runs.
- `/app/runs/[id]`: Immutable run report.
- `/app/settings`: Account, billing, API keys.

Do not make every page equal. The product hierarchy should be:

```text
Builder -> Backtest -> Visualizer -> Validation -> Report
```

Dashboard and Strategies support this loop. They are navigation and history, not
the core product motion.

---

## 9. Page Responsibilities

### Builder `/app`

Owns:
- Prompting.
- Generation.
- Draft editing.
- Assumptions.
- Static errors.
- Handoff to Backtest and Validation.

Should not own:
- Deep charts.
- Full report inspection.
- Billing.

### Backtester `/app/backtest`

Owns:
- Strategy source input.
- Config form.
- Parameter grid.
- Running exploratory tests.
- Inline report preview.

Should not own:
- Strategy history management.
- Final validation queue.
- Multi-run comparison beyond simple local context.

### Visualizer `/app/visualizer`

Owns:
- Charts.
- Run comparisons.
- Trade inspection.
- Window-level investigation.
- Parameter robustness review.

Should not own:
- Code generation.
- Run submission, except loading existing evidence.

### Validation `/app/validation`

Owns:
- Formal validation runs.
- Queue/status.
- Pass/reject/inconclusive reports.
- Rejection reason handoff back to Builder.

Should not own:
- Exploratory parameter tweaking.

### Strategies `/app/strategies`

Owns:
- Library of strategies.
- Versions.
- Latest status.
- Recent runs.
- Filters and search.

Should not be just a run table forever. It should become the durable workspace.

### Report `/app/runs/[id]`

Owns:
- Immutable evidence.
- Run source.
- Config.
- Verdict.
- Export/share.

Reports should be understandable without the rest of the app.

---

## 10. Product Language

Use these terms consistently:

- **Strategy**: the user's trading idea as a durable object.
- **Draft**: editable strategy version.
- **Backtest**: exploratory historical run.
- **Visualizer**: evidence explorer.
- **Validation**: formal trust gate.
- **Verdict**: validation outcome.
- **Report**: shareable evidence artifact.
- **OOS**: out-of-sample, but spell it out on first use in public-facing copy.
- **Edge retained**: out-of-sample performance relative to in-sample performance.

Avoid:

- "Bot" as primary language.
- "Guaranteed profitable."
- "AI trader."
- "Signal."
- "Pass" as the only visible explanation.

Better:

- "Validated"
- "Rejected"
- "Inconclusive"
- "Needs more evidence"
- "Edge collapsed out-of-sample"
- "Survived the gate"

---

## 11. Trust Principles

Every feature should reinforce these principles.

### No future data exists in the strategy object

The strategy only receives a `MarketView` sliced at time `t`.

### Generated code gets no shortcut

LLM-generated strategies run through the same static checks, sandbox, backtest,
and validation path as pasted code.

### A backtest is not a verdict

Exploration and validation are different jobs.

### The report must explain itself

The user should understand why a strategy passed or failed without reading code.

### Failure is a product feature

A rejected strategy is valuable if the reason is specific and actionable.

---

## 12. Feature Contracts

### Builder contract

Input:
- Prompt or code.
- Optional context: symbol, timeframe, risk constraints, parameters.

Output:
- Strategy draft.
- Source code.
- Assumptions.
- Parameter grid.
- Static validation result.
- Recommended next action.

### Backtest contract

Input:
- Strategy version or raw source.
- Adapter config.
- Starting cash.
- Execution assumptions.
- Parameter grid.
- Window settings.

Output:
- Run ID.
- Progress stream.
- Metrics.
- Equity/drawdown/benchmark.
- Trades.
- Sweep results.
- Report preview.

### Visualizer contract

Input:
- Evidence bundle from one or more runs.

Output:
- Charts.
- Comparisons.
- Annotations or observations.
- Navigation to source report.

### Validation contract

Input:
- Frozen strategy version.
- Validation config.
- Data environment.

Output:
- Verdict.
- Reason.
- Window evidence.
- Robustness evidence.
- Integrity scan.
- Shareable report.

---

## 13. Build Implications

The current implementation already has much of the hard technical spine:

- Lookahead-safe core engine.
- Walk-forward overfit gate.
- Sandbox execution.
- Generator path.
- FastAPI runs and WebSocket progress.
- Durable run store.
- Auth boundary.
- Report UI.
- Backtest UI.
- Strategy list/dashboard.

The biggest missing product pieces are object-model clarity and page semantics:

1. **Add strategy drafts and versions.**
   - Today, runs are the durable object.
   - Product-wise, strategies should be durable and runs should attach to them.

2. **Separate backtest runs from validation runs.**
   - Add `Run.kind`.
   - Make Validation visually and semantically stricter.

3. **Create a dedicated Visualizer route.**
   - Reuse report components.
   - Add comparison and drilldown later.

4. **Create a Validation route or mode.**
   - The current report can render validation evidence.
   - The product still needs a clear place to start and review validation runs.

5. **Make failed validation feed Builder.**
   - Rejection reason plus code plus config should become a refinement prompt.

6. **Add export/share.**
   - Reports become useful artifacts only when they can leave the app.

---

## 14. MVP Product Shape

The near-term product should not try to be a full trading platform. It should
be excellent at this:

```text
Describe or paste a strategy.
Run it honestly.
Show the evidence.
Validate it rigorously.
Explain what to do next.
```

Minimum lovable feature set:

- Builder with prompt, generated code, assumptions, and static errors.
- Backtest lab with editable code/config/parameter grid.
- Report with verdict, metrics, equity, drawdown, benchmark, windows, heatmap,
  integrity scan, parameters, and trades.
- Strategy library with latest status.
- Validation action that produces a formal report.
- Failed-validation refinement loop.

Deferred:

- Live trading.
- Broker integration.
- Portfolio construction.
- Advanced execution modeling.
- Multi-user collaboration.
- Public marketplace.

---

## 15. Roadmap From Here

### Step 1: Product model

Add:
- `Strategy`
- `StrategyDraft`
- `StrategyVersion`
- `Run.kind`

Keep implementation simple. SQLite first is fine. The current `RunStore`
boundary can expand without changing the core engine.

### Step 2: Builder refinement

Turn `/app` from "chat that runs" into "strategy draft workbench":
- show current draft;
- show source;
- show assumptions;
- show parameters;
- show readiness;
- add Backtest and Validate actions.

### Step 3: Validation mode

Add a clear validation entry point:
- from Builder;
- from Backtest report;
- from Strategy detail;
- from Strategies table.

The validation result should be a report, not a toast.

### Step 4: Visualizer route

Create `/app/visualizer` using existing chart/report components:
- select run;
- inspect equity/drawdown;
- inspect windows;
- inspect sweep;
- inspect trades;
- compare runs later.

### Step 5: Strategy detail page

Create `/app/strategies/[id]`:
- strategy overview;
- draft/version history;
- latest backtests;
- latest validation;
- notes and assumptions.

### Step 6: Production hardening

Then finish:
- real market data adapter;
- Supabase auth with RS256/JWKS where applicable;
- Postgres store;
- hardened Docker/gVisor sandbox;
- export/share;
- paid model keys.

---

## 16. Success Criteria

Apollo is working when a user can:

- Describe a strategy in plain English.
- Understand the generated strategy before running it.
- Run an exploratory backtest.
- See whether performance came from robust behavior or a narrow fit.
- Submit the strategy to validation.
- Receive a clear pass, rejection, or inconclusive result.
- Use that result to refine or discard the strategy.
- Return later and understand the history of the strategy.

The product is excellent when users start trusting the process more than the
equity curve.

---

## 17. Open Decisions

- Should Validation be a dedicated route, a mode inside Backtest, or both?
  Recommendation: both. Dedicated route for queue/history, action entry points
  from Builder and Backtest.
- Should `inconclusive` be added to the core verdict model?
  Recommendation: yes, once real market data arrives.
- What is the first real market-data provider?
  Recommendation: choose based on clean OHLCV access and redistribution terms,
  not brand.
- Should users be able to override validation gates?
  Recommendation: allow configuration, but label non-default gates clearly.
- Should live trading exist?
  Recommendation: not until validation/reporting is strong enough that live
  trading feels like a natural extension instead of a distraction.
