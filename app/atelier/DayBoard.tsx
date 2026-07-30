'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// The Quarry as a month and a day, rather than one list that grows forever.
//
// A flat queue is fine at seventeen entries and unusable at three hundred, and the thing
// it hides is precisely the thing being composed: how a day reads. Client-facing time is
// representative effort rather than a timesheet, which means the arrangement of a day is
// authored, and authoring it in a list sorted by descending timestamp is like editing a
// paragraph through a spreadsheet.
//
// So: a month to choose from, and the chosen day laid out on its hours. Drag a block to
// move it, drag its bottom edge to change how long the piece reads as taking. Nothing
// saves until you press Save, because a drag is an experiment and an autosave would make
// every twitch a decision.
//
// It shows released and unreleased together, distinguished by treatment, because you are
// arranging one day and a client sees one day. Hiding the released half would mean
// composing around furniture you cannot see.

// Writing one by hand. Not everything comes through Notion: a thing noticed mid
// afternoon, a piece parked half finished, work that predates this system. An entry
// written here is an ordinary Quarry row, with no notion_id, so no sync can key onto it
// and overwrite what was typed. Time is optional, which is what makes it a draft.
function Draft({
  projectId, day, onDone,
}: {
  projectId: string | null;
  day: string | null;
  onDone: () => void;
}) {
  const [d, setD] = useState({
    title: '', area: '', detail: '',
    date: day ?? '', time: '', minutes: 60, timed: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!d.title.trim()) return setErr('It needs a title.');
    if (!projectId) return setErr('Pick a project in the rail first.');
    setBusy(true); setErr('');

    let started_at: string | null = null;
    if (d.timed && d.date && d.time) {
      const [y, m, dd] = d.date.split('-').map(Number);
      const [hh, mm] = d.time.split(':').map(Number);
      started_at = new Date(y, m - 1, dd, hh, mm).toISOString();
    }

    const res = await fetch('/api/quarry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        create: {
          project_id: projectId,
          title: d.title.trim(),
          area: d.area.trim(),
          detail: d.detail.trim(),
          started_at,
          minutes: d.minutes,
        },
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j.error ?? 'That did not save.');
    setD({ title: '', area: '', detail: '', date: day ?? '', time: '', minutes: 60, timed: false });
    onDone();
  };

  return (
    <div className="db-draft">
      <input placeholder="What it is" value={d.title}
             onChange={(e) => setD({ ...d, title: e.target.value })} />
      <input placeholder="Which part of the build" value={d.area}
             onChange={(e) => setD({ ...d, area: e.target.value })} />
      <textarea rows={2} placeholder="Notes to yourself, optional" value={d.detail}
                onChange={(e) => setD({ ...d, detail: e.target.value })} />

      <label className="db-timed">
        <input type="checkbox" checked={d.timed}
               onChange={(e) => setD({ ...d, timed: e.target.checked })} />
        Put it on the calendar
      </label>

      {d.timed && (
        <div className="db-when-row">
          <input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
          <input type="time" value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} />
          <input type="number" min={5} step={5} value={d.minutes}
                 onChange={(e) => setD({ ...d, minutes: Number(e.target.value) })} title="minutes" />
        </div>
      )}

      {err && <p className="cur-msg bad">{err}</p>}
      <div className="cn-add-row">
        <button className="mini-btn pri" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : d.timed ? 'Add to the day' : 'Park it'}
        </button>
        <span className="cn-note">
          It lands staged, like everything else. Nothing reaches a client without a
          release.
        </span>
      </div>
    </div>
  );
}

export type Block = {
  id: string;
  title: string;
  area: string | null;
  started_at: string | null;
  minutes: number | null;
  released: boolean;
};

