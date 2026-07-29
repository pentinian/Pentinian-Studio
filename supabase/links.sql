-- Links on a work log entry.
--
-- Paste the whole thing into the Supabase SQL editor and run it. Safe to run twice.
--
-- Why an array rather than a text field: a block often produces two or three things
-- worth poking at, and splitting a blob on commas breaks the first time a URL
-- contains one.
--
-- These are client-visible when released, so they carry a standing caveat in the
-- Window: a link points at wherever the work lived when the note was written, and
-- builds move. Half of them will rot. They are kept mainly for the studio's own
-- record, and a client is welcome to use whichever still answer.

alter table work_log_raw      add column if not exists links text[];
alter table work_log_released add column if not exists links text[];

-- No policy changes needed. Both tables already carry the right ones: work_log_raw is
-- revoked from browser JWTs outright, and work_log_released is scoped to the reader's
-- own project and only when released and due. A new column inherits both.
