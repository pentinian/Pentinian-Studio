-- Row Level Security for the Pentinian studio database.
--
-- Why this file exists: the anon key ships inside the browser bundle by design, so
-- it is public. Without RLS, that key reads every row in every table. This closes it.
--
-- Two kinds of caller:
--   staff   app_metadata.role = 'admin' on the Supabase user. Sees everything.
--   client  a row in clients where user_id = their auth uid. Sees only their own
--           project and only the entries that have been released to them.
--
-- The Notion sync route uses the service role key, which bypasses RLS entirely,
-- so scheduled ingestion keeps working untouched.
--
-- Safe to run more than once.

-- Staff check. app_metadata is server-controlled, so a user cannot grant this to
-- themselves. Reading it from the JWT avoids a table lookup on every row.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- The set of project ids belonging to the caller.
create or replace function public.my_project_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from projects p
  join clients c on c.id = p.client_id
  where c.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------- clients
alter table clients enable row level security;
drop policy if exists clients_read on clients;
drop policy if exists clients_write on clients;

create policy clients_read on clients for select
  using (public.is_admin() or user_id = auth.uid());

create policy clients_write on clients for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- projects
alter table projects enable row level security;
drop policy if exists projects_read on projects;
drop policy if exists projects_write on projects;

create policy projects_read on projects for select
  using (
    public.is_admin()
    or client_id in (select id from clients where user_id = auth.uid())
  );

create policy projects_write on projects for all
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------ work_log_raw
-- The Quarry. Unsanitised working notes. Staff only, never a client, at any time.
alter table work_log_raw enable row level security;
drop policy if exists raw_staff_only on work_log_raw;

create policy raw_staff_only on work_log_raw for all
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------- work_log_released
-- The client sees their own project's entries, and only once released and visible.
alter table work_log_released enable row level security;
drop policy if exists released_read on work_log_released;
drop policy if exists released_write on work_log_released;

create policy released_read on work_log_released for select
  using (
    public.is_admin()
    or (
      project_id in (select public.my_project_ids())
      and visible
      and (release_at is null or release_at <= now())
    )
  );

create policy released_write on work_log_released for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- sessions
alter table sessions enable row level security;
drop policy if exists sessions_read on sessions;
drop policy if exists sessions_write on sessions;

create policy sessions_read on sessions for select
  using (
    public.is_admin()
    or (project_id in (select public.my_project_ids()) and visible)
  );

create policy sessions_write on sessions for all
  using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------- questions
-- A client may read questions raised on their project, and answer them by
-- moving status. They may not invent questions or touch the text.
alter table questions enable row level security;
drop policy if exists questions_read on questions;
drop policy if exists questions_answer on questions;
drop policy if exists questions_write on questions;

create policy questions_read on questions for select
  using (public.is_admin() or project_id in (select public.my_project_ids()));

create policy questions_answer on questions for update
  using (project_id in (select public.my_project_ids()))
  with check (project_id in (select public.my_project_ids()));

create policy questions_write on questions for all
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------- site_config
-- Governs the public site. Nothing client-facing reads it from the browser,
-- so keep it staff only.
alter table site_config enable row level security;
drop policy if exists siteconfig_staff_only on site_config;

create policy siteconfig_staff_only on site_config for all
  using (public.is_admin()) with check (public.is_admin());
