-- The console gets the same gate the work log has.
--
-- Paste into the Supabase SQL editor and run. Safe to run twice.
--
-- Until now the console had no pipeline. Anything written appeared to the client at
-- once, which meant a brand decision could not be drafted, and there was nowhere for
-- Cowork to put one. It now runs the same road as the work log:
--
--   Cowork  ->  Notion (Console database)  ->  sync  ->  staged in the Atelier
--           ->  a deliberate press  ->  the client's Window
--
-- The asymmetry is the point. What Pentinian authors is held until released. What the
-- CLIENT authors is theirs and appears to them immediately, because gating someone's
-- own pinned image behind my approval would be absurd, and because they already know
-- what they wrote.

-- --------------------------------------------------------------- American spelling
-- The British spelling throughout was mine, not Pen's. The constraint, the rows
-- already written, and every label in the interface move together, because a facet
-- value meaning the same thing spelled two ways is a bug waiting for its first
-- mismatch. Drop first, rewrite, then re-add: the old constraint would refuse the
-- new value, and the new one would refuse the old rows.
alter table project_notes drop constraint if exists project_notes_facet_check;
update project_notes set facet = 'color' where facet = 'colou' || 'r';
alter table project_notes add constraint project_notes_facet_check
  check (facet is null or facet in ('color', 'type', 'rule', 'asset'));

-- ------------------------------------------------------------------- the sync key
-- Same convention as work_log_raw: the Notion page id is the identity, so a row edited
-- in Notion updates in place rather than arriving a second time. Nullable, because a
-- client writing in their own Window has no Notion page behind them.
alter table project_notes add column if not exists notion_id text;
create unique index if not exists project_notes_notion_id_key
  on project_notes (notion_id) where notion_id is not null;

-- ---------------------------------------------------------------------- the gate
-- Null means staged. A timestamp means someone pressed Release, and when.
alter table project_notes add column if not exists released_at timestamptz;

-- Everything that existed before this migration was written straight into the Window
-- and has already been seen there. Releasing it retroactively keeps what is on screen
-- on screen; the alternative is content silently vanishing from a client's view the
-- moment the gate is installed.
update project_notes set released_at = coalesce(created_at, now()) where released_at is null;

-- A link back to the source, so the Atelier can offer "open in Notion" rather than
-- making you go and find the row.
alter table project_notes add column if not exists notion_url text;

-- ------------------------------------------------------------------ read policy
-- Admin sees everything, staged included: that is what the Atelier is.
-- A client sees their own project, and within it only what has been released or what
-- they wrote themselves.
drop policy if exists notes_read on project_notes;
create policy notes_read on project_notes for select
  to authenticated
  using (
    public.is_admin()
    or (
      project_id in (select public.my_project_ids())
      and (released_at is not null or from_client)
    )
  );

-- ----------------------------------------------------------------- write policies
-- A client may still write inspiration and requests as themselves, and only those.
-- They cannot author a brand decision, which is a decision rather than a contribution,
-- and cannot set a status, because a request they mark done is not done.
drop policy if exists notes_client_write on project_notes;
create policy notes_client_write on project_notes for insert
  to authenticated
  with check (
    public.is_admin()
    or (
      project_id in (select public.my_project_ids())
      and kind in ('inspiration', 'request')
      and from_client
      and author_id = auth.uid()
      and status in ('none', 'open')
      -- A client cannot release their own row, nor arrive carrying a Notion id.
      and released_at is null
      and notion_id is null
    )
  );

-- They may edit or remove what they wrote, and nothing else. The USING clause governs
-- which rows they can reach; the WITH CHECK clause governs what those rows may become,
-- and without the second one an update could hand itself the release it was refused.
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
      and kind in ('inspiration', 'request')
      and released_at is null
      and notion_id is null
    )
  );

drop policy if exists notes_client_delete on project_notes;
create policy notes_client_delete on project_notes for delete
  to authenticated
  using (
    public.is_admin()
    or (author_id = auth.uid() and from_client and project_id in (select public.my_project_ids()))
  );

-- ------------------------------------------------------------------ housekeeping
-- The seeded brand colors carried their purpose inside the name, "Paper, the page
-- itself", because there was nowhere else to put it. There is now: the name is the
-- swatch label and the purpose appears on hover, so they separate.
update project_notes
set title = split_part(title, ', ', 1),
    body  = coalesce(nullif(body, ''), nullif(substr(title, strpos(title, ', ') + 2), ''))
where kind = 'brand' and facet = 'color' and strpos(title, ', ') > 0;

create index if not exists project_notes_release_idx
  on project_notes (project_id, kind, released_at);
