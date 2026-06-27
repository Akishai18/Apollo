# Deploying Apollo — Render (API) + Vercel (web) + Supabase

Three managed pieces:

- **Supabase** — Postgres + Auth (already in your `.env`).
- **Render** — the FastAPI API (`Dockerfile` + `render.yaml`), the only piece that
  needs a long-running container (WebSockets + sandboxed subprocesses).
- **Vercel** — the Next.js web app (`web/`).

Do them in this order — the API URL and the web URL each feed the other.

---

## 1. Supabase — run the schema (once)
1. Supabase project → **SQL Editor** → paste `api/migrations/0001_init.sql` → **Run**.
2. Confirm the `runs` / `strategies` / `strategy_drafts` / `strategy_versions`
   tables exist with RLS enabled.
3. Grab, from **Project Settings → Database**, the **pooled** connection string
   (port 6543) → this is `GREEN_DATABASE_URL`. Your `.env` already has it.

## 2. Render — deploy the API
1. Push the repo to GitHub.
2. Render → **New → Blueprint** → pick the repo (it reads `render.yaml`).
3. In the service's **Environment** tab, set the `sync:false` secrets:
   - `GREEN_DATABASE_URL` — the Supabase pooled string
   - `GREEN_SUPABASE_URL` — `https://<ref>.supabase.co` (enables JWKS auth)
   - `GEMINI_API_KEY`
   - `GREEN_DATABRICKS_HOST`, `GREEN_DATABRICKS_HTTP_PATH`, `GREEN_DATABRICKS_TOKEN`, `GREEN_MARKET_TABLE`
   - optional: `GREEN_MLFLOW_TRACKING_URI=databricks`, `GREEN_MLFLOW_EXPERIMENT`
   - `GREEN_CORS_ORIGINS` — leave blank for now (set in step 4)
4. Deploy. Health check is `GET /healthz`. Copy the service URL, e.g.
   `https://apollo-api.onrender.com`.

> Note: the **free** plan sleeps on idle (cold start ~30s, drops WebSockets).
> Use **starter** to keep it warm — `render.yaml` defaults to starter.

## 3. Vercel — deploy the web app
1. Vercel → **Add New → Project** → import the repo.
2. **Root Directory:** `web`.
3. **Environment Variables:**
   - `NEXT_PUBLIC_API_URL` = the Render API URL from step 2
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = Supabase anon key
4. Deploy. Copy the web URL, e.g. `https://apollo.vercel.app`.

## 4. Wire CORS + Auth back
1. **Render** → set `GREEN_CORS_ORIGINS` = your Vercel URL
   (comma-separated if more than one) → redeploy/restart.
2. **Supabase** → **Authentication → URL Configuration** → set **Site URL** and
   **Redirect URLs** to the Vercel domain (needed for email confirm / Google OAuth).
   If using Google sign-in, enable the Google provider there too.

## 5. Verify
- Open the Vercel URL → sign up / log in.
- Run "build a strategy on the SLS stock" → it should generate, validate on the
  Databricks Delta data, and stream a verdict.
- `GET https://<api>/healthz` returns `{"status":"ok"}`.

---

## Before opening it to the public
The gate runs **untrusted generated code**. Today's sandbox blocks net/fs and
caps CPU/mem/time, but is subprocess-level, not container-isolated. For a
private/invited beta that's acceptable. **Before a public launch**, harden it
(build `sandbox/Dockerfile` and switch the executor to the Docker/gVisor path),
and keep the API on a host where each run is contained.

## Scheduled jobs (after deploy)
`scripts/revalidate.py` and `scripts/decay_alerts.py` hit the API, so run them on
a scheduler (cron / GitHub Actions) pointed at the Render URL with
`GREEN_API_URL` (+ `GREEN_API_TOKEN` if auth is on). Market-data ingestion stays
a Databricks Job (see `scripts/databricks_ingest.py`).
