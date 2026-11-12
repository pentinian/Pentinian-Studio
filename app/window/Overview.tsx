'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { splitWhy } from '@/lib/window/reason';
import { createClient } from '@/lib/supabase/client';
import { parseDay, clock12, type Chunk } from '@/lib/worklog/parse';

// The whole project, rather than one day of it.
//
// The log answers "what happened on Tuesday", which is the right question while a build
// is moving and the wrong one three months in, when nobody remembers which Tuesday. This
// answers "what is this thing, and what has been built", by cutting the same released
// work along its OTHER axis: by area rather than by date.
//
// It is compiled, never stored. Every number here is derived at read time from released
// entries, so it cannot drift from the log, cannot be edited into disagreeing with it,
// and cannot show a client something the gate has not passed. Hold something back and it
// leaves here too, on its own.

type Entry = {
  id: string;
  title: string | null;
  eli5: string | null;
  why: string | null;
  area: string | null;
  minutes: number | null;
  started_at: string | null;
  links: string[] | null;
  shots: string[] | null;
};

const dur = (m: number) => {
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
};
const when = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

// Days are the studio's days, the same clock the log uses (Log.tsx), so an entry
// started at 11 PM in the studio never lands on the next day for a reader elsewhere.
const STUDIO_TZ = 'America/Los_Angeles';
const dayKey = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-CA', { timeZone: STUDIO_TZ }) : 'undated';
const dayName = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString('en-US', { timeZone: STUDIO_TZ, weekday: 'long', month: 'long', day: 'numeric' })
    : 'Undated';
const clockOf = (s: string | null) =>
  s ? new Date(s).toLocaleTimeString('en-US', { timeZone: STUDIO_TZ, hour: 'numeric', minute: '2-digit' }).replace(':00 ', ' ') : '';

type DayGroup = { key: string; label: string; minutes: number; entries: Entry[] };

/** An area's entries, gathered by the day they were worked, in the order they happened. */
function byDay(es: Entry[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const e of es) {
    const k = dayKey(e.started_at);
    let g = out.find((d) => d.key === k);
    if (!g) out.push((g = { key: k, label: dayName(e.started_at), minutes: 0, entries: [] }));
    g.entries.push(e);
    g.minutes += e.minutes ?? 0;
  }
  return out;
}

