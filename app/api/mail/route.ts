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

const dur = (m: number) => {
  const h = Math.floor(m / 60), r = m % 60;
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
};

export async function GET(request: Request) {
  if (!(await staffOnly())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
  const db = admin();

  // ?digest=projectId: prebuild this week's check-in from the released log. It
  // returns a draft for the composer, never a send: client-facing words pass
  // through hands in this studio, the same doctrine as the release gate.
  const digestFor = new URL(request.url).searchParams.get('digest');
  if (digestFor) {
    const { data: proj } = await db
      .from('projects')
      .select('id,name,client_id, clients:client_id (name,email)')
      .eq('id', digestFor)
      .single();
    if (!proj) return NextResponse.json({ error: 'No such project' }, { status: 404 });

    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: entries } = await db
      .from('work_log_released')
      .select('title,eli5,minutes,started_at,created_at,visible,release_at')
      .eq('project_id', proj.id)
      .gte('created_at', weekAgo)
      .order('started_at', { ascending: true });

    const live = (entries ?? []).filter(
      (e) => e.visible && (!e.release_at || new Date(e.release_at).getTime() <= Date.now())
    );
    if (live.length === 0) {
      return NextResponse.json({ error: 'Nothing released this week on that project.' }, { status: 404 });
    }

    const byDay = new Map<string, typeof live>();
    for (const e of live) {
      const d = new Date(e.started_at ?? e.created_at).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      });
      byDay.set(d, [...(byDay.get(d) ?? []), e]);
    }
    const total = live.reduce((n, e) => n + (e.minutes ?? 0), 0);

    const client: any = proj.clients;
    const first = (client?.name ?? '').trim().split(/\s+/)[0];
    const lines: string[] = [];
    lines.push(`Hello${first ? ' ' + first : ''}.`);
    lines.push(`Here is the week at the studio on ${proj.name}.`);
    for (const [day, es] of byDay) {
      const mins = es.reduce((n, e) => n + (e.minutes ?? 0), 0);
      lines.push(`${day}${mins ? ` · ${dur(mins)}` : ''}\n` + es.map((e) => `${e.title}${e.eli5 ? `: ${e.eli5}` : ''}`).join('\n'));
    }
    lines.push(`${total ? `About ${dur(total)} across ${byDay.size} day${byDay.size === 1 ? '' : 's'} this week. ` : ''}Every entry sits in your Window with the full notes and hours.`);
    lines.push('Pen');

    return NextResponse.json({
      draft: {
        to: client?.email ?? '',
        client_id: proj.client_id,
        project_id: proj.id,
        subject: `The week at the studio: ${proj.name}`,
        body: lines.join('\n\n'),
      },
    });
  }
  const { data: ledger, error } = await db
    .from('mail_ledger')
    .select('id,kind,to_email,from_email,subject,body,status,scheduled_for,sent_at,created_at,error,client_id,project_id')
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const scheduled = (ledger ?? []).filter((m) => m.status === 'scheduled');
  // Counted against the whole table rather than the page of it that was fetched, or a
  // letter that fell past the eightieth row would stop being waiting without being read.
  const { count } = await db
    .from('mail_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'inbound')
    .eq('status', 'received');
  return NextResponse.json({ ledger: ledger ?? [], scheduled, waiting: count ?? 0 });
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
  if (!b?.id || !['cancel', 'send-now', 'read'].includes(b.action)) {
    return NextResponse.json({ error: 'Need an id and an action' }, { status: 400 });
  }

  const db = admin();

  // Marking a letter read.
  //
  // Kept in the status the row already carries rather than in a new column, because
  // read is a state a letter is in and the column for that exists. Received means
  // waiting; read means someone opened it. Only inbound has the distinction: the
  // studio's own sends were read as they were written.
  if (b.action === 'read') {
    const { error } = await db
      .from('mail_ledger')
      .update({ status: 'read' })
      .eq('id', b.id)
      .eq('kind', 'inbound')
      .eq('status', 'received');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

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
