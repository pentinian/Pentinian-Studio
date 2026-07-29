-- The project console: brand decisions, their inspiration, and their requests.
--
-- Paste the whole thing into the Supabase SQL editor and run it. Safe to run twice.
--
-- One table rather than three, because they are the same shape: a small thing pinned
-- to a project, sometimes with a link, sometimes with an image, sometimes with a
-- color, sometimes carrying a status. Three tables would have meant three sets of
-- policies to keep in step, which is three chances to get one wrong.

create table if not exists project_notes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,

  -- brand       a decision, usually with a swatch or a typeface
  -- inspiration something they want the work to feel like
  -- request     something they have asked for
  kind        text not null check (kind in ('brand', 'inspiration', 'request')),

  title       text,
  body        text,
  url         text,
  swatch      text,          -- hex, for brand rows
  shot        text,          -- storage path in the shots bucket, for images

  -- Only requests really use this. Everything else sits at 'none'.
  status      text not null default 'none'
              check (status in ('none', 'open', 'doing', 'done', 'declined')),

  author_id   uuid references auth.users(id) on delete set null,
  from_client boolean not null default false,
  sort        int not null default 0,
  created_at  timestamptz default now()
);

create index if not exists project_notes_project_kind_idx
  on project_notes (project_id, kind, sort, created_at);

alter table project_notes enable row level security;

drop policy if exists notes_read on project_notes;
drop policy if exists notes_client_write on project_notes;
drop policy if exists notes_client_edit on project_notes;
drop policy if exists notes_staff_all on project_notes;

-- Read: staff, or the client whose project it is.
create policy notes_read on project_notes for select
  using (public.is_admin() or project_id in (select public.my_project_ids()));

-- A client may add inspiration and requests to their own project, as themselves,
-- and may never pass something off as coming from the studio. They cannot author a
-- brand decision, because that is a decision rather than a contribution, and they
-- cannot set a status, because a request they mark 'done' is not done.
create policy notes_client_write on project_notes for insert
  with check (
    project_id in (select public.my_project_ids())
    and author_id = auth.uid()
    and from_client = true
    and kind in ('inspiration', 'request')
    and status in ('none', 'open')
  );

-- They may edit or withdraw their own contributions, and nothing else. The status
-- check is repeated here on purpose: without it an edit could set 'done' after the
-- fact, which the insert policy alone would not catch.
create policy notes_client_edit on project_notes for update
  using (
    project_id in (select public.my_project_ids())
    and from_client = true
    and author_id = auth.uid()
  )
  with check (
    project_id in (select public.my_project_ids())
    and from_client = true
    and author_id = auth.uid()
    and kind in ('inspiration', 'request')
    and status in ('none', 'open')
  );

create policy notes_staff_all on project_notes for all
  using (public.is_admin()) with check (public.is_admin());

-- Defence in depth: nobody signed out has any business here, whatever the policies say.
revoke all on project_notes from anon;