export default function Overview({
  projectId, projectName, phase,
}: {
  projectId: string;
  projectName: string;
  phase?: string | null;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openArea, setOpenArea] = useState<string | null>(null);
  // Which lines are open, by entry id and chunk index. Everything starts closed.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const flip = useCallback((k: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  }), []);

  const load = useCallback(async () => {
    const supabase = createClient();
    setLoading(true);
    const base = 'id,title,eli5,why,area,minutes,started_at,shots';
    // Same progressive fallback the rest of the Window uses: one unknown column makes
    // PostgREST refuse the whole query, so a pending migration would blank this rather
    // than degrade it.
    const ask = (select: string) => supabase.from('work_log_released')
      .select(select).eq('project_id', projectId)
      .order('started_at', { ascending: true, nullsFirst: false });
    let { data, error } = (await ask(`${base},links`)) as { data: any; error: any };
    if (error) ({ data } = (await ask(base)) as { data: any; error: any });
    setEntries((data as Entry[]) ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const areas = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const k = (e.area ?? '').trim() || 'Everything else';
      (map.get(k) ?? map.set(k, []).get(k)!).push(e);
    }
    // Heaviest first. The area that took the most work is the one someone should read
    // about first, and alphabetical order would bury it behind whatever starts with A.
    return [...map.entries()]
      .map(([name, es]) => ({
        name, es,
        minutes: es.reduce((n, e) => n + (e.minutes ?? 0), 0),
      }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [entries]);

  const total = entries.reduce((n, e) => n + (e.minutes ?? 0), 0);
  const days = new Set(entries.map((e) => (e.started_at ?? '').slice(0, 10)).filter(Boolean)).size;
  const first = entries.find((e) => e.started_at)?.started_at ?? null;
  const last = [...entries].reverse().find((e) => e.started_at)?.started_at ?? null;
  const links = [...new Set(entries.flatMap((e) => e.links ?? []))];

  if (loading) return <div className="cn-body"><p className="cur-empty">Reading the project…</p></div>;

  if (!entries.length) {
    return (
      <div className="cn-body">
        <p className="cur-empty">
          Nothing released yet, so there is nothing to summarise. As pieces of work are
          passed they gather here by area, which is how this reads as a project rather
          than a list of days.
        </p>
      </div>
    );
  }

  return (
    <div className="cn-body ov">
      <header className="bg-head">
        <div>
          <span className="bg-kicker">The project</span>
          <h4>{projectName}</h4>
        </div>
        <p>
          Everything released so far, gathered by the part of the build it touched. The
          log next door is the same work in the order it happened. This is the same work
          in the order it matters.
        </p>
      </header>

      <div className="ov-stats">
        <div><b>{dur(total)}</b><span>of work released</span></div>
        <div><b>{entries.length}</b><span>piece{entries.length === 1 ? '' : 's'}</span></div>
        <div><b>{days}</b><span>day{days === 1 ? '' : 's'} with work on them</span></div>
        <div><b>{areas.length}</b><span>part{areas.length === 1 ? '' : 's'} of the build</span></div>
      </div>

      {(first || phase) && (
        <p className="ov-span">
          {phase && <b>{phase}</b>}
          {first && <>Running from {when(first)}{last && last !== first ? ` to ${when(last)}` : ''}.</>}
        </p>
      )}

      {/* The spine. Each area is a chapter, weighted by the work in it, and the bar is
          the same proportion the day summary uses so the two read as one system. */}
      <div className="cn-row">
        <span className="cn-row-l"><em>01</em>What was built</span>
        <div className="cn-row-b">
          {areas.map((a, i) => {
            const on = openArea === a.name;
            return (
              <section className={'ov-area' + (on ? ' open' : '')} key={a.name}>
                <button className="ov-head" onClick={() => setOpenArea(on ? null : a.name)}>
                  <span className="ov-n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="ov-name">{a.name}</span>
                  <span className="ov-bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(4, (a.minutes / total) * 100)}%` }} />
                  </span>
                  {/* A part with pieces in it but no minutes against them read as 0m
                      beside an empty bar, which says the row is empty when it is not.
                      It says what it holds instead, and the row stays worth opening. */}
                  <span className="ov-mins">
                    {a.minutes > 0
                      ? dur(a.minutes)
                      : `${a.es.length} piece${a.es.length === 1 ? '' : 's'}`}
                  </span>
                  <span className="ov-caret" aria-hidden="true">{on ? '−' : '+'}</span>
                </button>

                {/* Read by day (R111). Each day is a header (the date, its hours), then
                    one line per piece of it: the chunks of a day's entry when its body
                    parses (lib/worklog/parse.ts), or the entry itself on the older days
                    that logged one entry per piece. What was done waits behind each
                    line, so the open area is a list of days rather than a wall. */}
                {on && (
                  <div className="fc-days">
                    {/* The work log's download control mounts here after the merge
                        (contract interface 3, r720 provides, r721 mounts). */}
                    {/^work log$/i.test(a.name) && <div className="fc-slot" data-slot="log-downloads" />}
                    {byDay(a.es).map((d) => (
                      <section className="fc-day" key={d.key} data-day={d.key}>
                        <header className="fc-day-h">
                          <h5>{d.label}</h5>
                          {d.minutes > 0 && <span>{dur(d.minutes)}</span>}
                        </header>
                        {d.entries.map((e) => (
                          <DayEntry key={e.id} e={e} open={open} flip={flip} />
                        ))}
                      </section>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {links.length > 0 && (
        <div className="cn-row">
          <span className="cn-row-l"><em>02</em>Things to look at</span>
          <div className="cn-row-b">
            <ul className="ov-links">
              {links.map((u) => (
                <li key={u}>
                  <a href={u} target="_blank" rel="noopener noreferrer">{u.replace(/^https?:\/\//, '')}</a>
                </li>
              ))}
            </ul>
            {/* Written once here rather than as an asterisk on every link, same as the
                log. A dead link someone was warned about is a shrug. */}
            <p className="cn-note">
              These point at wherever the work was living when it was written about.
              Builds move, so some will already be dead.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const JOB_LABEL = { artinian: 'Artinian Gems', caveman: 'Caveman Gems', both: 'Both' } as const;

/** One entry on a day: its chunks when the body parses, otherwise one line for the
 *  entry. Nothing in the entry is rewritten or dropped; it is only laid out. */
function DayEntry({ e, open, flip }: { e: Entry; open: Set<string>; flip: (k: string) => void }) {
  const day = useMemo(() => parseDay(e.eli5), [e.eli5]);
  const why = splitWhy(e.why);

  if (day.chunks.length) {
    return (
      <>
        {day.purpose && <p className="fc-purpose">{day.purpose}</p>}
        {day.ran && (
          <p className="fc-ran">
            {clock12(day.ran.start)} to {clock12(day.ran.end)}
            {(() => {
              const parts = [
                day.totals?.office ? `office ${dur(Math.round(day.totals.office * 60))}` : null,
                day.totals?.remote ? `remote ${dur(Math.round(day.totals.remote * 60))}` : null,
              ].filter(Boolean).join(', ');
              return parts ? `. ${parts.charAt(0).toUpperCase()}${parts.slice(1)}.` : '';
            })()}
          </p>
        )}
        <ul className="fc-lines">
          {day.chunks.map((c, i) => (
            <ChunkLine key={i} c={c} k={`${e.id}:${i}`} on={open.has(`${e.id}:${i}`)} flip={flip} />
          ))}
        </ul>
      </>
    );
  }

  // The older days logged one entry per piece of work, and a day entry whose body
  // the parser cannot place falls back here too: its text exactly as written, one
  // paragraph per line, behind the line.
  const k = `${e.id}:e`;
  const on = open.has(k);
  const lines = (e.eli5 ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const items = lines.filter((l) => /^[•·]\s?/.test(l)).map((l) => l.replace(/^[•·]\s?/, ''));
  const prose = lines.filter((l) => !/^[•·]\s?/.test(l));
  const has = !!(why.sentence || lines.length);
  return (
    <ul className="fc-lines">
      <li data-chunk>
        <button className="fc-line" onClick={() => has && flip(k)} aria-expanded={has ? on : undefined}
                data-chunk-toggle={has ? '' : undefined}>
          <span className="fc-span">{clockOf(e.started_at)}</span>
          <span className="fc-tb">
            <span className="fc-t">{e.title || 'Work'}</span>
            {why.reason && <span className="fc-chips"><em className="we-reason">{why.reason}</em></span>}
          </span>
          <span className="fc-h">{e.minutes ? `~${dur(e.minutes)}` : ''}</span>
          <span className="fc-c" aria-hidden="true">{has ? (on ? '−' : '+') : ''}</span>
        </button>
        {on && (
          <div className="fc-more">
            {why.sentence && <p className="ov-why">{why.sentence}</p>}
            {prose.map((p, i) => <p key={i}>{p}</p>)}
            {items.length > 0 && <ul className="fc-items">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>}
          </div>
        )}
      </li>
    </ul>
  );
}

function ChunkLine({ c, k, on, flip }: { c: Chunk; k: string; on: boolean; flip: (k: string) => void }) {
  const has = c.lines.length > 0;
  const where = [c.placeLabel, c.parallel ? 'in parallel' : null].filter(Boolean).join(', ');
  return (
    <li data-chunk className={c.counted ? undefined : 'fc-late'}>
      <button className="fc-line" onClick={() => has && flip(k)} aria-expanded={has ? on : undefined}
              data-chunk-toggle={has ? '' : undefined}>
        <span className="fc-span">{clock12(c.start)} to {clock12(c.end)}</span>
        <span className="fc-tb">
          <span className="fc-t">{c.title}</span>
          <span className="fc-chips">
            {c.job && (
              <span className={'fc-job ' + c.job}><i aria-hidden="true" />{c.company ?? JOB_LABEL[c.job]}</span>
            )}
            {c.reason && <em className="we-reason">{c.reason}</em>}
          </span>
        </span>
        <span className="fc-h">{!c.counted ? 'not counted' : c.hours != null ? dur(Math.round(c.hours * 60)) : ''}</span>
        <span className="fc-c" aria-hidden="true">{has ? (on ? '−' : '+') : ''}</span>
      </button>
      {on && (
        <div className="fc-more">
          {where && <p className="fc-where">{where}</p>}
          {c.notes.map((n, i) => <p key={i}>{n}</p>)}
          {c.items.length > 0 && <ul className="fc-items">{c.items.map((t, i) => <li key={i}>{t}</li>)}</ul>}
        </div>
      )}
    </li>
  );
}
