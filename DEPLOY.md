# Deploying Apollo — AWS Lightsail (API) + Vercel (web) + Supabase

Three managed pieces:

- **Supabase** — Postgres + Auth (already in your `.env`).
- **AWS Lightsail container service** — the FastAPI API (`Dockerfile`), the only
  piece that needs a long-running container (WebSockets + sandboxed subprocesses).
  $7/mo nano tier; GitHub Actions builds and deploys on every push to main.
- **Vercel** — the Next.js web app (`web/`).

> History: the API originally ran on Render (`render.yaml` is the legacy
> blueprint — delete it once the Lightsail cutover is verified). The Lightsail
> setup mirrors the SignalM migration playbook
> (`~/Downloads/AWS_LIGHTSAIL_MIGRATION_SUMMARY.md`).

---

## 1. Supabase — run the schema (once)
1. Supabase project → **SQL Editor** → paste `api/migrations/0001_init.sql` → **Run**.
2. Confirm the `runs` / `strategies` / `strategy_drafts` / `strategy_versions`
   tables exist with RLS enabled.
3. Grab, from **Project Settings → Database**, the **pooled** connection string
   (port 6543) → this is `GREEN_DATABASE_URL`.

## 2. AWS — one-time setup (CloudShell, ~10 min)
1. AWS console → **CloudShell** → Actions → **Upload file** → `aws-apollo-setup.sh`
   (upload the file; don't paste — long pastes get mangled).
2. `bash aws-apollo-setup.sh` — creates the ECR repo (`apollo-api`), the GitHub
   OIDC deploy role (`apollo-github-deploy`, trust pinned to `Akishai18/trade`),
   and the Lightsail container service (`apollo-api`, nano) with ECR pulling
   enabled.
3. Copy the two values it prints: the **deploy role ARN** and the **service URL**.

## 3. GitHub — variables, secrets, first deploy
1. Repo → Settings → Secrets and variables → Actions:
   - **Variables:** `AWS_REGION` = `us-east-1`, `AWS_DEPLOY_ROLE_ARN` = the ARN
     from step 2.
   - **Secrets** (values from your `.env` / old Render Environment tab):
     `GREEN_DATABASE_URL`, `GREEN_SUPABASE_URL`, `GREEN_CORS_ORIGINS`,
     `GEMINI_API_KEY`, `GREEN_DATABRICKS_HOST`, `GREEN_DATABRICKS_HTTP_PATH`,
     `GREEN_DATABRICKS_TOKEN`, `GREEN_MARKET_TABLE`; optional:
     `ANTHROPIC_API_KEY`, `GREEN_MLFLOW_TRACKING_URI`, `GREEN_MLFLOW_EXPERIMENT`.
     Unset optional secrets are simply omitted from the container env.
2. Actions tab → **Deploy API to Lightsail** → **Run workflow** (or just push to
   main). The workflow builds the image, pushes to ECR, deploys, and polls until
   the service is RUNNING. (Until `AWS_DEPLOY_ROLE_ARN` is set the job skips
   itself, so CI stays green.)
3. Verify: `GET https://<service-url>/healthz` returns `{"status":"ok"}`.

## 4. Vercel — deploy the web app
1. Vercel → **Add New → Project** → import the repo. **Root Directory:** `web`.
2. **Environment Variables:**
   - `NEXT_PUBLIC_API_URL` = the Lightsail service URL (no trailing slash)
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = Supabase anon key
3. Deploy. Copy the web URL, e.g. `https://apollo.vercel.app`.

## 5. Wire CORS + Auth back
1. GitHub secret `GREEN_CORS_ORIGINS` = your Vercel URL (comma-separated if
   more than one) → re-run the deploy workflow.
2. **Supabase** → **Authentication → URL Configuration** → set **Site URL** and
   **Redirect URLs** to the Vercel domain (needed for email confirm / Google
   OAuth). If using Google sign-in, enable the Google provider there too.

## 6. Verify
- Open the Vercel URL → sign up / log in.
- Run "build a strategy on the SLS stock" → it should generate, validate on the
  Databricks Delta data, and stream a verdict over the WebSocket.

---

## Sizing
Nano (0.25 vCPU / 512 MB) is half the CPU of the old Render starter, so
backtests run ~2× slower. If that bites, one command bumps the tier
(micro $10 = 1 GB RAM; small $15 = 0.5 vCPU, the true Render match):

```sh
aws lightsail update-container-service --service-name apollo-api --power small
```

## Before opening it to the public
The gate runs **untrusted generated code**. Today's sandbox blocks net/fs and
caps CPU/mem/time, but is subprocess-level, not container-isolated. For a
private/invited beta that's acceptable. **Before a public launch**, harden it
(build `sandbox/Dockerfile` and switch the executor to the Docker/gVisor path).
Note: the Docker executor needs a real Docker daemon, which Lightsail
*container services* cannot provide (no Docker-in-Docker) — hardening means
moving the API to a host you control, e.g. a Lightsail VPS instance
(~$12/mo, 2 GB / 2 vCPU) running Docker + Caddy.

## Scheduled jobs (after deploy)
`scripts/revalidate.py` and `scripts/decay_alerts.py` hit the API, so run them on
a scheduler (cron / GitHub Actions) pointed at the Lightsail URL with
`GREEN_API_URL` (+ `GREEN_API_TOKEN` if auth is on). Market-data ingestion stays
a Databricks Job (see `scripts/databricks_ingest.py`).
