-- The work-log spine: real time blocks, plain-language summaries, screenshots,
-- and client comments. Safe to run more than once.
--
-- Shape of the loop:
--   Cowork works  ->  Notion Work Log (the record, Detail is for you only)
--                 ->  sync into work_log_raw (the Quarry, staff only, never released
--                     automatically by the sync)
--                 ->  you release it in the Atelier
--                 ->  work_log_released (what the client actually sees)
--
-- Privacy contract, enforced below rather than by habit:
--   * a client reads only their own project, and only entries released and due
--   * a client never reads work_log_raw, at any stage, ever
--   * screenshots live in a PRIVATE bucket keyed by project id in the path
--   * the anon role (nobody signed in) is revoked outright from the sensitive tables,
--     so RLS is the second line rather than the only line

-- ------------------------------------------------- released entries: the client's view
alter table work_log_released add column if not exists started_at  timestamptz;
alter table work_log_released add column if not exists ended_at    timestamptz;
alter table work_log_released add column if not exists minutes     int;
alter table work_log_released add column if not exists eli5        text;   -- what happened, plainly
alter table work_log_released add column if not exists why         text;   -- why it mattered, how it fits
alter table work_log_released add column if not exists area        text;   -- which part of their build
alter table work_log_released add column if not exists shots       text[]; -- storage object paths
alter table work_log_released add column if not exists notion_id   text;

create unique index if not exists work_log_released_notion_id_key
  on work_log_released (notion_id) where notion_id is not null;
create index if not exists work_log_released_project_started_idx
  on work_log_released (project_id, started_at desc);

-- the raw side carries the same block so the Atelier can show you the real hours
alter table work_log_raw add column if not exists started_at timestamptz;
alter table work_log_raw add column if not exists ended_at   timestamptz;
alter table work_log_raw add column if not exists minutes    int;
alter table work_log_raw add column if not exists eli5       text;
alter table work_log_raw add column if not exists why        text;
alter table work_log_raw add column if not exists area       text;
alter table work_log_raw add column if not exists shots      text[];
alter table work_log_raw add column if not exists client_visible boolean default false;
alter table work_log_raw add column if not exists release_at timestamptz;
alter table work_log_raw add column if not exists stage      text;

-- ---------------------------------------------------------------------- comments
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  entry_id uuid references work_log_released(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  from_staff boolean default false,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz default now()
);
create index if not exists comments_project_idx on comments (project_id, created_at desc);
create index if not exists comments_entry_idx on comments (entry_id, created_at);

alter table comments enable row level security;
drop policy if exists comments_read on comments;
drop policy if exists comments_client_write on comments;
drop policy if exists comments_staff_all on comments;

create policy comments_read on comments for select
  using (public.is_admin() or project_id in (select public.my_project_ids()));

-- A client may comment on their own project, as themselves, never as staff, and only
-- against an entry they can actually see. The exists() runs as the client, so RLS on
-- work_log_released does the checking for us: an entry belonging to someone else, or
-- one not yet released, simply is not visible and the insert fails.
create policy comments_client_write on comments for insert
  with check (
    project_id in (select public.my_project_ids())
    and author_id = auth.uid()
    and from_staff = false
    and (
      entry_id is null
      or exists (
        select 1 from work_log_released w
        where w.id = comments.entry_id
          and w.project_id = comments.project_id
      )
    )
  );

create policy comments_staff_all on comments for all
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------- the month overview
-- One row per day that had client-visible work, so the calendar is one cheap read.
create or replace view work_days as
  select
    project_id,
    (started_at at time zone 'UTC')::date as day,
    count(*)                              as entries,
    coalesce(sum(minutes), 0)             as minutes
  from work_log_released
  where visible
    and (release_at is null or release_at <= now())
    and started_at is not null
  group by project_id, (started_at at time zone 'UTC')::date;

-- Without this a view runs as its owner and silently bypasses RLS on the base table,
-- which would have leaked every project's working days to every client.
alter view work_days set (security_invoker = on);

-- --------------------------------------------------------- defence in depth: grants
-- Nobody signed out has any business touching these, regardless of policy bugs.
revoke all on clients, projects, work_log_raw, work_log_released,
              sessions, questions, site_config, comments from anon;
revoke all on work_log_raw from authenticated;   -- the Quarry is staff-only; staff go through the service key or an admin JWT
grant select on work_days to authenticated;

-- ------------------------------------------------------------------ screenshots
-- Private bucket, images only, capped size. Nothing is world-readable and the app
-- signs a short-lived URL per request.
insert into storage.buckets (id, name, public)
values ('shots', 'shots', false)
on conflict (id) do nothing;

update storage.buckets
set file_size_limit = 10485760,                                   -- 10 MB
    allowed_mime_types = array['image/png','image/jpeg','image/webp']
where id = 'shots';

drop policy if exists shots_read on storage.objects;
drop policy if exists shots_staff_write on storage.objects;

-- Objects are stored as <project_id>/<file>, so the first path segment is the gate.
-- Compared as text, never cast to uuid: a malformed path would otherwise raise and
-- take the whole query down instead of simply denying.
create policy shots_read on storage.objects for select
  using (
    bucket_id = 'shots'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] in (
        select p::text from public.my_project_ids() p
      )
    )
  );

create policy shots_staff_write on storage.objects for all
  using (bucket_id = 'shots' and public.is_admin())
  with check (bucket_id = 'shots' and public.is_admin());
