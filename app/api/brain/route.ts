import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { slugForProject } from '@/lib/brain/lanes';
import { migrateWorklog } from '@/lib/brain/migrate';
import { absorbConsole } from '@/lib/brain/absorb';

// The Atelier's window onto the brain.
//
// brain_entries is revoked from the authenticated role, exactly like
// work_log_raw and for the same reason: it holds unsanitised working
// material. The Atelier comes through here, service key only after the
// caller is confirmed staff. The Window never uses this route; in Phase C it
// gets its own, over released projections only.
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

/** Entries for one project's brain, newest first, plus the lane so the UI can
 *  say honestly when a project has no bundle yet. */
export async function GET(request: Request) {
  if (!(await staffOnly()))
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  if (!projectId)
    return NextResponse.json({ error: 'project required' }, { status: 400 });

  const db = admin();
  const { data: project, error: pErr } = await db
    .from('projects')
    .select('id,name')
    .eq('id', projectId)
    .single();
  if (pErr || !project)
    return NextResponse.json({ error: 'No such project' }, { status: 404 });

  const slug = slugForProject(project.name);

  // Two nets, one list: rows tied to the project id (worklog migration) and
  // rows tied to the lane slug (bundle ingestion, which may have run before
  // the project was linked). De-duplicated by id.
  const seen = new Set<string>();
  const entries: any[] = [];
  const take = (rows: any[] | null) => {
    for (const r of rows ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      entries.push(r);
    }
  };

  const cols =
    'id,slug,type,source,title,body,payload,asset_path,provenance,entry_key,visibility,released_at,created,updated_at';
  const byProject = await db
    .from('brain_entries')
    .select(cols)
    .eq('project_id', projectId)
    .order('created', { ascending: false })
    .limit(500);
  if (byProject.error)
    return NextResponse.json({ error: byProject.error.message }, { status: 500 });
  take(byProject.data);

  if (slug) {
    const bySlug = await db
      .from('brain_entries')
      .select(cols)
      .eq('slug', slug)
      .order('created', { ascending: false })
      .limit(500);
    if (bySlug.error)
      return NextResponse.json({ error: bySlug.error.message }, { status: 500 });
    take(bySlug.data);
  }

  entries.sort((a, b) => (a.created < b.created ? 1 : -1));

  return NextResponse.json({
    project: { id: project.id, name: project.name },
    lane: slug,
    entries,
  });
}

/**
 * One job for now: { migrate: true } folds the synced worklog into the brain.
 * The logic lives in lib/brain/migrate.ts so scripts and tests drive the same
 * path the button presses; this shell only holds the door.
 */
export async function POST(request: Request) {
  if (!(await staffOnly()))
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.migrate)
    return NextResponse.json({ error: 'Nothing asked' }, { status: 400 });

  try {
    const db = admin();
    // One press, the whole fold: the Quarry and the console both become brain.
    const worklog = await migrateWorklog(db);
    const consoleFold = await absorbConsole(db);
    return NextResponse.json({
      ok: true,
      migration: worklog.migration,
      reconciliation: worklog.reconciliation,
      console: consoleFold.console,
      console_reconciliation: consoleFold.reconciliation,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'migration failed' }, { status: 500 });
  }
}
