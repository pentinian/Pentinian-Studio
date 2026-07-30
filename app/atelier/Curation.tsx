'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import DayBoard, { type Block } from './DayBoard';

// The gate. Left: everything the Quarry holds. Right: exactly what the client
// would read if you released it, rendered with the same markup the Window uses,
// so the preview cannot drift from the real thing.
//
// Nothing here reads work_log_raw directly. It cannot: that table is revoked from
// browser JWTs. Everything comes through /api/quarry, which checks staff first.

type Raw = {
  id: string; notion_id: string | null; project_id: string | null;
  body: string | null; eli5: string | null; why: string | null; area: string | null;
  started_at: string | null; ended_at: string | null; minutes: number | null;
  shots: string[] | null; links: string[] | null; gap_label: string | null;
  stage: string | null; client_visible: boolean | null;
};
type Released = { id: string; raw_id: string | null; visible: boolean; title: string };
type Project = { id: string; name: string; client_facing: boolean };

const clock = (s: string | null) =>
  s ? new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
const day = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'No date';
const dur = (m: number | null) =>
  m == null ? '' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${m}m`;

export default function Curation({
  projectId,
  projectName,
  refreshKey = 0,
}: {
  projectId: string | null;
  projectName: string | null;
  /** Bumped by the parent after a sync. Pressing Sync Notion used to refresh the
   *  project counts and leave this queue showing whatever it loaded on mount, so the
   *  message said eight entries were pulled while the list underneath did not move. */
  refreshKey?: number;
}) {
  const [raw, setRaw] = useState<Raw[]>([]);
  const [released, setReleased] = useState<Released[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sel, setSel] = useState<Raw | null>(null);
  const [draft, setDraft] = useState({ title: '', eli5: '', why: '', area: '', gap_label: '' });
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState(true);
  const [busy, setBusy] = useState(false);
  // The rail scopes the queue. Unplaced entries are the exception: they belong to no
  // project by definition, so they would otherwise be invisible from every rail
  // position, which is the one state most worth noticing.
  const [scope, setScope] = useState<'project' | 'all'>('project');
  // A flat list is fine at seventeen entries and unusable at three hundred, and the
  // thing it hides is the arrangement of a day, which is the thing actually being
  // composed. The list stays for searching and for anything with no time on it.
  const [view, setView] = useState<'days' | 'list'>('days');
  const [when, setWhen] = useState({ date: '', time: '', minutes: 60 });

  const load = useCallback(async () => {
    const res = await fetch('/api/quarry', { cache: 'no-store' });
    if (!res.ok) { setMsg('Could not load the Quarry.'); return; }
    const d = await res.json();
    setRaw(d.raw); setReleased(d.released); setProjects(d.projects);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Moving along the rail should not leave a stale entry sitting in the gate, or you
  // could edit one project's work while reading another project's name in the header.
  useEffect(() => { setSel(null); setMsg(''); }, [projectId]);

  const unplaced = raw.filter((e) => !e.project_id);
  const shown =
    scope === 'all' || !projectId
      ? raw
      : raw.filter((e) => e.project_id === projectId || !e.project_id);

  // What the day board draws. Released and staged together, because you are arranging
  // one day and a client reads one day: hiding the released half would mean composing
  // around furniture you cannot see.
  const blocks: Block[] = useMemo(
    () => shown.map((e) => {
      const out = released.find((r) => r.raw_id === e.id);
      return {
        id: e.id,
        title: (e.body ?? '(no text)').split('\n')[0],
        area: e.area ?? null,
        started_at: e.started_at ?? null,
        minutes: e.minutes ?? null,
        released: Boolean(out?.visible),
      };
    }),
    [shown, released]
  );

  function pickById(id: string) {
    const e = raw.find((r) => r.id === id);
    if (e) pick(e);
  }

  function pick(e: Raw) {
    setSel(e);
    setMsg('');
    setDraft({
      // The title falls back to the raw body only as a starting point. It is meant
      // to be rewritten, which is why the field is editable and pre-filled.
      title: (e.body ?? '').split('\n')[0].slice(0, 80),
      eli5: e.eli5 ?? '',
      why: e.why ?? '',
      area: e.area ?? '',
      gap_label: e.gap_label ?? '',
    });
    // Prefilled from whatever the entry already carries, so the fields describe the
    // block rather than sitting empty next to one that plainly has a time.
    const d = e.started_at ? new Date(e.started_at) : null;
    const p2 = (n: number) => String(n).padStart(2, '0');
    setWhen({
      date: d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '',
      time: d ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : '',
      minutes: e.minutes ?? 60,
    });
  }

  async function saveWhen() {
    if (!sel || !when.date || !when.time) return;
    const [y, m, dd] = when.date.split('-').map(Number);
    const [hh, mm] = when.time.split(':').map(Number);
    const started = new Date(y, m - 1, dd, hh, mm);
    setBusy(true); setMsg('');
    const res = await fetch('/api/quarry', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moves: [{ id: sel.id, started_at: started.toISOString(), minutes: when.minutes }] }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false); setOk(res.ok);
    setMsg(res.ok ? 'Placed. The calendar and their Window both moved.' : `Could not place it: ${j.error}`);
    if (res.ok) load();
  }

  const projectOf = (id: string | null) => projects.find((p) => p.id === id);
  const isReleased = (id: string) => released.find((r) => r.raw_id === id);

  async function release(visible = true) {
    if (!sel) return;
    setBusy(true); setMsg('');
    const res = await fetch('/api/quarry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_id: sel.id, ...draft, visible }),
    });
    const d = await res.json();
    setBusy(false);
    // A failure has to look like one. This used to render in the same quiet sage as
    // "Released", so a release that errored read as a release that worked, and the
    // only clue was a line of small text under the buttons.
    setOk(res.ok);
    setMsg(res.ok ? (visible ? 'Released. It is in their Window now.' : 'Saved, held back.') : `Could not release: ${d.error}`);
    if (res.ok) load();
  }

  async function withdraw(id: string) {
    setBusy(true);
    await fetch('/api/quarry', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, withdraw: true }),
    });
    setBusy(false); setOk(true); setMsg('Pulled back. The client can no longer see it.'); load();
  }

  const proj = projectOf(sel?.project_id ?? null);
  const blocked = sel && (!sel.project_id || !proj?.client_facing);

  return (
    <div className="cur-wrap">
      {/* ---------------- the queue ---------------- */}
      <div className="cur-queue">
        <div className="cur-head">
          <span className="ln">Quarry</span>
          <button
            className="cur-scope"
            onClick={() => setScope(scope === 'project' ? 'all' : 'project')}
            title="Switch between this project and everything in the Quarry"
          >
            {scope === 'all' || !projectId ? 'everything' : projectName ?? 'this project'}
          </button>
          <span className="cur-count">{shown.length}</span>
          <button
            className="cur-view"
            onClick={() => setView(view === 'days' ? 'list' : 'days')}
            title="A month of days, or the flat queue"
          >
            {view === 'days' ? 'list' : 'days'}
          </button>
        </div>

        {view === 'days' && raw.length > 0 && (
          <DayBoard
            blocks={blocks}
            onOpen={pickById}
            onSaved={load}
            selectedId={sel?.id ?? null}
            projectId={projectId}
            projectFacing={projectOf(projectId)?.client_facing ?? false}
          />
        )}

        {raw.length === 0 && <p className="cur-empty">Nothing here. Press Sync Notion.</p>}
        {view === 'list' && raw.length > 0 && shown.length === 0 && (
          <p className="cur-empty">
            Nothing logged against {projectName ?? 'this project'} yet.
          </p>
        )}
        {view === 'list' && scope === 'project' && unplaced.length > 0 && (
          <p className="cur-note">
            {unplaced.length} entr{unplaced.length === 1 ? 'y has' : 'ies have'} no project,
            so {unplaced.length === 1 ? 'it shows' : 'they show'} everywhere until linked in Notion.
          </p>
        )}

        {view === 'list' && shown.map((e) => {
          const out = isReleased(e.id);
          const p = projectOf(e.project_id);
          return (
            <button
              key={e.id}
              className={'cur-row' + (sel?.id === e.id ? ' on' : '')}
              onClick={() => pick(e)}
            >
              {/* Staff side keeps the clock. You need to find your own work by when you
                  did it; the client only ever needs to know what it cost. */}
              <span className="cur-when">
                {day(e.started_at)} {clock(e.started_at) && <b>{clock(e.started_at)}</b>} {dur(e.minutes)}
              </span>
              <span className="cur-title">{(e.body ?? '(no text)').split('\n')[0]}</span>
              <span className="cur-tags">
                {/* The project name is only worth repeating when the queue is showing
                    more than one. Scoped to a single project it was six identical
                    chips down the column, which is noise pretending to be data. */}
                {(scope === 'all' || !projectId || e.project_id !== projectId) && (
                  <i className={'cur-proj' + (p?.client_facing ? ' facing' : '')}>
                    {p?.name ?? 'no project'}
                  </i>
                )}
                {e.area && <i className="cur-area">{e.area}</i>}
                {out && <i className={'cur-state' + (out.visible ? ' live' : '')}>
                  {out.visible ? 'released' : 'held'}
                </i>}
              </span>
            </button>
          );
        })}
      </div>

      {/* ---------------- the gate ---------------- */}
      <div className="cur-gate">
        {!sel && <p className="cur-empty">Pick an entry to see what a client would read.</p>}

        {sel && (
          <>
            <div className="cur-head">
              <span className="ln">What they will see</span>
              {proj && <span className={'cur-proj' + (proj.client_facing ? ' facing' : '')}>{proj.name}</span>}
            </div>

            {/* What the log called it, shown only once you have changed it. Until then
                it is the same sentence twice, which is clutter rather than context. */}
            {(sel.body ?? '').split('\n')[0].trim() !== draft.title.trim() && (
              <div className="cur-src">
                <span className="cur-src-l">logged as</span>{' '}
                {(sel.body ?? '').split('\n')[0] || '(untitled)'}
              </div>
            )}

            {blocked && (
              <p className="cur-warn">
                {!sel.project_id
                  ? 'No project on this entry, so it has nowhere to land. Link it in Notion.'
                  : `${proj?.name} is internal. Mark it client-facing before releasing.`}
              </p>
            )}

            {/* the preview, using the Window's own classes */}
            <div className="win-entry preview">
              {/* What the client reads: effort, not a clock window. The approximate
                  sign carries the hedge so no word has to. See Log.tsx. */}
              <div className="we-time">
                <b>{dur(sel.minutes) ? `~${dur(sel.minutes)}` : 'no time recorded'}</b>
              </div>
              {/* Area above the title, matching the Window exactly. These had drifted
                  into different orders, which is precisely the drift the shared classes
                  were supposed to make impossible. Sharing a stylesheet is not sharing
                  a layout, and only one of the two is actually a guarantee. */}
              {draft.area && <div className="we-area">{draft.area}</div>}
              <h4 className="we-title">{draft.title || 'Untitled'}</h4>
              <p className="we-eli5">{draft.eli5 || 'No plain-language summary yet. The client would see nothing here.'}</p>
              {draft.why && <p className="we-why">{draft.why}</p>}
              {!!sel.shots?.length && <div className="we-shots">{sel.shots.length} screenshot(s) attached</div>}
              {!!sel.links?.length && (
                <div className="we-shots">
                  {sel.links.length} link{sel.links.length === 1 ? '' : 's'}, shown with the standing
                  caveat that builds move and some will already be dead
                </div>
              )}
            </div>

            {/* what they will never see. The first line is the heading shown above,
                so only the body below it belongs here. */}
            <details className="cur-detail">
              <summary>The detail, staff only</summary>
              <pre>{(sel.body ?? '').split('\n').slice(1).join('\n').trim() || '(empty)'}</pre>
            </details>

            <div className="cur-fields">
              <label>Title<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
              <label>Area<input value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} /></label>
              <label>In plain words
                <textarea rows={3} value={draft.eli5} onChange={(e) => setDraft({ ...draft, eli5: e.target.value })} />
              </label>
              <label>Why it mattered
                <textarea rows={2} value={draft.why} onChange={(e) => setDraft({ ...draft, why: e.target.value })} />
              </label>
              {/* Labels the quiet stretch BEFORE this block, which the Window draws as
                  a dashed line. Empty reads as research, since a gap in a build day is
                  usually reading or waiting rather than being away. */}
              <label>The gap before this
                <input
                  placeholder="research"
                  value={draft.gap_label}
                  onChange={(e) => setDraft({ ...draft, gap_label: e.target.value })}
                />
              </label>

              {/* The same placement the board edits, reachable from the side you happen
                  to be on. Dragging is faster for arranging a day; typing is exact when
                  you know the answer. Both write through the same endpoint, so neither
                  can drift from the other. */}
              <div className="cur-time">
                <span className="cur-time-l">Where it sits</span>
                <div className="cur-time-row">
                  <input type="date" value={when.date}
                         onChange={(e) => setWhen({ ...when, date: e.target.value })} />
                  <input type="time" value={when.time}
                         onChange={(e) => setWhen({ ...when, time: e.target.value })} />
                  <input type="number" min={5} step={5} value={when.minutes} title="minutes"
                         onChange={(e) => setWhen({ ...when, minutes: Number(e.target.value) })} />
                  <button className="mini-btn" disabled={busy || !when.date || !when.time}
                          onClick={saveWhen}>
                    Place it
                  </button>
                </div>
                <span className="cn-note">
                  This is the effort a client reads, not a record of when you sat down.
                  Moving it here moves it on the calendar, and in their Window if it is
                  already out.
                </span>
              </div>
            </div>

            <div className="cur-actions">
              <button className="mini-btn pri" disabled={busy || !!blocked} onClick={() => release(true)}>
                Release
              </button>
              <button className="mini-btn" disabled={busy || !!blocked} onClick={() => release(false)}>
                Save, hold back
              </button>
              {isReleased(sel.id) && (
                <button className="mini-btn warn" disabled={busy} onClick={() => withdraw(isReleased(sel.id)!.id)}>
                  Pull back
                </button>
              )}
            </div>

            {msg && <p className={ok ? "cur-msg" : "cur-msg bad"}>{msg}</p>}
          </>
        )}
      </div>
    </div>
  );
}
