'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// The client's view of the work: a month of days that had work, and the hours inside
// whichever day they open.
//
// Everything here reads through the ordinary browser client, which means Row Level
// Security is doing the gating rather than this component. There is no service key
// anywhere on this path, and no endpoint that could be asked for another project's
// month by changing an id. A crafted request returns nothing because the database
// refuses it, not because the interface hid the button.
//
// Times are grouped in the studio's own timezone. Days here mean the days Pen was
// working, which is what a client is actually asking when they look at a calendar,
// and it keeps a late evening from appearing as the following morning.

const STUDIO_TZ = 'America/Los_Angeles';

type Entry = {
  id: string;
  project_id: string;
  title: string | null;
  area: string | null;
  eli5: string | null;
  why: string | null;
  started_at: string | null;
  ended_at: string | null;
  minutes: number | null;
  shots: string[] | null;
  release_at: string | null;
};

type Comment = {
  id: string;
  entry_id: string | null;
  body: string;
  from_staff: boolean;
  created_at: string;
};

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: STUDIO_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const clockFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: STUDIO_TZ,
  hour: 'numeric',
  minute: '2-digit',
});

const dayKey = (iso: string) => dayKeyFmt.format(new Date(iso));
const clock = (iso: string | null) => (iso ? clockFmt.format(new Date(iso)) : '');
const dur = (m: number | null) =>
  m == null ? '' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A local-noon Date for a YYYY-MM-DD key, so no timezone shift can move the square. */
const keyToDate = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

