import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { notifyOfLetter } from '@/lib/notify';
import { record } from '@/lib/events';

// Real letters arriving. Resend receives mail for pentinian.com and delivers
// each one here as a signed webhook; verified, it becomes an inbound row in the
// ledger, so a reply to hello@ lands in the same room as everything the studio
// ever said. The signature check is not optional dressing: an unsigned POST to
// this route is just a stranger claiming to be the postman.
//
// Refuses with 503 until RESEND_WEBHOOK_SECRET exists, so the surface is dark
// rather than gullible while unconfigured.

export const dynamic = 'force-dynamic';

function verify(secret: string, id: string, timestamp: string, payload: string, signatures: string): boolean {
  // Svix scheme, implemented directly: HMAC-SHA256 over "id.timestamp.payload"
  // with the base64 secret (after the whsec_ prefix), compared against any of
  // the space-separated "v1,<base64>" entries.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signed = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64');
  return signatures.split(' ').some((s) => {
    const [v, sig] = s.split(',');
    if (v !== 'v1' || !sig) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(sig));
    } catch {
      return false;
    }
  });
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Not configured' }, { status: 503 });

  const id = request.headers.get('svix-id') ?? '';
  const timestamp = request.headers.get('svix-timestamp') ?? '';
  const signature = request.headers.get('svix-signature') ?? '';
  const payload = await request.text();

  if (!id || !timestamp || !signature || !verify(secret, id, timestamp, payload, signature)) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 });
  }
  // Stale deliveries are replays until proven otherwise.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return NextResponse.json({ error: 'Too old' }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 });
  }
  if (event?.type !== 'email.received') return NextResponse.json({ ok: true, ignored: true });

  const d = event.data ?? {};
  const from = String(d.from ?? '').slice(0, 300);
  const to = Array.isArray(d.to) ? d.to.join(', ').slice(0, 300) : String(d.to ?? '').slice(0, 300);
  const subject = String(d.subject ?? '(no subject)').slice(0, 300);
  const text = String(d.text ?? d.html ?? '').slice(0, 8000);

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Filed against the client if the sender is one, so their thread is whole.
  const bare = from.match(/<([^>]+)>/)?.[1] ?? from;
  const { data: client } = await db
    .from('clients')
    .select('id')
    .ilike('email', bare.trim())
    .limit(1)
    .maybeSingle();

  await db.from('mail_ledger').insert({
    kind: 'inbound',
    from_email: from,
    to_email: to,
    client_id: client?.id ?? null,
    subject,
    body: text,
    status: 'received',
    sent_at: new Date().toISOString(),
  });

  // Told, not just filed. Resend needs its 200 whatever happens next, so the
  // forward is awaited and swallowed rather than allowed to fail the delivery:
  // a notification that did not send must never cost the studio the letter.
  let name: string | null = null;
  if (client?.id) {
    const { data: c } = await db.from('clients').select('name').eq('id', client.id).maybeSingle();
    name = c?.name ?? null;
  }
  try {
    await notifyOfLetter({ from, subject, text, client: name });
    record('notify', true, 'letter forwarded', { from });
  } catch (e: any) {
    record('notify', false, e?.message ?? 'letter forward failed', { from });
  }

  return NextResponse.json({ ok: true });
}
