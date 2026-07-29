-- What was happening in the quiet stretches.
--
-- Paste into the Supabase SQL editor and run. Safe to run twice.
--
-- The label sits on the block that FOLLOWS the gap, because a gap is not a row: it is
-- the space between two of them. Storing it on the later block means it moves with
-- the work if times are edited, and disappears on its own if the gap closes up.
--
-- Null reads as "research" in the Window. That default matters: the first version
-- said "1h 55m away", and away reads as absence. A quiet stretch in the middle of a
-- build day is usually reading, thinking, or waiting on something to come back, none
-- of which is being away. Set it per gap when it was something else.

alter table work_log_released add column if not exists gap_label text;
alter table work_log_raw      add column if not exists gap_label text;
