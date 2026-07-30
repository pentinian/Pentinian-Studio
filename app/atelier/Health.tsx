'use client';

import { useCallback, useEffect, useState } from 'react';

// One line that says whether the machinery is running.
//
// Everything here was already discoverable and none of it was ever discovered, because
// it lived in a platform log or in the absence of an email. The strip is deliberately
// small and quiet when things are fine: a health display that shouts while healthy gets
// tuned out, and then says nothing when it matters.
//
// It distinguishes "never configured" from "broken", which look identical from outside
// and need opposite responses. A notification that has never been switched on is a task;
// one that used to work and now fails is an incident.

type Ev = { ok: boolean; detail: string | null; meta: any; at: string } | { missing: true } | null;

type Health = {
  sync: Ev; cron: Ev; notify: Ev;
  config: { notifications: boolean; cronSecret: boolean; notionWorkLog: boolean; notionConsole: boolean };
  counts: { quarry: number; uninvitedClients: number };
};

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
};

// A sync older than this means the daily schedule has not landed. Stated as a constant
// because the cron runs once a day, so anything past about 30 hours is a real gap rather
// than a slow morning.
const STALE_HOURS = 30;

export default function Health() {
  const [h, setH] = useState<Health | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (res.ok) setH(await res.json());
  }, []);

  useEffect(() => { load(); }, [load]);
  if (!h) return null;

  const ev = (e: Ev) => (e && !('missing' in e) ? e : null);
  const sync = ev(h.sync), cron = ev(h.cron), notify = ev(h.notify);
  const recording = !(h.sync && typeof h.sync === 'object' && 'missing' in h.sync);

  const stale = sync ? (Date.now() - new Date(sync.at).getTime()) / 3600000 > STALE_HOURS : false;
  const bad =
    (sync && !sync.ok) || (cron && !cron.ok) || (notify && !notify.ok) || stale ||
    !h.config.cronSecret || !h.config.notionConsole;

  const items: { label: string; state: 'good' | 'warn' | 'bad' | 'off'; note: string }[] = [];

  if (!recording) {
    items.push({ label: 'Health', state: 'off', note: 'not recording yet, run supabase/health.sql' });
  } else {
    items.push(
      sync
        ? { label: 'Sync', state: sync.ok ? (stale ? 'warn' : 'good') : 'bad',
            note: sync.ok
              ? `${ago(sync.at)}${stale ? ', longer than a day' : ''}${sync.meta?.pulled != null ? ` · ${sync.meta.pulled} entries` : ''}`
              : sync.detail ?? 'failed' }
        : { label: 'Sync', state: 'off', note: 'has not run since recording began' }
    );
    items.push(
      cron
        ? { label: 'Schedule', state: cron.ok ? 'good' : 'bad', note: cron.ok ? ago(cron.at) : cron.detail ?? 'failed' }
        : { label: 'Schedule', state: h.config.cronSecret ? 'off' : 'bad',
            note: h.config.cronSecret ? 'not fired yet, runs 6am' : 'CRON_SECRET missing, it will refuse itself' }
    );
  }

  items.push(
    !h.config.notifications
      ? { label: 'Notifications', state: 'off', note: 'not configured, needs a verified domain' }
      : notify
        ? { label: 'Notifications', state: notify.ok ? 'good' : 'bad', note: notify.ok ? `sent ${ago(notify.at)}` : notify.detail ?? 'failed' }
        : { label: 'Notifications', state: 'good', note: 'configured, nothing sent yet' }
  );

  if (h.counts.uninvitedClients > 0) {
    items.push({
      label: 'Access', state: 'warn',
      note: `${h.counts.uninvitedClients} client-facing project${h.counts.uninvitedClients === 1 ? '' : 's'} with nobody invited`,
    });
  }

  return (
    <div className={'hz' + (bad ? ' bad' : '') + (open ? ' open' : '')}>
      <button className="hz-h" onClick={() => setOpen((o) => !o)}>
        <span className={'hz-dot ' + (bad ? 'bad' : 'good')} aria-hidden="true" />
        <span className="hz-t">
          {bad ? 'Something needs attention' : 'Everything is running'}
        </span>
        <span className="hz-sum">
          {h.counts.quarry} in the Quarry
          {sync ? ` · synced ${ago(sync.at)}` : ''}
        </span>
        <span className="hz-caret" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="hz-body">
          {items.map((i) => (
            <div className={'hz-row s-' + i.state} key={i.label}>
              <span className="hz-k">{i.label}</span>
              <span className="hz-v">{i.note}</span>
            </div>
          ))}
          <button className="hz-refresh" onClick={load}>Check again</button>
        </div>
      )}
    </div>
  );
}
