import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { notifyOfAccessRequest, notifyOfDecline } from '@/lib/notify';
import { record } from '@/lib/events';
import { NextResponse } from 'next/server';

// The knock at the door, and the hand that opens it.
//
// POST is the only public writing surface in the whole app, so it is deliberately
// boring: it accepts an email and a line of context, dedupes, tells Pen, and answers
// the same way no matter what it learned. The response never varies by whether the
// address is already a client, already pending, or brand new, because a door that
// answers differently for known names is an oracle for guessing who the clients are.
//
// GET and PATCH are the Atelier's side and require the admin session. Approving is
// the single place a stranger becomes a client: it makes the client row, their
// project, and their sign-in, in that order, and is written so pressing it twice
// finishes the job rather than duplicating it.

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.app_metadata?.role === 'admin' ? user : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Best-effort per-instance throttle. Serverless instances are ephemeral so this is
// not a wall, only a speed bump; the real guard is the pending-row dedupe below.
const recent = new Map<string, number>();
const throttled = (key: string) => {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > 600000) recent.delete(k);
  if ((recent.get(key) ?? 0) > now - 60000) return true;
  recent.set(key, now);
  return false;
};

export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const email = String(b?.email ?? '').trim().toLowerCase();
  const name = String(b?.name ?? '').trim().slice(0, 120) || null;
  const note = String(b?.note ?? '').trim().slice(0, 600) || null;

  if (!EMAIL.test(email) || email.length > 200) {
    return NextResponse.json({ error: 'That does not look like an email address.' }, { status: 400 });
  }

  // One generic answer for every path below this line.
  const ok = NextResponse.json({ ok: true });

  if (throttled(email)) return ok;

  const db = admin();

  // Already asked and still waiting: same answer, no second row, no second email.
  const { data: pending } = await db
    .from('access_requests')
    .select('id')
    .eq('status', 'pending')
    .ilike('email', email)
    .limit(1);
  if (pending?.length) return ok;

  const { error } = await db.from('access_requests').insert({ email, name, note });
  if (error) {
    // The one failure worth surfacing in health, because a broken door is silent by
    // nature: the person outside assumes it worked and nobody inside hears a thing.
    record('access', false, error.message, { email });
    return ok;
  }

  record('access', true, 'request received', { email });

  // Fire and forget, same contract as every notification here: the ask is saved and
  // that is the thing that matters. The email only shortens the wait.
  notifyOfAccessRequest({ email, name, note }).catch((e) => {
    console.error('notifyOfAccessRequest failed', e);
    record('notify', false, e?.message ?? 'send failed', { kind: 'access' });
  });

  return ok;
}

export async function GET() {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const db = admin();
  const { data, error } = await db
    .from('access_requests')
    .select('id,email,name,note,status,created_at,decided_at')
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    requests: data ?? [],
    waiting: (data ?? []).filter((r) => r.status === 'pending').length,
  });
}

export async function PATCH(request: Request) {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  if (!b?.id || !['approve', 'decline'].includes(b.action)) {
    return NextResponse.json({ error: 'Need an id and an action' }, { status: 400 });
  }

  const db = admin();
  const { data: req } = await db.from('access_requests').select('*').eq('id', b.id).single();
  if (!req) return NextResponse.json({ error: 'No such request' }, { status: 404 });

  if (b.action === 'decline') {
    await db
      .from('access_requests')
      .update({ status: 'declined', decided_at: new Date().toISOString() })
      .eq('id', req.id);

    // One kind line back, and the truth about whether it went out. Awaited rather
    // than fire-and-forget because the panel reports the send, and a report should
    // describe something that has happened, not something that was hoped.
    let noted = false;
    try {
      noted = await notifyOfDecline({ email: req.email, name: req.name });
    } catch (e: any) {
      console.error('notifyOfDecline failed', e);
      record('notify', false, e?.message ?? 'send failed', { kind: 'decline' });
    }
    return NextResponse.json({ ok: true, noted });
  }

  // ---- approve: the one place a stranger becomes a client -----------------------
  const email = req.email.toLowerCase();
  const display = req.name || email.split('@')[0];

  // 1. The client row. Found by email if Pen already made one by hand.
  let { data: client } = await db
    .from('clients')
    .select('id,name,user_id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle();
  if (!client) {
    const { data: made, error } = await db
      .from('clients')
      .insert({ name: display, email })
      .select('id,name,user_id')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    client = made;
  }

  // 2. Their sign-in. inviteUserByEmail both creates the account and sends the
  // invitation, so the person hears "you are in" without another moving part. If the
  // account already exists the invite call refuses, and the lookup path covers it:
  // approving twice, or approving someone Pen invited by hand, still converges.
  const cb = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://studio.pentinian.com'}/auth/callback`;
  let userId: string | null = client.user_id ?? null;
  if (!userId) {
    const { data: invited, error: invErr } = await db.auth.admin.inviteUserByEmail(email, {
      redirectTo: cb,
    });
    if (invited?.user) {
      userId = invited.user.id;
    } else if (invErr) {
      // Probably already registered. Find rather than fail.
      const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      userId = list?.users?.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
      if (!userId) return NextResponse.json({ error: invErr.message }, { status: 500 });
    }
    await db.from('clients').update({ user_id: userId }).eq('id', client.id);
  }

  // 3. A place for their Window to look at. Client-facing from the first moment, so
  // the empty state they meet is "nothing released yet" rather than a blank wall.
  const { data: existing } = await db
    .from('projects')
    .select('id')
    .eq('client_id', client.id)
    .limit(1);
  if (!existing?.length) {
    const { error } = await db
      .from('projects')
      .insert({ client_id: client.id, name: display, client_facing: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await db
    .from('access_requests')
    .update({ status: 'approved', decided_at: new Date().toISOString() })
    .eq('id', req.id);

  record('access', true, 'approved', { email });
  return NextResponse.json({ ok: true });
}
