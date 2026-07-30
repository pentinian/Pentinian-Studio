import { createClient } from '@/lib/supabase/server';
import { notifyOfNote } from '@/lib/notify';
import { record } from '@/lib/events';
import { NextResponse } from 'next/server';

// A client writing into their own console.
//
// This exists for exactly one reason: so that a request, a brand suggestion or a
// rebrand ask can raise a notification. Before it, those landed silently and the only
// signal was a count in the Atelier, which helps only once you are already looking.
//
// THE IMPORTANT PROPERTY, and the reason this is not a service-key route: the insert
// runs on the CALLER'S OWN SESSION. Row Level Security gates it exactly as it gated the
// direct insert this replaces. The route adds a notification, not an authority. If it
// ever starts using the service key, every policy protecting project_notes stops
// applying and this becomes the hole in the middle of the system.
//
// Everything the client may not do is still refused by the database rather than here:
// they cannot post as Pentinian, cannot release, cannot mark their own suggestion
// accepted, cannot reach another project. The checks below are for clearer errors, not
// for safety, and removing them would change the message and not the outcome.

export const dynamic = 'force-dynamic';

const KINDS = ['brand', 'inspiration', 'request'];

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const b = await request.json().catch(() => ({}));
  if (!b?.project_id || !KINDS.includes(b.kind)) {
    return NextResponse.json({ error: 'Need a project and a kind' }, { status: 400 });
  }

  const row: Record<string, any> = {
    project_id: b.project_id,
    kind: b.kind,
    facet: b.kind === 'brand' ? (b.facet ?? 'rule') : null,
    parent_id: b.parent_id ?? null,
    title: String(b.title ?? '').trim() || null,
    body: String(b.body ?? '').trim() || null,
    url: String(b.url ?? '').trim() || null,
    shot: String(b.shot ?? '').trim() || null,
    // Set here, not taken from the request, so a crafted body cannot claim otherwise.
    // The policy checks these too; sending the right values means the refusal a client
    // sees is about what they wrote rather than about a field they never filled in.
    from_client: true,
    author_id: user.id,
    status: b.kind === 'inspiration' ? 'none' : 'open',
    released_at: null,
  };

  const write = async (r: Record<string, any>) =>
    supabase.from('project_notes').insert(r).select('id,title,body,kind,parent_id').single();

  // Degrade through the columns a pending migration might not have, rather than
  // refusing to accept something someone just typed.
  let { data, error } = await write(row);
  if (error && /parent_id/.test(error.message)) {
    const { parent_id, ...lean } = row;
    ({ data, error } = await write(lean));
  }
  if (error && /facet/.test(error.message)) {
    const { facet, parent_id, ...lean } = row;
    ({ data, error } = await write(lean));
  }

  if (error) {
    const rls = /row-level security|violates row-level/i.test(error.message);
    return NextResponse.json(
      {
        error: rls && b.kind === 'brand'
          ? 'Suggestions are not switched on yet. Run supabase/brand-feedback.sql.'
          : error.message,
      },
      { status: rls ? 403 : 500 }
    );
  }

  // What the suggestion is about, for the subject line. Read on the caller's session,
  // so a client cannot use this to learn the title of a row they cannot already see.
  let about: string | null = null;
  if (data?.parent_id) {
    const { data: p } = await supabase
      .from('project_notes').select('title').eq('id', data.parent_id).single();
    about = p?.title ?? null;
  }

  // Fire and forget, and swallowed on purpose. A saved note must never report failure
  // because an email did not send: the note is the thing that mattered and it is saved.
  notifyOfNote({
    projectId: b.project_id,
    kind: b.kind,
    from: user.email ?? 'a client',
    title: data?.title ?? '',
    body: data?.body ?? '',
    about,
  })
    .then(() => record('notify', true, 'console note', { kind: b.kind }))
    .catch((e) => {
      console.error('notifyOfNote failed', e);
      // The note is saved either way. This only records that the studio was not told,
      // which is exactly the failure that is otherwise invisible.
      record('notify', false, e?.message ?? 'send failed', { kind: b.kind });
    });

  return NextResponse.json({ ok: true, id: data?.id });
}
