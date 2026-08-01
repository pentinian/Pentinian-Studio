import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { sendBranded, logMail } from '@/lib/mail';
import { NextResponse } from 'next/server';

// The composer's wire. Staff only, every verb.
//
// POST writes a letter: sent now, or laid on the pile for the morning post if a
// future date is given. GET reads the ledger newest first plus the scheduled
// pile. PATCH cancels a scheduled letter or pushes it out immediately.

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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function GET() {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
  const db = admin();
  const { data: ledger, error } = await db
    .from('mail_ledger')
    .select('id,kind,to_email,from_email,subject,body,status,scheduled_for,sent_at,created_at,error,client_id,project_id')
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const scheduled = (ledger ?? []).filter((m) => m.status === 'scheduled');
  return NextResponse.json({ ledger: ledger ?? [], scheduled });
}

export async function POST(request: Request) {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  const to = String(b?.to ?? '').trim().toLowerCase();
  const subject = String(b?.subject ?? '').trim().slice(0, 200);
  const body = String(b?.body ?? '').trim().slice(0, 8000);
  const clientId = b?.client_id || null;
  const projectId = b?.project_id || null;
  const when = b?.send_on ? new Date(String(b.send_on) + 'T14:00:00Z') : null;

  if (!EMAIL.test(to)) return NextResponse.json({ error: 'That does not look like an address.' }, { status: 400 });
  if (!subject || !body) return NextResponse.json({ error: 'A letter needs a subject and something said.' }, { status: 400 });

  // A future date lays it on the pile; anything else goes now. The 14:00 UTC is
  // the cron's own hour, so "scheduled for the 12th" means the morning post of
  // the 12th, and a date of today simply sends.
  if (when && !isNaN(when.getTime()) && when.getTime() > Date.now()) {
    await logMail({
      kind: 'manual', to_email: to, client_id: clientId, project_id: projectId,
      subject, body, status: 'scheduled', scheduled_for: when.toISOString(),
    });
    return NextResponse.json({ ok: true, scheduled: true });
  }

  const r = await sendBranded({ to, subject, body, kind: 'manual', client_id: clientId, project_id: projectId });
  if (!r.ok) return NextResponse.json({ error: r.error ?? 'The send did not go through.' }, { status: 502 });
  return NextResponse.json({ ok: true, sent: true });
}

export async function PATCH(request: Request) {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const b = await request.json().catch(() => ({}));
  if (!b?.id || !['cancel', 'send-now'].includes(b.action)) {
    return NextResponse.json({ error: 'Need an id and an action' }, { status: 400 });
  }

  const db = admin();
  const { data: m } = await db.from('mail_ledger').select('*').eq('id', b.id).single();
  if (!m || m.status !== 'scheduled') return NextResponse.json({ error: 'Not on the pile' }, { status: 404 });

  if (b.action === 'cancel') {
    await db.from('mail_ledger').update({ status: 'canceled' }).eq('id', m.id);
    return NextResponse.json({ ok: true });
  }

  // send-now: the plan row becomes the event, same as the morning post does it.
  await db.from('mail_ledger').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', m.id);
  const r = await sendBranded({
    to: m.to_email, subject: m.subject, body: m.body, kind: m.kind,
    client_id: m.client_id, project_id: m.project_id,
  });
  // sendBranded logged the real event; remove the plan row so one letter is one row.
  await db.from('mail_ledger').delete().eq('id', m.id);
  if (!r.ok) return NextResponse.json({ error: r.error ?? 'The send did not go through.' }, { status: 502 });
  return NextResponse.json({ ok: true, sent: true });
}
