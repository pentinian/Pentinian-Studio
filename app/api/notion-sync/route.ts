import { fetchWorkLog, fetchPageTitle } from '@/lib/notion';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Pulls the Notion work log into the Quarry (work_log_raw).
//
// This route NEVER writes to work_log_released. Nothing reaches a client from a
// sync. Releasing is a human decision made in the Atelier, and that is the whole
// point of the gate, so do not "helpfully" add it here later.
//
// Access: an admin session, or a cron caller carrying CRON_SECRET. /api sits outside
// the middleware matcher, so without this check the endpoint would be open to anyone.
export const dynamic = 'force-dynamic';

async function authorise(request: Request): Promise<string | null> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  if (secret && auth === `Bearer ${secret}`) return null;

  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.app_metadata?.role === 'admin') return null;
  } catch {
    // fall through to refusal
  }
  return 'Not permitted';
}

export async function POST(request: Request) {
  const refused = await authorise(request);
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  }

  let entries;
  try {
    entries = await fetchWorkLog();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Notion pull failed' }, { status: 502 });
  }

  const admin = createAdminClient(url, serviceKey, { auth: { persistSession: false } });

  // Map a Notion project page to a Supabase project row. Prefer notion_page_id, which
  // is exact and survives renaming on either side. Fall back to name only for rows not
  // yet linked, and report anything that matched neither so it cannot fail silently:
  // an entry with no project can never reach a client's Window.
  const { data: projects } = await admin.from('projects').select('id,name,notion_page_id');
  const byPage = new Map(
    (projects ?? []).filter((p: any) => p.notion_page_id).map((p: any) => [p.notion_page_id, p.id])
  );
  const byName = new Map((projects ?? []).map((p: any) => [String(p.name).trim().toLowerCase(), p.id]));
  const pageToProject = new Map<string, string | null>();
  const unmatched = new Set<string>();

  async function resolveProject(pageId: string | null): Promise<string | null> {
    if (!pageId) return null;
    if (pageToProject.has(pageId)) return pageToProject.get(pageId)!;

    let id: string | null = byPage.get(pageId) ?? null;
    if (!id) {
      const title = await fetchPageTitle(pageId);
      id = title ? byName.get(title.trim().toLowerCase()) ?? null : null;
      if (!id) unmatched.add(title ?? pageId);
    }
    pageToProject.set(pageId, id);
    return id;
  }

  const rows = [];
  for (const e of entries) {
    rows.push({
      notion_id: e.notion_id,
      project_id: await resolveProject(e.project_page_id),
      logged_at: e.logged_at,
      started_at: e.started_at,
      ended_at: e.ended_at,
      minutes: e.minutes,
      // Title first, then the detail, separated by a blank line.
      //
      // This used to be `e.detail || e.title`, which threw the title away whenever a
      // detail existed. The Quarry then listed six rows of dense technical prose with
      // no readable headings, which defeats the point of a queue you are meant to
      // scan. Everything downstream already reads the first line as the title, so
      // this shape needs no schema change and no new column.
      body: [e.title, e.detail].filter(Boolean).join('\n\n'),
      eli5: e.eli5,
      why: e.why,
      area: e.area,
      shots: e.shots,
      stage: e.stage,
      // Carried across as a hint for the Atelier queue. It releases nothing.
      client_visible: e.client_visible,
      release_at: e.release_at,
      out_of_scope: e.out_of_scope,
    });
  }

  if (rows.length) {
    const { error } = await admin.from('work_log_raw').upsert(rows, { onConflict: 'notion_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    pulled: rows.length,
    withProject: rows.filter((r) => r.project_id).length,
    // Surfaced rather than swallowed: a project named in Notion with no matching
    // Supabase row means those entries have nowhere to land in a client's Window.
    unmatchedProjects: [...unmatched],
  });
}
