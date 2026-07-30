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
};

const FIELDS: Field[] = [
  // ---- home
  { key: 'hero.eyebrow', label: 'Eyebrow', page: 'home', hint: 'The small line above the headline' },
  { key: 'hero.title', label: 'Headline', page: 'home', lines: 3,
    hint: 'Line breaks are kept. The last line renders lighter.' },
  { key: 'hero.lede', label: 'Opening paragraph', page: 'home', lines: 5 },
  { key: 'work.heading', label: 'Selected Work heading', page: 'home' },
  { key: 'work.note', label: 'Selected Work note', page: 'home', lines: 2 },

  // ---- the waitlist
  { key: 'wl.eyebrow', label: 'Waitlist eyebrow', page: 'home' },
  { key: 'wl.title', label: 'Waitlist heading', page: 'home' },
  { key: 'wl.lede', label: 'Waitlist intro', page: 'home', lines: 3 },
  { key: 'wl.name', label: 'Name field', page: 'home' },
  { key: 'wl.email', label: 'Email field', page: 'home' },
  { key: 'wl.venture', label: 'Venture field', page: 'home' },
  { key: 'wl.idea', label: 'Idea field', page: 'home' },
  { key: 'wl.inspiration', label: 'Inspiration field', page: 'home' },
  { key: 'wl.budget', label: 'Budget field', page: 'home' },
  { key: 'wl.timeline', label: 'Timeline field', page: 'home' },
  { key: 'wl.submit', label: 'Submit button', page: 'home' },
  { key: 'wl.note', label: 'Note under the button', page: 'home' },

  // ---- the Pen page
  { key: 'pen.eyebrow', label: 'Eyebrow', page: 'pen' },
  { key: 'pen.title', label: 'Heading', page: 'pen', lines: 2 },
  { key: 'pen.lede', label: 'Opening paragraph', page: 'pen', lines: 5 },
  { key: 'pen.body', label: 'The rest', page: 'pen', lines: 10,
    hint: 'A blank line starts a new paragraph.' },
];

const SITE = 'https://pentinian-site.vercel.app';

export default function HomePage() {
  const [content, setContent] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [page, setPage] = useState<'home' | 'pen'>('home');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [nudge, setNudge] = useState(0);

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
          {fields.map((f) => {
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
