'use client';

import { useMemo, useState } from 'react';
import './day.css';
import {
  clock12,
  hoursFor,
  hoursText,
  jobsOf,
  minutesOf,
  switchovers,
  type Chunk,
  type Day,
  type Job,
} from '@/lib/worklog/parse';

// A day of work, read as its chunks (r718, rulings R101 to R104 and R107).
//
// The day's entry is one row of plain text. lib/worklog/parse.ts reads it back into
// spans; this draws them as a document: a tab per job, a line saying what the day was
// for and where it was worked, then one block per chunk in time order with its time
// in the gutter, a header, and its lines as a short list. Where the day moved from
// the office to remote a rule crosses the list at that hour.
//
// Nothing here is stored or written. A body the parser cannot place never reaches
// this component; Log.tsx shows it as it always did.

const span = (c: Chunk) => `${clock12(c.start)} to ${clock12(c.end)}`;
const sum = (cs: Chunk[], k: 'office' | 'remote') => cs.reduce((n, c) => n + (c[k] ?? 0), 0);

/* R107. One segment per hour, eight marked as the full day, the hours past eight in
 * the second color, the figure beside it. A short day shows the rest of its eight
 * as an empty track, so the line always says how full the day was. */
/** Quarter hours read as the log writes them ("11.5 h"); anything else as clock
 *  time ("9h 50m"), never as "9.83 h". */
const figure = (min: number) =>
  min % 15 === 0 ? hoursText(min / 60) : `${Math.floor(min / 60)}h ${min % 60}m`;

export function HoursLine({ minutes }: { minutes: number }) {
  const h = Math.round((minutes / 60) * 100) / 100;
  if (!h) return null;
  const overMin = Math.max(0, minutes - 8 * 60);
  const n = Math.max(8, Math.ceil(h));
  const SEG = 8, GAP = 2;
  const over = Math.max(0, Math.round((h - 8) * 100) / 100);
  const label = over
    ? `${figure(minutes)}: a full day of 8 hours and ${figure(overMin)} past it`
    : `${figure(minutes)} of an 8 hour day`;
  return (
    <span className="hl" role="img" aria-label={label} title={label}>
      <span className="hl-track" aria-hidden="true">
        {Array.from({ length: n }, (_, i) => {
          const fill = Math.min(1, Math.max(0, h - i));
          if (!fill) return <span key={i} className="empty" style={{ width: SEG }} />;
          return (
            <span
              key={i}
              className={i >= 8 ? 'over' : undefined}
              style={{ width: fill < 1 ? Math.max(2, Math.round(SEG * fill)) : SEG, marginRight: fill < 1 ? SEG - Math.max(2, Math.round(SEG * fill)) : 0 }}
            />
          );
        })}
        <i className="hl-eight" style={{ left: 8 * SEG + 7 * GAP + GAP / 2 - 0.5 }} />
      </span>
      <span className="hl-fig">
        {figure(minutes)}
        {over > 0 && <i>+{figure(overMin)}</i>}
      </span>
    </span>
  );
}

