import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { record } from '@/lib/events';
import { logMail } from '@/lib/mail';
import { NextResponse } from 'next/server';

// Who can walk in, and the hand on the latch. Staff only.
//
// Suspension keeps everything: the person's sign-in is banned at the auth layer
// so no magic link, passkey, or live session survives it, but their Window,
// project, and every exchanged word stay whole. Restore is one press, because a
// removal that destroys history is a decision nobody should make in one click.

export const dynamic = 'force-dynamic';

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function staffOnly() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.app_metadata?.role === 'admin' ? user : null;
}

export async function GET() {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
  const db = admin();
  const { data: clients, error } = await db
    .from('clients')
    .select('id,name,email,user_id,suspended,created_at')
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ people: clients ?? [] });
}

export async function PATCH(request: Request) {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  if (!b?.client_id || !['suspend', 'restore', 'invite'].includes(b.action)) {
    return NextResponse.json({ error: 'Need a client and an action' }, { status: 400 });
  }

  const db = admin();
  const { data: client } = await db
    .from('clients')
    .select('id,name,email,user_id')
    .eq('id', b.client_id)
    .single();
  if (!client) return NextResponse.json({ error: 'No such person' }, { status: 404 });

  // Letting someone in.
  //
  // The same two steps the door already runs when an ask is approved, reachable
  // from the list as well, because a client added by hand is in exactly the state
  // an approved one is and had no way through. Inviting twice is safe: if the
  // account exists, find it and attach rather than fail, so a second press
  // converges instead of erroring.
  if (b.action === 'invite') {
    const email = String(client.email ?? '').trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { error: `${client.name} has no email address on file, so there is nowhere to send it.` },
        { status: 400 }
      );
    }
    if (client.user_id) {
      return NextResponse.json({ error: `${client.name} can already sign in.` }, { status: 400 });
    }

    const cb = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://studio.pentinian.com'}/auth/callback`;
    let userId: string | null = null;
    const { data: invited, error: invErr } = await db.auth.admin.inviteUserByEmail(email, {
      redirectTo: cb,
    });
    if (invited?.user) {
      userId = invited.user.id;
    } else {
      const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      userId = list?.users?.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
      if (!userId) {
        return NextResponse.json(
          { error: invErr?.message ?? 'The invitation did not go out.' },
          { status: 502 }
        );
      }
    }

    await db.from('clients').update({ user_id: userId, suspended: false }).eq('id', client.id);
    logMail({
      kind: 'invite', to_email: email, client_id: client.id,
      subject: 'You have been invited', body: 'Supabase invitation email',
      status: 'sent', sent_at: new Date().toISOString(),
    });
    record('access', true, 'invited', { client: client.name });
    return NextResponse.json({ ok: true, invited: !!invited?.user });
  }

  if (client.user_id) {
    // A ban of a hundred years rather than a deletion: reversible on purpose.
    const { error } = await db.auth.admin.updateUserById(client.user_id, {
      ban_duration: b.action === 'suspend' ? '876000h' : 'none',
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await db.from('clients').update({ suspended: b.action === 'suspend' }).eq('id', client.id);
  record('access', true, b.action, { client: client.name });
  return NextResponse.json({ ok: true });
}
