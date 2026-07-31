'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Editing the public site without touching the public site.
//
// The Foyer is static HTML on its own deploy, which is why it is fast and why it cannot
// simply be a page in this app. So the text it holds gets addresses, and this writes to
// those addresses. Each editable node on the Foyer carries data-cms="key"; the script
// there replaces its text with whatever is stored under that key, and leaves the node
// exactly as authored if there is nothing stored. That last part is the whole safety
// property: an empty content record renders the site as shipped, so this can never blank
// a page by being wrong or unreachable.
//
// It is a named-block editor rather than a page builder, deliberately. A visual builder
// over hand-written HTML produces markup nobody can maintain, and the parts of the Foyer
// worth changing weekly are the words, not the layout. Adding a block later is one entry
// in this list and one attribute in the HTML.

type Field = {
  key: string;
  label: string;
  hint?: string;
  lines?: number;
  page: 'home' | 'pen';
  /** Grouped so forty fields read as five short sections rather than one wall. */
  group: string;
};

// The six work rows, which are the bulk of the home page. Four fields each: what kind of
// thing it is, its name, where it stands, and the paragraph that does the actual work.
const WORK = [
  ['artinian', 'Artinian Gems'],
  ['caveman', 'Caveman Gems'],
  ['limicon', 'LimIcon'],
  ['unimpact', 'UnImpact'],
  ['studiolo', 'Studiolo'],
  ['pentinian', 'Pentinian'],
] as const;

const workFields: Field[] = WORK.flatMap(([slug, name]) => [
  { key: `work.${slug}.cat`, label: 'Category', page: 'home', group: name },
  { key: `work.${slug}.title`, label: 'Name', page: 'home', group: name, lines: 2,
    hint: 'Two lines. The second renders lighter.' },
  { key: `work.${slug}.status`, label: 'Status', page: 'home', group: name },
  { key: `work.${slug}.intro`, label: 'The paragraph', page: 'home', group: name, lines: 6 },
]);

