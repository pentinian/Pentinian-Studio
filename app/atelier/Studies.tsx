'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/* The case study desk.
 *
 * A study is two things: the words on its page, and whether it is out. Both live in
 * the site_config row the home page already uses, so one record stands behind the
 * whole public site rather than two that can disagree.
 *
 * The words are keyed exactly as the page reads them, cs.<slug>.<field>, so what is
 * typed here and what the study shows are the same string with nothing in between.
 * The instruments each study carries, the map, the palette, the desk previews, are
 * not editable and are not meant to be. They are drawings, not copy.
 *
 * Release is a separate press from save on purpose. Saving a sentence on a study that
 * is still in review must never be the thing that publishes it.
 */

type Study = { slug: string; file: string; name: string };

const STUDIES: Study[] = [
  { slug: 'artinian', file: 'artinian.html', name: 'Artinian' },
  { slug: 'caveman', file: 'caveman.html', name: 'Caveman' },
  { slug: 'limicon', file: 'limicon.html', name: 'LimIcon' },
  { slug: 'unimpact', file: 'unimpact.html', name: 'UnImpact' },
  { slug: 'pentinian', file: 'colophon.html', name: 'Pentinian' },
];

const SITE = 'https://pentinian.com';

type Field = { key: string; label: string; lines?: number; hint?: string; group: string };

/* The eight sections every study runs through, in the order the page runs them. The
 * kicker is the small line above the heading; the paragraph is the one each section
 * opens with, which is the piece carrying the argument. */
const SECTIONS = [
  'The situation', 'What was built', 'Under the hood', 'The design system',
  'How it runs differently', 'Economics', 'In the world', 'Honest edges',
];

function fieldsFor(slug: string): Field[] {
  const f: Field[] = [
    { key: `cs.${slug}.title`, label: 'Title', lines: 2, group: 'The opening',
      hint: 'Two lines. The second renders lighter.' },
    { key: `cs.${slug}.dek`, label: 'Opening paragraph', lines: 5, group: 'The opening' },
  ];
  for (let i = 1; i <= 4; i++) {
    f.push({ key: `cs.${slug}.n${i}`, label: `Figure ${i}`, group: 'The four figures' });
    f.push({ key: `cs.${slug}.l${i}`, label: 'What it counts', group: 'The four figures' });
  }
  SECTIONS.forEach((name, i) => {
    const n = i + 1;
    f.push({ key: `cs.${slug}.k${n}`, label: 'Kicker', group: `${n}. ${name}` });
    f.push({ key: `cs.${slug}.h${n}`, label: 'Heading', group: `${n}. ${name}` });
    f.push({ key: `cs.${slug}.p${n}`, label: 'The paragraph', lines: 6, group: `${n}. ${name}` });
  });
  return f;
}

export default function Studies() {
  const [slug, setSlug] = useState(STUDIES[0].slug);
  const [content, setContent] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [released, setReleased] = useState<Record<string, boolean>>({});
  const [openGroup, setOpenGroup] = useState<string | null>('The opening');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from('site_config').select('config').eq('id', 1).single();
    const c = (data?.config?.content ?? {}) as Record<string, string>;
    const cs = (data?.config?.case_studies ?? {}) as Record<string, { released?: boolean }>;
    setContent(c);
    setSaved(c);
    setReleased(Object.fromEntries(STUDIES.map((s) => [s.slug, cs[s.slug]?.released === true])));
  }, []);

  useEffect(() => { load(); }, [load]);

  const fields = useMemo(() => fieldsFor(slug), [slug]);
  const dirty = fields.some((f) => (content[f.key] ?? '') !== (saved[f.key] ?? ''));
  const groups = useMemo(
    () => Array.from(
      fields.reduce((m, f) => (m.set(f.group, [...(m.get(f.group) ?? []), f]), m), new Map<string, Field[]>())
    ),
    [fields]
  );
  const study = STUDIES.find((s) => s.slug === slug)!;
  const isOut = released[slug] === true;

  /* Read, merge, write. The home page's words and the calibration switches live in this
     same row, so writing the whole config from here would quietly reset them. */
  async function writeConfig(mut: (cfg: Record<string, unknown>) => Record<string, unknown>) {
    const supabase = createClient();
    const { data } = await supabase.from('site_config').select('config').eq('id', 1).single();
    const next = mut({ ...(data?.config ?? {}) });
    const { error } = await supabase
      .from('site_config')
      .update({ config: next, updated_at: new Date().toISOString() })
      .eq('id', 1);
    return error?.message ?? null;
  }

  async function save() {
    setBusy(true); setMsg('');
    const err = await writeConfig((cfg) => ({ ...cfg, content }));
    setBusy(false);
    if (err) return setMsg(`Could not save: ${err}`);
    setSaved(content);
    setMsg(
      isOut
        ? 'Saved. It is out, so the live study picks this up within a minute, since the config is cached at the edge.'
        : 'Saved. Still in review, so only you can see it.'
    );
  }

  async function setOut(next: boolean) {
    if (next && dirty && !window.confirm('There are unsaved words. Release anyway?')) return;
    setBusy(true); setMsg('');
    const err = await writeConfig((cfg) => ({
      ...cfg,
      case_studies: { ...((cfg.case_studies as object) ?? {}), [slug]: { released: next } },
    }));
    setBusy(false);
    if (err) return setMsg(`Could not change that: ${err}`);
    setReleased((r) => ({ ...r, [slug]: next }));
    setMsg(
      next
        ? 'Out. The row on the home page becomes a real link within a minute.'
        : 'Pulled back. The row reads private again and the link goes away.'
    );
  }

  return (
    <div className="hp">
      <div className="hp-head">
        {/* The dot on each name says whether that study is out, so the state of all
            five is readable before opening any of them. */}
        <div className="hp-pages">
          {STUDIES.map((s) => (
            <button
              key={s.slug}
              className={'cd-face' + (s.slug === slug ? ' on' : '')}
              onClick={() => { setSlug(s.slug); setOpenGroup('The opening'); setMsg(''); }}
            >
              <i className={'cs-dot ' + (released[s.slug] ? 'out' : 'in')} />
              {s.name}
            </button>
          ))}
        </div>

        <a className="hp-open" href={`${SITE}/${study.file}`} target="_blank" rel="noopener">
          Read it ↗
        </a>

        <div className="hp-save">
          {dirty && <button className="mini-btn" onClick={() => setContent(saved)}>Discard</button>}
          <button className="mini-btn pri" onClick={save} disabled={busy || !dirty}>
            {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      <div className={'cs-state ' + (isOut ? 'out' : 'in')}>
        <b>{isOut ? 'Released' : 'Private, in review'}</b>
        <span>
          {isOut
            ? 'Anyone can open this from Selected Work.'
            : 'The row reads private, in review. Signed in, you can still preview it.'}
        </span>
        <button className="mini-btn" disabled={busy} onClick={() => setOut(!isOut)}>
          {isOut ? 'Pull it back' : 'Release it'}
        </button>
      </div>

      {msg && <p className="cur-msg">{msg}</p>}

      {/* No live preview column here, unlike the home page. A study is long enough that a
          thumbnail of it says nothing; Read it opens the real page instead. */}
      <div className="hp-fields cs-fields">
        {groups.map(([name, gf]) => {
          const on = openGroup === name;
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
          An empty field is not an empty page. Anything left blank keeps whatever the
          study was built with, so one paragraph can change without retyping a study.
          The drawings each study carries are not editable here on purpose.
        </p>
      </div>
    </div>
  );
}
