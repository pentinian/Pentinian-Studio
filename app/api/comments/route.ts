import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { notifyOfReply } from '@/lib/notify';

// Comments, both directions.
//
// The client used to insert straight from the browser, which was safe but had no
// seam to hang anything on, so a reply landed in the database and nobody was told.
// It comes through here now, and the important detail is that the insert still runs
// on the CALLER'S OWN session, not the service key. Row Level Security is doing the
// same gating it always did: a client cannot write into another project, cannot pose
// as staff, and cannot attach a comment to an entry they are not allowed to see.
// This route adds a notification, not an authority.
export const dynamic = 'force-dynamic';

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

/** Post a comment. Clients reply to an entry; staff reply to a client. */
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.entry_id || !body?.project_id || !String(body.body ?? '').trim()) {
    return NextResponse.json({ error: 'entry_id, project_id and body required' }, { status: 400 });
  }

  const isStaff = user.app_metadata?.role === 'admin';
  const text = String(body.body).trim().slice(0, 4000);

  const { data, error } = await supabase
    .from('comments')
    .insert({
      project_id: body.project_id,
      entry_id: body.entry_id,
      author_id: user.id,
      // A client can never set this: the RLS policy refuses from_staff = true for
      // anyone who is not admin, so this line is a convenience, not the guard.
      from_staff: isStaff,
      body: text,
    })
    .select('id,entry_id,body,from_staff,created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  // Fire and forget. A notification that fails must never fail the comment: the
  // reply is already saved and visible, and losing the email is a smaller harm than
  // telling someone their message did not send when it did.
  if (!isStaff) {
    notifyOfReply({ commentId: data.id, projectId: body.project_id, from: user.email ?? 'a client', text })
      .catch((e) => console.error('reply notification failed:', e?.message));
  }

  return NextResponse.json({ ok: true, comment: data });
}

/**
 * The studio inbox: every client comment, newest first, with whether it has been
 * answered since.
 *
 * Answered means a staff comment exists on the same entry, written later. That is a
 * loose definition on purpose. It is better to re-show something already dealt with
 * than to quietly mark a client's question as handled when it was not.
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
  }

  const db = admin();
  const { data: comments, error } = await db
    .from('comments')
    .select('id,project_id,entry_id,body,from_staff,created_at,author_id')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const entryIds = [...new Set((comments ?? []).map((c: any) => c.entry_id).filter(Boolean))];
  const projectIds = [...new Set((comments ?? []).map((c: any) => c.project_id))];

  const [{ data: entries }, { data: projects }] = await Promise.all([
    entryIds.length
      ? db.from('work_log_released').select('id,title,area,started_at,eli5').in('id', entryIds)
      : Promise.resolve({ data: [] as any[] }),
    db.from('projects').select('id,name,client_id').in('id', projectIds),
  ]);

  const clientIds = [...new Set((projects ?? []).map((p: any) => p.client_id).filter(Boolean))];
  const { data: clients } = clientIds.length
    ? await db.from('clients').select('id,name').in('id', clientIds)
    : { data: [] as any[] };

  const entryById = new Map((entries ?? []).map((e: any) => [e.id, e]));
  const projectById = new Map((projects ?? []).map((p: any) => [p.id, p]));
  const clientById = new Map((clients ?? []).map((c: any) => [c.id, c]));

  const staffAfter = (entryId: string, at: string) =>
    (comments ?? []).some(
      (c: any) => c.entry_id === entryId && c.from_staff && c.created_at > at
    );

  const threads = (comments ?? [])
    .filter((c: any) => !c.from_staff)
    .map((c: any) => {
      const p = projectById.get(c.project_id);
      return {
        id: c.id,
        body: c.body,
        created_at: c.created_at,
        answered: c.entry_id ? staffAfter(c.entry_id, c.created_at) : false,
        entry: entryById.get(c.entry_id) ?? null,
        entry_id: c.entry_id,
        project_id: c.project_id,
        project: p?.name ?? 'Unknown project',
        client: p?.client_id ? clientById.get(p.client_id)?.name ?? null : null,
        replies: (comments ?? [])
          .filter((r: any) => r.entry_id === c.entry_id && r.from_staff && r.created_at > c.created_at)
          .map((r: any) => ({ id: r.id, body: r.body, created_at: r.created_at }))
          .reverse(),
      };
    });

  return NextResponse.json({
    threads,
    waiting: threads.filter((t) => !t.answered).length,
  });
}
