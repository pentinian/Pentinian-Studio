'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Attach from './Attach';
import Files from './Files';
import { ExampleInspiration, ExampleRequest } from './Mocks';

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
  parent_id: string | null;
  created_at: string;
};

// A mark for each face, drawn in the same thin line as everything else. Not an icon
// set: four small diagrams of what is behind the tab, which is enough to find the one
// you want without reading, and quiet enough not to become decoration.
const MARK: Record<Face, React.ReactNode> = {
  files: (
    <>
      <rect x="2.5" y="4.5" width="8" height="9" rx="1" />
      <path d="M5 2.5h6.5a1 1 0 0 1 1 1V11" />
    </>
  ),
  brand: (
    <>
      <rect x="1.5" y="5" width="4" height="8" rx=".8" />
      <rect x="6.5" y="5" width="4" height="8" rx=".8" />
      <rect x="11.5" y="5" width="3" height="8" rx=".8" />
      <path d="M1.5 3h13" />
    </>
  ),
  inspiration: (
    <>
      <rect x="1.5" y="3.5" width="6" height="6" rx=".8" />
      <rect x="8.5" y="6" width="6" height="6.5" rx=".8" />
      <path d="M1.5 11.5h5" />
    </>
  ),
  requests: (
    <>
      <path d="M2 3.5h12v7.5H7l-3.5 3v-3H2z" />
      <path d="M5 6.5h6M5 8.5h3.5" />
    </>
  ),
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
  // The brand splits in two, and the split is the whole point. What Pentinian settled
  // is the board. What the client has asked for is a conversation next to the board,
  // and it never joins the board until it is adopted.
  const settledBrand = of('brand').filter((n) => !n.from_client);
  const suggestions = of('brand').filter((n) => n.from_client);

  async function add(row: Partial<Note> & { kind: Note['kind'] }) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const payload: any = {
      project_id: projectId,
      from_client: true,
      author_id: user?.id,
      status: row.kind === 'request' || row.kind === 'brand' ? 'open' : 'none',
      ...row,
    };
    const tryInsert = async (p: any) => (await supabase.from('project_notes').insert(p)).error;
    let error = await tryInsert(payload);
    // Degrade through the columns a pending migration might not have yet, rather than
    // refusing to accept what someone just typed.
    if (error && /parent_id/.test(error.message)) {
      const { parent_id, ...lean } = payload;
      error = await tryInsert(lean);
    }
    if (error && /facet/.test(error.message)) {
      const { facet, parent_id, ...lean } = payload;
      error = await tryInsert(lean);
    }
    if (error) {
      // The one refusal worth translating: the database is still on the old policy that
      // forbade a client writing to the brand face at all.
      setMsg(/row-level security/i.test(error.message) && row.kind === 'brand'
        ? 'Suggestions are not switched on yet. Run supabase/brand-feedback.sql.'
        : error.message);
      return false;
    }
    setMsg(''); load(); return true;
  }

  async function remove(n: Note) {
    const supabase = createClient();
    const { error } = await supabase.from('project_notes').delete().eq('id', n.id);
    if (error) return setMsg(error.message);
    load();
  }

  const tab = (k: Face, label: string, n: number | null, blurb: string) => (
    <button className={'cn-tab' + (face === k ? ' on' : '')} onClick={() => setFace(k)} title={blurb}>
      <svg viewBox="0 0 16 16" aria-hidden="true">{MARK[k]}</svg>
      <span className="cn-tab-t">
        {label}
        <small>{blurb}</small>
      </span>
      {n != null && n > 0 && <i>{n}</i>}
    </button>
  );

  return (
    <div className="cn">
      <div className="cn-tabs">
        {tab('files', 'Files', fileCount, 'Everything the project holds')}
        {tab('brand', 'Brand', settledBrand.length, 'What we have settled')}
        {tab('inspiration', 'Inspiration', of('inspiration').length, 'What it should feel like')}
        {tab('requests', 'Requests', openRequests, 'What you have asked for')}
      </div>

      {face && missing && (
        <p className="cur-warn">The console table is not there yet. Run supabase/notes.sql, then reload.</p>
      )}

      {face === 'files' && <Files projectId={projectId} projectName={projectName} />}

      {face === 'brand' && !missing && (
        <Brand
          notes={settledBrand} suggestions={suggestions} ready={ready} staff={staff}
          shotUrls={shotUrls} add={add} remove={remove} projectName={projectName}
        />
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
function Brand({ notes, suggestions, ready, staff, shotUrls, add, remove, projectName }: any) {
  const [hover, setHover] = useState<string | null>(null);
  const [asking, setAsking] = useState<Note | null | 'general' | 'rebrand'>(null);

  const group = (f: Facet) => notes.filter((n: Note) => (n.facet ?? 'rule') === f);
  const colors = group('color'), type = group('type'), rules = group('rule'), assets = group('asset');
  const lit = colors.find((n: Note) => n.id === hover) ?? null;
  const about = (n: Note) => suggestions.filter((s: Note) => s.parent_id === n.id && s.status === 'open').length;

  if (ready && !notes.length && !suggestions.length) {
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

  // Numbered as a guide is numbered. Only the sections that exist get a number, so the
  // sequence never has a hole where a section would have been.
  let n = 0;
  const no = () => String(++n).padStart(2, '0');

  return (
    <div className="cn-body settled">
      {/* It is a document, so it says so. The first version was four unlabelled groups
          of cards, which read as a list of preferences rather than the thing we agreed
          to build against. */}
      <header className="bg-head">
        <div>
          <span className="bg-kicker">Brand guide</span>
          <h4>How {projectName} is set</h4>
        </div>
        <p>
          Maintained by Pentinian. Everything here is decided rather than proposed, which
          is what makes it safe to build against. If something is wrong, say so and it
          waits for me instead of changing under you.
        </p>
      </header>

      {colors.length > 0 && (
        <Row label="Palette" no={no()}>
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
                <button className="bx-ask" onClick={() => setAsking(lit)}>Ask about this</button>
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
        <Row label="Typography" no={no()}>
          <div className="bx-grid">
            {type.map((t: Note) => (
              <div className="bx spec" key={t.id}>
                {/* A typeface can only be shown in itself. A name in another face tells
                    you nothing, which is why the specimen leads and the label follows. */}
                <b className="bx-spec" style={{ fontFamily: `'${t.title}', var(--serif)` }}>
                  Aa
                </b>
                <span className="bx-set" style={{ fontFamily: `'${t.title}', var(--serif)` }}>
                  ABCDEFGHIJKLM<br />abcdefghijklm 0123456789
                </span>
                <span className="bx-name">{t.title}</span>
                {t.body && <p>{t.body}</p>}
                {t.url && (
                  <a href={t.url} target="_blank" rel="noopener noreferrer">{host(t.url)} &#8599;</a>
                )}
                <Ask n={t} pending={about(t)} onAsk={setAsking} />
              </div>
            ))}
          </div>
        </Row>
      )}

      {rules.length > 0 && (
        <Row label="Principles" no={no()}>
          {/* Numbered clauses set in the serif, indented under their own heading. As
              cards in a grid these read as a list of rules someone is imposing; as a
              manual they read as the shape of the thing, which is what they are. */}
          <ol className="pr">
            {rules.map((r: Note, i: number) => (
              <li className="pr-i" key={r.id}>
                <span className="pr-n">{String(i + 1).padStart(2, '0')}</span>
                <div className="pr-b">
                  <b>{r.title}</b>
                  {r.body && <p>{r.body}</p>}
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noopener noreferrer">{host(r.url)} &#8599;</a>
                  )}
                  <Ask n={r} pending={about(r)} onAsk={setAsking} />
                </div>
              </li>
            ))}
          </ol>
        </Row>
      )}

      {assets.length > 0 && (
        <Row label="Assets" no={no()}>
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

      {/* The conversation, kept next to the board rather than inside it. A suggestion
          that sat among the decisions would read as one, which is precisely the thing
          the board is for preventing. */}
      {suggestions.length > 0 && (
        <Row label="Your notes" no={no()}>
          <div className="sg-list">
            {suggestions.map((s: Note) => {
              const on = notes.find((n: Note) => n.id === s.parent_id);
              return (
                <div className={'sg s-' + s.status} key={s.id}>
                  <span className="sg-st">
                    {s.status === 'open' ? 'Pending' : s.status === 'declined' ? 'Not doing' : STATUS[s.status]}
                  </span>
                  <div className="sg-b">
                    {on && <span className="sg-on">on {on.title}</span>}
                    {s.title && <b>{s.title}</b>}
                    {s.body && <p>{s.body}</p>}
                  </div>
                  {s.status === 'open' && (
                    <button className="cn-x" onClick={() => remove(s)} title="Withdraw" aria-label="Withdraw">
                      &#215;
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Row>
      )}

      {!staff && (
        <SuggestBox target={asking} setTarget={setAsking} add={add} />
      )}
    </div>
  );
}

function Row({ label, no, children }: { label: string; no?: string; children: React.ReactNode }) {
  return (
    <div className="cn-row">
      <span className="cn-row-l">
        {no && <em>{no}</em>}
        {label}
      </span>
      <div className="cn-row-b">{children}</div>
    </div>
  );
}

// Saying "the sage is too soft" should take ten seconds and land where it will be seen.
// The alternative is an email, and an email about a colour is lost by Thursday.
function Ask({ n, pending, onAsk }: { n: Note; pending: number; onAsk: (n: Note) => void }) {
  return (
    <span className="bx-foot">
      {pending > 0 && <i className="bx-pend">{pending} pending</i>}
      <button className="bx-ask" onClick={() => onAsk(n)}>Ask about this</button>
    </span>
  );
}

function SuggestBox({ target, setTarget, add }: any) {
  const [d, setD] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const on: Note | null =
    target && target !== 'general' && target !== 'rebrand' ? target : null;

  const submit = async () => {
    if (!d.title.trim() && !d.body.trim()) return;
    setBusy(true);
    const ok = await add({
      kind: 'brand',
      facet: on?.facet ?? 'rule',
      parent_id: on?.id ?? null,
      // Prefixed rather than given its own column. A rebrand is still a suggestion on
      // the brand face, and a whole new kind for one word would have to be taught to
      // the sync, the Atelier and both policies for nothing.
      title: (target === 'rebrand' ? 'Rebrand: ' : '') + (d.title.trim() || 'a conversation'),
      body: d.body.trim() || null,
      status: 'open',
    });
    setBusy(false);
    if (ok) { setD({ title: '', body: '' }); setTarget(null); }
  };

  if (!target) {
    return (
      <div className="sg-open">
        <div className="sg-open-l">
          <b>The brand is mine to set, and yours to push on.</b>
          <span>
            Anything you send here waits for me rather than changing what is above. Point
            at a single piece with Ask about this, or start something larger.
          </span>
        </div>
        <div className="sg-open-a">
          <button className="mini-btn" onClick={() => setTarget('general')}>
            Suggest a change
          </button>
          {/* A rebrand is a different size of request and pretending otherwise helps
              nobody. It arrives as a suggestion like any other, but it says what it is,
              so the conversation starts in the right place. */}
          <button className="mini-btn rebrand" onClick={() => setTarget('rebrand')}>
            Ask about a rebrand
          </button>
        </div>
      </div>
    );
  }

  const big = target === 'rebrand';

  return (
    <div className={'cn-add sg-form' + (big ? ' big' : '')}>
      {on && <span className="sg-on">about {on.title}</span>}
      {big && (
        <p className="sg-lead">
          A rebrand is a project rather than a change, so this one starts a conversation
          rather than a ticket. Tell me what stopped working and I will come back with
          what it would take.
        </p>
      )}
      <input
        placeholder={big ? 'What is not working any more' : 'What would you change'}
        value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })}
      />
      <textarea
        rows={big ? 4 : 2}
        placeholder={big
          ? 'Anything that helps: who you are speaking to now, what has changed, what you want it to feel like'
          : 'Why, or what it should be instead'}
        value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })}
      />
      <div className="cn-add-row">
        <button className="mini-btn pri" onClick={submit} disabled={busy}>
          {busy ? 'Sending…' : big ? 'Start the conversation' : 'Send it over'}
        </button>
        <button className="mini-btn" onClick={() => setTarget(null)}>Cancel</button>
      </div>
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

      {/* The composer and a worked example side by side. A blank field on its own asks
          someone to invent the format as well as the content, and the usual answer to
          that is nothing at all. */}
      <div className="cn-pair">
        <div className="cn-add">
          <textarea rows={3} placeholder="What you like about it" value={d.body}
                    onChange={(e) => setD({ ...d, body: e.target.value })} />
          <input placeholder="Pinterest or any link" value={d.url}
                 onChange={(e) => setD({ ...d, url: e.target.value })} />
          <div className="cn-add-row">
            <Attach projectId={projectId} label={d.shot ? 'Image ready' : 'Add an image'}
                    onDone={(p) => setD((x) => ({ ...x, shot: p }))} />
            <button className="mini-btn pri" onClick={submit} disabled={busy}>
              {busy ? 'Pinning…' : 'Pin it'}
            </button>
          </div>
        </div>
        <ExampleInspiration />
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

      <div className="cn-pair">
        <div className="cn-add">
          <input placeholder="What would you like" value={d.title}
                 onChange={(e) => setD({ ...d, title: e.target.value })} />
          <textarea rows={3} placeholder="Any detail that helps" value={d.body}
                    onChange={(e) => setD({ ...d, body: e.target.value })} />
          <div className="cn-add-row">
            <Attach projectId={projectId} label={d.shot ? 'Shot ready' : 'Show me where'}
                    onDone={(p) => setD((x) => ({ ...x, shot: p }))} />
            <button className="mini-btn pri" onClick={submit} disabled={busy}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
        <ExampleRequest />
      </div>
    </div>
  );
}

