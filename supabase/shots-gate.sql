-- The release gate reaches into storage.
--
-- Paste into the Supabase SQL editor and run. Safe to run twice.
--
-- WHAT THIS FIXES. push-shots uploads a screenshot the moment it is captured, long
-- before the work it belongs to is released. The read policy let a client read anything
-- under their own project folder, so every screenshot of unreleased work was already
-- readable by them, and the Files face was rendering exactly that under "Loose images".
-- Found by probing the live bucket against work_log_raw: one image belonging to an
-- entry still sitting in the Quarry was visible in a client's Window.
--
-- Hiding it in the interface was the first fix and it is not enough, because a client
-- holds a real Supabase session and can sign a URL for any object the policy permits.
-- The gate has to be in the policy or it is not a gate.
--
-- After this, a client may read exactly three things in their own project folder:
--   1. a screenshot attached to a piece of work that has been RELEASED
--   2. anything under <project>/files/, which is where deliberate attachments go
--   3. an image referenced by a console note they are allowed to see
-- Everything else is work in progress, and stays that way until it is passed.

drop policy if exists shots_read on storage.objects;
create policy shots_read on storage.objects for select
  using (
    bucket_id = 'shots'
    and (
      public.is_admin()
      or (
        -- Their own project first. Compared as text and never cast to uuid, because a
        -- malformed path should deny rather than raise and take the query with it.
        (storage.foldername(name))[1] in (select p::text from public.my_project_ids() p)
        and (
          -- Deliberately attached, by them or by Pentinian, through the console.
          (storage.foldername(name))[2] = 'files'

          -- Or attached to work that has actually been released.
          or exists (
            select 1 from public.work_log_released w
            where w.project_id::text = (storage.foldername(name))[1]
              and name = any (w.shots)
          )

          -- Or carried by a console note. RLS on project_notes already decides which
          -- notes they can see, so this inherits that decision rather than repeating it:
          -- a staged brand asset is invisible here for the same reason it is invisible
          -- on the board.
          or exists (
            select 1 from public.project_notes n
            where n.shot = name
          )
        )
      )
    )
  );

-- Staff write stays as it was. Client write and delete are unchanged from console.sql,
-- and both still key on the first path segment, which a nested files/ path preserves.
