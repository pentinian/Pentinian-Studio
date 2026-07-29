'use client';

// The day, said once, before the blocks.
//
// Compiled rather than stored. It is derived from whatever is released at the moment
// you look, which is the only shape that behaves correctly at the edges: a piece held
// back is simply absent from the summary, and the day it is released it joins the
// summary with no backfill and nothing to regenerate. A stored summary would have
// needed rewriting every time something was released or pulled back, and would have
// been wrong in between.
//
// Deterministic, not written. It names what was touched and what it cost, and leaves
// the telling to the entries themselves, which are already in Pen's words.

type E = { area: string | null; minutes: number | null; title: string | null };

const dur = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`;

/** "the Window, signing in and the studio side" */
function list(items: string[]) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export default function DaySummary({ entries }: { entries: E[] }) {
  if (!entries.length) return null;

  const total = entries.reduce((n, e) => n + (e.minutes ?? 0), 0);

  // Areas in order of time spent, so the summary leads with where the day actually went.
  const byArea = new Map<string, number>();
  for (const e of entries) {
    const a = (e.area ?? '').trim();
    if (!a) continue;
    byArea.set(a, (byArea.get(a) ?? 0) + (e.minutes ?? 0));
  }
  const areas = [...byArea.entries()].sort((a, b) => b[1] - a[1]);

  const pieces = entries.length;
  const longest = [...entries].sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))[0];

  return (
    <div className="ds">
      <p className="ds-line">
        <b>
          {pieces} {pieces === 1 ? 'piece' : 'pieces'}
          {total ? `, ~${dur(total)}` : ''}
        </b>
        {areas.length > 0 && (
          <>
            {' '}
            across {list(areas.map(([a]) => a.toLowerCase()))}.
          </>
        )}
        {pieces > 1 && longest?.title && (
          <> The longest stretch went on {longest.title.charAt(0).toLowerCase() + longest.title.slice(1)}.</>
        )}
      </p>

      {areas.length > 1 && (
        <div className="ds-bar" aria-hidden="true">
          {areas.map(([a, m]) => (
            <span key={a} style={{ flexGrow: m || 1 }} title={`${a}, ${dur(m)}`} />
          ))}
        </div>
      )}

      {areas.length > 1 && (
        <div className="ds-keys">
          {areas.map(([a, m]) => (
            <span key={a}>
              <i />
              {a} <b>{dur(m)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
