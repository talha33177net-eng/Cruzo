-- Cruzo — database schema
--
-- Paste this whole file into the Supabase SQL Editor and run it. It is safe to
-- run more than once, and it upgrades a project set up with the earlier
-- schema in place.
--
-- Scope note: this table holds only the party "lobby" -- enough to turn a
-- six-character code into a ride, and nothing more. Everything that happens
-- during a ride travels over Realtime and is never stored:
--
--   * rider positions, SOS and destinations ride on Presence and vanish when a
--     rider disconnects;
--   * group chat is Realtime broadcast, held only in the riders' phones.
--
-- A party row is deleted outright when the ride ends, and automatically once
-- nobody has been in it for 10 minutes. At any moment the table holds only the
-- rides that are actually happening.

create table if not exists public.parties (
  code           text primary key,
  host_id        text        not null,
  host_name      text        not null,
  -- Proof of hosting. Generated on the host's device, never displayed, and
  -- deliberately excluded from the anon SELECT grant below so that only the
  -- device that created the party can end it.
  host_secret    text        not null,
  -- Refreshed every few minutes by a rider in the party (touch_party below).
  -- A party that stops being refreshed has nobody in it.
  last_active_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Upgrading from the first schema
--
-- That version kept ended and expired parties as rows, and stored a ride name
-- that is always just "<host>'s ride". Finished rows are deleted and the
-- redundant columns dropped. Each step is a no-op on a fresh install.
-- ---------------------------------------------------------------------------

alter table public.parties
  add column if not exists last_active_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'parties' and column_name = 'ended_at'
  ) then
    delete from public.parties where ended_at is not null or expires_at < now();
  end if;

  -- The old optional purge job filtered on a column that no longer exists.
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'cruzo-purge-old-parties';
  end if;
end;
$$;

drop index if exists public.parties_expires_at_idx;

alter table public.parties
  drop column if exists name,
  drop column if exists created_at,
  drop column if exists expires_at,
  drop column if exists ended_at;

create index if not exists parties_last_active_at_idx on public.parties (last_active_at);

alter table public.parties enable row level security;

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Cruzo has no user accounts, so every request arrives as the `anon` role and
-- RLS alone cannot tell one device from another. Column-level grants do the
-- real work here: `host_secret` is never readable, so it cannot be harvested
-- from a party you merely joined.
-- ---------------------------------------------------------------------------

revoke all on public.parties from anon, authenticated;

grant select (code, host_id, host_name, last_active_at)
  on public.parties to anon, authenticated;

grant insert (code, host_id, host_name, host_secret)
  on public.parties to anon, authenticated;

-- No UPDATE or DELETE grant: ending a ride and keeping it alive both go
-- through the functions below.

-- An abandoned party disappears from lookups the moment it goes quiet, even
-- before touch_party gets round to deleting the row.
drop policy if exists "anyone can look up a party" on public.parties;
create policy "anyone can look up a party"
  on public.parties for select
  to anon, authenticated
  using (last_active_at > now() - interval '10 minutes');

drop policy if exists "anyone can open a party" on public.parties;
create policy "anyone can open a party"
  on public.parties for insert
  to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- Ending a ride
--
-- SECURITY DEFINER so the function may delete from a table the caller cannot,
-- and `search_path` is pinned so the definer's rights cannot be redirected at
-- a shadowed table.
-- ---------------------------------------------------------------------------

create or replace function public.end_party(p_code text, p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  delete from public.parties
   where code = p_code
     and host_secret = p_secret;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.end_party(text, text) from public;
grant execute on function public.end_party(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Keeping a ride alive, and closing empty ones
--
-- Riders are only visible to Realtime, not to Postgres, so the database learns
-- a party is occupied by being told: one rider in the party calls this every
-- few minutes. The same call sweeps away every party nobody has touched for
-- 10 minutes, which is what closes a ride everyone has left -- no cron job,
-- no extension, nothing to schedule.
--
-- A party that has already gone quiet is not revived: its code may be handed
-- out again, and two groups must never share one.
-- ---------------------------------------------------------------------------

create or replace function public.touch_party(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  update public.parties
     set last_active_at = now()
   where code = p_code
     and last_active_at > now() - interval '10 minutes';

  get diagnostics affected = row_count;

  delete from public.parties
   where last_active_at <= now() - interval '10 minutes';

  return affected > 0;
end;
$$;

revoke all on function public.touch_party(text) from public;
grant execute on function public.touch_party(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tell PostgREST to pick the new table and function up straight away, rather
-- than waiting for its cache to expire. Without this the app can still get a
-- "table not found in the schema cache" error for a minute after running this.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
