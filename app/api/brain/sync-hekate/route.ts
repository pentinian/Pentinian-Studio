import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  validateBundle,
  entriesFromBundle,
  upsertEntries,
  sha256,
  type Bundle,
} from '@/lib/brain/ingest';
import { LANES } from '@/lib/brain/lanes';

// Sync Hekate: bundles in, internal brain entries out, counts back.
//
// This route NEVER writes visibility. Everything it produces is internal, and
// releasing is a human decision made at the press. Do not "helpfully" add it
// here later; the identical warning on notion-sync has held since July.
//
// Transport today is the filesystem: BRAIN_BUNDLES_DIR if set (the shared
// folder on the Mac, for dev), else the fixtures committed in the repo. The
// loader is a function so a future authenticated endpoint replaces file reads
// without touching the model or the ingest module.
export const dynamic = 'force-dynamic';

async function staffOnly() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.app_metadata?.role === 'admin' ? user : null;
}

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function bundlesDir(): string {
  return process.env.BRAIN_BUNDLES_DIR || join(process.cwd(), 'fixtures', 'brain');
}

type PerBundle = {
  slug: string;
  status: 'ingested' | 'missing' | 'rejected' | 'hash-mismatch' | 'error';
  reason?: string;
  created?: number;
  updated?: number;
  unchanged?: number;
  entries?: number;
};

export async function POST() {
  if (!(await staffOnly()))
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const dir = bundlesDir();

  // The index first: it carries the generated timestamp the UI reports, and
  // the sha256 that lets a bundle prove it is the one the index describes.
  let index: any;
  try {
    index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
  } catch {
    return NextResponse.json(
      { error: 'No readable index.json at the bundle transport' },
      { status: 502 }
    );
  }
  if (index?.schema !== 'hekate.brain-index/1' || !Array.isArray(index?.bundles)) {
    return NextResponse.json(
      { error: `index.json is not hekate.brain-index/1` },
      { status: 422 }
    );
  }

  const db = admin();

  // Lane resolution: bundle slug to project id, through the explicit map.
  // A bundle whose slug has no lane still ingests (keyed by slug), so the
  // record exists the day Pen adds the lane; it simply has no project yet.
  const { data: projects } = await db.from('projects').select('id,name');
  const projectByName = new Map(
    (projects ?? []).map((p: any) => [String(p.name).trim(), p.id])
  );
  const projectForSlug = (slug: string): string | null => {
    for (const [name, s] of Object.entries(LANES)) {
      if (s === slug) return projectByName.get(name) ?? null;
    }
    return null;
  };

  const report: PerBundle[] = [];
  for (const b of index.bundles) {
    const slug = String(b?.slug ?? '');
    if (!slug) continue;

    // The index is data from disk, not an instruction. A file name is a
    // basename or it is nothing: a path that climbs out of the bundle folder
    // reads whatever the server can read. And a row without a sha256 is
    // refused rather than waved through; a bundle proves itself or stays out.
    const fname = String(b?.file ?? '');
    if (!fname || basename(fname) !== fname || fname.includes('..')) {
      report.push({ slug, status: 'rejected', reason: 'file name is not a plain basename' });
      continue;
    }
    if (!b.sha256) {
      report.push({ slug, status: 'rejected', reason: 'index row has no sha256; refusing an unprovable bundle' });
      continue;
    }

    let raw: string;
    try {
      raw = await readFile(join(dir, fname), 'utf8');
    } catch {
      report.push({
        slug,
        status: 'missing',
        reason: `${fname} not present at this transport; the index lists it`,
      });
      continue;
    }

    if (sha256(raw) !== b.sha256) {
      report.push({
        slug,
        status: 'hash-mismatch',
        reason: 'file does not match the sha256 the index recorded; refusing to ingest a bundle that cannot prove itself',
      });
      continue;
    }

    let parsed: Bundle;
    try {
      parsed = JSON.parse(raw);
    } catch {
      report.push({ slug, status: 'rejected', reason: 'not JSON' });
      continue;
    }
    const bad = validateBundle(parsed);
    if (bad.length) {
      report.push({ slug, status: 'rejected', reason: bad.join('; ') });
      continue;
    }
    if (parsed.slug !== slug) {
      report.push({
        slug,
        status: 'rejected',
        reason: `bundle names itself ${JSON.stringify(parsed.slug)}, the index says ${JSON.stringify(slug)}; refusing a bundle filed under a lane it does not claim`,
      });
      continue;
    }

    try {
      const entries = entriesFromBundle(parsed);
      const res = await upsertEntries(db, projectForSlug(slug), entries);
      report.push({ slug, status: 'ingested', entries: entries.length, ...res });
    } catch (e: any) {
      report.push({ slug, status: 'error', reason: e?.message ?? String(e) });
    }
  }

  // Lane drift detection: a LANES name that matches no project row means a
  // rename happened somewhere. Loud at sync time, not weeks later.
  const lanesWithoutProject = Object.keys(LANES).filter(
    (name) => !projectByName.has(name)
  );

  return NextResponse.json({
    ok: true,
    indexGenerated: index.generated ?? null,
    transport: process.env.BRAIN_BUNDLES_DIR ? 'shared-folder' : 'fixtures',
    bundles: report,
    lanesWithoutProject,
  });
}
