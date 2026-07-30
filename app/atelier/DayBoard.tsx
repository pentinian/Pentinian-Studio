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

export type Block = {
  id: string;
  title: string;
  area: string | null;
  started_at: string | null;
  minutes: number | null;
  released: boolean;
};

const HOUR = 56;          // px per hour, enough that a 30 minute block is still legible
const START_HOUR = 6;     // the grid runs 6am to 11pm; earlier hours are almost always empty
const END_HOUR = 23;
const SNAP = 5;           // minutes

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
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** Minutes from the top of the grid, for a block's start. */
const offsetOf = (iso: string) => {
  const d = new Date(iso);
  return (d.getHours() - START_HOUR) * 60 + d.getMinutes();
};

export default function DayBoard({
  blocks, onOpen, onSaved, selectedId,
}: {
  blocks: Block[];
  onOpen: (id: string) => void;
  onSaved: () => void;
  selectedId?: string | null;
}) {
  const [cursor, setCursor] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; });
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { started_at: string; minutes: number }>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<null | {
    id: string; mode: 'move' | 'size'; startY: number; baseOffset: number; baseMinutes: number;
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
  useEffect(() => {
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || !openDay) return;
      const dy = ev.clientY - d.startY;
      const dm = Math.round((dy / HOUR) * 60 / SNAP) * SNAP;

      if (d.mode === 'move') {
        const total = (END_HOUR - START_HOUR) * 60;
        const offset = Math.max(0, Math.min(total - d.baseMinutes, d.baseOffset + dm));
        const base = keyToDate(openDay);
        base.setHours(START_HOUR, 0, 0, 0);
        const started = new Date(base.getTime() + offset * 60000);
        setEdits((e) => ({ ...e, [d.id]: { started_at: started.toISOString(), minutes: d.baseMinutes } }));
      } else {
        const total = (END_HOUR - START_HOUR) * 60;
        const minutes = Math.max(SNAP, Math.min(total - d.baseOffset, d.baseMinutes + dm));
        const base = keyToDate(openDay);
        base.setHours(START_HOUR, 0, 0, 0);
        const started = new Date(base.getTime() + d.baseOffset * 60000);
        setEdits((e) => ({ ...e, [d.id]: { started_at: started.toISOString(), minutes } }));
      }
    };
    const up = () => { drag.current = null; document.body.classList.remove('dragging'); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [openDay]);

  function grab(ev: React.PointerEvent, b: Block, mode: 'move' | 'size') {
    ev.preventDefault();
    ev.stopPropagation();
    if (!b.started_at) return;
    drag.current = {
      id: b.id, mode, startY: ev.clientY,
      baseOffset: offsetOf(b.started_at),
      baseMinutes: b.minutes ?? 60,
    };
    document.body.classList.add('dragging');
  }

  async function save() {
    const moves = Object.entries(edits).map(([id, v]) => ({ id, ...v }));
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
    setMsg(`Moved ${d.moved} block${d.moved === 1 ? '' : 's'}. Anything already released moved in their Window too.`);
    onSaved();
  }

  const day = openDay ? byDay[openDay] ?? [] : [];
  const dayTotal = day.reduce((n, b) => n + (b.minutes ?? 0), 0);
  const dirty = Object.keys(edits).length;
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

        {undated.length > 0 && (
          <div className="db-undated">
            <span className="db-undated-h">{undated.length} with no time on them</span>
            {undated.map((b) => (
              <button key={b.id} className="db-un" onClick={() => onOpen(b.id)}>{b.title}</button>
            ))}
            <p className="cn-note">
              These carry no start, so they cannot be placed on a day. Give them a Start
              in Notion and re-sync, or open one to release it as it is.
            </p>
          </div>
        )}
      </div>

      <div className="db-day-wrap">
        <div className="db-head">
          <h4>
            {openDay
              ? keyToDate(openDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
              : 'No day chosen'}
          </h4>
          {openDay && <span className="db-total">{day.length} block{day.length === 1 ? '' : 's'} · {dur(dayTotal)}</span>}
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

            {day.map((b) => {
              const off = offsetOf(b.started_at!);
              const mins = b.minutes ?? 60;
              const l = lanes[b.id] ?? { lane: 0, of: 1 };
              const w = 100 / l.of;
              return (
                <div
                  key={b.id}
                  className={
                    'db-block' + (b.released ? ' live' : '') +
                    (edits[b.id] ? ' moved' : '') +
                    (selectedId === b.id ? ' sel' : '')
                  }
                  style={{
                    top: (off / 60) * HOUR,
                    height: Math.max(22, (mins / 60) * HOUR),
                    left: `calc(58px + ${l.lane * w}% - ${l.lane * w * 0.58}px)`,
                    width: `calc(${w}% - ${w * 0.58}px - 6px)`,
                  }}
                  onPointerDown={(e) => grab(e, b, 'move')}
                  onDoubleClick={() => onOpen(b.id)}
                  title="Drag to move, drag the bottom edge to change how long it reads as taking, double click to open"
                >
                  <span className="db-when">{clock(b.started_at!)} · {dur(mins)}</span>
                  <span className="db-title">{b.title}</span>
                  {b.area && <span className="db-area">{b.area}</span>}
                  <span className="db-state">{b.released ? 'Released' : 'Staged'}</span>
                  <span className="db-handle" onPointerDown={(e) => grab(e, b, 'size')} aria-hidden="true" />
                </div>
              );
            })}
          </div>
        )}

        {openDay && day.length > 0 && (
          <p className="cn-note db-hint">
            Drag a block to move it, drag its bottom edge to change how long it reads as
            taking. This is the effort a client sees, not a record of when you sat down,
            so arrange the day the way it should be read. Nothing saves until you press
            Save, and anything already released moves in their Window too.
          </p>
        )}
      </div>
    </div>
  );
}
