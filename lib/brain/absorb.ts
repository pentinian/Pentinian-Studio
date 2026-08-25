// The console fold: project_notes becomes brain entries.
//
// Brand notes and inspiration are knowledge and belong to the substrate.
// Requests do not: they are asks with a lifecycle, the correspondence
// species, and the boundary that keeps replies out of the brain keeps them
// out too.
//
// Standing mirrors the console once, at arrival: a released note arrives
// released with its stamp, everything else staged. After arrival the press
// owns standing. Idempotent by entry_key console:<id> and a real content
// hash.

import { slugForProject } from './lanes';
import { sha256, canonical } from './ingest';

const PAGE = 1000;

async function all(db: any, table: string, cols: string): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(cols).range(from, from + PAGE - 1);
    if (error) throw new Error(`reading ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export type AbsorbResult = {
  console: { created: number; updated: number; unchanged: number; requests_left: number };
  reconciliation: { notes_in: number; brain_console_out: number; match: boolean };
};

export async function absorbConsole(db: any): Promise<AbsorbResult> {
  const notes = await all(
    db,
    'project_notes',
    'id,project_id,kind,facet,title,body,url,swatch,shot,status,from_client,sort,created_at,released_at,notion_id,counter'
  );
  const projects = await all(db, 'projects', 'id,name');
  const nameById = new Map(projects.map((p: any) => [p.id, p.name]));

  const existingRows = await all(db, 'brain_entries', 'id,entry_key,visibility,content_hash');
  const brainByKey = new Map(existingRows.map((e: any) => [e.entry_key, e]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let requests_left = 0;

  for (const n of notes) {
    if (n.kind === 'request') {
      requests_left++;
      continue;
    }

    const slug = slugForProject(nameById.get(n.project_id) ?? null) ?? 'unlaned';
    const title = n.title || (n.kind === 'inspiration' ? 'Inspiration' : 'Brand note');

    let type: string;
    let payload: any;
    if (n.kind === 'inspiration') {
      type = 'inspiration';
      payload = { kind: 'inspiration', name: title, note: n.body, url: n.url, shot: n.shot, sort: n.sort };
    } else if (n.facet === 'tone') {
      // The register: one named quality per row, its meaning in the body.
      type = 'brand';
      payload = { kind: 'voice-tone', name: title, note: n.body ?? '', console: true, sort: n.sort };
    } else if (n.facet === 'lexicon') {
      // Terminology law: say this, never that, because.
      type = 'brand';
      payload = {
        kind: 'voice-lexicon',
        say: title,
        never: n.counter ?? '',
        why: n.body ?? '',
        console: true,
        sort: n.sort,
      };
    } else if (n.facet === 'color') {
      type = 'brand';
      payload = { kind: 'token', name: title, value: n.swatch ?? '', purpose: n.body ?? '', url: n.url, console: true, sort: n.sort };
    } else if (n.facet === 'type') {
      type = 'brand';
      payload = { kind: 'face', name: title, stack: title, note: n.body, url: n.url, console: true, sort: n.sort };
    } else if (n.facet === 'asset') {
      type = 'file';
      payload = { kind: 'asset', name: title, note: n.body, url: n.url, shot: n.shot, console: true, sort: n.sort };
    } else {
      // rule, and the rare brand note with no facet reads as one
      type = 'brand';
      payload = {
        kind: 'rule',
        key: title,
        text: title,
        rule: { statement: title, why: n.body || undefined },
        console: true,
        sort: n.sort,
      };
    }

    const provenance = n.from_client
      ? 'written by the client in their Window, via the console'
      : n.notion_id
        ? `console item from Notion (${n.notion_id})`
        : 'written in the Atelier console';

    const row: any = {
      project_id: n.project_id,
      slug,
      type,
      source: n.notion_id ? 'notion' : 'manual',
      title,
      body: n.body ?? null,
      payload,
      asset_path: n.shot ?? null,
      provenance,
      entry_key: `console:${n.id}`,
      content_hash: sha256(
        canonical({ title, body: n.body, url: n.url, swatch: n.swatch, shot: n.shot, counter: n.counter ?? null, facet: n.facet, kind: n.kind, sort: n.sort, from_client: n.from_client, provenance })
      ),
      // Standing mirrors the console, which remains a pressed surface: released
      // stays released with its stamp, everything else staged. Never internal,
      // because the console never had an internal rung.
      visibility: n.released_at ? 'released' : 'staged',
      released_at: n.released_at ?? null,
      created: n.created_at,
      updated_at: new Date().toISOString(),
    };

    // Standing mirrors the console ONCE, at arrival. After that the press
    // owns it; a re-absorbed edit updates content and leaves standing alone.
    const prior = brainByKey.get(row.entry_key);
    if (prior) {
      if (prior.content_hash === row.content_hash) {
        unchanged++;
        continue;
      }
      const { visibility: _v, released_at: _r, ...contentOnly } = row;
      const { error } = await db.from('brain_entries').update(contentOnly).eq('id', prior.id);
      if (error) throw new Error(`updating ${row.entry_key}: ${error.message}`);
      updated++;
    } else {
      const { error } = await db.from('brain_entries').insert(row);
      if (error) throw new Error(`inserting ${row.entry_key}: ${error.message}`);
      created++;
    }
  }

  const notesIn = notes.filter((n: any) => n.kind !== 'request').length;
  const { count: brainOut, error: cntErr } = await db
    .from('brain_entries')
    .select('id', { count: 'exact', head: true })
    .like('entry_key', 'console:%');
  if (cntErr) throw new Error(`counting console entries: ${cntErr.message}`);

  return {
    console: { created, updated, unchanged, requests_left },
    reconciliation: {
      notes_in: notesIn,
      brain_console_out: brainOut ?? 0,
      match: notesIn === (brainOut ?? 0),
    },
  };
}
