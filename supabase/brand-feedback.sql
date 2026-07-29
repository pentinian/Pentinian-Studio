-- A client may ask for a brand change. They may not make one.
--
-- Paste into the Supabase SQL editor and run. Safe to run twice.
--
-- The brand is authored by Pentinian and it should read as settled, because a client
-- looking at their own colors needs to know these are decided rather than in play. But
-- settled is not the same as closed. A client who cannot say "the sage is too soft" has
-- to say it in an email, where it is lost by Thursday.
--
-- So: a suggestion is a real row on the brand face, written by the client, unreleased,
-- and marked pending. It sits beside the decision it is about rather than inside it.
-- Nothing about the decision changes until Pen approves, and approving is what converts
-- the suggestion into a Pentinian-authored item and releases it.

-- --------------------------------------------------------------- what it points at
-- Optional. A suggestion usually concerns one colour or one rule, and saying which is
-- most of the value. Null means a suggestion about the brand in general, or a proposal
-- for something that does not exist yet.
--
-- ON DELETE SET NULL rather than CASCADE: removing a colour must not silently take the
-- conversation about it with it. An orphaned suggestion is recoverable; a deleted one
-- is not.
alter table project_notes add column if not exists parent_id uuid;
do $$
begin
  alter table project_notes
    add constraint project_notes_parent_fk
    foreign key (parent_id) references project_notes(id) on delete set null;
exception when duplicate_object then null;
end $$;

create index if not exists project_notes_parent_idx on project_notes (parent_id);

-- ------------------------------------------------------------------- who may write
-- The old policy refused kind = 'brand' from a client outright, which was right when
-- there was no pending state. Now a client may write a brand row on three conditions,
-- all of which the database enforces rather than the interface:
--
--   from_client   it is marked as theirs, so it can never be mistaken for a decision
--   released_at   null, so it cannot reach the board
--   status        'open', so they cannot mark their own suggestion accepted
--
-- Everything else is unchanged: still their own project only, still under their own
-- id, still no Notion id.
drop policy if exists notes_client_write on project_notes;
create policy notes_client_write on project_notes for insert
  to authenticated
  with check (
    public.is_admin()
    or (
      project_id in (select public.my_project_ids())
      and kind in ('brand', 'inspiration', 'request')
      and from_client
      and author_id = auth.uid()
      and status in ('none', 'open')
      and released_at is null
      and notion_id is null
      -- A suggestion may only point at something on the same project. Without this a
      -- client could attach their note to another client's brand row by id.
      and (
        parent_id is null
        or parent_id in (select id from project_notes p where p.project_id in (select public.my_project_ids()))
      )
    )
  );

-- Editing their own still cannot grant a release, change ownership, or move the row to
-- another project. The WITH CHECK clause is what enforces that; the USING clause only
-- decides which rows they can reach.
drop policy if exists notes_client_edit on project_notes;
create policy notes_client_edit on project_notes for update
  to authenticated
  using (
    public.is_admin()
    or (author_id = auth.uid() and from_client and project_id in (select public.my_project_ids()))
  )
  with check (
    public.is_admin()
    or (
      author_id = auth.uid() and from_client
      and project_id in (select public.my_project_ids())
      and kind in ('brand', 'inspiration', 'request')
      and status in ('none', 'open')
      and released_at is null
      and notion_id is null
    )
  );

-- A client may withdraw their own suggestion, and nothing else.
drop policy if exists notes_client_delete on project_notes;
create policy notes_client_delete on project_notes for delete
  to authenticated
  using (
    public.is_admin()
    or (author_id = auth.uid() and from_client and project_id in (select public.my_project_ids()))
  );
