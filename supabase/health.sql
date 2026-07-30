-- Somewhere for the system to say how it is doing.
--
-- Paste into the Supabase SQL editor and run. Safe to run twice.
--
-- Three things currently fail in silence. The scheduled sync logs to Vercel, which is
-- not a place anyone looks. Notifications are fire and forget by design, which is right,
-- because a saved reply must never report failure over an email, but it means a dead
-- Resend key is invisible. And a sync that has been failing for a week gets discovered
-- by noticing the Quarry looks thin, which is a slow and unpleasant way to find out.
--
-- One row per event, newest read first. Not a log to browse: a place the Atelier can ask
-- "when did this last work, and did it".

create table if not exists system_events (
  id          bigint generated always as identity primary key,
  -- 'sync' | 'cron' | 'notify' | 'release'. Left as free text rather than an enum so
  -- adding a fourth thing later is not a migration.
  kind        text not null,
  ok          boolean not null,
  -- Short enough to read at a glance. The full story belongs in the platform logs.
  detail      text,
  -- Whatever the event wants to carry: counts, ids, the shape of what moved.
  meta        jsonb,
  at          timestamptz not null default now()
);

create index if not exists system_events_kind_at_idx on system_events (kind, at desc);

alter table system_events enable row level security;

-- Staff only, and read only. Writes come through the service key from routes that have
-- already checked who is asking, so nothing in a browser can forge a healthy-looking
-- event to hide a broken one.
drop policy if exists events_read on system_events;
create policy events_read on system_events for select
  to authenticated
  using (public.is_admin());

-- A cheap guard against this growing forever. Nothing older than sixty days is useful
-- for answering "did it run this morning", and keeping it costs a table scan later.
create or replace function public.trim_system_events()
returns void
language sql
security definer
set search_path = public
as $$
  delete from system_events where at < now() - interval '60 days';
$$;
