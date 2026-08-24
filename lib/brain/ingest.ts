// Ingestion: hekate.brain/1 bundles become internal brain entries.
//
// The contract, in order of what it protects:
//   1. Schema validation rejects anything that is not hekate.brain/1. A bundle
//      that half-parses would half-ingest, and a half-ingested brand is worse
//      than none.
//   2. Upsert is keyed by (slug, entry_key) and guarded by content_hash:
//      re-ingesting an unchanged bundle is a no-op, a changed value updates in
//      place, and nothing ever duplicates.
//   3. Provenance is stored on every produced entry, in words, because the UI
//      shows it and a person reads it.
//   4. Everything arrives as internal. Ingestion cannot release; only the
//      press can.
//
// Transport today is files: committed fixtures in fixtures/brain, or the
// shared folder named by BRAIN_BUNDLES_DIR. The reader takes (index, loadFile)
// so a future authenticated endpoint replaces the file read without touching
// this module or the model.

import { createHash } from 'node:crypto';

export type BrainType = 'worklog' | 'doc' | 'file' | 'shot' | 'brand' | 'inspiration';
export type BrainSource = 'notion' | 'hekate' | 'upload' | 'manual';

export type ProducedEntry = {
  slug: string;
  type: BrainType;
  source: BrainSource;
  title: string;
  body: string | null;
  payload: unknown | null;
  asset_path: string | null;
  provenance: string;
  entry_key: string;
  content_hash: string;
};

export type Bundle = {
  schema: 'hekate.brain/1';
  slug: string;
  generated: string;
  authoritative: string;
  canon: {
    recorded_count?: number;
    source?: string;
    tokens?: Record<string, any>;
    retired?: any[];
    rules?: Record<string, any> | any[];
  };
  taxonomy: { count?: number; specimens?: any[] };
  docs: { file: string; bytes?: number; sha256?: string; mtime?: number }[];
  profile: Record<string, any>;
};

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Stable stringify: object keys sorted, so the same content always hashes
 *  the same regardless of construction order. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return (
    '{' +
    Object.keys(o)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(o[k]))
      .join(',') +
    '}'
  );
}

/** Validate a parsed bundle. Returns a list of reasons; empty means valid.
 *  Reasons, not a boolean, because "rejected" without why is a support call. */
export function validateBundle(b: any): string[] {
  const bad: string[] = [];
  if (!b || typeof b !== 'object') return ['not an object'];
  if (b.schema !== 'hekate.brain/1') bad.push(`schema is ${JSON.stringify(b.schema)}, not hekate.brain/1`);
  if (typeof b.slug !== 'string' || !b.slug) bad.push('slug missing');
  if (typeof b.generated !== 'string' || Number.isNaN(Date.parse(b.generated)))
    bad.push('generated missing or not a date');
  if (!b.canon || typeof b.canon !== 'object') bad.push('canon missing');
  if (!b.taxonomy || typeof b.taxonomy !== 'object') bad.push('taxonomy missing');
  if (!Array.isArray(b.docs)) bad.push('docs is not a list');
  if (!b.profile || typeof b.profile !== 'object') bad.push('profile missing');
  return bad;
}

function entry(
  slug: string,
  type: BrainType,
  key: string,
  title: string,
  provenance: string,
  payload: unknown,
  body: string | null = null,
  asset_path: string | null = null
): ProducedEntry {
  return {
    slug,
    type,
    source: 'hekate',
    title,
    body,
    payload,
    asset_path,
    provenance,
    entry_key: key,
    // Provenance is part of the hash on purpose: a reworded provenance line
    // must propagate, and before this it silently could not.
    content_hash: sha256(canonical({ payload: payload ?? null, body, title, provenance })),
  };
}

/** Everything a bundle contributes, as internal entries.
 *  Brand entries come from canon, taxonomy and profile; doc entries from the
 *  docs index. Nothing here decides visibility: that is the press's job. */