const FIELDS: Field[] = [
  // ---- home
  { key: 'hero.eyebrow', label: 'Eyebrow', page: 'home', group: 'The opening', hint: 'The small line above the headline' },
  { key: 'hero.title', label: 'Headline', page: 'home', group: 'The opening', lines: 3,
    hint: 'Line breaks are kept. The last line renders lighter.' },
  { key: 'hero.lede', label: 'Opening paragraph', page: 'home', group: 'The opening', lines: 5 },
  { key: 'work.heading', label: 'Selected Work heading', page: 'home', group: 'The opening' },
  { key: 'work.note', label: 'Selected Work note', page: 'home', group: 'The opening', lines: 2 },

  // ---- the waitlist
  { key: 'wl.eyebrow', label: 'Waitlist eyebrow', page: 'home', group: 'The waitlist' },
  { key: 'wl.title', label: 'Waitlist heading', page: 'home', group: 'The waitlist' },
  { key: 'wl.lede', label: 'Waitlist intro', page: 'home', group: 'The waitlist', lines: 3 },
  { key: 'wl.name', label: 'Name field', page: 'home', group: 'The waitlist' },
  { key: 'wl.email', label: 'Email field', page: 'home', group: 'The waitlist' },
  { key: 'wl.venture', label: 'Venture field', page: 'home', group: 'The waitlist' },
  { key: 'wl.idea', label: 'Idea field', page: 'home', group: 'The waitlist' },
  { key: 'wl.inspiration', label: 'Inspiration field', page: 'home', group: 'The waitlist' },
  { key: 'wl.budget', label: 'Budget field', page: 'home', group: 'The waitlist' },
  { key: 'wl.timeline', label: 'Timeline field', page: 'home', group: 'The waitlist' },
  { key: 'wl.submit', label: 'Submit button', page: 'home', group: 'The waitlist' },
  { key: 'wl.note', label: 'Note under the button', page: 'home', group: 'The waitlist' },

  // ---- the Pen page
  { key: 'pen.eyebrow', label: 'Eyebrow', page: 'pen', group: 'The Pen page' },
  { key: 'pen.title', label: 'Heading', page: 'pen', group: 'The Pen page', lines: 2 },
  { key: 'pen.lede', label: 'Opening paragraph', page: 'pen', group: 'The Pen page', lines: 5 },
  { key: 'pen.body', label: 'The rest', page: 'pen', group: 'The Pen page', lines: 10,
    hint: 'A blank line starts a new paragraph.' },
  // ---- the Window section
  { key: 'win.heading', label: 'Section heading', page: 'home', group: 'Your Window' },
  { key: 'win.count', label: 'Heading note', page: 'home', group: 'Your Window' },
  { key: 'win.lede', label: 'Intro', page: 'home', group: 'Your Window', lines: 3 },
  { key: 'win.t0', label: 'Tab 1 label', page: 'home', group: 'Your Window' },
  { key: 'win.h0', label: 'Tab 1 heading', page: 'home', group: 'Your Window' },
  { key: 'win.p0', label: 'Tab 1 copy', page: 'home', group: 'Your Window', lines: 4 },
  { key: 'win.t1', label: 'Tab 2 label', page: 'home', group: 'Your Window' },
  { key: 'win.h1', label: 'Tab 2 heading', page: 'home', group: 'Your Window' },
  { key: 'win.p1', label: 'Tab 2 copy', page: 'home', group: 'Your Window', lines: 4 },
  { key: 'win.t2', label: 'Tab 3 label', page: 'home', group: 'Your Window' },
  { key: 'win.h2', label: 'Tab 3 heading', page: 'home', group: 'Your Window' },
  { key: 'win.p2', label: 'Tab 3 copy', page: 'home', group: 'Your Window', lines: 4 },
  { key: 'win.t3', label: 'Tab 4 label', page: 'home', group: 'Your Window' },
  { key: 'win.h3', label: 'Tab 4 heading', page: 'home', group: 'Your Window' },
  { key: 'win.p3', label: 'Tab 4 copy', page: 'home', group: 'Your Window', lines: 4 },
  { key: 'win.t4', label: 'Tab 5 label', page: 'home', group: 'Your Window' },
  { key: 'win.h4', label: 'Tab 5 heading', page: 'home', group: 'Your Window' },
  { key: 'win.p4', label: 'Tab 5 copy', page: 'home', group: 'Your Window', lines: 4 },
  { key: 'win.t5', label: 'Tab 6 label', page: 'home', group: 'Your Window' },
  { key: 'win.h5', label: 'Tab 6 heading', page: 'home', group: 'Your Window' },
  { key: 'win.p5', label: 'Tab 6 copy', page: 'home', group: 'Your Window', lines: 4 },

  ...workFields,
];

const SITE = 'https://pentinian-site.vercel.app';

