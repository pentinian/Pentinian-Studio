-- Correspondence: the studio's one ledger of everything said by email.
--
-- Every send the app makes (a knock notification, a kind no, a manual letter, a
-- scheduled one, someday a weekly digest) writes itself here, and inbound mail
-- will land here too. The Atelier reads it through a staff-only route; like the
-- access requests, no browser JWT ever touches the table itself, because a pile
-- of other people's correspondence is exactly the kind of thing RLS mistakes
-- are made of.

create table if not exists mail_ledger (
  id uuid primary key default gen_random_uuid(),
  -- notify: to the studio about an event      decline: the kind no
  -- invite: the way in                        manual: written in the composer
  -- digest: a prebuilt check-in               inbound: a real email received
  kind text not null check (kind in ('notify', 'decline', 'invite', 'manual', 'digest', 'inbound')),
  to_email text,
  from_email text,
  client_id uuid references clients(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  subject text,
  body text,                      -- the human-written or received text, not the wrapper
  status text not null default 'sent'
    check (status in ('sent', 'scheduled', 'canceled', 'failed', 'received')),
  scheduled_for timestamptz,      -- only for status = scheduled
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists mail_ledger_created_idx on mail_ledger (created_at desc);
create index if not exists mail_ledger_due_idx on mail_ledger (status, scheduled_for);
create index if not exists mail_ledger_client_idx on mail_ledger (client_id, created_at desc);

alter table mail_ledger enable row level security;
revoke all on mail_ledger from anon;
revoke all on mail_ledger from authenticated;

-- Removal that keeps everything: a suspended person cannot sign in, but their
-- Window, their project, and every word exchanged stays. Restoring is one press.
alter table clients add column if not exists suspended boolean not null default false;
