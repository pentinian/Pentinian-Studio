'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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

                {on && (
                  <ol className="ov-list">
                    {a.es.map((e) => (
                      <li key={e.id}>
                        <span className="ov-when">{when(e.started_at)}</span>
                        <div className="ov-b">
                          <b>{e.title}</b>
                          {e.eli5 && <p>{e.eli5}</p>}
                          {e.why && <p className="ov-why">{e.why}</p>}
                        </div>
                        <span className="ov-dur">~{dur(e.minutes ?? 0)}</span>
                      </li>
                    ))}
                  </ol>
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
