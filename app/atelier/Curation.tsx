'use client';

import { useCallback, useEffect, useState } from 'react';

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
  shots: string[] | null; stage: string | null; client_visible: boolean | null;
};
type Released = { id: string; raw_id: string | null; visible: boolean; title: string };
type Project = { id: string; name: string; client_facing: boolean };

const clock = (s: string | null) =>
  s ? new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
const day = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'No date';
const dur = (m: number | null) =>
  m == null ? '' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${m}m`;

export default function Curation() {
  const [raw, setRaw] = useState<Raw[]>([]);
  const [released, setReleased] = useState<Released[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sel, setSel] = useState<Raw | null>(null);
  const [draft, setDraft] = useState({ title: '', eli5: '', why: '', area: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/quarry', { cache: 'no-store' });
    if (!res.ok) { setMsg('Could not load the Quarry.'); return; }
    const d = await res.json();
    setRaw(d.raw); setReleased(d.released); setProjects(d.projects);
  }, []);

  useEffect(() => { load(); }, [load]);

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
    });
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
    setMsg(res.ok ? (visible ? 'Released. It is in their Window now.' : 'Saved, held back.') : d.error);
    if (res.ok) load();
  }

  async function withdraw(id: string) {
    setBusy(true);
    await fetch('/api/quarry', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, withdraw: true }),
    });
    setBusy(false); setMsg('Pulled back. The client can no longer see it.'); load();
  }

  const proj = projectOf(sel?.project_id ?? null);
  const blocked = sel && (!sel.project_id || !proj?.client_facing);

  return (
    <div className="cur-wrap">
      {/* ---------------- the queue ---------------- */}
      <div className="cur-queue">
        <div className="cur-head">
          <span className="ln">Quarry</span>
          <span className="cur-count">{raw.length}</span>
        </div>

        {raw.length === 0 && <p className="cur-empty">Nothing here. Press Sync Notion.</p>}

        {raw.map((e) => {
          const out = isReleased(e.id);
          const p = projectOf(e.project_id);
          return (
            <button
              key={e.id}
              className={'cur-row' + (sel?.id === e.id ? ' on' : '')}
              onClick={() => pick(e)}
            >
              <span className="cur-when">
                {day(e.started_at)} {clock(e.started_at) && <b>{clock(e.started_at)}</b>} {dur(e.minutes)}
              </span>
              <span className="cur-title">{(e.body ?? '(no text)').split('\n')[0]}</span>
              <span className="cur-tags">
                <i className={'cur-proj' + (p?.client_facing ? ' facing' : '')}>
                  {p?.name ?? 'no project'}
                </i>
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

            {blocked && (
              <p className="cur-warn">
                {!sel.project_id
                  ? 'No project on this entry, so it has nowhere to land. Link it in Notion.'
                  : `${proj?.name} is internal. Mark it client-facing before releasing.`}
              </p>
            )}

            {/* the preview, using the Window's own classes */}
            <div className="win-entry preview">
              <div className="we-time">
                <b>{clock(sel.started_at) || 'time not recorded'}</b>
                {clock(sel.ended_at) && <span> to {clock(sel.ended_at)}</span>}
                <i>{dur(sel.minutes)}</i>
              </div>
              <h4 className="we-title">{draft.title || 'Untitled'}</h4>
              {draft.area && <div className="we-area">{draft.area}</div>}
              <p className="we-eli5">{draft.eli5 || 'No plain-language summary yet. The client would see nothing here.'}</p>
              {draft.why && <p className="we-why">{draft.why}</p>}
              {!!sel.shots?.length && <div className="we-shots">{sel.shots.length} screenshot(s) attached</div>}
            </div>

            {/* what they will never see */}
            <details className="cur-detail">
              <summary>The detail, staff only</summary>
              <pre>{sel.body || '(empty)'}</pre>
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

            {msg && <p className="cur-msg">{msg}</p>}
          </>
        )}
      </div>
    </div>
  );
}
