'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Attach, { isImage } from './Attach';
import Files from './Files';

// The project console: what I made, what we decided, what you want, what you asked for.
//
// One table under all of it, because they are the same shape. But they are not the
// same THING, and an earlier version drew them identically, which made the brand face
// read like a list of notes rather than a set of decisions. Each face now knows what
// it holds: brand has colours, typefaces, rules and assets; inspiration is a picture
// with what you thought about it; a request is what you want with a shot of where.
//
// What a client can do is deliberately uneven and enforced in the database. They add
// inspiration and requests as themselves. They cannot author a brand decision, which
// is a decision rather than a contribution, and cannot set a status, because a
// request they mark done is not done.

export type Face = 'files' | 'brand' | 'inspiration' | 'requests';
type Facet = 'colour' | 'type' | 'rule' | 'asset';

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
    // Tolerant of a pending migration, same as everywhere else: one unknown column
    // makes PostgREST refuse the whole query.
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
      from_client: !staff,
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

  async function setStatus(n: Note, status: string) {
    const supabase = createClient();
    await supabase.from('project_notes').update({ status }).eq('id', n.id);
    load();
  }

  async function remove(n: Note) {
    const supabase = createClient();
    await supabase.from('project_notes').delete().eq('id', n.id);
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
        <p className="cur-warn">
          The console table is not there yet. Run supabase/notes.sql, then reload.
        </p>
      )}

      {face === 'files' && <Files projectId={projectId} projectName={projectName} />}

      {face === 'brand' && !missing && (
        <Brand
          notes={of('brand')} staff={staff} ready={ready} projectId={projectId}
          shotUrls={shotUrls} add={add} remove={remove}
        />
      )}

      {face === 'inspiration' && !missing && (
        <Inspiration
          notes={of('inspiration')} ready={ready} projectId={projectId}
          shotUrls={shotUrls} add={add} remove={remove} staff={staff}
        />
      )}

      {face === 'requests' && !missing && (
        <Requests
          notes={of('request')} ready={ready} projectId={projectId} staff={staff}
          shotUrls={shotUrls} add={add} setStatus={setStatus}
        />
      )}

      {face && msg && <p className="cur-msg bad">{msg}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ brand ----- */
// Colours, typefaces, rules and assets. Four shapes, shown as four rows, and a row
// with nothing in it is not drawn at all.
function Brand({ notes, staff, ready, projectId, shotUrls, add, remove }: any) {
  const [open, setOpen] = useState<Facet | null>(null);
  const [d, setD] = useState({ title: '', body: '', url: '', swatch: '#7E9270' });

  const group = (f: Facet) => notes.filter((n: Note) => (n.facet ?? 'rule') === f);
  const colours = group('colour'), type = group('type'), rules = group('rule'), assets = group('asset');

  const submit = async (facet: Facet) => {
    const ok = await add({
      kind: 'brand', facet,
      title: d.title.trim() || null,
      body: d.body.trim() || null,
      url: facet === 'asset' ? null : d.url.trim() || null,
      swatch: facet === 'colour' ? d.swatch : null,
      shot: facet === 'asset' ? d.url || null : null,
    });
    if (ok) { setD({ title: '', body: '', url: '', swatch: '#7E9270' }); setOpen(null); }
  };

  const empty = !colours.length && !type.length && !rules.length && !assets.length;

  return (
    <div className="cn-body">
      {ready && empty && !staff && (
        <p className="cur-empty">
          Nothing formalised yet. Colours, type and the rules we settle appear here as we
          settle them, so neither of us has to remember what we agreed.
        </p>
      )}

      {colours.length > 0 && (
        <Row label="Colour">
          <div className="bd-cols">
            {colours.map((n: Note) => (
              <div className="bd-col" key={n.id}>
                <span className="bd-chip" style={{ background: n.swatch ?? '#ccc' }} />
                <b>{n.title}</b>
                <i>{n.swatch}</i>
                {staff && <button className="cn-x" onClick={() => remove(n)}>remove</button>}
              </div>
            ))}
          </div>
        </Row>
      )}

      {type.length > 0 && (
        <Row label="Type">
          {type.map((n: Note) => (
            <div className="bd-type" key={n.id}>
              <b style={{ fontFamily: `${n.title}, var(--serif)` }}>{n.title}</b>
              {n.body && <span>{n.body}</span>}
              {n.url && <a href={n.url} target="_blank" rel="noopener noreferrer">{host(n.url)} &#8599;</a>}
              {staff && <button className="cn-x" onClick={() => remove(n)}>remove</button>}
            </div>
          ))}
        </Row>
      )}

      {rules.length > 0 && (
        <Row label="Rules">
          {rules.map((n: Note) => (
            <div className="bd-rule" key={n.id}>
              <b>{n.title}</b>
              {n.body && <p>{n.body}</p>}
              {staff && <button className="cn-x" onClick={() => remove(n)}>remove</button>}
            </div>
          ))}
        </Row>
      )}

      {assets.length > 0 && (
        <Row label="Assets">
          <div className="cn-grid">
            {assets.map((n: Note) => (
              <Thumb key={n.id} note={n} url={n.shot ? shotUrls[n.shot] : undefined}
                     onRemove={staff ? () => remove(n) : undefined} />
            ))}
          </div>
        </Row>
      )}

      {staff && (
        <div className="cn-add">
          <div className="cn-pick-row">
            {(['colour', 'type', 'rule', 'asset'] as Facet[]).map((f) => (
              <button key={f} className={'cn-fchip' + (open === f ? ' on' : '')}
                      onClick={() => setOpen(open === f ? null : f)}>
                {f === 'colour' ? 'Colour' : f === 'type' ? 'Typeface' : f === 'rule' ? 'Rule' : 'Asset'}
              </button>
            ))}
          </div>

          {open === 'colour' && (
            <div className="cn-add-row">
              <input type="color" className="cn-colour" value={d.swatch}
                     onChange={(e) => setD({ ...d, swatch: e.target.value })} />
              <input placeholder="What it is for. Deep sage, the primary." value={d.title}
                     onChange={(e) => setD({ ...d, title: e.target.value })} />
              <button className="mini-btn pri" onClick={() => submit('colour')}>Add</button>
            </div>
          )}
          {open === 'type' && (
            <div className="cn-add-row">
              <input placeholder="Family name, exactly as it is set" value={d.title}
                     onChange={(e) => setD({ ...d, title: e.target.value })} />
              <input placeholder="Where it is used" value={d.body}
                     onChange={(e) => setD({ ...d, body: e.target.value })} />
              <button className="mini-btn pri" onClick={() => submit('type')}>Add</button>
            </div>
          )}
          {open === 'rule' && (
            <>
              <input placeholder="The decision" value={d.title}
                     onChange={(e) => setD({ ...d, title: e.target.value })} />
              <div className="cn-add-row">
                <input placeholder="Why, or what it rules out" value={d.body}
                       onChange={(e) => setD({ ...d, body: e.target.value })} />
                <button className="mini-btn pri" onClick={() => submit('rule')}>Add</button>
              </div>
            </>
          )}
          {open === 'asset' && (
            <div className="cn-add-row">
              <input placeholder="What it is. The wordmark, the favicon." value={d.title}
                     onChange={(e) => setD({ ...d, title: e.target.value })} />
              <Attach projectId={projectId} label="Choose a file"
                      accept="image/*,application/pdf,font/*"
                      onDone={(p) => setD((x) => ({ ...x, url: p }))} />
              <button className="mini-btn pri" disabled={!d.url} onClick={() => submit('asset')}>Add</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ inspiration ----- */
// A picture and what you thought about it. The thought is the point: a board of
// images with no words is a mood, and a mood cannot be built from.
function Inspiration({ notes, ready, projectId, shotUrls, add, remove, staff }: any) {
  const [d, setD] = useState({ body: '', url: '', shot: '' });

  const submit = async () => {
    if (!d.body.trim() && !d.url.trim() && !d.shot) return;
    const ok = await add({
      kind: 'inspiration', facet: null,
      title: null, body: d.body.trim() || null,
      url: d.url.trim() || null, shot: d.shot || null,
    });
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
                  {(staff || n.from_client) && (
                    <button className="cn-x" onClick={() => remove(n)}>remove</button>
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
          <button className="mini-btn pri" onClick={submit}>Pin it</button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- requests ----- */
// What you want, and a shot of where you mean. Pointing at the page beats describing
// it, and it removes a whole round of "which header".
function Requests({ notes, ready, projectId, staff, shotUrls, add, setStatus }: any) {
  const [d, setD] = useState({ title: '', body: '', shot: '' });

  const submit = async () => {
    if (!d.title.trim() && !d.body.trim()) return;
    const ok = await add({
      kind: 'request', facet: null,
      title: d.title.trim() || null, body: d.body.trim() || null,
      shot: d.shot || null, url: null,
    });
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
          {staff && (
            <select className="cn-pick" value={n.status}
                    onChange={(e) => setStatus(n, e.target.value)} aria-label="status">
              {['open', 'doing', 'done', 'declined'].map((s) => (
                <option key={s} value={s}>{STATUS[s]}</option>
              ))}
            </select>
          )}
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
          <button className="mini-btn pri" onClick={submit}>Send</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shared ---- */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cn-row">
      <span className="cn-row-l">{label}</span>
      <div className="cn-row-b">{children}</div>
    </div>
  );
}

function Thumb({ note, url, onRemove }: { note: Note; url?: string; onRemove?: () => void }) {
  const p = note.shot ?? '';
  return (
    <div className="cn-thumb">
      {url && isImage(p) ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" loading="lazy" />
        </a>
      ) : url ? (
        <a className="cn-doc" href={url} target="_blank" rel="noopener noreferrer">
          {(p.split('.').pop() ?? 'file').toUpperCase()}
        </a>
      ) : (
        <span className="cn-doc" />
      )}
      <span className="cn-cap">
        {note.title}
        {onRemove && <button className="cn-x" onClick={onRemove}>remove</button>}
      </span>
    </div>
  );
}
