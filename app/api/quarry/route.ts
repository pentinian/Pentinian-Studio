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

  // With links, or without if that column has not been added yet. See Log.tsx: one
  // unknown column makes PostgREST refuse the entire query.
  const relCols =
    'id,raw_id,title,eli5,why,area,started_at,ended_at,minutes,visible,release_at,shots,gap_label,project_id';
  let { data: released, error: relErr } = await db
    .from('work_log_released')
    .select(`${relCols},links`);
  if (relErr) ({ data: released } = await db.from('work_log_released').select(relCols));

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
    links: Array.isArray(body.links) ? body.links : source.links ?? [],
    gap_label: (body.gap_label ?? '').trim() || null,
    visible: body.visible !== false,
    release_at: body.release_at || null,
  };

  // Pressing Release twice edits rather than duplicates.
  //
  // This was an upsert on notion_id, which never worked: the unique index on that
  // column is PARTIAL (`where notion_id is not null`), and Postgres cannot infer a
  // partial index from ON CONFLICT unless the statement repeats the predicate, which
  // PostgREST does not emit. Every release failed with "no unique or exclusion
  // constraint matching the ON CONFLICT specification", printed in small text under
  // the buttons, so it read as nothing happening rather than as an error.
  //
  // Looking the row up first needs no schema change and no migration to run. It is
  // two queries instead of one, at a volume where that costs nothing, and it also
  // handles entries with no notion_id, which the upsert never could.
  const { data: existing } = await db
    .from('work_log_released')
    .select('id')
    .or(source.notion_id ? `notion_id.eq.${source.notion_id},raw_id.eq.${source.id}` : `raw_id.eq.${source.id}`)
    .limit(1);

  const write = (r: any) =>
    existing?.length
      ? db.from('work_log_released').update(r).eq('id', existing[0].id).select().single()
      : db.from('work_log_released').insert(r).select().single();

  let { data, error } = await write(row);
  // Same tolerance as the reads: if the links column has not been added yet, release
  // the entry without it rather than refusing to publish anything at all.
  if (error && /links|gap_label/.test(error.message)) {
    const { links, gap_label, ...lean } = row;
    ({ data, error } = await write(lean));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entry: data });
}

/**
 * Three jobs, told apart by what arrives.
 *
 *   { moves: [...] }        arrange a day: move blocks, change how long they read as taking
 *   { id, withdraw: true }  pull a released entry back out of the Window
 *   { id, visible }         show or hide one already released
 *
 * MOVES EDIT THE REPRESENTATIVE TIME, which is the only time a client ever sees. Pen is
 * commissioned for projects, not employed by the hour, so a day is composed rather than
 * recorded: the point is that a client can weigh a piece of work and answer it, in
 * chunks they can keep up with, without being handed a record of when someone sat down.
 *
 * A move writes to work_log_raw AND to the released row if there is one, because
 * otherwise arranging a day in the Atelier would change nothing a client sees and the
 * arrangement would silently be a draft.
 */
export async function PATCH(request: Request) {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const db = admin();

  if (Array.isArray(body?.moves)) {
    const done: string[] = [];
    for (const m of body.moves) {
      if (!m?.id || !m?.started_at) continue;
      const started = new Date(m.started_at);
      if (Number.isNaN(started.getTime())) continue;

      // Clamped, and the end recomputed from the start rather than trusted from the
      // browser. A duration that disagrees with its own start and end renders fine and
      // reads as nonsense, which is the worst kind of wrong.
      const minutes = Math.max(5, Math.min(16 * 60, Math.round(Number(m.minutes) || 0)));
      const patch = {
        started_at: started.toISOString(),
        ended_at: new Date(started.getTime() + minutes * 60000).toISOString(),
        minutes,
      };

      const { error } = await db.from('work_log_raw').update(patch).eq('id', m.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await db.from('work_log_released').update(patch).eq('raw_id', m.id);
      done.push(m.id);
    }
    return NextResponse.json({ ok: true, moved: done.length });
  }

  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

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