function ChunkBlock({ c }: { c: Chunk }) {
  const placeClass = c.place ?? (c.placeLabel ? 'mixed' : '');
  const charged =
    c.hours == null ? null : c.parallel ? `${hoursText(c.hours)}, in parallel` : hoursText(c.hours);
  return (
    <section className="dc-chunk" data-job={c.job ?? undefined}>
      <span className="dc-when">
        <b>{span(c)}</b>
        {charged && <i>{charged}</i>}
      </span>
      <div className="dc-main">
        <h5>{c.title}</h5>
        <p className="dc-meta">
          {c.company && (
            <span className={'dc-job ' + (c.job ?? '')}>
              <i aria-hidden="true" />
              {c.company}
            </span>
          )}
          {c.placeLabel && <span className={'dc-place ' + placeClass}>{c.placeLabel}</span>}
          {c.reason && <em className="we-reason">{c.reason}</em>}
        </p>
        {c.notes.map((n, i) => (
          <p className="dc-note" key={i}>{n}</p>
        ))}
        {c.items.length > 0 && (
          <ul className="dc-items">
            {c.items.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function DayChunks({ day }: { day: Day }) {
  // Tabs in a fixed order (Both, Artinian Gems, Caveman Gems), whatever order the
  // day's sentence happened to name them in.
  const RANK: Record<string, number> = { artinian: 0, caveman: 1, both: 2 };
  const jobs = useMemo(() => [...jobsOf(day)].sort((a, b) => RANK[a.job] - RANK[b.job]), [day]);
  const [tab, setTab] = useState<Job>(null);
  const showTabs = jobs.length > 1;

  const shown = useMemo(() => {
    const order = (j: Job) => {
      const i = jobs.findIndex((x) => x.job === j);
      return i < 0 ? jobs.length : i;
    };
    return day.chunks
      .filter((c) => tab == null || c.job === tab)
      .map((c, i) => ({ c, i }))
      .sort((a, b) => minutesOf(a.c.start) - minutesOf(b.c.start) || order(a.c.job) - order(b.c.job) || a.i - b.i)
      .map((x) => x.c);
  }, [day, tab, jobs]);

  const counted = shown.filter((c) => c.counted);
  const late = shown.filter((c) => !c.counted);
  const switches = switchovers(day, counted);
  const office = sum(counted, 'office');
  const remote = sum(counted, 'remote');
  const placed = counted.some((c) => c.office != null);
  const hours = hoursFor(day, tab);

  // The list, with a rule dropped in before the first chunk at or after each switch.
  const rows: ({ k: 'c'; c: Chunk } | { k: 's'; at: string; to: 'office' | 'remote' })[] = [];
  const pending = [...switches];
  for (const c of counted) {
    while (pending.length && minutesOf(pending[0].at) <= minutesOf(c.start) && rows.length) {
      const s = pending.shift()!;
      rows.push({ k: 's', at: s.at, to: s.to });
    }
    if (pending.length && minutesOf(pending[0].at) <= minutesOf(c.start) && !rows.length) pending.shift();
    rows.push({ k: 'c', c });
  }
  for (const s of pending) rows.push({ k: 's', at: s.at, to: s.to });

  const tabLabel = tab == null ? null : jobs.find((j) => j.job === tab)?.label;

  return (
    <div className="dc">
      {showTabs && (
        <div className="tabs dc-tabs" role="tablist" aria-label="Which job">
          {[{ job: null as Job, label: 'Both' }, ...jobs].map((j) => (
            <button
              key={j.job ?? 'both'}
              role="tab"
              aria-selected={tab === j.job}
              className={tab === j.job ? 'on' : undefined}
              onClick={() => setTab(j.job)}
            >
              {j.label}
              <b>{hoursText(hoursFor(day, j.job))}</b>
            </button>
          ))}
        </div>
      )}

      <div className="dc-lede">
        {tab == null && day.purpose && <p>{day.purpose}</p>}
        {tab != null && (
          <p>
            {tabLabel}: {hoursText(hours)} across {counted.length} {counted.length === 1 ? 'piece' : 'pieces'}.
          </p>
        )}
        {placed && (office > 0 || remote > 0) && (
          <p className="dc-where">
            {office > 0 && <span className="t-office">Office {hoursText(office)}</span>}
            {office > 0 && remote > 0 && ', '}
            {remote > 0 && <span className="t-remote">{office > 0 ? 'remote' : 'Remote'} {hoursText(remote)}</span>}
            {switches.length > 0 &&
              `. ${switches.map((s) => `${s.to === 'remote' ? 'Remote' : 'In office'} from ${clock12(s.at)}`).join('. ')}`}
            .
          </p>
        )}
      </div>

      <div className="dc-list">
        {rows.map((r, i) =>
          r.k === 'c' ? (
            <ChunkBlock c={r.c} key={`c${i}`} />
          ) : (
            <div className={'dc-switch to-' + r.to} key={`s${i}`} role="separator">
              <b>{clock12(r.at)}</b>
              <span>{r.to === 'remote' ? 'Remote from here' : 'In office from here'}</span>
            </div>
          )
        )}
      </div>

      {late.length > 0 && (
        <div className="dc-late">
          <p>Outside 5 AM to 10 PM: written down, not counted in the hours</p>
          <div className="dc-list">
            {late.map((c, i) => (
              <ChunkBlock c={c} key={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
