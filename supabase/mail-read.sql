-- One more state a letter can be in: read.
--
-- The ledger has always known whether a letter was sent, scheduled, canceled, failed,
-- or received. Received meant "it arrived" and nothing more, so there was no way to
-- tell a letter waiting for someone from one that had already been answered, and the
-- Atelier could not put a number on the door.
--
-- Read belongs in status rather than in a column of its own: it is a state the letter
-- is in, and status is where those live. Only inbound uses it. The studio's own sends
-- were read as they were written.
--
-- Additive and reversible. No row changes, no data moves; the old five values all
-- remain legal, so nothing already in the table can be made invalid by running this.
-- Safe to run twice.

alter table mail_ledger drop constraint if exists mail_ledger_status_check;

alter table mail_ledger add constraint mail_ledger_status_check
  check (status in ('sent', 'scheduled', 'canceled', 'failed', 'received', 'read'));

-- Letters waiting are counted on every load of the Atelier, so the count should not
-- be a table scan once the ledger is a few thousand rows deep.
create index if not exists mail_ledger_waiting_idx
  on mail_ledger (kind, status)
  where kind = 'inbound' and status = 'received';
