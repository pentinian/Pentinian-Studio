-- Voice grows an anatomy. Paste into the Supabase SQL editor and run.
-- Safe to run twice.
--
-- The Voice chapter was a holding area for rulings; a language guide has
-- parts. Two new facets carry them through the same console pipeline the
-- palette uses: tone (the register, one named quality per row) and lexicon
-- (terminology law: say this, never that, because). The counter column
-- holds the lexicon row's "never" term; every other facet leaves it null.

alter table project_notes drop constraint if exists project_notes_facet_check;
alter table project_notes add constraint project_notes_facet_check
  check (facet is null or facet in ('color', 'type', 'rule', 'asset', 'tone', 'lexicon'));

alter table project_notes add column if not exists counter text;
