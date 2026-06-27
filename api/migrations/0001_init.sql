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
    strategy_id   text,
    strategy_version_id text,
    state         text not null check (state in ('queued', 'generating', 'running', 'completed', 'error')),
    request_json  jsonb not null,
    progress_json jsonb,
    verdict_json  jsonb,
    error         text,
    note          text,  -- generator rationale (natural-language runs)
    prompt        text,  -- original NL prompt (natural-language runs)
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index if not exists runs_user_id_idx on public.runs (user_id);
create index if not exists runs_strategy_id_idx on public.runs (strategy_id);
create index if not exists runs_created_at_idx on public.runs (created_at);

create table if not exists public.strategies (
    id           text primary key,
    user_id      uuid not null references auth.users (id) on delete cascade,
    title        text not null,
    description  text not null default '',
    status       text not null default 'active' check (status in ('active', 'archived')),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index if not exists strategies_user_id_idx on public.strategies (user_id);
create index if not exists strategies_updated_at_idx on public.strategies (updated_at);

create table if not exists public.strategy_drafts (
    id           text primary key,
    strategy_id  text not null references public.strategies (id) on delete cascade,
    user_id      uuid not null references auth.users (id) on delete cascade,
    draft_json   jsonb not null,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create index if not exists strategy_drafts_strategy_id_idx on public.strategy_drafts (strategy_id);
create index if not exists strategy_drafts_user_id_idx on public.strategy_drafts (user_id);

create table if not exists public.strategy_versions (
    id             text primary key,
    strategy_id    text not null references public.strategies (id) on delete cascade,
    draft_id       text not null references public.strategy_drafts (id) on delete cascade,
    user_id        uuid not null references auth.users (id) on delete cascade,
    version_number integer not null,
    version_json   jsonb not null,
    frozen_at      timestamptz not null default now()
);

create index if not exists strategy_versions_strategy_id_idx on public.strategy_versions (strategy_id);
create index if not exists strategy_versions_user_id_idx on public.strategy_versions (user_id);

-- Row-level security: a user can only see and touch their own runs.
alter table public.runs enable row level security;
alter table public.strategies enable row level security;
alter table public.strategy_drafts enable row level security;
alter table public.strategy_versions enable row level security;

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

drop policy if exists strategies_select_own on public.strategies;
create policy strategies_select_own on public.strategies
    for select using (auth.uid() = user_id);

drop policy if exists strategies_insert_own on public.strategies;
create policy strategies_insert_own on public.strategies
    for insert with check (auth.uid() = user_id);

drop policy if exists strategies_update_own on public.strategies;
create policy strategies_update_own on public.strategies
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists strategies_delete_own on public.strategies;
create policy strategies_delete_own on public.strategies
    for delete using (auth.uid() = user_id);

drop policy if exists strategy_drafts_select_own on public.strategy_drafts;
create policy strategy_drafts_select_own on public.strategy_drafts
    for select using (auth.uid() = user_id);

drop policy if exists strategy_drafts_insert_own on public.strategy_drafts;
create policy strategy_drafts_insert_own on public.strategy_drafts
    for insert with check (auth.uid() = user_id);

drop policy if exists strategy_drafts_update_own on public.strategy_drafts;
create policy strategy_drafts_update_own on public.strategy_drafts
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists strategy_drafts_delete_own on public.strategy_drafts;
create policy strategy_drafts_delete_own on public.strategy_drafts
    for delete using (auth.uid() = user_id);

drop policy if exists strategy_versions_select_own on public.strategy_versions;
create policy strategy_versions_select_own on public.strategy_versions
    for select using (auth.uid() = user_id);

drop policy if exists strategy_versions_insert_own on public.strategy_versions;
create policy strategy_versions_insert_own on public.strategy_versions
    for insert with check (auth.uid() = user_id);

drop policy if exists strategy_versions_update_own on public.strategy_versions;
create policy strategy_versions_update_own on public.strategy_versions
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists strategy_versions_delete_own on public.strategy_versions;
create policy strategy_versions_delete_own on public.strategy_versions
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

drop trigger if exists strategies_set_updated_at on public.strategies;
create trigger strategies_set_updated_at
    before update on public.strategies
    for each row execute function public.set_updated_at();

drop trigger if exists strategy_drafts_set_updated_at on public.strategy_drafts;
create trigger strategy_drafts_set_updated_at
    before update on public.strategy_drafts
    for each row execute function public.set_updated_at();
