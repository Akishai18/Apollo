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
- **Mock data** in `lib/mock.ts` is shaped like the API `Verdict` so wiring to
  FastAPI later is a swap.

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
