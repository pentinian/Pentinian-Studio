-- Fixes an infinite recursion in the policy from brand-feedback.sql.
--
-- Paste into the Supabase SQL editor and run. Safe to run twice.
--
-- WHAT WAS WRONG. The insert policy on project_notes validated parent_id with a
-- subquery against project_notes:
--
--   and (parent_id is null
--        or parent_id in (select id from project_notes p where ...))
--
-- A policy on a table cannot query that table. Evaluating the policy runs the subquery,
-- which evaluates the policy, and Postgres stops it with "infinite recursion detected in
-- policy for relation project_notes".
--
-- The effect was worse than a broken feature. Every client insert failed, including
-- writing a plain request, so the console was read-only for clients without saying so.
-- And every NEGATIVE test in verify-console.mjs passed, because each of them only
-- asserted that an error came back, and a recursion error is an error. A broken policy
-- read as a green suite on everything except the two positive cases.
--
-- The fix is the pattern my_project_ids() already uses: a security definer function,
-- which runs with the definer's rights and therefore does not re-enter the policy. It
-- returns a boolean and nothing else, and auth.uid() inside it is still the caller, so
-- it cannot be used to ask about anybody else's rows.

create or replace function public.note_in_my_projects(nid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from project_notes n
    where n.id = nid
      and n.project_id in (select public.my_project_ids())
  );
$$;

revoke all on function public.note_in_my_projects(uuid) from public;
grant execute on function public.note_in_my_projects(uuid) to authenticated;

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
      -- A suggestion may only point at something on a project they can already see.
      -- Without this a client could attach their note to another client's row by id.
      and (parent_id is null or public.note_in_my_projects(parent_id))
    )
  );
