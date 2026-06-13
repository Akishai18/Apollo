-- green — Supabase / Postgres schema + row-level security.
--
-- This is the production deployment artifact. Run it against your Supabase
-- project (SQL editor, or `psql "$DATABASE_URL" -f api/migrations/0001_init.sql`).
-- The application uses the same `RunStore` interface it uses for SQLite; only
-- the backend (a Postgres DSN) and auth (the project JWT secret) change.
--
-- Isolation is enforced twice: the API scopes every read to the caller's user
-- id (application layer), and the RLS policies below scope every row to
-- auth.uid() (database layer) — defense in depth.

create table if not exists public.runs (
    id            text primary key,
    user_id       uuid not null references auth.users (id) on delete cascade,
    state         text not null check (state in ('queued', 'running', 'completed', 'error')),
    request_json  jsonb not null,
    progress_json jsonb,
    verdict_json  jsonb,
    error         text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index if not exists runs_user_id_idx on public.runs (user_id);
create index if not exists runs_created_at_idx on public.runs (created_at);

-- Row-level security: a user can only see and touch their own runs.
alter table public.runs enable row level security;

drop policy if exists runs_select_own on public.runs;
create policy runs_select_own on public.runs
    for select using (auth.uid() = user_id);

drop policy if exists runs_insert_own on public.runs;
create policy runs_insert_own on public.runs
    for insert with check (auth.uid() = user_id);

drop policy if exists runs_update_own on public.runs;
create policy runs_update_own on public.runs
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists runs_delete_own on public.runs;
create policy runs_delete_own on public.runs
    for delete using (auth.uid() = user_id);

-- Keep updated_at honest on every write.
create or replace function public.set_updated_at() returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists runs_set_updated_at on public.runs;
create trigger runs_set_updated_at
    before update on public.runs
    for each row execute function public.set_updated_at();
