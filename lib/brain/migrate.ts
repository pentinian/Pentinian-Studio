// The Quarry fold: work_log_raw becomes brain worklog entries.
//
// A module rather than route-embedded logic so scripts and tests can drive
// the same code path the button presses. The route stays a thin authed shell.
//
// The two review findings this shape answers:
//   1. content_hash is a hash of the content (body and the payload fields),
//      not the row id, so an edited entry re-synced from Notion propagates on
//      the next fold instead of hiding behind "unchanged" forever.
//   2. Every read pages through PostgREST's max-rows cap, and the
//      reconciliation's "in" number comes from a count query rather than the
//      length of a possibly truncated fetch, so the gate cannot report a
//      match while rows are missing.

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

async function exactCount(db: any, table: string, filter?: (q: any) => any): Promise<number> {
  let q = db.from(table).select('id', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw new Error(`counting ${table}: ${error.message}`);
  return count ?? 0;
}

export type MigrateResult = {
  migration: { created: number; updated: number; unchanged: number };
  reconciliation: { synced_entries_in: number; brain_worklog_out: number; match: boolean };
};

export async function migrateWorklog(db: any): Promise<MigrateResult> {
  const raw = await all(
    db,
    'work_log_raw',
    'id,project_id,notion_id,logged_at,started_at,body,eli5,why,area,minutes,created_at'
  );
  const released = await all(db, 'work_log_released', 'raw_id,visible,release_at,created_at');
  const projects = await all(db, 'projects', 'id,name');
  const existing = await all(db, 'brain_entries', 'id,entry_key,visibility,content_hash');

  const standing = new Map<string, { visible: boolean; at: string | null }>();
  for (const r of released) {
    if (!r.raw_id) continue;
    standing.set(r.raw_id, {
      visible: r.visible !== false,
      at: r.release_at ?? r.created_at ?? null,
    });
  }
  const nameById = new Map(projects.map((p: any) => [p.id, p.name]));
  const brainByKey = new Map(existing.map((e: any) => [e.entry_key, e]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const r of raw) {
    const rel = standing.get(r.id);
    const visibility = rel ? (rel.visible ? 'released' : 'staged') : 'internal';
    const projectName = nameById.get(r.project_id) ?? null;
    const slug = slugForProject(projectName) ?? 'unlaned';
    const title = String(r.body ?? '').split('\n')[0].slice(0, 120) || 'Work';

    const payload = {
      kind: 'worklog',
      raw_id: r.id,
      notion_id: r.notion_id,
      eli5: r.eli5,
      why: r.why,
      area: r.area,
      started_at: r.started_at,
      minutes: r.minutes,
    };
    const provenance = r.notion_id
      ? `synced from Notion (${r.notion_id}); the Build row is the working copy`
      : 'written by hand in the Atelier';
    // The hash covers everything whose change should reach the brain,
    // provenance included, so a reworded line propagates instead of hiding.
    const content_hash = sha256(canonical({ body: r.body ?? null, payload, provenance }));

    const row: any = {
      project_id: r.project_id,
      slug,
      type: 'worklog',
      source: r.notion_id ? 'notion' : 'manual',
      title,
      body: r.body ?? null,
      payload,
      provenance,
      entry_key: `worklog:${r.id}`,
      content_hash,
      visibility,
      released_at: visibility === 'released' ? rel!.at ?? r.created_at : null,
      created: r.logged_at ?? r.created_at,
      updated_at: new Date().toISOString(),
    };

    // The one place visibility IS written: migration mirrors standing that a
    // human already pressed in the old system. It never invents a release.
    const prior = brainByKey.get(row.entry_key);
    if (prior) {
      if (prior.visibility === row.visibility && prior.content_hash === row.content_hash) {
        unchanged++;
        continue;
      }
      const { error } = await db.from('brain_entries').update(row).eq('id', prior.id);
      if (error) throw new Error(`updating ${row.entry_key}: ${error.message}`);
      updated++;
    } else {
      const { error } = await db.from('brain_entries').insert(row);
      if (error) throw new Error(`inserting ${row.entry_key}: ${error.message}`);
      created++;
    }
  }

  // The reconciliation the gate requires: both sides from count queries.
  const syncedIn = await exactCount(db, 'work_log_raw');
  const brainOut = await exactCount(db, 'brain_entries', (q) => q.eq('type', 'worklog'));

  return {
    migration: { created, updated, unchanged },
    reconciliation: {
      synced_entries_in: syncedIn,
      brain_worklog_out: brainOut,
      match: syncedIn === brainOut,
    },
  };
}