export default function HomePage() {
  const [content, setContent] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [page, setPage] = useState<'home' | 'pen'>('home');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [nudge, setNudge] = useState(0);
  // One section open at a time. Everything expanded is the same wall the grouping was
  // meant to remove.
  const [openGroup, setOpenGroup] = useState<string | null>('The opening');

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from('site_config').select('config').eq('id', 1).single();
    const c = (data?.config?.content ?? {}) as Record<string, string>;
    setContent(c);
    setSaved(c);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true); setMsg('');
    const supabase = createClient();
    // Read, merge, write. The calibration switches live in the same row, so replacing
    // the whole config here would silently reset them.
    const { data } = await supabase.from('site_config').select('config').eq('id', 1).single();
    const next = { ...(data?.config ?? {}), content };
    const { error } = await supabase
      .from('site_config')
      .update({ config: next, updated_at: new Date().toISOString() })
      .eq('id', 1);
    setBusy(false);
    if (error) return setMsg(`Could not save: ${error.message}`);
    setSaved(content);
    // Honest about the edge cache. /api/site-config sets s-maxage=60, so a save is not
    // instant on the public site, and saying "next load" sends someone to refresh three
    // times and conclude it is broken. It is the right cache to keep: the Foyer hits
    // this on every visit and it must stay fast.
    setMsg('Saved. The live site picks it up within a minute, since the config is cached at the edge.');
    setNudge((n) => n + 1);
  }

  const dirty = FIELDS.some((f) => (content[f.key] ?? '') !== (saved[f.key] ?? ''));
  const fields = FIELDS.filter((f) => f.page === page);
  // Order preserved from the field list, so sections read down the page the way the
  // page itself reads.
  const groups = Array.from(
    fields.reduce((m, f) => (m.set(f.group, [...(m.get(f.group) ?? []), f]), m), new Map<string, Field[]>())
  );

  return (
    <div className="hp">
      <div className="hp-head">
        <div className="hp-pages">
          <button className={'cd-face' + (page === 'home' ? ' on' : '')} onClick={() => setPage('home')}>
            Home
          </button>
          <button className={'cd-face' + (page === 'pen' ? ' on' : '')} onClick={() => setPage('pen')}>
            Pen
          </button>
        </div>
        <a className="hp-open" href={page === 'home' ? SITE : `${SITE}/pen.html`}
           target="_blank" rel="noopener noreferrer">
          Open the live page &#8599;
        </a>
        {dirty && (
          <div className="hp-save">
            <button className="mini-btn" onClick={() => setContent(saved)}>Discard</button>
            <button className="mini-btn pri" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {msg && <p className="cur-msg">{msg}</p>}

      <div className="hp-body">
        <div className="hp-fields">
          {groups.map(([name, gf]) => {
            const on = openGroup === name;
            // A group carrying an unsaved edit says so on its closed header, so a
            // change cannot hide inside a collapsed section.
            const touched = gf.filter((f) => (content[f.key] ?? '') !== (saved[f.key] ?? '')).length;
            const written = gf.filter((f) => (content[f.key] ?? '').trim()).length;
            return (
              <section className={'hp-g' + (on ? ' open' : '')} key={name}>
                <button className="hp-g-h" onClick={() => setOpenGroup(on ? null : name)}>
                  <span className="hp-g-n">{name}</span>
                  <span className="hp-g-m">
                    {touched > 0 && <i className="hp-g-d">{touched} unsaved</i>}
                    {written > 0 ? `${written} of ${gf.length} edited` : `${gf.length} fields`}
                  </span>
                  <span className="hp-g-c" aria-hidden="true">{on ? '−' : '+'}</span>
                </button>

                {on && gf.map((f) => {
                  const changed = (content[f.key] ?? '') !== (saved[f.key] ?? '');
                  return (
                    <label className={'hp-f' + (changed ? ' changed' : '')} key={f.key}>
                      <span className="hp-l">
                        {f.label}
                        <i>{f.key}</i>
                      </span>
                      {f.lines && f.lines > 1 ? (
                        <textarea
                          rows={f.lines}
                          value={content[f.key] ?? ''}
                          placeholder="As written on the page"
                          onChange={(e) => setContent({ ...content, [f.key]: e.target.value })}
                        />
                      ) : (
                        <input
                          value={content[f.key] ?? ''}
                          placeholder="As written on the page"
                          onChange={(e) => setContent({ ...content, [f.key]: e.target.value })}
                        />
                      )}
                      {f.hint && <small>{f.hint}</small>}
                    </label>
                  );
                })}
              </section>
            );
          })}

          <p className="cn-note hp-foot">
            An empty box means the page keeps the words it was built with. Nothing here
            can blank the site: if this record is missing or unreachable, every node
            renders exactly as authored.
          </p>
        </div>

        {/* The real page, live, beside the fields. Not a rendering of it and not a
            preview that can drift: the site itself, reloaded when something saves. */}
        <div className="hp-preview">
          <div className="hp-frame">
            <iframe
              key={`${page}-${nudge}`}
              // Cache-busted, so a reload after saving fetches a fresh page rather
              // than the copy the browser is already holding.
              src={`${page === 'home' ? SITE : `${SITE}/pen.html`}?v=${nudge}`}
              title="The live site"
              loading="lazy"
            />
          </div>
          <span className="cn-note">
            The live page, not a rendering of it. It reloads when you save, though the
            config is cached at the edge for a minute, so give it a moment and press
            Save again to reload if a change has not appeared yet.
          </span>
        </div>
      </div>
    </div>
  );
}
