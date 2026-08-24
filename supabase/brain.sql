-- The brain. One row per entry; everything a client ever sees is a released
-- projection of one of these. Paste into the Supabase SQL editor. Safe to run
-- twice.
--
-- Types and sources are closed lists on purpose: an open text column grows a
-- taxonomy by typo. Visibility is a one-way ladder with a human at the top
-- rung: internal -> staged -> released, demotion back to internal allowed,
-- and released_at records the press. Correspondence is NOT a type here.
-- Replies are their own stream, linkable to entries, never inside the brain.

create table if not exists brain_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,

  -- The lane. A bundle slug (artinian, caveman, pentinian, atelier), or the
  -- project's own lane for worklog rows. Kept even where project_id exists,
  -- because bundles arrive keyed by slug before any project row must exist.
  slug text not null,

  type text not null check (type in
    ('worklog','doc','file','shot','brand','inspiration')),
  source text not null check (source in
    ('notion','hekate','upload','manual')),

  title text not null,
  body text,
  -- Structured payloads (a token, a retired value, a specimen) ride here so
  -- the brand renderer works from data rather than from parsed prose.
  payload jsonb,
  -- Files and shots reference storage rather than embedding it.
  asset_path text,

  -- Where this came from, in words a person reads on the entry itself.
  provenance text not null default '',

  -- Idempotency. entry_key names the thing (worklog:<raw_id>,
  -- brand:token:--a2-garnet-12, doc:artinian-canon.md); content_hash is the
  -- sha256 of the canonical payload. Same key + same hash means the upsert
  -- is a no-op; same key + new hash means the thing changed at its source
  -- and the row updates in place.
  entry_key text not null,
  content_hash text not null,

  visibility text not null default 'internal'
    check (visibility in ('internal','staged','released')),
  released_at timestamptz,

  created timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (slug, entry_key)
);

create index if not exists brain_entries_project_idx
  on brain_entries (project_id, type, created desc);
create index if not exists brain_entries_slug_idx
  on brain_entries (slug, type);

-- A released entry must know when it was pressed; anything demoted loses the
-- stamp with the standing. Enforced here so no code path can half-release.
alter table brain_entries drop constraint if exists brain_released_has_stamp;
alter table brain_entries add constraint brain_released_has_stamp
  check (visibility <> 'released' or released_at is not null);

-- Staff-only, exactly like work_log_raw: the brain holds unsanitised working
-- material, so no browser JWT reads it, not even an admin's. The Atelier
-- comes through the API, where the service key is used only after the caller
-- is confirmed staff. Phase C will grant the Window a *view* over released
-- rows; it will never touch this table directly.
alter table brain_entries enable row level security;
revoke all on brain_entries from authenticated;
revoke all on brain_entries from anon;
