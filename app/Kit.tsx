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

function VisTag({ e }: { e: Entry }) {
  if (e.visibility === 'internal') return null;
  return (
    <span className={'tag ' + (e.visibility === 'released' ? 'sage' : 'clay')}>{e.visibility}</span>
  );
}

const bySortThenName = (a: Entry, z: Entry) => {
  const s = (a.payload?.sort ?? 0) - (z.payload?.sort ?? 0);
  if (s !== 0) return s;
  return String(a.payload?.name ?? a.title).localeCompare(String(z.payload?.name ?? z.title));
};

function Swatches({ list, dense, stems }: { list: Entry[]; dense?: boolean; stems?: Map<string, number> }) {
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
              <VisTag e={e} />
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
}: {
  entries: Entry[];
  projectName: string;
  lane: string | null;
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

    const brandColors = colorTokens.filter((e) => tokenTier(String(e.payload?.name ?? '')) === 'branding');
    const buildColors = colorTokens.filter((e) => tokenTier(String(e.payload?.name ?? '')) === 'build');
    const faces = [...faceTokens, ...brand.filter((e) => e.payload?.kind === 'face')];

    const rules = brand.filter((e) => e.payload?.kind === 'rule');
    const voiceRules = rules.filter((e) => ruleTier(ruleText(e)) === 'branding');
    const buildRules = rules.filter((e) => ruleTier(ruleText(e)) === 'build');

    for (const l of [brandColors, buildColors, faces, voiceRules, buildRules]) l.sort(bySortThenName);

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
      voiceRules,
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
        { id: 'voice', name: 'Voice', count: b.voiceRules.length },
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
      {(b.brandColors.length || b.faces.length || b.voiceRules.length || b.inspiration.length || b.assets.length) > 0 && (
        <div className="kit-part">
          <h2 className="kit-part-h">Branding</h2>
          <p className="kit-part-sub">The surface. What the brand is.</p>

          {b.brandColors.length > 0 && (
            <section className="kit-ch" id="kit-color">
              <h2>Color</h2>
              <Swatches list={b.brandColors} stems={b.stems} />
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
                      <VisTag e={e} />
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

          {b.voiceRules.length > 0 && (
            <section className="kit-ch" id="kit-voice">
              <h2>Voice</h2>
              <ol className="kit-rules">
                {b.voiceRules.map((e) => {
                  const why =
                    typeof e.payload.rule === 'object' && e.payload.rule?.why
                      ? String(e.payload.rule.why)
                      : null;
                  return (
                    <li key={e.id}>
                      <p className="kit-rule-line">
                        {ruleText(e)} <VisTag e={e} />
                      </p>
                      {why ? <p className="kit-rule-why">{why}</p> : null}
                    </li>
                  );
                })}
              </ol>
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
                      <VisTag e={e} />
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
                        <VisTag e={e} />
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
              <Swatches list={b.buildColors} dense />
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
                        <VisTag e={e} />
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
                  <VisTag e={e} />
                </div>
              ))}
            </div>
            {b.work.length > 8 && (
              <button className="mini-btn" onClick={() => setAllWork((v) => !v)}>
                {allWork ? 'Show recent only' : `Show all ${b.work.length}`}
              </button>
            )}
            <p className="kit-note">The Quarry remains the working surface; this is the record.</p>
          </section>
        </div>
      )}
    </div>
  );
}
