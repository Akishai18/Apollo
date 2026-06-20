# web — Next.js frontend

The visual differentiator. Our edge is fundamentally visual (overfit curves,
equity curves, parameter-sweep heatmaps, "why we rejected this" panels) — this
is where it gets shown. Phase 5 in progress.

## Apollo design system (keep every page consistent)

Brand: **Apollo** (temp name). Positioning: lead with *build strategies fast by
describing them*; validation is the trust **kicker**, not the headline.

- **Aesthetic:** dark & atmospheric. Near-black base (`bg`) with a slowly
  drifting **aurora** behind the hero, near-white text, ONE indigo accent
  (`#5d6bff`). Premium, instrument-grade, sparse copy. (Inspired by nvestiv.com.)
- **Tokens** (in `app/globals.css` `@theme`): surfaces `bg`/`bg-soft`/`surface`/
  `surface-2`/`elevated`; text `text`/`text-dim`/`muted`/`faint`; `accent`/
  `accent-hi`/`accent-ink`; `pass`/`reject`; `line`/`line-strong`. Use opacity
  modifiers (`bg-white/8`, `accent/10`) for washes. Never raw hex.
- **Type:** `font-display` Space Grotesk · `font-sans` Inter · `font-mono`
  JetBrains Mono. **Every number/param/verdict is mono** (use `.nums` for tabular
  figures). Fonts load via next/font as `--ff-*`.
- **Background:** the hero uses a continuously-flowing **GPU shader**
  (`ShaderBackground` — domain-warped fbm fluid + drifting diagonal light beams,
  indigo→violet with warm glints, biased right). Real WebGL so motion is smooth,
  never a CSS ping-pong; renders one static frame under reduced-motion. Tune in
  the fragment shader.
- **Signature elements** (reuse, don't reinvent): the hero **rotating headline
  word**, the flowing shader background, the prompt-bar→app-preview
  vignette (`AppPreview`/`PromptBar` — sidebar + equity + agent build log + chat),
  the `WalkForward` train/held-out strips, and the `VerdictStamp` PASS/REJECTED
  artifact. Components live in `components/`.
- **Motion:** subtle and intentional — drifting aurora (CSS keyframes), crossfade
  rotating headline (framer-motion). Buttons are pills (`rounded-full`).
- **Rules:** Lucide icons only (no emoji), `cursor-pointer` + 150-300ms color
  transitions, `focusable` class for focus rings, `prefers-reduced-motion`
  respected (aurora freezes, headline shows a static word).
- **Wired to the live API.** `lib/api.ts` (REST + WebSocket client,
  `NEXT_PUBLIC_API_URL`, default `http://localhost:8000`) + `lib/report.ts`
  (maps the backend `Verdict` JSON → the report view-model). The app submits a
  real run, streams real progress, and renders the real verdict. Until the NL
  generator exists, a prompt maps to a backend **strategy template** (`GET
  /templates`) — the whole sandbox + gate runs for real; only NL→code is stubbed.
  `lib/mock.ts` still backs the **landing page** visuals.
- **Run it (two servers):** `uv run uvicorn green.api:app --port 8000` (needs
  `uvicorn[standard]` for WebSockets) + `npm run dev` (port 3000; CORS allows it).
  Auth is off in dev (API resolves a fixed user), so no token needed yet.

## The app (`/app`) — workspace

- **Shell** (`components/app/app-shell.tsx`): static sidebar on desktop, off-canvas
  drawer on mobile. Sidebar = search (⌘K affordance), time-grouped strategy
  threads with state dots, Companion slot, user.
- **Workspace** (`workspace.tsx`): prompt-first conversation thread. Empty =
  `Launchpad` (centered greeting + composer + archetype cards + stat pulse). After
  submit = a thread of `RunResult`s with a docked composer; each run streams its
  build (`BuildingState`) then resolves into the inline `VerdictReport`. `submit()`
  matches the prompt to a mock scenario so the report stays coherent. (A split
  "conversation + persistent report canvas" variant was tried and reverted — keep
  the thread unless revisiting that.)
- **The signature artifact** is `VerdictReport` (`verdict-report.tsx`): the verdict
  is an *inspectable report* — header + 6 metric tiles + segmented tabs
  (Equity / Windows / Sweep) + reasoning + action row. This is Apollo's unique UI;
  no other trading app turns a backtest into a legible audit.
- **Data-viz** (`report-viz.tsx`, hand-rolled SVG/CSS, no chart lib):
  `EquityReport` (in-sample→held-out split, divider, gridlines, % axis, gradient,
  animated draw-in via `.draw-line`), `SweepHeatmap` (param grid colored by
  Sharpe; robust = broad green, overfit = lone hot cell), `WindowBars` (per-window
  train vs held-out), `MetricTile`. The overfit *story* is told visually — keep it.

## Stack

- **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui**.
- Charts: **TradingView lightweight-charts** for price/equity; **Plotly or visx**
  for overfit curves and parameter-sweep heatmaps.
- Talks to the FastAPI backend over **REST + WebSocket** (live progress).

## Rule

Frontend holds **no business logic**. All strategy execution, validation, and
scoring happen in the Python backend; the web layer fetches, streams, and renders.
If you're tempted to compute a verdict here, it belongs in `validation`.

## The screens that matter

- Strategy editor (write/paste, or NL prompt that routes to the generator).
- Equity curve + metrics for a run.
- Overfit-gate verdict: in-sample vs. forward-window curves, legible pass/fail.
- Parameter-sweep heatmap.
- "Why we rejected this" panel — the reason, with evidence.
