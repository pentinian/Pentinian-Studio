import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// The Spine: every project, with enough context to know what is safe to release.
//
// Staff only. It reports which projects are client-facing and which of their clients
// actually has a login, because those two together decide whether a released entry
// reaches a human or falls into a room with nobody in it.
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

export async function GET() {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const db = admin();
  const [{ data: projects, error }, { data: clients }, { data: raw }, { data: rel }] =
    await Promise.all([
      db.from('projects').select('id,name,phase,progress,client_facing,client_id,notion_page_id').order('name'),
      db.from('clients').select('id,name,email,user_id'),
      db.from('work_log_raw').select('project_id'),
      db.from('work_log_released').select('project_id,visible'),
    ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const clientById = new Map((clients ?? []).map((c: any) => [c.id, c]));
  const countIn = (rows: any[] | null, id: string) =>
    (rows ?? []).filter((r: any) => r.project_id === id).length;

  const out = (projects ?? []).map((p: any) => {
    const c = p.client_id ? clientById.get(p.client_id) : null;
    return {
      id: p.id,
      name: p.name,
      phase: p.phase ?? null,
      progress: typeof p.progress === 'number' ? p.progress : null,
      client_facing: !!p.client_facing,
      linked: !!p.notion_page_id,
      client: c ? { name: c.name, has_login: !!c.user_id } : null,
      quarry: countIn(raw, p.id),
      released: (rel ?? []).filter((r: any) => r.project_id === p.id && r.visible).length,
      // Written by a sync but never matched to a project. Surfaced on its own below.
      held: (rel ?? []).filter((r: any) => r.project_id === p.id && !r.visible).length,
    };
  });

  return NextResponse.json({
    projects: out,
    // Entries the sync could not place. They can never reach a Window, so they are
    // worth seeing rather than silently absent from every project's count.
    orphaned: (raw ?? []).filter((r: any) => !r.project_id).length,
  });
}

/**
 * Flip a project between internal and client-facing.
 *
 * This is the switch the release gate checks, so it is the most consequential
 * toggle in the Atelier. Turning it on does not release anything; it only makes
 * releasing possible. Turning it off leaves already-released entries in place,
 * which is why the response says how many are currently live.
 */
export async function PATCH(request: Request) {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = admin();

  /* What the client reads at the top of their Window.
   *
   * Both are optional and both stay null until someone says otherwise, because null
   * and zero are different claims: null is "nobody has said", zero is "none of it is
   * done". The Window renders them differently for that reason.
   *
   * Phase is free text so it can say what is actually happening rather than pick from
   * a list of stages that were guessed at in advance. */
  if ('phase' in body || 'progress' in body) {
    const patch: Record<string, unknown> = {};
    if ('phase' in body) {
      const p = typeof body.phase === 'string' ? body.phase.trim().slice(0, 80) : '';
      patch.phase = p || null;
    }
    if ('progress' in body) {
      const n = Number(body.progress);
      patch.progress =
        body.progress === null || body.progress === '' || Number.isNaN(n)
          ? null
          : Math.max(0, Math.min(100, Math.round(n)));
    }
    const { data, error } = await db
      .from('projects')
      .update(patch)
      .eq('id', body.id)
      .select('id,name,phase,progress')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, project: data });
  }

  if (typeof body.client_facing !== 'boolean') {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  }
  const { data, error } = await db
    .from('projects')
    .update({ client_facing: body.client_facing })
    .eq('id', body.id)
    .select('id,name,client_facing')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: live } = await db
    .from('work_log_released')
    .select('id')
    .eq('project_id', body.id)
    .eq('visible', true);

  return NextResponse.json({ ok: true, project: data, stillLive: (live ?? []).length });
}
