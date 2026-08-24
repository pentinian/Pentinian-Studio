'use client';

import { useCallback, useEffect, useState } from 'react';

// Where the project console is calibrated.
//
// Cowork writes into the Notion Console database. Sync pulls it here, staged. This is
// where it gets checked, corrected, ordered, and passed. Nothing on this screen is
// visible to a client until the release control on its row is pressed.
//
// The layout mirrors the client's Window on purpose. When the two drift, someone
// releases something that reads differently than it looked, and by then it is in
// front of the person it was written for. A shared stylesheet was supposed to prevent
// that and did not, because sharing a stylesheet is not sharing a layout. So the
// preview here is the actual Window component, not a copy of it.

type Item = {
  id: string; kind: 'brand' | 'inspiration' | 'request';
  facet: 'color' | 'type' | 'rule' | 'asset' | null;
  title: string | null; body: string | null; swatch: string | null;
  url: string | null; shot: string | null; status: string;
  sort: number; from_client: boolean; parent_id: string | null;
  released_at: string | null; notion_id: string | null; notion_url: string | null;
  created_at: string;
};

const FACES: { k: Item['kind']; label: string }[] = [
  { k: 'brand', label: 'Brand' },
  { k: 'inspiration', label: 'Inspiration' },
  { k: 'request', label: 'Requests' },
];
const FACETS: Item['facet'][] = ['color', 'type', 'rule', 'asset'];
/* Exactly the words the client reads in their own Window, taken from the same set, so
   the two cannot describe one request differently. See window/Console.tsx. */
const REQ_STATES: [string, string][] = [
  ['open', 'Open'],
  ['doing', 'In hand'],
  ['done', 'Done'],
  ['declined', 'Not doing'],
];

const FACET_LABEL: Record<string, string> = {
  color: 'Color', type: 'Typeface', rule: 'Rule', asset: 'Asset',
};

