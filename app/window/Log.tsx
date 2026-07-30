'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import DaySummary from './DaySummary';
import QuietDay from './QuietDay';

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
  links: string[] | null;
  /** Labels the gap BEFORE this block. Null reads as research, which is what a
   *  quiet stretch in the middle of a build day usually was. */
  gap_label: string | null;
  release_at: string | null;
};

/** A bare URL is not a label. Show the host and the last path segment, which is
 *  usually the only part that says anything. */
function labelFor(url: string) {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last ? `${u.host}/${last}` : u.host;
  } catch {
    return url;
  }
}

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

/**
 * A day, read as a timeline: the blocks in order with the untouched stretches
 * between them compressed to a line.
 *
 * The point is the shape of the day, not a running total. Work that happened at one
 * in the morning should look like it happened at one in the morning, because that is
 * the part a duration alone erases. The quiet stretches are collapsed rather than
 * drawn to scale, so a day with a gap in the middle does not become mostly whitespace.
 */
type Row = { kind: 'entry'; e: Entry } | { kind: 'gap'; minutes: number; label: string };

function timeline(entries: Entry[]): Row[] {
  const out: Row[] = [];
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    if (prev?.ended_at && e.started_at) {
      const gap = Math.round(
        (new Date(e.started_at).getTime() - new Date(prev.ended_at).getTime()) / 60000
      );
      // Half an hour is a coffee, not a gap worth drawing.
      // "away" reads as absence. A gap in a build day is usually reading, thinking
      // or waiting on something, so research is the honest default and the label is
      // editable per gap in the Atelier.
      if (gap >= 30) out.push({ kind: 'gap', minutes: gap, label: (e.gap_label ?? '').trim() || 'research' });
    }
    out.push({ kind: 'entry', e });
  });
  return out;
}

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
  const [openEntry, setOpenEntry] = useState<string | null>(null);
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
    // Asked for with links, and again without if that column is not there yet.
    // A pending migration should degrade to one missing feature, not a blank page:
    // PostgREST refuses the whole query over one unknown column, so without this the
    // Window would go empty between deploying the code and running the SQL.
    const base =
      'id,project_id,title,area,eli5,why,started_at,ended_at,minutes,shots,gap_label,release_at';
    const ask = (cols: string) =>
      supabase
        .from('work_log_released')
        .select(cols)
        .eq('project_id', projectId)
        .not('started_at', 'is', null)
        .gte('started_at', from)
        .lte('started_at', to)
        .order('started_at', { ascending: true });

    // Asked for with the newest columns, then progressively without. PostgREST
    // refuses a whole query over one unknown column, so a pending migration must
    // cost one feature rather than the page.
    let { data, error } = await ask(`${base},links`);
    if (error) ({ data, error } = await ask(base));
    if (error) ({ data } = await ask(base.replace(',gap_label', '')));
    setEntries((data as unknown as Entry[]) ?? []);
    setLoading(false);
  }, [projectId, cursor.y, cursor.m]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOpenDay(null); }, [cursor.y, cursor.m]);

  // Open the most recent day that has work, rather than greeting someone with an
  // empty panel and an instruction. The calendar is for moving between days, not a
  // gate you have to pass to see anything, and with one marked day it was a click
  // that did nothing but hide the content until you found it.
  useEffect(() => {
    if (openDay || !entries.length) return;
    const latest = Object.keys(byDay).sort().pop();
    if (latest) open(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, openDay]);

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
    await open(key);
  }

  async function open(key: string) {
    setOpenDay(key);
    setOpenEntry(null);

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
                    // Depth of color is hours, so a heavy day reads as heavier at a glance.
                    style={worked ? ({ ['--w' as any]: (mins / busiest).toFixed(2) }) : undefined}
                    // Every day opens, not only the ones with work. A disabled square
                    // answers a question with silence, and the honest answer to "what
                    // happened on the 14th" is usually "it is not written up yet"
                    // rather than nothing at all.
                    onClick={() => openThe(key)}
                    title={worked ? `${es.length} update${es.length === 1 ? '' : 's'}, ${dur(mins)}` : 'Nothing released'}
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

        {/* A day with nothing released still answers. Silence reads as nothing
            happened, and the true answer is almost always that the write-up is not
            finished, which is worth saying out loud. */}
        {openDay && (byDay[openDay] ?? []).length === 0 && (
          <>
            <div className="wl-dayhead">
              <h4>
                {keyToDate(openDay).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </h4>
            </div>
            <QuietDay date={keyToDate(openDay)} />
          </>
        )}

        {openDay && (byDay[openDay] ?? []).length > 0 && (
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

            {/* Collapsed by default: the duration, the title, and a thumbnail. A day
                with six blocks in it should read as a list you can scan, not a wall of
                prose you have to scroll past to find the one you care about. Everything
                else waits behind a click. */}
            <DaySummary entries={byDay[openDay] ?? []} />

            {timeline(byDay[openDay] ?? []).map((row, i) => {
              if (row.kind === 'gap') {
                return (
                  <div className="wl-gap" key={`gap${i}`}>
                    <span>{dur(row.minutes)} {row.label}</span>
                  </div>
                );
              }
              const e = row.e;
              const isOpen = openEntry === e.id;
              const firstShot = e.shots?.[0];
              return (
                <div className={'win-entry' + (isOpen ? ' open' : '')} key={e.id}>
                  <button className="we-head" onClick={() => setOpenEntry(isOpen ? null : e.id)}>
                    {/* The gutter is the timeline: when it started, then how long it ran.
                        The approximate sign carries the hedge, so no word has to. */}
                    <span className="we-when">
                      <b>{clock(e.started_at) || '--'}</b>
                      <i>{dur(e.minutes) ? `~${dur(e.minutes)}` : 'no time'}</i>
                    </span>
                    <span className="we-headline">
                      {e.area && <i className="we-area">{e.area}</i>}
                      <b>{e.title || 'Work'}</b>
                    </span>
                    {firstShot &&
                      (shotUrls[firstShot] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="we-thumb" src={shotUrls[firstShot]} alt="" loading="lazy" />
                      ) : (
                        <span className="we-thumb skel" />
                      ))}
                    <span className="we-caret">{isOpen ? '▾' : '▸'}</span>
                  </button>

                  {isOpen && (
                    <div className="we-body">
                      {clock(e.started_at) && clock(e.ended_at) && (
                        <p className="we-ran">
                          Ran {clock(e.started_at)} to {clock(e.ended_at)}
                        </p>
                      )}
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

                      {!!e.links?.length && (
                        <div className="we-links">
                          <span className="we-links-l">Have a look</span>
                          {e.links.map((u) => (
                            <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                              {labelFor(u)} <i>&#8599;</i>
                            </a>
                          ))}
                          {/* Said plainly and once, rather than an asterisk on every link.
                              A dead link a client was warned about is a shrug. One they
                              were not warned about looks like the work went missing. */}
                          <p className="we-links-note">
                            These point at wherever the thing was living when I wrote the note.
                            Builds move, so some will already be dead. I keep them mostly for my
                            own record. While one still answers, poke at it.
                          </p>
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
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
