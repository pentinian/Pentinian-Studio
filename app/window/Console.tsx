'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Files from './Files';

// The project console: what I made, what we decided, what you want, what you asked for.
//
// Four faces on one table, because they are the same shape: a small thing pinned to a
// project, sometimes with a link, sometimes an image, sometimes a colour, sometimes a
// status. Three tables would have meant three sets of policies to keep in step.
//
// What a client can do here is deliberately uneven. They add inspiration and requests,
// because those are theirs. They cannot author a brand decision, because that is a
// decision rather than a contribution, and they cannot move a status, because a
// request they mark done is not done. The database enforces all of that; this file
// only declines to draw the controls.

export type Note = {
  id: string;
  kind: 'brand' | 'inspiration' | 'request';
  title: string | null;
  body: string | null;
  url: string | null;
  swatch: string | null;
  shot: string | null;
  status: string;
  from_client: boolean;
  created_at: string;
};

type Face = 'files' | 'brand' | 'inspiration' | 'requests';

const STATUS: Record<string, string> = {
  open: 'Open', doing: 'In hand', done: 'Done', declined: 'Not doing', none: '',
};

const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };
const day = (s: string) =>
  new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function Console({
  projectId,
  projectName,
  staff,
  face,
  setFace,
  fileCount,
}: {
  projectId: string;
  projectName: string;
  staff: boolean;
  face: Face;
  setFace: (f: Face) => void;
  fileCount: number | null;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState({ title: '', body: '', url: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('project_notes')
      .select('id,kind,title,body,url,swatch,shot,status,from_client,created_at')
      .eq('project_id', projectId)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: false });
    // The table may not exist yet. Say so plainly rather than rendering an empty
    // console that looks like a project with nothing in it.
    if (error) setMissing(true);
    else setNotes((data as Note[]) ?? []);
    setReady(true);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function add(kind: 'inspiration' | 'request') {
    const title = draft.title.trim();
    const body = draft.body.trim();
    const url = draft.url.trim();
    if (!title && !body && !url) return;
    setBusy(true); setMsg('');

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('project_notes').insert({
      project_id: projectId,
      kind,
      title: title || null,
      body: body || null,
      url: url || null,
      // Staff adding on a client's behalf is still staff. from_client is about who
      // wrote it, not which panel it landed in.
      from_client: !staff,
      author_id: user?.id,
      status: kind === 'request' ? 'open' : 'none',
    });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setDraft({ title: '', body: '', url: '' });
    setMsg(kind === 'request' ? 'Sent. It is on the project now.' : 'Added.');
    load();
  }

  async function setStatus(n: Note, status: string) {
    const supabase = createClient();
    await supabase.from('project_notes').update({ status }).eq('id', n.id);
    load();
  }

  const of = (k: Note['kind']) => notes.filter((n) => n.kind === k);
  const openRequests = of('request').filter((n) => n.status === 'open').length;

  const tab = (k: Face, label: string, n?: number | null) => (
    <button className={'cn-tab' + (face === k ? ' on' : '')} onClick={() => setFace(k)}>
      {label}
      {n != null && n > 0 && <i>{n}</i>}
    </button>
  );

  return (
    <div className="cn">
      <div className="cn-tabs">
        {tab('files', 'Files', fileCount)}
        {tab('brand', 'Brand', of('brand').length)}
        {tab('inspiration', 'Inspiration', of('inspiration').length)}
        {tab('requests', 'Requests', openRequests)}
      </div>

      {missing && (
        <p className="cur-warn">
          The console table is not there yet. Run supabase/notes.sql, then reload.
        </p>
      )}

      {face === 'files' && <Files projectId={projectId} projectName={projectName} />}

      {/* ---------------- brand ---------------- */}
      {face === 'brand' && !missing && (
        <div className="cn-body">
          {ready && !of('brand').length && (
            <p className="cur-empty">
              No decisions recorded yet. They appear here as we settle them, so neither of
              us has to remember what we agreed.
            </p>
          )}
          <div className="cn-brand">
            {of('brand').map((n) => (
              <div className="cn-rule" key={n.id}>
                {n.swatch && <span className="cn-sw" style={{ background: n.swatch }} />}
                <div>
                  <b>{n.title}</b>
                  {n.body && <p>{n.body}</p>}
                </div>
              </div>
            ))}
          </div>
          {staff && <Composer kind="brand" draft={draft} setDraft={setDraft} onAdd={() => addBrand()} busy={busy} />}
          {msg && <p className="cur-msg">{msg}</p>}
        </div>
      )}

      {/* ---------------- inspiration ---------------- */}
      {face === 'inspiration' && !missing && (
        <div className="cn-body">
          {ready && !of('inspiration').length && (
            <p className="cur-empty">
              Nothing pinned yet. Anything you want this to feel like belongs here: a link,
              a phrase, a thing you saw. It is the reference we both come back to.
            </p>
          )}
          <div className="cn-insp">
            {of('inspiration').map((n) => (
              <div className="cn-card" key={n.id}>
                {n.title && <b>{n.title}</b>}
                {n.body && <p>{n.body}</p>}
                {n.url && (
                  <a href={n.url} target="_blank" rel="noopener noreferrer">
                    {host(n.url)} <i>&#8599;</i>
                  </a>
                )}
                <span className="cn-who">{n.from_client ? 'Yours' : 'Pentinian'} · {day(n.created_at)}</span>
              </div>
            ))}
          </div>
          <Composer kind="inspiration" draft={draft} setDraft={setDraft} onAdd={() => add('inspiration')} busy={busy} />
          {msg && <p className="cur-msg">{msg}</p>}
        </div>
      )}

      {/* ---------------- requests ---------------- */}
      {face === 'requests' && !missing && (
        <div className="cn-body">
          {ready && !of('request').length && (
            <p className="cur-empty">Nothing asked for yet. Anything you want changed or added, put it here.</p>
          )}
          {of('request').map((n) => (
            <div className={'cn-req s-' + n.status} key={n.id}>
              <span className="cn-st">{STATUS[n.status] || n.status}</span>
              <div className="cn-req-b">
                {n.title && <b>{n.title}</b>}
                {n.body && <p>{n.body}</p>}
                <span className="cn-who">{n.from_client ? 'You' : 'Pentinian'} · {day(n.created_at)}</span>
              </div>
              {staff && (
                <select
                  className="cn-pick"
                  value={n.status}
                  onChange={(e) => setStatus(n, e.target.value)}
                  aria-label="status"
                >
                  {['open', 'doing', 'done', 'declined'].map((s) => (
                    <option key={s} value={s}>{STATUS[s]}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
          <Composer kind="request" draft={draft} setDraft={setDraft} onAdd={() => add('request')} busy={busy} />
          {msg && <p className="cur-msg">{msg}</p>}
        </div>
      )}
    </div>
  );

  // Brand rows carry a swatch, so they get their own writer. Staff only, enforced in
  // the database as well as here.
  async function addBrand() {
    const title = draft.title.trim();
    if (!title) return;
    setBusy(true); setMsg('');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const swatch = /^#[0-9a-f]{3,8}$/i.test(draft.url.trim()) ? draft.url.trim() : null;
    const { error } = await supabase.from('project_notes').insert({
      project_id: projectId, kind: 'brand',
      title, body: draft.body.trim() || null,
      swatch, url: swatch ? null : draft.url.trim() || null,
      from_client: false, author_id: user?.id, status: 'none',
    });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setDraft({ title: '', body: '', url: '' });
    load();
  }
}

function Composer({
  kind, draft, setDraft, onAdd, busy,
}: {
  kind: 'brand' | 'inspiration' | 'request';
  draft: { title: string; body: string; url: string };
  setDraft: (d: { title: string; body: string; url: string }) => void;
  onAdd: () => void;
  busy: boolean;
}) {
  const placeholder =
    kind === 'brand' ? { t: 'The decision', b: 'Why, or what it rules out', u: 'A hex colour, or a link' }
    : kind === 'inspiration' ? { t: 'What is it', b: 'What you like about it', u: 'Link, if there is one' }
    : { t: 'What would you like', b: 'Any detail that helps', u: 'Link, if it helps' };

  return (
    <div className="cn-add">
      <input
        placeholder={placeholder.t}
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />
      <textarea
        rows={2}
        placeholder={placeholder.b}
        value={draft.body}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
      />
      <div className="cn-add-row">
        <input
          placeholder={placeholder.u}
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
        />
        <button className="mini-btn pri" onClick={onAdd} disabled={busy}>
          {kind === 'request' ? 'Send' : 'Add'}
        </button>
      </div>
    </div>
  );
}
