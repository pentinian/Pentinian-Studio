import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// The Atelier's window onto the Quarry.
//
// work_log_raw is revoked from the `authenticated` role on purpose: it holds
// unsanitised working notes, so no browser JWT can read it, not even yours.
// The Atelier therefore comes through here, where the service key is used only
// after confirming the caller is staff.
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

/** The queue: raw entries plus whether each has already been released. */
export async function GET() {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const db = admin();
  const { data: raw, error } = await db
    .from('work_log_raw')
    .select('*')
    .order('started_at', { ascending: false, nullsFirst: false })
    .order('logged_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: released } = await db
    .from('work_log_released')
    .select('id,raw_id,title,eli5,why,area,started_at,ended_at,minutes,visible,release_at,shots,project_id');

  const { data: projects } = await db.from('projects').select('id,name,client_facing');

  return NextResponse.json({
    raw: raw ?? [],
    released: released ?? [],
    projects: projects ?? [],
  });
}

/**
 * Release an entry, or update one already released.
 *
 * The client-facing text is whatever is POSTed, not whatever Notion said. That is
 * the point of the gate: you read it, you can rewrite it, and only then does it go.
 */
export async function POST(request: Request) {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.raw_id) return NextResponse.json({ error: 'raw_id required' }, { status: 400 });

  const db = admin();
  const { data: source, error: srcErr } = await db
    .from('work_log_raw').select('*').eq('id', body.raw_id).single();
  if (srcErr || !source) return NextResponse.json({ error: 'No such entry' }, { status: 404 });

  if (!source.project_id) {
    return NextResponse.json(
      { error: 'That entry has no project, so it has nowhere to land. Link it in Notion first.' },
      { status: 409 }
    );
  }

  // Never release into a project that is not client-facing. A Window is a promise
  // to a person, and this is the last place to catch it going somewhere it should not.
  const { data: project } = await db
    .from('projects').select('id,client_facing,name').eq('id', source.project_id).single();
  if (!project?.client_facing) {
    return NextResponse.json(
      { error: `"${project?.name ?? 'That project'}" is internal. Mark it client-facing before releasing.` },
      { status: 409 }
    );
  }

  const row = {
    project_id: source.project_id,
    raw_id: source.id,
    notion_id: source.notion_id,
    title: (body.title ?? '').trim() || 'Work',
    eli5: (body.eli5 ?? '').trim() || null,
    why: (body.why ?? '').trim() || null,
    area: (body.area ?? source.area ?? '').trim() || null,
    started_at: source.started_at,
    ended_at: source.ended_at,
    minutes: source.minutes,
    shots: Array.isArray(body.shots) ? body.shots : source.shots ?? [],
    visible: body.visible !== false,
    release_at: body.release_at || null,
  };

  // Upsert on notion_id so pressing Release twice edits rather than duplicates.
  const { data, error } = source.notion_id
    ? await db.from('work_log_released').upsert(row, { onConflict: 'notion_id' }).select().single()
    : await db.from('work_log_released').insert(row).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entry: data });
}

/** Pull something back: hide it, or delete the released copy entirely. */
export async function PATCH(request: Request) {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = admin();
  if (body.withdraw) {
    const { error } = await db.from('work_log_released').delete().eq('id', body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, withdrawn: true });
  }

  const { data, error } = await db
    .from('work_log_released')
    .update({ visible: !!body.visible })
    .eq('id', body.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entry: data });
}
