'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Attach from './Attach';
import Files from './Files';

// The project console: what we settled, what you want it to feel like, what you asked
// for, and everything the project holds.
//
// One table under all of it, because the rows are the same shape. They are not the
// same THING, and the first version drew them identically, which made a brand board
// read like a list of notes. Each face knows what it holds now.
//
// Who may write what is uneven on purpose and enforced in the database. Brand is
// authored in the Atelier and released deliberately, because a brand decision is a
// decision. Inspiration and requests are the client's to add, and their own additions
// appear to them at once: gating someone's own pinned image behind approval would be
// absurd, and they already know what they wrote.

export type Face = 'files' | 'brand' | 'inspiration' | 'requests';
type Facet = 'color' | 'type' | 'rule' | 'asset';

export type Note = {
  id: string;
  kind: 'brand' | 'inspiration' | 'request';
  facet: Facet | null;
  title: string | null;
  body: string | null;
  url: string | null;
  swatch: string | null;
  shot: string | null;
  status: string;
  from_client: boolean;
  created_at: string;
};

const STATUS: Record<string, string> = {
  open: 'Open', doing: 'In hand', done: 'Done', declined: 'Not doing', none: '',
};
const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
const day = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Whether a swatch needs light text on it. Perceived luminance, not the average of the
// channels: green reads far brighter than blue at the same number, and a plain average
// puts dark text on a navy chip.
const lightOn = (h: string) => {
  const v = h.replace('#', '');
  if (v.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.55;
};

export default function Console({
  projectId, projectName, staff, face, setFace,
}: {
  projectId: string;
  projectName: string;
  staff: boolean;
  face: Face | null;
  setFace: (f: Face) => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [shotUrls, setShotUrls] = useState<Record<string, string>>({});
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [missing, setMissing] = useState(false);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const supabase = createClient();
    const cols = 'id,kind,title,body,url,swatch,shot,status,from_client,created_at';
    // Tolerant of a pending migration: one unknown column makes PostgREST refuse the
    // entire query, so a half-applied schema would blank the console rather than
    // degrade it.
    const ask = (select: string) => supabase.from('project_notes')
      .select(select).eq('project_id', projectId)
      .order('sort', { ascending: true }).order('created_at', { ascending: false });
    let { data, error } = (await ask(`${cols},facet`)) as { data: any; error: any };
    if (error) ({ data, error } = (await ask(cols)) as { data: any; error: any });

    if (error) setMissing(true);
    else {
      const rows = (data as Note[]) ?? [];
      setNotes(rows);
      const paths = rows.map((n) => n.shot).filter(Boolean) as string[];
      if (paths.length) {
        const { data: signed } = await supabase.storage.from('shots').createSignedUrls(paths, 60 * 30);
        const next: Record<string, string> = {};
        for (const s of signed ?? []) if (s.signedUrl && s.path) next[s.path] = s.signedUrl;
        setShotUrls((p) => ({ ...p, ...next }));
      }
    }

    const { data: objects } = await supabase.storage.from('shots').list(projectId, { limit: 500 });
    setFileCount((objects ?? []).filter((o: any) => o.name && !o.name.startsWith('.')).length);
    setReady(true);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const of = (k: Note['kind']) => notes.filter((n) => n.kind === k);
  const openRequests = of('request').filter((n) => n.status === 'open').length;

  async function add(row: Partial<Note> & { kind: Note['kind'] }) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const payload: any = {
      project_id: projectId,
      from_client: true,
      author_id: user?.id,
      status: row.kind === 'request' ? 'open' : 'none',
      ...row,
    };
    let { error } = await supabase.from('project_notes').insert(payload);
    if (error && /facet/.test(error.message)) {
      const { facet, ...lean } = payload;
      ({ error } = await supabase.from('project_notes').insert(lean));
    }
    if (error) { setMsg(error.message); return false; }
    setMsg(''); load(); return true;
  }

  async function remove(n: Note) {
    const supabase = createClient();
    const { error } = await supabase.from('project_notes').delete().eq('id', n.id);
    if (error) return setMsg(error.message);
    load();
  }

  const tab = (k: Face, label: string, n: number | null) => (
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

      {face && missing && (
        <p className="cur-warn">The console table is not there yet. Run supabase/notes.sql, then reload.</p>
      )}

      {face === 'files' && <Files projectId={projectId} projectName={projectName} />}

      {face === 'brand' && !missing && (
        <Brand notes={of('brand')} ready={ready} staff={staff} shotUrls={shotUrls} />
      )}

      {face === 'inspiration' && !missing && (
        <Inspiration
          notes={of('inspiration')} ready={ready} projectId={projectId}
          shotUrls={shotUrls} add={add} remove={remove}
        />
      )}

      {face === 'requests' && !missing && (
        <Requests
          notes={of('request')} ready={ready} projectId={projectId}
          shotUrls={shotUrls} add={add}
        />
      )}

      {face && msg && <p className="cur-msg bad">{msg}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ brand ----- */
// Read only here. Brand is authored in the Atelier and passed deliberately, so this
// side is a board to look at rather than a form to fill in.
//
// Colours sit on one row as pure swatches. The name and the purpose live underneath
// the cursor, because five labelled chips is a table and a table is not a palette: you
// look at a palette to see the colors next to each other, which is exactly what a
// caption on every one prevents.
function Brand({ notes, ready, staff, shotUrls }: any) {
  const [hover, setHover] = useState<string | null>(null);

  const group = (f: Facet) => notes.filter((n: Note) => (n.facet ?? 'rule') === f);
  const colors = group('color'), type = group('type'), rules = group('rule'), assets = group('asset');
  const lit = colors.find((n: Note) => n.id === hover) ?? null;

  if (ready && !notes.length) {
    return (
      <div className="cn-body">
        <p className="cur-empty">
          Nothing settled yet. Colors, type and the decisions we make appear here as we
          make them, so neither of us has to remember what we agreed.
          {staff && ' Author them in the Atelier under Console, then release.'}
        </p>
      </div>
    );
  }

  return (
    <div className="cn-body">
      {colors.length > 0 && (
        <Row label="Color">
          {/* One row, and one caption slot under it that changes rather than five
              captions competing. The slot keeps its height whether or not anything is
              hovered, so the rows below do not jump as the cursor crosses. */}
          <div className="pal" onMouseLeave={() => setHover(null)}>
            {colors.map((n: Note) => (
              <button
                key={n.id}
                className={'pal-c' + (hover === n.id ? ' on' : '')}
                style={{ background: n.swatch ?? '#ccc' }}
                onMouseEnter={() => setHover(n.id)}
                onFocus={() => setHover(n.id)}
                aria-label={`${n.title ?? 'Color'}${n.body ? `, ${n.body}` : ''}`}
              >
                <span className={'pal-hex' + (lightOn(n.swatch ?? '') ? ' lit' : '')}>
                  {(n.swatch ?? '').replace('#', '')}
                </span>
              </button>
            ))}
          </div>
          <p className="pal-cap" aria-live="polite">
            {lit ? (
              <>
                <b>{lit.title}</b>
                {lit.body && <span>{lit.body}</span>}
                <i>{lit.swatch}</i>
              </>
            ) : (
              <span className="pal-rest">
                {colors.length} color{colors.length === 1 ? '' : 's'}. Hover one to see what it is for.
              </span>
            )}
          </p>
        </Row>
      )}

      {type.length > 0 && (
        <Row label="Type">
          <div className="bx-grid">
            {type.map((n: Note) => (
              <div className="bx" key={n.id}>
                <b className="bx-spec" style={{ fontFamily: `'${n.title}', var(--serif)` }}>
                  {n.title}
                </b>
                <span className="bx-name">{n.title}</span>
                {n.body && <p>{n.body}</p>}
                {n.url && (
                  <a href={n.url} target="_blank" rel="noopener noreferrer">{host(n.url)} &#8599;</a>
                )}
              </div>
            ))}
          </div>
        </Row>
      )}

      {rules.length > 0 && (
        <Row label="Decisions">
          <div className="bx-grid wide">
            {rules.map((n: Note) => (
              <div className="bx" key={n.id}>
                <b>{n.title}</b>
                {n.body && <p>{n.body}</p>}
                {n.url && (
                  <a href={n.url} target="_blank" rel="noopener noreferrer">{host(n.url)} &#8599;</a>
                )}
              </div>
            ))}
          </div>
        </Row>
      )}

      {assets.length > 0 && (
        <Row label="Assets">
          <div className="cn-grid">
            {assets.map((n: Note) => {
              const u = n.shot ? shotUrls[n.shot] : undefined;
              const ext = (n.shot ?? '').split('.').pop()?.toUpperCase() ?? 'FILE';
              const img = /\.(png|jpe?g|webp|gif|svg)$/i.test(n.shot ?? '');
              return (
                <div className="cn-thumb" key={n.id}>
                  {u && img ? (
                    <a href={u} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" loading="lazy" />
                    </a>
                  ) : u ? (
                    <a className="cn-doc" href={u} target="_blank" rel="noopener noreferrer">{ext}</a>
                  ) : (
                    <span className="cn-doc" />
                  )}
                  <span className="cn-cap">{n.title}{n.body && <i>{n.body}</i>}</span>
                </div>
              );
            })}
          </div>
        </Row>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ inspiration ----- */
// A picture and what you thought about it. The thought is the point: a board of
// images with no words is a mood, and a mood cannot be built from.
function Inspiration({ notes, ready, projectId, shotUrls, add, remove }: any) {
  const [d, setD] = useState({ body: '', url: '', shot: '' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!d.body.trim() && !d.url.trim() && !d.shot) return;
    setBusy(true);
    const ok = await add({
      kind: 'inspiration', facet: null,
      title: null, body: d.body.trim() || null,
      url: d.url.trim() || null, shot: d.shot || null,
    });
    setBusy(false);
    if (ok) setD({ body: '', url: '', shot: '' });
  };

  return (
    <div className="cn-body">
      {ready && !notes.length && (
        <p className="cur-empty">
          Nothing pinned yet. Anything you want this to feel like belongs here: paste a
          Pinterest link or drop an image, and say what you liked about it.
        </p>
      )}

      {notes.length > 0 && (
        <div className="in-grid">
          {notes.map((n: Note) => (
            <figure className="in-card" key={n.id}>
              {n.shot && shotUrls[n.shot] ? (
                <a href={shotUrls[n.shot]} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shotUrls[n.shot]} alt="" loading="lazy" />
                </a>
              ) : n.shot ? (
                <span className="in-skel" />
              ) : null}
              <figcaption>
                {n.body && <p>{n.body}</p>}
                {n.url && (
                  <a className="in-src" href={n.url} target="_blank" rel="noopener noreferrer">
                    {host(n.url)} <i>&#8599;</i>
                  </a>
                )}
                <span className="cn-who">
                  {n.from_client ? 'Yours' : 'Pentinian'} · {day(n.created_at)}
                  {n.from_client && (
                    <button className="cn-x" onClick={() => remove(n)} title="Remove" aria-label="Remove">
                      &#215;
                    </button>
                  )}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <div className="cn-add">
        <textarea rows={2} placeholder="What you like about it" value={d.body}
                  onChange={(e) => setD({ ...d, body: e.target.value })} />
        <div className="cn-add-row">
          <input placeholder="Pinterest or any link" value={d.url}
                 onChange={(e) => setD({ ...d, url: e.target.value })} />
          <Attach projectId={projectId} label={d.shot ? 'Image ready' : 'Add an image'}
                  onDone={(p) => setD((x) => ({ ...x, shot: p }))} />
          <button className="mini-btn pri" onClick={submit} disabled={busy}>
            {busy ? 'Pinning…' : 'Pin it'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- requests ----- */
// What you want, and a shot of where you mean. Pointing at the page beats describing
// it, and it removes a whole round of "which header".
function Requests({ notes, ready, projectId, shotUrls, add }: any) {
  const [d, setD] = useState({ title: '', body: '', shot: '' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!d.title.trim() && !d.body.trim()) return;
    setBusy(true);
    const ok = await add({
      kind: 'request', facet: null,
      title: d.title.trim() || null, body: d.body.trim() || null,
      shot: d.shot || null, url: null,
    });
    setBusy(false);
    if (ok) setD({ title: '', body: '', shot: '' });
  };

  return (
    <div className="cn-body">
      {ready && !notes.length && (
        <p className="cur-empty">
          Nothing asked for yet. Anything you want changed or added, put it here, and add
          a shot of the page if it helps me see where you mean.
        </p>
      )}

      {notes.map((n: Note) => (
        <div className={'cn-req s-' + n.status} key={n.id}>
          <span className="cn-st">{STATUS[n.status] || n.status}</span>
          <div className="cn-req-b">
            {n.title && <b>{n.title}</b>}
            {n.body && <p>{n.body}</p>}
            {n.shot && shotUrls[n.shot] && (
              <a className="rq-shot" href={shotUrls[n.shot]} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shotUrls[n.shot]} alt="" loading="lazy" />
              </a>
            )}
            <span className="cn-who">{n.from_client ? 'You' : 'Pentinian'} · {day(n.created_at)}</span>
          </div>
        </div>
      ))}

      <div className="cn-add">
        <input placeholder="What would you like" value={d.title}
               onChange={(e) => setD({ ...d, title: e.target.value })} />
        <textarea rows={2} placeholder="Any detail that helps" value={d.body}
                  onChange={(e) => setD({ ...d, body: e.target.value })} />
        <div className="cn-add-row">
          <Attach projectId={projectId} label={d.shot ? 'Shot ready' : 'Show me where'}
                  onDone={(p) => setD((x) => ({ ...x, shot: p }))} />
          <button className="mini-btn pri" onClick={submit} disabled={busy}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shared ---- */
// A labelled row. The label column is wide enough for the longest word it will ever
// hold: at 88px "SCREENSHOTS" overflowed and printed straight through the heading
// beside it, which is the sort of thing that reads as carelessness everywhere else on
// the page too.
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cn-row">
      <span className="cn-row-l">{label}</span>
      <div className="cn-row-b">{children}</div>
    </div>
  );
}
