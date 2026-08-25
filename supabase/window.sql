-- The Window's door onto the brain. Paste into the Supabase SQL editor and
-- run. Safe to run twice.
--
-- The brain table stays revoked from every browser key; this view is the
-- only client path, and it is narrow by construction:
--   released rows only, and never the worklog type: the client work log has
--     its own curated projection (work_log_released) with shaped titles and
--     representative times, and this view does not compete with it;
--   never a retired value, even one somehow released: the second of the two
--     tests this phase exists for;
--   worklog body and title are excluded twice over (type filter plus column
--     guards) because the raw Detail is staff only, always;
--   scoped to the caller's own projects through my_project_ids(), the same
--     fence the rest of the Window stands behind.
-- The view runs with its owner's rights, which is what lets it read a table
-- the caller cannot; auth.uid() still resolves to the caller inside
-- my_project_ids(), so the scoping is the caller's, not the owner's.

create or replace view window_brain as
select
  id,
  project_id,
  slug,
  type,
  case when type = 'worklog' then null else title end as title,
  case when type = 'worklog' then null else body end as body,
  (payload - 'console') as payload,
  released_at,
  created
from brain_entries
where visibility = 'released'
  and type in ('brand', 'doc', 'inspiration', 'file')
  and coalesce(payload->>'kind', '') <> 'retired'
  and project_id in (select public.my_project_ids());

grant select on window_brain to authenticated;
revoke all on window_brain from anon;
