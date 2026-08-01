-- The knock at the door.
--
-- A stranger at the login can ask for access. The ask lands here, Pen hears about it
-- by email, and the Atelier shows it in a Wants In panel. Approving is what creates
-- the client, their project, and their sign-in; this table only ever holds the ask.
--
-- Locked to the service key on purpose. The public writes through /api/access-request,
-- which validates and dedupes; nobody reads this table from a browser session, not
-- even an admin one, because the Atelier goes through the same staff-only route. A
-- table of strangers' emails is a small privacy ledger and gets the same treatment as
-- the Quarry: no browser JWT touches it.

create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- Case-insensitive lookups without a function index on every query.
create index if not exists access_requests_email_idx on access_requests (lower(email));
create index if not exists access_requests_status_idx on access_requests (status, created_at desc);

alter table access_requests enable row level security;
-- No policies at all: with RLS on and no policy, anon and authenticated can do
-- nothing, and the service key bypasses RLS. Belt and braces below.
revoke all on access_requests from anon;
revoke all on access_requests from authenticated;
