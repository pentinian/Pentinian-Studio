'use client';

import { useMemo, useState } from 'react';

// The kit: a project's brain rendered as a brand book in three strata.
//
//   BRANDING       the surface. What the brand is: the main colors, the
//                  faces, the voice, the inspiration, the assets.
//   BUILD          branding plus the fine detail: sub color steps, measures
//                  and motion, components, technical rules. Standardized
//                  bits pulled from during building. Retired closes it,
//                  loud, because it exists to warn builders.
//   DOCUMENTATION  the coding methodology referenced during building, and
//                  the document index. Separate from branding, linked where
//                  it makes sense.
//
// The strata are distinct on purpose and interlinked on purpose: a branding
// color names its build steps, a build step names its branding parent, a
// technical rule points into the methodology.
//
// One shared renderer. The Atelier mounts it over everything internal; in
// Phase C the Window mounts the same component over released entries only.

export type Entry = {
  id: string;
  slug: string;
  type: 'worklog' | 'doc' | 'file' | 'shot' | 'brand' | 'inspiration';
  source: string;
  title: string;
  body: string | null;
  payload: any;
  asset_path: string | null;
  provenance: string;
  entry_key: string;
  visibility: 'internal' | 'staged' | 'released';
  released_at: string | null;
  created: string;
};

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s,.%/]*\)|hsla?\([\d\s,.%deg/]*\))$/;

function isColorValue(v: unknown): boolean {
  return COLOR_RE.test(String(v ?? '').trim());
}

