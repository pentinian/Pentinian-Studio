'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Attach, { isImage, pretty } from '../Attach';
import DayBoard, { type Block, type Edit } from './DayBoard';

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
  /* The selection is an id, and the row is looked up from what was last loaded.
     Held as a snapshot it went stale the moment anything was saved, so the panel
     kept describing the row as it had been rather than as it now is. */
  const [selId, setSelId] = useState<string | null>(null);
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

  /* A block's time is one value. The calendar edits it by dragging and this panel
     edits it by typing, so both have to read and write the same pending state or
     they will show two different answers for the same block. */
  const [edits, setEdits] = useState<Record<string, Edit>>({});

  /* Signed URLs for whatever the selected entry carries, keyed by storage path.
     Screenshots live in a private bucket, so a path is not an image: it has to be
     signed before anything can be shown. Held per path rather than per entry so
     moving between entries that share one does not sign it twice. */
  const [shotUrls, setShotUrls] = useState<Record<string, string>>({});
  const [shotBusy, setShotBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/quarry', { cache: 'no-store' });
    if (!res.ok) { setMsg('Could not load Build.'); return; }
    const d = await res.json();
    setRaw(d.raw); setReleased(d.released); setProjects(d.projects);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const sel = useMemo(() => raw.find((r) => r.id === selId) ?? null, [raw, selId]);

  /* One value, two ways in. The board writes it by dragging and the fields below
     write it by typing, and both read it from the same pending state. Deriving
     the fields instead of mirroring them into their own copy is what stops the
     two drifting: there is nothing left to keep in sync. */
  const p2 = (n: number) => String(n).padStart(2, '0');
  const place = useMemo(() => {
    if (!sel) return { date: '', time: '', minutes: 60 };
    const e = edits[sel.id];
    const iso = e ? e.started_at : sel.started_at;
    const mins = e ? e.minutes : (sel.minutes ?? 60);
    const d = iso ? new Date(iso) : null;
    return {
      date: d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '',
      time: d ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : '',
      minutes: mins,
    };
  }, [sel, edits]);

  function setPlace(next: { date?: string; time?: string; minutes?: number }) {
    if (!sel) return;
    const date = next.date ?? place.date;
    const time = next.time ?? place.time;
    const minutes = next.minutes ?? place.minutes;
    let started: string | null = null;
    if (date && time) {
      const [y, m, dd] = date.split('-').map(Number);
      const [hh, mm] = time.split(':').map(Number);
      started = new Date(y, m - 1, dd, hh, mm).toISOString();
    }
    setEdits((e) => ({ ...e, [sel.id]: { started_at: started, minutes } }));
  }

  // Moving along the rail should not leave a stale entry sitting in the gate, or you
  // could edit one project's work while reading another project's name in the header.
  useEffect(() => { setSelId(null); setMsg(''); }, [projectId]);

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
    setSelId(e.id);
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
  }

  async function saveWhen() {
    if (!sel || !place.date || !place.time) return;
    const [y, m, dd] = place.date.split('-').map(Number);
    const [hh, mm] = place.time.split(':').map(Number);
    const started = new Date(y, m - 1, dd, hh, mm);
    setBusy(true); setMsg('');
    const res = await fetch('/api/quarry', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moves: [{ id: sel.id, started_at: started.toISOString(), minutes: place.minutes }] }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false); setOk(res.ok);
    setMsg(res.ok ? 'Placed. The calendar and their Window both moved.' : `Could not place it: ${j.error}`);
    if (res.ok) {
      // Stored now, so any pending calendar edit for this block is spent. Left in
      // place it would keep overriding the value that was just written and the
      // calendar would go on showing the old time.
      setEdits((e) => { const n = { ...e }; delete n[sel.id]; return n; });
      load();
    }
  }

  const projectOf = (id: string | null) => projects.find((p) => p.id === id);
  const isReleased = (id: string) => released.find((r) => r.raw_id === id);

  /* ------------------------------------------------------------- screenshots
   *
   * Three facts this is built on, each measured on 2026-09-15 rather than read
   * off a comment, because two of the three were surprises:
   *
   *   1. An admin browser JWT CAN write into the shots bucket. So the file goes
   *      straight from this machine to storage and no byte passes through a
   *      serverless route.
   *   2. That same JWT is REFUSED work_log_raw outright (Postgres 42501,
   *      "permission denied for table"). It is revoked from `authenticated` on
   *      purpose. So the PATH cannot be recorded from here and goes through
   *      /api/quarry, the same door everything else in this panel uses.
   *   3. An object at the project ROOT is refused to the client until a released
   *      entry names it. That is supabase/shots-gate.sql, and it is why these
   *      upload to the root rather than to files/: a work screenshot is not a
   *      deliberate attachment, and it should become visible when the work is
   *      released and not one moment sooner.
   *
   * So the honest summary of the control below: it puts the image somewhere the
   * client cannot read yet, and releasing the entry is what lets them read it.
   */
  const signShots = useCallback(async (paths: string[]) => {
    const missing = paths.filter((p) => !shotUrls[p]);
    if (!missing.length) return;
    const supabase = createClient();
    const { data } = await supabase.storage.from('shots').createSignedUrls(missing, 60 * 30);
    const next: Record<string, string> = {};
    for (const s of data ?? []) if (s.signedUrl && s.path) next[s.path] = s.signedUrl;
    if (Object.keys(next).length) setShotUrls((u) => ({ ...u, ...next }));
  }, [shotUrls]);

  // Sign whatever the open entry carries, as it opens. Not on load for the whole
  // queue: two hundred entries would mean signing every screenshot in the studio
  // to show one panel.
  useEffect(() => { if (sel?.shots?.length) signShots(sel.shots); }, [sel, signShots]);

  /** Record the whole array. The route replaces rather than appends, so add and
   *  remove are one operation with two callers and there is no second write path
   *  that could forget a check. */
  async function setShots(next: string[]) {
    if (!sel) return;
    setShotBusy(true); setMsg('');
    const res = await fetch('/api/quarry', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sel.id, shots: next }),
    });
    const j = await res.json().catch(() => ({}));
    setShotBusy(false); setOk(res.ok);
    if (!res.ok) { setMsg(`Could not attach that: ${j.error ?? 'no reason given'}`); return; }
    // Said out loud, because the gate is not obvious and somebody will reasonably
    // assume an uploaded screenshot is visible the moment it uploads.
    setMsg(
      isReleased(sel.id)
        ? `${next.length} screenshot${next.length === 1 ? '' : 's'} on this entry. It is already released, so they can see them now.`
        : `${next.length} screenshot${next.length === 1 ? '' : 's'} on this entry. The client cannot see them until it is released.`
    );
    load();
  }

  async function removeShot(path: string) {
    if (!sel) return;
    const next = (sel.shots ?? []).filter((p) => p !== path);
    await setShots(next);
    /* The object is deleted too, and only after the row no longer points at it.
     * The other order leaves a released entry naming a file that is not there,
     * which renders as a broken frame in somebody's Window. A failure here is
     * not reported: the row is what governs what a client sees, and an orphaned
     * object in a private bucket is tidiness rather than a defect. */
    const supabase = createClient();
    await supabase.storage.from('shots').remove([path]);
    setShotUrls((u) => { const n = { ...u }; delete n[path]; return n; });
  }

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
  /* An entry with no time cannot be released.
   *
   * The Window is organised by day: the log loads a month of entries by started_at and
   * skips any that have none. So a release without a time landed in the table, reported
   * "it is in their Window now", and was never once visible there. Half visible in fact,
   * because the overview lists it, which is worse than either.
   *
   * The fix belongs here rather than in the Window. A piece of work that never happened
   * at a time is not ready to be read as a day's work, and the panel to give it one is
   * already open beside this. A pending calendar edit counts: it is about to be saved. */
  const placed = Boolean(sel && (sel.started_at || edits[sel.id]?.started_at));
  const blocked = sel && (!sel.project_id || !proj?.client_facing || !placed);

  return (
    <div className="cur-wrap">
      {/* ---------------- the queue ---------------- */}
      <div className="cur-queue">
        <div className="cur-head">
          <span className="ln">Build</span>
          <button
            className="cur-scope"
            onClick={() => setScope(scope === 'project' ? 'all' : 'project')}
            title="Switch between this project and everything in Build"
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
            edits={edits}
            setEdits={setEdits}
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
                  : !proj?.client_facing
                    ? `${proj?.name} is internal. Mark it client-facing before releasing.`
                    : 'No time on this one yet. Their Window is a calendar, so an entry with no day to sit on would never appear in it. Place it under Where it sits first.'}
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
              {/* The screenshots, as pictures rather than as a number.
                  This read "N screenshot(s) attached" until 2026-09-15, which is a
                  count of something the preview is supposed to be showing. The
                  panel's whole job is that what you see here is what they read,
                  and a sentence about images is not the images. */}
              {!!sel.shots?.length && (
                <div className="we-gal">
                  {sel.shots.map((p) =>
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

              {/* ------------------------------------------------ screenshots --
                  The gap the README called the last genuine stub. Curation showed
                  the count and could not add one, so every screenshot on a client's
                  Window had to come from push-shots.mjs at a terminal, with the path
                  pasted into Notion by hand.

                  Uploads to the project ROOT, not to files/, and that is the whole
                  security posture in one argument: shots-gate.sql refuses a root
                  object to the client until a released entry names it, so a
                  screenshot attached here is invisible to them until the work is
                  passed. files/ would be visible immediately, which is right for
                  something a client deliberately attached and wrong for this. */}
              <div className="cur-shots">
                <span className="cur-time-l">Screenshots</span>

                {!!sel.shots?.length && (
                  <div className="cn-grid cur-shot-grid">
                    {sel.shots.map((p) => (
                      <div className="cn-thumb" key={p}>
                        {shotUrls[p] && isImage(p) ? (
                          <a href={shotUrls[p]} target="_blank" rel="noopener noreferrer" title={p}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={shotUrls[p]} alt="" loading="lazy" />
                          </a>
                        ) : (
                          <span className="cn-doc" />
                        )}
                        <span className="cn-cap" title={p.split('/').pop()}>
                          {pretty(p.split('/').pop() ?? p)}
                          <button
                            className="cn-x"
                            title="Take this off the entry and delete the file"
                            disabled={shotBusy}
                            onClick={() => removeShot(p)}
                          >
                            ×
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="cn-add-row">
                  {/* No project, no upload control. Rendering it would offer a
                      write that builds the path `/<name>`, whose first segment is
                      empty and matches no project, so storage refuses it and the
                      person gets a raw policy error for a thing that was never
                      going to work. The sentence says why instead. */}
                  {sel.project_id && (
                    <Attach
                      projectId={sel.project_id}
                      label={sel.shots?.length ? 'Add another' : 'Add a screenshot'}
                      accept="image/*"
                      folder={null}
                      onDone={(path) => setShots([...(sel.shots ?? []), path])}
                    />
                  )}
                  <span className="cn-note">
                    {!sel.project_id
                      ? 'This entry has no project, so there is nowhere to put a screenshot.'
                      : isReleased(sel.id)
                        ? 'This entry is already released, so anything added here reaches them straight away.'
                        : 'Held with the entry. The client cannot see it until you release this.'}
                  </span>
                </div>
              </div>

              {/* The same placement the board edits, reachable from the side you happen
                  to be on. Dragging is faster for arranging a day; typing is exact when
                  you know the answer. Both write through the same endpoint, so neither
                  can drift from the other. */}
              <div className="cur-time">
                <span className="cur-time-l">Where it sits</span>
                <div className="cur-time-row">
                  <input type="date" value={place.date}
                         onChange={(e) => setPlace({ date: e.target.value })} />
                  <input type="time" value={place.time}
                         onChange={(e) => setPlace({ time: e.target.value })} />
                  <input type="number" min={5} step={5} value={place.minutes} title="minutes"
                         onChange={(e) => setPlace({ minutes: Number(e.target.value) })} />
                  <button className="mini-btn" disabled={busy || !place.date || !place.time}
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
