import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { record } from '@/lib/events';
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
  if (!b?.client_id || !['suspend', 'restore'].includes(b.action)) {
    return NextResponse.json({ error: 'Need a client and an action' }, { status: 400 });
  }

  const db = admin();
  const { data: client } = await db.from('clients').select('id,name,user_id').eq('id', b.client_id).single();
  if (!client) return NextResponse.json({ error: 'No such person' }, { status: 404 });

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
