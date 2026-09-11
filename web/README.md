# Apollo — web

The Next.js front end for Apollo: the public landing page plus the
authenticated app (strategy builder, backtest, visualizer, validation,
report, and experiments views). It is a thin client over the FastAPI
backend in `../api`; all validation logic lives server-side.

## Run locally

```sh
cp .env.example .env.local   # NEXT_PUBLIC_API_URL, optional Supabase keys
npm install
npm run dev                  # http://localhost:3000
```

Start the API from the repository root first:

```sh
uv run uvicorn green.api:app --reload
```

With the Supabase variables unset the app runs in local dev mode (no login);
set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to enable
real sign-in and per-user data.

## Stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · framer-motion ·
Supabase JS for browser auth. Deployed on Vercel with `web` as the root
directory (see `../deploy/README.md`).