function isTypeToken(name: string, value: unknown, purpose: string): boolean {
  const v = String(value ?? '').trim();
  if (/[<>()]|cubic-bezier|url\(|data:/i.test(v)) return false;
  if (/font|face|serif|sans|mono|typeface/i.test(name + ' ' + purpose) && !/\d/.test(v)) return true;
  return v.includes(',') && /^[a-zA-Z'" ,-]+$/.test(v);
}

/** Branding or build, for a token. Steps (-06, -12, -2) and system prefixes
 *  are build vocabulary; plainly named colors are the brand itself. */
export function tokenTier(name: string): 'branding' | 'build' {
  if (/-\d+$/.test(name)) return 'build';
  if (/^--(cgs-|core-|a\d-|mo-)/.test(name)) return 'build';
  return 'branding';
}

/** Voice or build, for a rule. A rule that cites files, selectors or pixels
 *  is builder's law; the rest is how the brand speaks. */
export function ruleTier(text: string): 'branding' | 'build' {
  return /\.css|\.mjs|\.tsx|\.ts\b|:\d+|\bpx\b|selector|getBounding|scroll|smoke|min-height|--[a-z]/i.test(
    text
  )
    ? 'build'
    : 'branding';
}

function ruleText(e: Entry): string {
  const r = e.payload.rule;
  return String(
    typeof r === 'string' ? r : (e.payload.text ?? r?.text ?? r?.statement ?? e.payload.key ?? e.title)
  );
}

/** The stem a step belongs to: --gold-08 stems from --gold. */
function stemOf(name: string): string | null {
  const m = name.match(/^(.*)-\d+$/);
  return m ? m[1] : null;
}

function measureBar(v: string): number | null {
  const m = v.trim().match(/^(\d+(?:\.\d+)?)px$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n > 0 && n <= 240 ? n : null;
}

export type Standing = 'internal' | 'staged' | 'released';
export type PressFn = (id: string, to: Standing) => void | Promise<void>;

/** Standing, and in the Atelier, the press. The Window mounts this kit with
 *  no press function, so its read only nature is structural, not styled. */
function VisTag({ e, onPress }: { e: Entry; onPress?: PressFn }) {
  const chip =
    e.visibility === 'internal' ? 'tag' : e.visibility === 'released' ? 'tag sage' : 'tag clay';
  if (!onPress) {
    if (e.visibility === 'internal') return null;
    return <span className={chip}>{e.visibility}</span>;
  }
  const acts: [string, Standing][] =
    e.visibility === 'internal'
      ? [
          ['stage', 'staged'],
          ['release', 'released'],
        ]
      : e.visibility === 'staged'
        ? [
            ['release', 'released'],
            ['unstage', 'internal'],
          ]
        : [['pull back', 'staged']];
  return (
    <span className="kit-press">
      <span className={chip}>{e.visibility}</span>
      {acts.map(([label, to]) => (
        <button key={to} className="kit-press-b" onClick={() => onPress(e.id, to)}>
          {label}
        </button>
      ))}
    </span>
  );
}

const bySortThenName = (a: Entry, z: Entry) => {
  const s = (a.payload?.sort ?? 0) - (z.payload?.sort ?? 0);
  if (s !== 0) return s;
  return String(a.payload?.name ?? a.title).localeCompare(String(z.payload?.name ?? z.title));
};

/** Branding presents color grouped by VALUE: the brand has a handful of real
 *  colors wearing many name tags, so each color renders once, value led, with
 *  its token names as chips beneath. Legacy aliases collapse instead of
 *  multiplying, and a near paper value stays visible inside its hairline. */
function Palette({
  list,
  stems,
  onPress,
}: {
  list: Entry[];
  stems: Map<string, number>;
  onPress?: PressFn;
}) {
  const groups = new Map<string, Entry[]>();
  for (const e of list) {
    const v = String(e.payload?.value ?? '').trim().toLowerCase();
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v)!.push(e);
  }

  const role = (members: Entry[]): string => {
    const curated = members.find((m) => m.payload?.console);
    const text = String((curated ?? members[0]).payload?.purpose ?? '');
    if (!text) return '';
    const sentences = text.split(/\.\s+/).filter(Boolean);
    const pick = curated ? sentences[0] : sentences[sentences.length - 1];
    return (pick ?? '').replace(/\.?$/, '.').trim();
  };

  // A color's name. Curated entries carry theirs (the console row's title);
  // legacy groups usually SAY their name inside the role prose ("the text is
  // ink", "becomes Artinian garnet"), so the card reads it out. When neither
  // speaks, the value leads alone, which is honest.
  const displayName = (members: Entry[]): string | null => {
    const curated = members.find((m) => m.payload?.console);
    if (curated) return String(curated.payload?.name ?? '') || null;
    for (const m of members) {
      const p = String(m.payload?.purpose ?? '');
      const hit = p.match(/(?:is|becomes|stays)\s+(?:the\s+|an?\s+)?([a-z][a-z -]{2,30}?)[.;,]/i);
      if (hit) {
        const words = hit[1].trim().split(/\s+/);
        const last = words[words.length - 1];
        return last.charAt(0).toUpperCase() + last.slice(1);
      }
    }
    return null;
  };

  // Ratified colors carry their order; a group's seat is its lowest sort.
  // Unratified projects have no sorts, so their groups fall back to value
  // order, which is stable and honest.
  const seat = (members: Entry[]) =>
    Math.min(...members.map((m) => (typeof m.payload?.sort === 'number' ? m.payload.sort : Infinity)));
  const cards = [...groups.entries()].sort((a, z) => {
    const sa = seat(a[1]);
    const sz = seat(z[1]);
    if (sa !== sz) return sa < sz ? -1 : 1;
    return a[0].localeCompare(z[0]);
  });

  return (
    <div className="kit-palette">
      {cards.map(([value, members]) => {
        const name = displayName(members);
        // The card's own name is not an alias of itself.
        const names = members
          .map((m) => String(m.payload?.name ?? ''))
          .filter((n) => n && n !== name)
          .sort();
        const steps = names.reduce((n, alias) => n + (stems.get(alias) ?? 0), 0);
        // The press target is the ratified row when one exists; pressing a
        // palette card presses the decision, not an alias.
        const pressTarget = members.find((m) => m.payload?.console) ?? members[0];
        return (
          <figure key={value} className="kit-pcard">
            <i style={{ background: value }} />
            <figcaption>
              <div className="kit-pcard-head">
                {name ? <strong className="kit-pcard-n">{name}</strong> : null}
                <code className="kit-pcard-v">{String(members[0].payload?.value ?? '')}</code>
              </div>
              <VisTag onPress={onPress} e={pressTarget} />
              {role(members) ? <p className="kit-pcard-role">{role(members)}</p> : null}
              <div className="kit-alias">
                {names.map((n) => (
                  <code key={n}>{n}</code>
                ))}
                {steps > 0 ? (
                  <a className="kit-x" href="#kit-buildcolor">
                    {steps} build step{steps === 1 ? '' : 's'}
                  </a>
                ) : null}
              </div>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function Swatches({
  list,
  dense,
  stems,
  onPress,
}: {
  list: Entry[];
  dense?: boolean;
  stems?: Map<string, number>;
  onPress?: PressFn;
}) {
  return (
    <div className={'kit-colors' + (dense ? ' build' : '')}>
      {list.map((e) => {
        const name = String(e.payload.name ?? '');
        const steps = stems?.get(name) ?? 0;
        const stem = dense ? stemOf(name) : null;
        return (
          <figure key={e.id} className="kit-sw">
            {isColorValue(e.payload.value) ? (
              <i style={{ background: String(e.payload.value).trim() }} />
            ) : (
              <i className="kit-sw-none" />
            )}
            <figcaption>
              <code>{name}</code>
              <code className="kit-sw-v">{String(e.payload.value ?? '')}</code>
              {e.payload.purpose ? <p>{String(e.payload.purpose).slice(0, 160)}</p> : null}
              {steps > 0 ? (
                <a className="kit-x" href="#kit-buildcolor">
                  {steps} build step{steps === 1 ? '' : 's'}
                </a>
              ) : null}
              {stem ? (
                <a className="kit-x" href="#kit-color">
                  step of {stem}
                </a>
              ) : null}
              <VisTag onPress={onPress} e={e} />
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

export default function Kit({
  entries,
  projectName,
  lane,
  onPress,
}: {
  entries: Entry[];
  projectName: string;
  lane: string | null;
  /** The Atelier passes the press; the Window never does. */
  onPress?: PressFn;
}) {
  const [allWork, setAllWork] = useState(false);

  const b = useMemo(() => {
    const brand = entries.filter((e) => e.type === 'brand');
    const tokens = brand.filter((e) => e.payload?.kind === 'token');
    const colorTokens = tokens.filter((e) => isColorValue(e.payload?.value));
    const faceTokens = tokens.filter(
      (e) =>
        !colorTokens.includes(e) &&
        isTypeToken(String(e.payload?.name ?? ''), e.payload?.value, String(e.payload?.purpose ?? ''))
    );
    const otherTokens = tokens.filter((e) => !colorTokens.includes(e) && !faceTokens.includes(e));

    // Membership in the Branding palette is ratification, when ratification
    // exists: curated console colors define the set and its order, canon
    // values matching a ratified value ride along as aliases, and canon
    // values nobody ratified (the deep garnet) fall to Build. A project with
    // no ratified rows falls back to the tier heuristic so its book is never
    // empty.
    const curatedColors = colorTokens.filter((e) => e.payload?.console);
    const canonBranding = colorTokens.filter(
      (e) => !e.payload?.console && tokenTier(String(e.payload?.name ?? '')) === 'branding'
    );
    const canonBuild = colorTokens.filter(
      (e) => !e.payload?.console && tokenTier(String(e.payload?.name ?? '')) === 'build'
    );
    let brandColors: Entry[];
    let buildColors: Entry[];
    if (curatedColors.length > 0) {
      const ratified = new Set(
        curatedColors.map((e) => String(e.payload?.value ?? '').trim().toLowerCase())
      );
      const matching = canonBranding.filter((e) =>
        ratified.has(String(e.payload?.value ?? '').trim().toLowerCase())
      );
      const fallen = canonBranding.filter((e) => !matching.includes(e));
      brandColors = [...curatedColors, ...matching];
      buildColors = [...canonBuild, ...fallen];
    } else {
      brandColors = canonBranding;
      buildColors = canonBuild;
    }
    const faces = [...faceTokens, ...brand.filter((e) => e.payload?.kind === 'face')];

    const rules = brand.filter((e) => e.payload?.kind === 'rule');
    const allVoiceRules = rules.filter((e) => ruleTier(ruleText(e)) === 'branding');
    const buildRules = rules.filter((e) => ruleTier(ruleText(e)) === 'build');

    // The language guide's anatomy. Tone and lexicon arrive ratified through
    // the console; principles are ratified rules; and once any part of a
    // guide exists, unratified rules fall to the Rulings appendix, the case
    // law beneath the law. A lane with no guide yet keeps its flat list.
    const voiceTone = brand.filter((e) => e.payload?.kind === 'voice-tone').sort(bySortThenName);
    const lexicon = brand.filter((e) => e.payload?.kind === 'voice-lexicon').sort(bySortThenName);
    const curatedPrinciples = allVoiceRules.filter((e) => e.payload?.console).sort(bySortThenName);
    const guideExists = voiceTone.length > 0 || lexicon.length > 0 || curatedPrinciples.length > 0;
    const voiceRules = guideExists ? curatedPrinciples : allVoiceRules;
    const rulings = guideExists ? allVoiceRules.filter((e) => !e.payload?.console) : [];

    for (const l of [brandColors, buildColors, faces, voiceRules, buildRules, rulings]) l.sort(bySortThenName);

    // Interlink counts: branding stem -> number of build steps beneath it.
    const stems = new Map<string, number>();
    for (const e of buildColors) {
      const stem = stemOf(String(e.payload?.name ?? ''));
      if (stem) stems.set(stem, (stems.get(stem) ?? 0) + 1);
    }

    return {
      brandColors,
      buildColors,
      faces,
      voiceTone,
      lexicon,
      voiceRules,
      rulings,
      buildRules,
      stems,
      inspiration: entries.filter((e) => e.type === 'inspiration').sort(bySortThenName),
      assets: entries.filter((e) => e.type === 'file' || e.type === 'shot').sort(bySortThenName),
      measures: otherTokens.sort(bySortThenName),
      specimens: brand.filter((e) => e.payload?.kind === 'specimen'),
      retired: brand.filter((e) => e.payload?.kind === 'retired'),
      profile: brand.filter((e) => e.payload?.kind === 'profile'),
      docs: entries.filter((e) => e.type === 'doc'),
      work: entries.filter((e) => e.type === 'worklog').sort((a, z) => (a.created < z.created ? 1 : -1)),
    };
  }, [entries]);

  const generated =
    entries.find((e) => e.source === 'hekate')?.provenance.match(/generated ([0-9T:.Z-]+)/)?.[1] ??
    null;

  const parts: { name: string; sub: string; chapters: { id: string; name: string; count: number }[] }[] = [
    {
      name: 'Branding',
      sub: 'The surface. What the brand is.',
      chapters: [
        { id: 'color', name: 'Color', count: b.brandColors.length },
        { id: 'type', name: 'Type', count: b.faces.length },
        {
          id: 'voice',
          name: 'Voice',
          count: b.voiceTone.length + b.lexicon.length + b.voiceRules.length + b.rulings.length,
        },
        { id: 'inspiration', name: 'Inspiration', count: b.inspiration.length },
        { id: 'assets', name: 'Assets', count: b.assets.length },
      ],
    },
    {
      name: 'Build',
      sub: 'Branding plus the fine detail: standardized bits pulled from during building.',
      chapters: [
        { id: 'buildcolor', name: 'Color Steps', count: b.buildColors.length },
        { id: 'measures', name: 'Measures and Motion', count: b.measures.length },
        { id: 'components', name: 'Components', count: b.specimens.length },
        { id: 'buildrules', name: 'Build Rules', count: b.buildRules.length },
        { id: 'retired', name: 'Retired', count: b.retired.length },
      ],
    },
    {
      name: 'Documentation',
      sub: 'The coding methodology referenced during building.',
      chapters: [
        { id: 'method', name: 'Methodology', count: b.profile.length },
        { id: 'documents', name: 'Documents', count: b.docs.length },
      ],
    },
  ];

  const shownWork = allWork ? b.work : b.work.slice(0, 8);

  return (
    <div className="kit">
      {/* ---- title page ---- */}
      <header className="kit-id">
        <h1>{projectName}</h1>
        <p className="kit-id-sub">
          {lane ? <>The {lane} lane. </> : null}
          {entries.length} entries in the brain
          {generated ? <>, canon generated {generated}</> : null}.
        </p>
        <p className="brain-truth">
          Brand truth lives at the source on the studio Mac; this book is its projection. Edit at
          the source and sync. Work and console entries fold in beside it.
        </p>
        <nav className="kit-rail" aria-label="Chapters">
          {parts.map((p) => {
            const live = p.chapters.filter((c) => c.count > 0);
            if (!live.length) return null;
            return (
              <span key={p.name} className="kit-rail-part">
                <b>{p.name}</b>
                {live.map((c) => (
                  <a key={c.id} href={'#kit-' + c.id}>
                    {c.name} <span>{c.count}</span>
                  </a>
                ))}
              </span>
            );
          })}
          {b.work.length > 0 && (
            <span className="kit-rail-part">
              <b>Record</b>
              <a href="#kit-work">
                Work <span>{b.work.length}</span>
              </a>
            </span>
          )}
        </nav>
      </header>

      {/* ================================================== BRANDING ==== */}
      {(b.brandColors.length || b.faces.length || b.voiceTone.length || b.lexicon.length || b.voiceRules.length || b.rulings.length || b.inspiration.length || b.assets.length) > 0 && (
        <div className="kit-part">
          <h2 className="kit-part-h">Branding</h2>
          <p className="kit-part-sub">The surface. What the brand is.</p>

          {b.brandColors.length > 0 && (
            <section className="kit-ch" id="kit-color">
              <h2>Color</h2>
              <Palette list={b.brandColors} stems={b.stems} onPress={onPress} />
            </section>
          )}

          {b.faces.length > 0 && (
            <section className="kit-ch" id="kit-type">
              <h2>Type</h2>
              {b.faces.map((e) => {
                const stack = String(e.payload.stack ?? e.payload.value ?? '');
                const styled = stack.includes(',') || /^[a-zA-Z'" -]+$/.test(stack);
                return (
                  <div key={e.id} className="kit-face">
                    <p className="kit-face-sample" style={styled && stack ? { fontFamily: stack } : undefined}>
                      The quick brown fox jumps over the lazy dog, 0123456789
                    </p>
                    <div className="kit-face-meta">
                      <code>{String(e.payload.name ?? '')}</code>
                      {stack ? <code className="kit-sw-v">{stack}</code> : null}
                      {e.payload.purpose || e.payload.note ? (
                        <p>{String(e.payload.purpose ?? e.payload.note).slice(0, 160)}</p>
                      ) : null}
                      {e.payload.url ? (
                        <a className="kit-x" href={e.payload.url} target="_blank" rel="noreferrer">
                          source
                        </a>
                      ) : null}
                      <VisTag onPress={onPress} e={e} />
                    </div>
                  </div>
                );
              })}
              <p className="kit-note">
                Samples set in each face&apos;s own stack; where a face is not installed here the
                browser falls back down the stack rather than faking it.
              </p>
            </section>
          )}

          {(b.voiceTone.length || b.lexicon.length || b.voiceRules.length || b.rulings.length) > 0 && (
            <section className="kit-ch" id="kit-voice">
              <h2>Voice</h2>

              {/* The register: what the brand sounds like, before any rule. */}
              {b.voiceTone.length > 0 && (
                <div className="kit-tone">
                  {b.voiceTone.map((e) => (
                    <div key={e.id} className="kit-tone-card">
                      <strong>{String(e.payload.name ?? e.title)}</strong>
                      {e.payload.note ? <p>{String(e.payload.note)}</p> : null}
                      <VisTag onPress={onPress} e={e} />
                    </div>
                  ))}
                </div>
              )}

              {/* Terminology law: say this, never that, because. */}
              {b.lexicon.length > 0 && (
                <table className="kit-lex">
                  <thead>
                    <tr>
                      <th>Say</th>
                      <th>Never</th>
                      <th>Because</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.lexicon.map((e) => (
                      <tr key={e.id}>
                        <td className="kit-lex-say">{String(e.payload.say ?? '')}</td>
                        <td className="kit-lex-never">{String(e.payload.never ?? '')}</td>
                        <td>{String(e.payload.why ?? '')}</td>
                        <td>
                          <VisTag onPress={onPress} e={e} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Phrasing law: the principles. */}
              {b.voiceRules.length > 0 && (
                <ol className="kit-rules">
                  {b.voiceRules.map((e) => {
                    const why =
                      typeof e.payload.rule === 'object' && e.payload.rule?.why
                        ? String(e.payload.rule.why)
                        : null;
                    return (
                      <li key={e.id}>
                        <p className="kit-rule-line">
                          {ruleText(e)} <VisTag onPress={onPress} e={e} />
                        </p>
                        {why ? <p className="kit-rule-why">{why}</p> : null}
                      </li>
                    );
                  })}
                </ol>
              )}

              {/* Case law: rulings made on real occasions, beneath the guide. */}
              {b.rulings.length > 0 && (
                <details className="kit-fold kit-rulings">
                  <summary>
                    Rulings, {b.rulings.length}. Case law from real occasions; the guide above
                    governs, these record.
                  </summary>
                  <ul>
                    {b.rulings.map((e) => {
                      const why =
                        typeof e.payload.rule === 'object' && e.payload.rule?.why
                          ? String(e.payload.rule.why)
                          : null;
                      return (
                        <li key={e.id}>
                          {ruleText(e)}
                          {why ? <span className="kit-rule-why"> {why}</span> : null}{' '}
                          <VisTag onPress={onPress} e={e} />
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </section>
          )}

          {b.inspiration.length > 0 && (
            <section className="kit-ch" id="kit-inspiration">
              <h2>Inspiration</h2>
              <div className="kit-specs">
                {b.inspiration.map((e) => (
                  <div key={e.id} className="qcard kit-spec">
                    <div className="kit-spec-head">
                      <strong>{String(e.payload.name ?? e.title)}</strong>
                      <VisTag onPress={onPress} e={e} />
                    </div>
                    {e.payload.note ? <p className="kit-spec-purpose">{String(e.payload.note)}</p> : null}
                    {e.payload.url ? (
                      <a className="kit-x" href={e.payload.url} target="_blank" rel="noreferrer">
                        visit
                      </a>
                    ) : null}
                    {e.asset_path ? <p className="kit-note">Attached image in the shots bucket.</p> : null}
                  </div>
                ))}
              </div>
            </section>
          )}

          {b.assets.length > 0 && (
            <section className="kit-ch" id="kit-assets">
              <h2>Assets</h2>
              <table className="kit-docs">
                <tbody>
                  {b.assets.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <code>{String(e.payload?.name ?? e.title)}</code>
                      </td>
                      <td>{e.payload?.note ? String(e.payload.note).slice(0, 120) : ''}</td>
                      <td>
                        {e.payload?.url ? (
                          <a className="kit-x" href={e.payload.url} target="_blank" rel="noreferrer">
                            link
                          </a>
                        ) : null}
                        {e.asset_path ? <span className="kit-note"> file attached</span> : null}
                      </td>
                      <td>
                        <VisTag onPress={onPress} e={e} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}

      {/* ===================================================== BUILD ==== */}
      {(b.buildColors.length || b.measures.length || b.specimens.length || b.buildRules.length || b.retired.length) > 0 && (
        <div className="kit-part">
          <h2 className="kit-part-h">Build</h2>
          <p className="kit-part-sub">
            Branding plus the fine detail: standardized bits pulled from during building.
          </p>

          {b.buildColors.length > 0 && (
            <section className="kit-ch" id="kit-buildcolor">
              <h2>Color Steps</h2>
              <Swatches list={b.buildColors} dense onPress={onPress} />
            </section>
          )}

          {b.measures.length > 0 && (
            <section className="kit-ch" id="kit-measures">
              <h2>Measures and Motion</h2>
              <table className="kit-measures">
                <tbody>
                  {b.measures.map((e) => {
                    const v = String(e.payload.value ?? '');
                    const w = measureBar(v);
                    return (
                      <tr key={e.id}>
                        <td>
                          <code>{String(e.payload.name ?? '')}</code>
                        </td>
                        <td>
                          <code className="kit-sw-v">{v}</code>
                        </td>
                        <td className="kit-measure-cell">
                          {w !== null ? <i className="kit-measure-bar" style={{ width: w }} /> : null}
                        </td>
                        <td>{String(e.payload.purpose ?? '').slice(0, 120)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {b.specimens.length > 0 && (
            <section className="kit-ch" id="kit-components">
              <h2>Components</h2>
              <div className="kit-specs">
                {b.specimens.map((e) => (
                  <div key={e.id} className="qcard kit-spec">
                    <div className="kit-spec-head">
                      <strong>{String(e.payload.name ?? e.title)}</strong>
                      {e.payload.specimen_kind ? (
                        <span className="tag">{String(e.payload.specimen_kind)}</span>
                      ) : null}
                    </div>
                    {e.payload.purpose ? <p className="kit-spec-purpose">{String(e.payload.purpose)}</p> : null}
                    {Array.isArray(e.payload.constraints) && e.payload.constraints.length > 0 ? (
                      <ul>
                        {e.payload.constraints.map((c: unknown, i: number) => (
                          <li key={i}>{String(c)}</li>
                        ))}
                      </ul>
                    ) : null}
                    {e.payload.adapt ? (
                      <p className="kit-note">Varies per use: {String(e.payload.adapt)}</p>
                    ) : null}
                    {Array.isArray(e.payload.states) || Array.isArray(e.payload.variants) ? (
                      <p className="kit-note">
                        {Array.isArray(e.payload.states) ? `${e.payload.states.length} states` : ''}
                        {Array.isArray(e.payload.states) && Array.isArray(e.payload.variants) ? ' · ' : ''}
                        {Array.isArray(e.payload.variants) ? `${e.payload.variants.length} variants` : ''}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          )}

          {b.buildRules.length > 0 && (
            <section className="kit-ch" id="kit-buildrules">
              <h2>Build Rules</h2>
              <ol className="kit-rules">
                {b.buildRules.map((e) => {
                  const why =
                    typeof e.payload.rule === 'object' && e.payload.rule?.why
                      ? String(e.payload.rule.why)
                      : null;
                  return (
                    <li key={e.id}>
                      <p className="kit-rule-line">{ruleText(e)}</p>
                      {why ? <p className="kit-rule-why">{why}</p> : null}
                    </li>
                  );
                })}
              </ol>
              <p className="kit-note">
                Builder&apos;s law, not voice. The wider methodology sits in{' '}
                <a className="kit-x" href="#kit-method">
                  Documentation
                </a>
                .
              </p>
            </section>
          )}

          {b.retired.length > 0 && (
            <section className="kit-ch brand-retired" id="kit-retired">
              <h3>Retired. Never use these.</h3>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Dead value</th>
                    <th>Replaced by</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {b.retired.map((e) => (
                    <tr key={e.id}>
                      <td>{String(e.payload.name ?? '')}</td>
                      <td>
                        <code>{String(e.payload.value ?? '')}</code>
                      </td>
                      <td>
                        <code>{String(e.payload.replaced_by ?? 'unrecorded')}</code>
                      </td>
                      <td>{String(e.payload.why ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}

      {/* ============================================= DOCUMENTATION ==== */}
      {(b.profile.length || b.docs.length) > 0 && (
        <div className="kit-part">
          <h2 className="kit-part-h">Documentation</h2>
          <p className="kit-part-sub">The coding methodology referenced during building.</p>

          {b.profile.length > 0 && (
            <section className="kit-ch" id="kit-method">
              <h2>Methodology</h2>
              {b.profile.map((e) => (
                <details key={e.id} className="kit-fold">
                  <summary>{String(e.payload.section ?? e.title)}</summary>
                  <pre className="brain-pre">
                    {typeof e.payload.value === 'string'
                      ? e.payload.value
                      : JSON.stringify(e.payload.value, null, 1)}
                  </pre>
                </details>
              ))}
            </section>
          )}

          {b.docs.length > 0 && (
            <section className="kit-ch" id="kit-documents">
              <h2>Documents</h2>
              <table className="kit-docs">
                <tbody>
                  {b.docs.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <code>{e.title}</code>
                      </td>
                      <td>{e.payload?.bytes ? `${e.payload.bytes} bytes` : ''}</td>
                      <td>
                        <VisTag onPress={onPress} e={e} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="kit-note">Files live with the stores; these rows are their index.</p>
            </section>
          )}
        </div>
      )}

      {/* ---- the work record, its own quiet part ---- */}
      {b.work.length > 0 && (
        <div className="kit-part">
          <h2 className="kit-part-h">Record</h2>
          <section className="kit-ch" id="kit-work">
            <h2>Work Record</h2>
            <div className="kit-work">
              {shownWork.map((e) => (
                <div key={e.id} className="kit-work-row">
                  <time>{new Date(e.created).toLocaleDateString()}</time>
                  <span className="kit-work-title">{e.title}</span>
                  <VisTag onPress={onPress} e={e} />
                </div>
              ))}
            </div>
            {b.work.length > 8 && (
              <button className="mini-btn" onClick={() => setAllWork((v) => !v)}>
                {allWork ? 'Show recent only' : `Show all ${b.work.length}`}
              </button>
            )}
            <p className="kit-note">Build remains the working surface; this is the record.</p>
          </section>
        </div>
      )}
    </div>
  );
}