export function entriesFromBundle(b: Bundle): ProducedEntry[] {
  const out: ProducedEntry[] = [];
  // The tool that carries the bundle is plumbing and stays unnamed here; the
  // projection speaks of the canon and its source, not the pipe.
  const stamp = `brand canon ${b.slug}, generated ${b.generated}; recorded at the source on the studio Mac`;

  // ---- canon: live tokens --------------------------------------------------
  const tokens = b.canon?.tokens ?? {};
  for (const [name, t] of Object.entries<any>(tokens)) {
    out.push(
      entry(
        b.slug,
        'brand',
        `brand:token:${name}`,
        name,
        `${t?.provenance ?? 'recorded'} · ${t?.by ?? ''} · ${stamp}`,
        { kind: 'token', name, ...t }
      )
    );
  }

  // ---- canon: retired values. Loud by design downstream. -------------------
  for (const r of b.canon?.retired ?? []) {
    const name = r?.name ?? 'unnamed';
    out.push(
      entry(
        b.slug,
        'brand',
        `brand:retired:${name}:${r?.value ?? ''}`,
        `${name} (retired)`,
        `retired ${r?.at ?? ''} by ${r?.by ?? 'unknown'} · ${stamp}`,
        { kind: 'retired', ...r }
      )
    );
  }

  // ---- canon: rules --------------------------------------------------------
  const rules = b.canon?.rules ?? {};
  const ruleList = Array.isArray(rules) ? rules.map((r, i) => [String(i), r] as const) : Object.entries(rules);
  for (const [k, r] of ruleList) {
    // Real bundles keep the rule sentence as the dict key, with a record
    // ({statement, why, at, by}) as the value. Strings and {text} shapes are
    // accepted too. The canonical fallback rendered JSON blobs; never again.
    const rec = r as any;
    const text =
      typeof r === 'string' ? r : rec?.text ?? rec?.statement ?? (/[a-zA-Z] /.test(k) ? k : null);
    out.push(
      entry(
        b.slug,
        'brand',
        `brand:rule:${k}`,
        `Rule: ${String(text ?? k).slice(0, 80)}`,
        stamp,
        { kind: 'rule', key: k, text: text ?? k, rule: r }
      )
    );
  }

  // ---- taxonomy: specimens -------------------------------------------------
  // A specimen carries its own kind (motion, button, card); spreading it over
  // the discriminator erased ours and hid every specimen from the renderer.
  // Both survive now: kind names the payload class, specimen_kind the record's.
  for (const s of b.taxonomy?.specimens ?? []) {
    const name = s?.name ?? s?.component ?? 'specimen';
    out.push(
      entry(b.slug, 'brand', `brand:specimen:${name}`, `Specimen: ${name}`, stamp, {
        ...s,
        kind: 'specimen',
        specimen_kind: s?.kind ?? null,
      })
    );
  }

  // ---- profile: each section is one brand entry ----------------------------
  for (const [k, v] of Object.entries(b.profile ?? {})) {
    out.push(
      entry(b.slug, 'brand', `brand:profile:${k}`, `Profile: ${k}`, stamp, {
        kind: 'profile',
        section: k,
        value: v,
      })
    );
  }

  // ---- docs index: doc entries reference files, they do not embed them -----
  for (const d of b.docs ?? []) {
    out.push(
      entry(
        b.slug,
        'doc',
        `doc:${d.file}`,
        d.file,
        stamp,
        { kind: 'doc-index', ...d },
        `Indexed from the bundle: ${d.bytes ?? '?'} bytes, sha256 ${d.sha256 ?? 'unrecorded'}. The file itself lives with the stores; this entry is its projection.`,
        null
      )
    );
  }

  return out;
}

export type UpsertResult = {
  created: number;
  updated: number;
  unchanged: number;
  /** hekate-sourced internal rows whose key vanished from the bundle: removed,
   *  because a relic that looks current resurrects a dead palette. */
  stale_removed: number;
  /** vanished keys whose rows were staged or released: kept and counted, never
   *  silently un-pressed. Demotion is a human act. */
  stale_kept: number;
};

/** Upsert produced entries through a Supabase admin client.
 *  Reads existing (slug, entry_key, content_hash) first so an unchanged
 *  bundle is a true no-op: no writes, no updated_at churn. Reads page through
 *  PostgREST's max-rows cap; an uncapped select silently truncates. */
export async function upsertEntries(
  db: any,
  projectId: string | null,
  entries: ProducedEntry[]
): Promise<UpsertResult> {
  const res: UpsertResult = { created: 0, updated: 0, unchanged: 0, stale_removed: 0, stale_kept: 0 };
  if (!entries.length) return res;

  const slug = entries[0].slug;
  const PAGE = 1000;
  const existing: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('brain_entries')
      .select('id,entry_key,content_hash,source,visibility')
      .eq('slug', slug)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`reading existing entries: ${error.message}`);
    existing.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const have = new Map<string, string>(
    existing.map((r: any) => [r.entry_key, r.content_hash])
  );

  for (const e of entries) {
    const prior = have.get(e.entry_key);
    if (prior === e.content_hash) {
      res.unchanged++;
      continue;
    }
    const row = {
      project_id: projectId,
      slug: e.slug,
      type: e.type,
      source: e.source,
      title: e.title,
      body: e.body,
      payload: e.payload,
      asset_path: e.asset_path,
      provenance: e.provenance,
      entry_key: e.entry_key,
      content_hash: e.content_hash,
      updated_at: new Date().toISOString(),
      // visibility deliberately absent: new rows default to internal, and an
      // update must never touch standing. A re-ingested token that was
      // released stays released at its new value only through the press.
    };
    const { error: upErr } = await db
      .from('brain_entries')
      .upsert(row, { onConflict: 'slug,entry_key' });
    if (upErr) throw new Error(`upserting ${e.entry_key}: ${upErr.message}`);
    if (prior === undefined) res.created++;
    else res.updated++;
  }

  // The stale sweep. A token renamed or retired at the source leaves its old
  // key behind; leaving that row in place renders a dead value as live canon,
  // beside its own warning. Internal relics are removed; staged or released
  // ones are kept and counted, because un-pressing is a human act.
  const produced = new Set(entries.map((e) => e.entry_key));
  for (const r of existing) {
    if (r.source !== 'hekate' || produced.has(r.entry_key)) continue;
    if (r.visibility === 'internal') {
      const { error: delErr } = await db.from('brain_entries').delete().eq('id', r.id);
      if (delErr) throw new Error(`removing stale ${r.entry_key}: ${delErr.message}`);
      res.stale_removed++;
    } else {
      res.stale_kept++;
    }
  }
  return res;
}