export default function ConsoleDesk({
  projectId, projectName, refreshKey, only,
}: {
  projectId: string | null;
  projectName: string | null;
  refreshKey: number;
  /** Lock the desk to one face. The Console tab retired into two rooms:
   *  Inspiration and Requests each mount this desk locked to their kind.
   *  Brand notes now live in the Brain and are edited at their sources;
   *  their release press arrives with Phase B. */
  only?: 'inspiration' | 'request';
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [face, setFace] = useState<Item['kind']>(only ?? 'brand');
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, Partial<Item>>>({});
  const [adding, setAdding] = useState<Item['facet'] | 'note' | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const res = await fetch(`/api/console?project=${projectId}`, { cache: 'no-store' });
    const d = await res.json();
    setItems(res.ok ? d.items ?? [] : []);
    if (!res.ok) { setMsg(d.error); setBad(true); }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const say = (m: string, isBad = false) => { setMsg(m); setBad(isBad); };

  async function patch(id: string, fields: Record<string, any>) {
    const res = await fetch('/api/console', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
    const d = await res.json();
    if (!res.ok) { say(d.error, true); return false; }
    setItems((cur) => cur.map((i) => (i.id === id ? d.item : i)));
    setDraft((cur) => { const { [id]: _, ...rest } = cur; return rest; });
    say('');
    return true;
  }

  async function add(facet: Item['facet']) {
    if (!projectId) return;
    const res = await fetch('/api/console', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId, kind: face, facet,
        sort: (items.filter((i) => i.kind === face).length + 1) * 10,
        swatch: facet === 'color' ? '#7E9270' : null,
      }),
    });
    const d = await res.json();
    if (!res.ok) return say(d.error, true);
    setItems((cur) => [...cur, d.item]);
    setAdding(null);
    say('Added, and staged. Fill it in, then release when it is right.');
  }

  async function drop(it: Item) {
    const res = await fetch(`/api/console?id=${it.id}`, { method: 'DELETE' });
    if (!res.ok) return say((await res.json()).error, true);
    setItems((cur) => cur.filter((i) => i.id !== it.id));
    say(it.notion_id
      ? 'Removed here. It is still in Notion, so the next sync brings it back. Delete it there to be rid of it.'
      : 'Removed.');
  }

  const val = (it: Item, k: keyof Item) =>
    (draft[it.id]?.[k] as any) ?? (it[k] as any) ?? '';
  const edit = (it: Item, k: keyof Item, v: any) =>
    setDraft((c) => ({ ...c, [it.id]: { ...c[it.id], [k]: v } }));
  const dirty = (it: Item) => Boolean(draft[it.id] && Object.keys(draft[it.id]).length);

  // A client's brand note is a suggestion, not a decision, and it belongs above the
  // board rather than in the same list. Mixing them would mean scanning a column of
  // rows to work out which ones are asking you something.
  const shown = items.filter((i) => i.kind === face && !(i.kind === 'brand' && i.from_client));
  // Client brand suggestions are asks, so with the brand face retired they
  // surface in the Requests room, where asks live.
  const showAsks = face === 'brand' || only === 'request';
  const pending = showAsks
    ? items.filter((i) => i.kind === 'brand' && i.from_client && i.status === 'open')
    : [];
  const answered = showAsks
    ? items.filter((i) => i.kind === 'brand' && i.from_client && i.status === 'declined')
    : [];
  const stagedCount = (k: Item['kind']) =>
    items.filter((i) => i.kind === k && !i.released_at && !i.from_client).length;
  const askCount = items.filter((i) => i.kind === 'brand' && i.from_client && i.status === 'open').length;

  if (!projectId) return <p className="cur-empty">Choose a project in the rail.</p>;

  return (
    <div className="cd">
      <div className="cd-h">
        {!only && (
          <div className="cd-faces">
            {FACES.map((f) => (
              <button key={f.k} className={'cd-face' + (face === f.k ? ' on' : '')}
                      onClick={() => { setFace(f.k); setAdding(null); }}>
                {f.label}
                {stagedCount(f.k) > 0 && <i title="staged, not yet released">{stagedCount(f.k)}</i>}
                {f.k === 'brand' && askCount > 0 && (
                  <i className="ask" title="waiting on you">{askCount}</i>
                )}
              </button>
            ))}
          </div>
        )}
        <span className="cd-note">
          {projectName}. Staged items are invisible to the client until released.
        </span>
      </div>

      {msg && <p className={'cur-msg' + (bad ? ' bad' : '')}>{msg}</p>}
      {loading && <p className="cur-empty">Reading the console…</p>}

      {/* What the client has asked for, above the board rather than inside it. Adopting
          one turns their row into a decision and releases it: they watch the same card
          move from Pending to settled, rather than theirs vanishing and a stranger
          appearing where it was. */}
      {(pending.length > 0 || answered.length > 0) && (
        <div className="cd-asks">
          <span className="cd-asks-h">
            From the client
            {pending.length > 0 && <b>{pending.length} waiting on you</b>}
          </span>
          {[...pending, ...answered].map((s) => {
            const on = items.find((i) => i.id === s.parent_id);
            return (
              <div className={'cd-ask s-' + s.status} key={s.id}>
                <div className="cd-ask-b">
                  {on && <span className="cd-ask-on">on {on.title}</span>}
                  {s.title && <b>{s.title}</b>}
                  {s.body && <p>{s.body}</p>}
                </div>
                {s.status === 'open' ? (
                  <div className="cd-acts">
                    <button
                      className="mini-btn pri"
                      title="Make it a decision and put it on their board"
                      onClick={async () => {
                        if (await patch(s.id, { adopt: true, release: true })) {
                          say('Adopted. It is on their board as a decision now.');
                        }
                      }}
                    >
                      Adopt
                    </button>
                    <button className="mini-btn"
                            onClick={async () => {
                              if (await patch(s.id, { adopt: false })) {
                                say('Marked not doing. They can see the answer, which beats silence.');
                              }
                            }}>
                      Decline
                    </button>
                  </div>
                ) : (
                  <span className="cd-state">Not doing</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && shown.length === 0 && (
        <p className="cur-empty">
          Nothing on this face yet. Write it in the Notion Console database and press
          Sync Notion above, or add one here.
        </p>
      )}

      {shown.map((it) => (
        <div className={'cd-row' + (it.released_at ? ' live' : '') + (it.from_client ? ' theirs' : '')} key={it.id}>
          <div className="cd-lead">
            <span className="cd-state">
              {it.from_client ? 'Theirs' : it.released_at ? 'Released' : 'Staged'}
            </span>
            {it.kind === 'brand' && (
              <select className="cn-pick" value={val(it, 'facet') || 'rule'}
                      onChange={(e) => edit(it, 'facet', e.target.value)} aria-label="kind">
                {FACETS.map((f) => <option key={f} value={f!}>{FACET_LABEL[f!]}</option>)}
              </select>
            )}
            {/* A request's state was readable by the client and settable by nobody.
                Their Window draws three of them and the public site promises three,
                so every request anyone ever sent would have read Open for good. */}
            {it.kind === 'request' && (
              <select
                className="cn-pick"
                value={val(it, 'status') || 'open'}
                onChange={(e) => patch(it.id, { status: e.target.value })}
                aria-label="what is happening with this request"
              >
                {REQ_STATES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            )}
            <input className="cd-sort" type="number" value={val(it, 'sort')}
                   onChange={(e) => edit(it, 'sort', Number(e.target.value))}
                   title="Order within its group" aria-label="order" />
          </div>

          <div className="cd-fields">
            <div className="cd-line">
              {val(it, 'facet') === 'color' && it.kind === 'brand' && (
                <input className="cn-color" type="color" value={val(it, 'swatch') || '#7E9270'}
                       onChange={(e) => edit(it, 'swatch', e.target.value)} aria-label="swatch" />
              )}
              <input
                placeholder={
                  it.kind === 'request' ? 'What they want'
                  : val(it, 'facet') === 'color' ? 'Name. Paper, Ink, Sage.'
                  : val(it, 'facet') === 'type' ? 'Family name, exactly as it is set'
                  : val(it, 'facet') === 'asset' ? 'What it is'
                  : it.kind === 'inspiration' ? 'Caption, optional'
                  : 'The decision'
                }
                value={val(it, 'title')} onChange={(e) => edit(it, 'title', e.target.value)}
              />
            </div>
            <textarea
              rows={2}
              placeholder={
                val(it, 'facet') === 'color' ? 'What it is for. This is what appears on hover.'
                : val(it, 'facet') === 'type' ? 'Where it is used'
                : it.kind === 'inspiration' ? 'What they liked about it'
                : it.kind === 'request' ? 'Any detail'
                : 'Why, or what it rules out'
              }
              value={val(it, 'body')} onChange={(e) => edit(it, 'body', e.target.value)}
            />
            {val(it, 'facet') !== 'color' && (
              <input placeholder="Link, optional" value={val(it, 'url')}
                     onChange={(e) => edit(it, 'url', e.target.value)} />
            )}
            {it.shot && <span className="cd-shot" title={it.shot}>image attached</span>}
          </div>

          <div className="cd-acts">
            {dirty(it) && (
              <button className="mini-btn pri" onClick={() => patch(it.id, draft[it.id])}>Save</button>
            )}
            {!it.from_client && (
              it.released_at ? (
                <button className="mini-btn" onClick={() => patch(it.id, { release: false })}
                        title="Take it back out of their Window">
                  Pull back
                </button>
              ) : (
                <button className="mini-btn pri"
                        onClick={async () => {
                          if (dirty(it)) { if (!(await patch(it.id, draft[it.id]))) return; }
                          if (await patch(it.id, { release: true })) say('Released. It is in their Window now.');
                        }}>
                  Release
                </button>
              )
            )}
            {it.notion_url && (
              <a className="cd-src" href={it.notion_url} target="_blank" rel="noopener noreferrer">
                Notion &#8599;
              </a>
            )}
            <button className="cd-drop" onClick={() => drop(it)} title="Remove">&#215;</button>
          </div>
        </div>
      ))}

      {!loading && (
        <div className="cd-add">
          {face === 'brand' ? (
            <>
              <span className="cd-addl">Add</span>
              {FACETS.map((f) => (
                <button key={f} className="cn-fchip" onClick={() => add(f)}>{FACET_LABEL[f!]}</button>
              ))}
            </>
          ) : (
            <button className="cn-fchip" onClick={() => add(null)}>
              Add {face === 'request' ? 'a request' : 'a reference'}
            </button>
          )}
          <span className="cd-hint">
            Anything added here starts staged, same as anything that arrives from Notion.
          </span>
        </div>
      )}
    </div>
  );
}