export default function Log({ projectId }: { projectId: string | null }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [shotUrls, setShotUrls] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);

  // One read per month, used for both the calendar and whichever day is opened.
  const load = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    setLoading(true);
    const supabase = createClient();
    // Widened by a day on each side so an entry near a month boundary still lands in
    // the right square once it is shifted into the studio's timezone.
    const from = new Date(cursor.y, cursor.m, 0).toISOString();
    const to = new Date(cursor.y, cursor.m + 1, 2).toISOString();
    const { data } = await supabase
      .from('work_log_released')
      .select('id,project_id,title,area,eli5,why,started_at,ended_at,minutes,shots,release_at')
      .eq('project_id', projectId)
      .not('started_at', 'is', null)
      .gte('started_at', from)
      .lte('started_at', to)
      .order('started_at', { ascending: true });
    setEntries(data ?? []);
    setLoading(false);
  }, [projectId, cursor.y, cursor.m]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOpenDay(null); }, [cursor.y, cursor.m]);

  /** day key -> entries, for the squares and the panel alike */
  const byDay = useMemo(() => {
    const m: Record<string, Entry[]> = {};
    for (const e of entries) {
      if (!e.started_at) continue;
      (m[dayKey(e.started_at)] ??= []).push(e);
    }
    return m;
  }, [entries]);

  const busiest = useMemo(
    () => Math.max(1, ...Object.values(byDay).map((es) => es.reduce((n, e) => n + (e.minutes ?? 0), 0))),
    [byDay]
  );

  /** Leading blanks then the real days, so the grid lines up under the weekday row. */
  const squares = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const out: (string | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= days; d++) {
      out.push(`${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return out;
  }, [cursor.y, cursor.m]);

  async function openThe(key: string) {
    if (openDay === key) return setOpenDay(null);
    setOpenDay(key);

    const supabase = createClient();
    const ids = (byDay[key] ?? []).map((e) => e.id);
    if (ids.length) {
      const { data } = await supabase
        .from('comments')
        .select('id,entry_id,body,from_staff,created_at')
        .in('entry_id', ids)
        .order('created_at', { ascending: true });
      const grouped: Record<string, Comment[]> = {};
      for (const c of data ?? []) if (c.entry_id) (grouped[c.entry_id] ??= []).push(c);
      setComments((prev) => ({ ...prev, ...grouped }));
      for (const id of ids) if (!grouped[id]) setComments((p) => ({ ...p, [id]: p[id] ?? [] }));
    }

    // Screenshots live in a private bucket. Each one gets its own short-lived signed
    // URL, minted per view, so nothing here is a link that keeps working if it leaks.
    const paths = (byDay[key] ?? []).flatMap((e) => e.shots ?? []).filter((p) => !shotUrls[p]);
    if (paths.length) {
      const { data } = await supabase.storage.from('shots').createSignedUrls(paths, 60 * 30);
      const next: Record<string, string> = {};
      for (const s of data ?? []) if (s.signedUrl && s.path) next[s.path] = s.signedUrl;
      setShotUrls((prev) => ({ ...prev, ...next }));
    }
  }

  // Posted through the app rather than straight into the table. Not for permission:
  // the insert still runs on this person's own session, so the same policies refuse
  // the same things. It is so the studio can be told, since a reply that nobody sees
  // is worse than no reply box at all.
  async function say(entry: Entry) {
    const body = (draft[entry.id] ?? '').trim();
    if (!body) return;
    setBusy(entry.id);
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_id: entry.id, project_id: entry.project_id, body }),
    });
    setBusy('');
    if (!res.ok) return;
    const { comment } = await res.json();
    setComments((p) => ({ ...p, [entry.id]: [...(p[entry.id] ?? []), comment as Comment] }));
    setDraft((p) => ({ ...p, [entry.id]: '' }));
  }

  const step = (n: number) => {
    const d = new Date(cursor.y, cursor.m + n, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  const monthTotal = entries.reduce((n, e) => n + (e.minutes ?? 0), 0);
  const todayKey = dayKey(new Date().toISOString());

  if (!projectId) {
    return <div className="empty">No project is linked to your account yet.</div>;
  }

  return (
    <div className="wl">
      <div className="wl-cal">
        <div className="wl-nav">
          <button onClick={() => step(-1)} aria-label="previous month">‹</button>
          <b>
            {MONTHS[cursor.m]} {cursor.y}
          </b>
          <button onClick={() => step(1)} aria-label="next month">›</button>
        </div>

        <div className="wl-dow">
          {DOW.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>

        <div className="wl-grid">
          {squares.map((key, i) =>
            key == null ? (
              <span key={`b${i}`} className="wl-blank" />
            ) : (
              (() => {
                const es = byDay[key] ?? [];
                const mins = es.reduce((n, e) => n + (e.minutes ?? 0), 0);
                const worked = es.length > 0;
                return (
                  <button
                    key={key}
                    className={
                      'wl-day' +
                      (worked ? ' worked' : '') +
                      (openDay === key ? ' on' : '') +
                      (key === todayKey ? ' today' : '')
                    }
                    // Depth of colour is hours, so a heavy day reads as heavier at a glance.
                    style={worked ? ({ ['--w' as any]: (mins / busiest).toFixed(2) }) : undefined}
                    onClick={() => worked && openThe(key)}
                    disabled={!worked}
                    title={worked ? `${es.length} update${es.length === 1 ? '' : 's'}, ${dur(mins)}` : ''}
                  >
                    {keyToDate(key).getDate()}
                  </button>
                );
              })()
            )
          )}
        </div>

        <div className="wl-sum">
          {loading
            ? 'Reading the log…'
            : entries.length
              ? `${Object.keys(byDay).length} day${Object.keys(byDay).length === 1 ? '' : 's'} worked · ${dur(monthTotal)}`
              : 'No work released in this month yet.'}
        </div>
      </div>

      <div className="wl-panel">
        {!openDay && (
          <div className="empty">
            {entries.length
              ? 'Pick a marked day to read what happened in those hours.'
              : 'When work is released it appears here, hour by hour, in plain language.'}
          </div>
        )}

        {openDay && (
          <>
            <div className="wl-dayhead">
              <h4>
                {keyToDate(openDay).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </h4>
              <span className="meta">
                {dur((byDay[openDay] ?? []).reduce((n, e) => n + (e.minutes ?? 0), 0))}
              </span>
            </div>

            {(byDay[openDay] ?? []).map((e) => (
              <div className="win-entry" key={e.id}>
                {/* Effort, not a timesheet.
                    This showed a wall-clock window, "3:00 PM to 4:45 PM", which makes a
                    factual claim about when someone sat down and invites a client to
                    watch the clock. The claim actually being made is how much work a
                    piece took, so that is what it says. Pen is commissioned for
                    projects, not employed by the hour, and the log is here to make the
                    work legible rather than to timestamp a shift. */}
                <div className="we-time">
                  <b>{dur(e.minutes) ? `About ${dur(e.minutes)} of work` : 'Duration not recorded'}</b>
                </div>
                {e.area && <div className="we-area">{e.area}</div>}
                <h4 className="we-title">{e.title || 'Work'}</h4>
                {e.eli5 && <p className="we-eli5">{e.eli5}</p>}
                {e.why && <p className="we-why">{e.why}</p>}

                {!!e.shots?.length && (
                  <div className="we-gal">
                    {e.shots.map((p) =>
                      shotUrls[p] ? (
                        <a key={p} href={shotUrls[p]} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={shotUrls[p]} alt="" loading="lazy" />
                        </a>
                      ) : (
                        <span key={p} className="we-shot-skel" />
                      )
                    )}
                  </div>
                )}

                <div className="wl-talk">
                  {(comments[e.id] ?? []).map((c) => (
                    <div key={c.id} className={'wl-c' + (c.from_staff ? ' staff' : '')}>
                      <span className="who">{c.from_staff ? 'Pentinian' : 'You'}</span>
                      <p>{c.body}</p>
                    </div>
                  ))}
                  <div className="wl-say">
                    <input
                      placeholder="Ask about this, or say something…"
                      value={draft[e.id] ?? ''}
                      onChange={(ev) => setDraft((p) => ({ ...p, [e.id]: ev.target.value }))}
                      onKeyDown={(ev) => ev.key === 'Enter' && say(e)}
                    />
                    <button
                      className="mini-btn"
                      onClick={() => say(e)}
                      disabled={busy === e.id || !(draft[e.id] ?? '').trim()}
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