// 72px an hour, because at 56 a thirty minute block was 28px tall and its own title was
// sliced through the middle. A block you cannot read is not a block, it is a smear with
// a tooltip. Anything under 45 minutes also drops to a single line, below.
const HOUR = 72;
const START_HOUR = 6;     // the grid runs 6am to 11pm; earlier hours are almost always empty
const END_HOUR = 23;
const SNAP = 5;           // minutes
const TIGHT = 45;         // minutes below which a block goes to one line
// A press that moves less than this is a click, not a drag. Without it every attempt to
// open an entry nudged it by a few minutes.
const SLOP = 4;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW = ['S','M','T','W','T','F','S'];

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const keyToDate = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
const dur = (m: number) => {
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
};
/** The clock face for a minute offset inside a given day, for the drop preview. */
const clockOf = (dayk: string, offset: number) => {
  const d = keyToDate(dayk);
  d.setHours(START_HOUR, 0, 0, 0);
  return new Date(d.getTime() + offset * 60000)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** Minutes from the top of the grid, for a block's start. */
const offsetOf = (iso: string) => {
  const d = new Date(iso);
  return (d.getHours() - START_HOUR) * 60 + d.getMinutes();
};

export default function DayBoard({
  blocks, onOpen, onSaved, selectedId, projectId, projectFacing,
}: {
  blocks: Block[];
  onOpen: (id: string) => void;
  onSaved: () => void;
  selectedId?: string | null;
  projectId: string | null;
  projectFacing?: boolean;
}) {
  const [drafting, setDrafting] = useState(false);
  const [cursor, setCursor] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; });
  const [openDay, setOpenDay] = useState<string | null>(null);
  // A null time is not missing data, it is a decision: the piece is real and where it
  // sits has not been settled. That is the whole point of the holding area, so the edit
  // shape has to be able to express it.
  const [edits, setEdits] = useState<Record<string, { started_at: string | null; minutes: number }>>({});
  // Which zone the pointer is over mid-drag, and where inside the grid it would land.
  const [over, setOver] = useState<null | 'grid' | 'bench'>(null);
  const [ghost, setGhost] = useState<number | null>(null);
  const bench = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<null | {
    id: string; mode: 'move' | 'size'; startY: number; baseOffset: number; baseMinutes: number;
    moved: boolean; from: 'grid' | 'bench';
  }>(null);

  // An edited block reads from the draft, everything else from the server.
  const shown = useMemo(
    () => blocks.map((b) => {
      const e = edits[b.id];
      return e ? { ...b, started_at: e.started_at, minutes: e.minutes } : b;
    }),
    [blocks, edits]
  );

  const byDay = useMemo(() => {
    const map: Record<string, Block[]> = {};
    for (const b of shown) if (b.started_at) (map[dayKey(b.started_at)] ??= []).push(b);
    for (const k of Object.keys(map)) {
      map[k].sort((a, z) => (a.started_at ?? '').localeCompare(z.started_at ?? ''));
    }
    return map;
  }, [shown]);

  const undated = useMemo(() => shown.filter((b) => !b.started_at), [shown]);

  const squares = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const out: (string | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= days; d++) out.push(`${cursor.y}-${pad(cursor.m + 1)}-${pad(d)}`);
    return out;
  }, [cursor.y, cursor.m]);

  // Open the busiest day in view rather than nothing, so the board is never blank on
  // arrival for no reason.
  useEffect(() => {
    const inMonth = Object.keys(byDay).filter((k) => k.startsWith(`${cursor.y}-${pad(cursor.m + 1)}`));
    if (!inMonth.length) { setOpenDay(null); return; }
    setOpenDay((cur) => (cur && inMonth.includes(cur) ? cur : inMonth.sort().pop()!));
  }, [cursor.y, cursor.m, byDay]);

  // ---------------------------------------------------------------- dragging
  //
  // Two zones and both directions. Onto the grid gives a piece a time; onto the bench
  // takes it away again. The zone is decided by where the pointer actually is rather
  // than by which element the press started on, because a drag that begins in one place
  // and ends in another is the entire gesture.
  //
  // HTML5 drag and drop is not used on purpose: it cannot show a live position inside
  // an hour grid, its drag image is not stylable, and it does not fire on touch.
  useEffect(() => {
    const zoneAt = (x: number, y: number): 'grid' | 'bench' | null => {
      const g = grid.current?.getBoundingClientRect();
      if (g && x >= g.left && x <= g.right && y >= g.top && y <= g.bottom) return 'grid';
      const b = bench.current?.getBoundingClientRect();
      if (b && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return 'bench';
      return null;
    };

    // Minutes from the top of the grid for a viewport y, snapped and clamped.
    const minutesAt = (y: number, len: number) => {
      const g = grid.current?.getBoundingClientRect();
      if (!g) return 0;
      const raw = ((y - g.top) / HOUR) * 60;
      const total = (END_HOUR - START_HOUR) * 60;
      return Math.max(0, Math.min(total - len, Math.round(raw / SNAP) * SNAP));
    };

    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dy = ev.clientY - d.startY;
      // Below the slop threshold this is still a click on its way to happening.
      if (!d.moved && Math.abs(dy) < SLOP) return;
      d.moved = true;
      document.body.classList.add('dragging');

      const zone = zoneAt(ev.clientX, ev.clientY);
      setOver(zone);

      // Resizing never leaves the block it started on.
      if (d.mode === 'size') {
        if (!openDay) return;
        const total = (END_HOUR - START_HOUR) * 60;
        const dm = Math.round((dy / HOUR) * 60 / SNAP) * SNAP;
        const minutes = Math.max(SNAP, Math.min(total - d.baseOffset, d.baseMinutes + dm));
        const base = keyToDate(openDay);
        base.setHours(START_HOUR, 0, 0, 0);
        setEdits((e) => ({
          ...e,
          [d.id]: { started_at: new Date(base.getTime() + d.baseOffset * 60000).toISOString(), minutes: minutes },
        }));
        return;
      }

      if (zone === 'grid' && openDay) {
        // Coming off the bench the cursor holds the top of the block; coming off the
        // grid it holds wherever it was grabbed, so the offset is carried through.
        const offset = d.from === 'bench'
          ? minutesAt(ev.clientY, d.baseMinutes)
          : Math.max(0, Math.min((END_HOUR - START_HOUR) * 60 - d.baseMinutes, d.baseOffset + Math.round((dy / HOUR) * 60 / SNAP) * SNAP));
        setGhost(offset);
        const base = keyToDate(openDay);
        base.setHours(START_HOUR, 0, 0, 0);
        setEdits((e) => ({
          ...e,
          [d.id]: { started_at: new Date(base.getTime() + offset * 60000).toISOString(), minutes: d.baseMinutes },
        }));
      } else if (zone === 'bench') {
        setGhost(null);
        setEdits((e) => ({ ...e, [d.id]: { started_at: null, minutes: d.baseMinutes } }));
      }
    };

    // A press that never moved is a click, and a click opens the entry. Reviewing and
    // releasing is what happens all day; rearranging is occasional.
    const up = () => {
      const d = drag.current;
      drag.current = null;
      document.body.classList.remove('dragging');
      setOver(null);
      setGhost(null);
      if (d && !d.moved && d.mode === 'move') onOpen(d.id);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [openDay, onOpen]);

  function grab(ev: React.PointerEvent, b: Block, mode: 'move' | 'size') {
    ev.preventDefault();
    ev.stopPropagation();
    drag.current = {
      id: b.id, mode, startY: ev.clientY,
      // A benched piece has no offset yet; the cursor decides it on the way over.
      baseOffset: b.started_at ? offsetOf(b.started_at) : 0,
      baseMinutes: b.minutes ?? 60,
      moved: false,
      from: b.started_at ? 'grid' : 'bench',
    };
  }

  async function save() {
    // started_at is sent explicitly, null included, because the endpoint distinguishes
    // "put this back on the bench" from "this key was not in the payload".
    const moves = Object.entries(edits).map(([id, v]) => ({
      id, started_at: v.started_at, minutes: v.minutes,
    }));
    if (!moves.length) return;
    setBusy(true); setMsg('');
    const res = await fetch('/api/quarry', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moves }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(d.error ?? 'That did not save.');
    setEdits({});
    const parked = Object.values(edits).filter((v) => v.started_at === null).length;
    setMsg(
      parked
        ? `Saved. ${parked} back on the workbench, the rest placed. Anything already released moved in their Window too.`
        : `Moved ${d.moved} block${d.moved === 1 ? '' : 's'}. Anything already released moved in their Window too.`
    );
    onSaved();
  }

  const day = openDay ? byDay[openDay] ?? [] : [];
  const dayTotal = day.reduce((n, b) => n + (b.minutes ?? 0), 0);
  const dirty = Object.keys(edits).length;
  const staged = day.filter((b) => !b.released);

  async function releaseDay() {
    if (!staged.length) return;
    setBusy(true); setMsg('');
    const res = await fetch('/api/quarry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ release_ids: staged.map((b) => b.id) }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(d.error ?? 'That did not go.');
    // Partial success is reported as partial. A batch that half worked and said
    // "Released" would be the worst possible answer.
    setMsg(
      d.failed
        ? `${d.released} released, ${d.failed} refused. ${d.reason ?? ''}`
        : `Released ${d.released} piece${d.released === 1 ? '' : 's'}. The whole day is in their Window now.`
    );
    onSaved();
  }
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  // Blocks that overlap share the width, so a double-booked hour is visible rather than
  // one block hiding under another.
  const lanes = useMemo(() => {
    const out: Record<string, { lane: number; of: number }> = {};
    const active: { id: string; end: number }[] = [];
    let cluster: Block[] = [];
    const flush = () => {
      if (!cluster.length) return;
      const cols: number[] = [];
      const place: Record<string, number> = {};
      for (const b of cluster) {
        const s = offsetOf(b.started_at!);
        let c = cols.findIndex((end) => end <= s);
        if (c === -1) { c = cols.length; cols.push(0); }
        cols[c] = s + (b.minutes ?? 60);
        place[b.id] = c;
      }
      for (const b of cluster) out[b.id] = { lane: place[b.id], of: cols.length };
      cluster = [];
    };
    let far = -1;
    for (const b of day) {
      const s = offsetOf(b.started_at!);
      if (s >= far && cluster.length) flush();
      cluster.push(b);
      far = Math.max(far, s + (b.minutes ?? 60));
    }
    flush();
    void active;
    return out;
  }, [day]);

  return (
    <div className="db">
      <div className="db-cal">
        <div className="wl-nav">
          <button onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { ...c, m: c.m - 1 }))}
                  aria-label="previous month">‹</button>
          <b>{MONTHS[cursor.m]} {cursor.y}</b>
          <button onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { ...c, m: c.m + 1 }))}
                  aria-label="next month">›</button>
        </div>

        <div className="wl-dow">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>

        <div className="wl-grid">
          {squares.map((key, i) => {
            if (key == null) return <span key={`b${i}`} className="wl-blank" />;
            const bs = byDay[key] ?? [];
            const held = bs.filter((b) => !b.released).length;
            return (
              <button
                key={key}
                className={'db-day' + (bs.length ? ' has' : '') + (openDay === key ? ' on' : '')}
                onClick={() => setOpenDay(key)}
                title={bs.length ? `${bs.length} block${bs.length === 1 ? '' : 's'}, ${held} still staged` : 'nothing here'}
              >
                {keyToDate(key).getDate()}
                {held > 0 && <i className="db-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        {/* The workbench. A holding area, not a leftovers tray: things waiting for a
            time, things pulled off a day to be reordered, and things written by hand
            that have not been placed yet. Drag out of it onto an hour, or drag a block
            off the day back into it. */}
        <div
          ref={bench}
          className={'db-bench' + (over === 'bench' ? ' target' : '') + (drag.current ? ' armed' : '')}
        >
          <div className="db-bench-h">
            <span>Workbench</span>
            {undated.length > 0 && <i className="db-bench-n">{undated.length}</i>}
            <button className="db-new" onClick={() => setDrafting((d) => !d)}>
              {drafting ? 'Close' : 'Write one'}
            </button>
          </div>

          {drafting && (
            <Draft
              projectId={projectId}
              day={openDay}
              onDone={() => { setDrafting(false); onSaved(); }}
            />
          )}

          <div className="db-bench-list">
            {undated.map((b) => (
              <div
                key={b.id}
                className={'db-un' + (edits[b.id] ? ' moved' : '')}
                onPointerDown={(e) => grab(e, b, 'move')}
                title="Click to open it. Drag it onto an hour to give it a time."
              >
                <span className="db-un-grip" aria-hidden="true" />
                <span className="db-un-t">{b.title}</span>
                {b.area && <span className="db-un-a">{b.area}</span>}
              </div>
            ))}
          </div>

          {undated.length === 0 && !drafting && (
            <p className="cn-note">
              Nothing waiting. Drag a block off the day to park it here, or write one.
            </p>
          )}
          {undated.length > 0 && (
            <p className="cn-note">
              Waiting for a time. Drag one onto an hour to place it, or open it to
              release it as it stands.
            </p>
          )}
        </div>
      </div>

      <div className="db-day-wrap">
        <div className="db-head">
          <h4>
            {openDay
              ? keyToDate(openDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
              : 'No day chosen'}
          </h4>
          {openDay && <span className="db-total">{day.length} block{day.length === 1 ? '' : 's'} · {dur(dayTotal)}</span>}
          {/* A day is the unit a client reads, so it is a reasonable unit to release.
              Held back until the arrangement is saved, because releasing a block you
              have just dragged and not committed would publish the old position. */}
          {openDay && staged.length > 0 && dirty === 0 && (
            <button
              className="mini-btn pri db-relday"
              onClick={releaseDay}
              disabled={busy || !projectFacing}
              title={projectFacing
                ? 'Pass everything staged on this day'
                : 'This project is internal, so nothing can be released into it'}
            >
              {busy ? 'Releasing…' : `Release this day (${staged.length})`}
            </button>
          )}
          {dirty > 0 && (
            <div className="db-save">
              <button className="mini-btn" onClick={() => { setEdits({}); setMsg(''); }}>Discard</button>
              <button className="mini-btn pri" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : `Save ${dirty} change${dirty === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </div>

        {msg && <p className="cur-msg">{msg}</p>}

        {openDay && day.length === 0 && (
          <p className="cur-empty">Nothing sits on this day. Pick another, or move a block onto it later.</p>
        )}

        {openDay && day.length > 0 && (
          <div className="db-grid" ref={grid} style={{ height: (END_HOUR - START_HOUR) * HOUR }}>
            {hours.map((h) => (
              <div className="db-hour" key={h} style={{ top: (h - START_HOUR) * HOUR, height: HOUR }}>
                <span>{h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'am' : 'pm'}</span>
              </div>
            ))}

            {/* Where it would land. A drop with no preview is a guess. */}
            {ghost != null && over === 'grid' && (
              <div className="db-ghost" style={{ top: (ghost / 60) * HOUR }} aria-hidden="true">
                <span>{clockOf(openDay!, ghost)}</span>
              </div>
            )}

            {day.map((b) => {
              const off = offsetOf(b.started_at!);
              const mins = b.minutes ?? 60;
              const l = lanes[b.id] ?? { lane: 0, of: 1 };
              const w = 100 / l.of;
              // A short block drops to one line. At the old scale a thirty minute block
              // was 28px tall holding 52px of content, so its own title came out sliced
              // through the middle of the letters.
              const tight = mins < TIGHT;
              return (
                <div
                  key={b.id}
                  className={
                    'db-block' + (b.released ? ' live' : '') +
                    (tight ? ' tight' : '') +
                    (edits[b.id] ? ' moved' : '') +
                    (selectedId === b.id ? ' sel' : '')
                  }
                  style={{
                    top: (off / 60) * HOUR,
                    height: Math.max(26, (mins / 60) * HOUR - 2),
                    left: `calc(58px + ${l.lane * w}% - ${l.lane * w * 0.58}px)`,
                    width: `calc(${w}% - ${w * 0.58}px - 6px)`,
                  }}
                  onPointerDown={(e) => grab(e, b, 'move')}
                  title="Click to open it. Drag to move it, drag the bottom edge to change how long it reads as taking."
                >
                  <span className="db-when">{clock(b.started_at!)} · {dur(mins)}</span>
                  <span className="db-title">{b.title}</span>
                  {b.area && !tight && <span className="db-area">{b.area}</span>}
                  <span className="db-state">{b.released ? 'Released' : 'Staged'}</span>
                  <span className="db-handle" onPointerDown={(e) => grab(e, b, 'size')} aria-hidden="true" />
                </div>
              );
            })}
          </div>
        )}

        {/* Moving a day wholesale, and moving one block to another day. Dragging across
            two separate components is fragile and easy to do by accident, and this is
            the same capability with the ambiguity removed. */}
        {openDay && day.length > 0 && (
          <div className="db-shift">
            <span className="db-shift-l">Shift the whole day</span>
            {[-60, -30, -15, 15, 30, 60].map((n) => (
              <button key={n} className="db-nudge" onClick={() => {
                setEdits((e) => {
                  const next = { ...e };
                  for (const b of day) {
                    if (!b.started_at) continue;
                    const t = new Date(new Date(b.started_at).getTime() + n * 60000);
                    next[b.id] = { started_at: t.toISOString(), minutes: b.minutes ?? 60 };
                  }
                  return next;
                });
              }}>
                {n > 0 ? `+${n}` : n}m
              </button>
            ))}
            {selectedId && day.some((b) => b.id === selectedId) && (
              <label className="db-moveto">
                Move the selected one to
                <input
                  type="date"
                  value={openDay}
                  onChange={(ev) => {
                    const b = day.find((x) => x.id === selectedId);
                    if (!b?.started_at || !ev.target.value) return;
                    const old = new Date(b.started_at);
                    const [y, m, d] = ev.target.value.split('-').map(Number);
                    const t = new Date(y, m - 1, d, old.getHours(), old.getMinutes());
                    setEdits((e) => ({ ...e, [b.id]: { started_at: t.toISOString(), minutes: b.minutes ?? 60 } }));
                    setOpenDay(ev.target.value);
                  }}
                />
              </label>
            )}
          </div>
        )}

        {openDay && day.length > 0 && (
          <p className="cn-note db-hint">
            Click a block to open it. Drag it to move it, drag its bottom edge to change
            how long the piece reads as taking. This is the effort a client sees, not a
            record of when you sat down, so arrange the day the way it should be read.
            Nothing saves until you press Save, and anything already released moves in
            their Window too.
          </p>
        )}
      </div>
    </div>
  );
}
