import { createClient } from '@supabase/supabase-js';

// The post room's machinery: one brand wrapper, one send path, one ledger.
//
// Every email the studio writes by hand or by schedule goes through sendBranded,
// which wraps it in the house look, sends it through Resend, and records it in
// mail_ledger whatever happens. The ledger is the memory; the Atelier's
// Correspondence room is just a reading of it.
//
// Scheduled letters go out with the morning post: the daily cron flushes
// everything due. That is a feature wearing the Hobby plan's constraint; a
// studio that answers at 6am reads as composed, not slow.

const db = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

export const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain paragraphs to brand HTML. Blank lines split paragraphs; nothing fancier,
 *  because a letter should read like a letter. */
export function wrapBrand(bodyText: string): string {
  const paras = bodyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="font:400 15px/1.65 Georgia,'Times New Roman',serif;color:#23251E;margin:0 0 16px">${escHtml(p).replace(/\n/g, '<br/>')}</p>`
    )
    .join('');
  return `
  <div style="background:#FAF7EF;padding:34px 8px">
    <div style="max-width:560px;margin:0 auto;background:#FDFBF5;border:1px solid #E4DFD2;border-radius:10px;padding:34px 38px">
      <div style="font:500 10px/1 system-ui,sans-serif;letter-spacing:.24em;color:#5E7355;margin:0 0 6px">P E N T I N I A N</div>
      <div style="height:1px;background:#E4DFD2;margin:14px 0 22px"></div>
      ${paras}
      <div style="height:1px;background:#E4DFD2;margin:26px 0 14px"></div>
      <p style="font:400 11.5px/1.6 system-ui,sans-serif;color:#8E8D7F;margin:0">
        Pentinian, Independent Studio · <a href="https://pentinian.com" style="color:#5E7355">pentinian.com</a>
      </p>
    </div>
  </div>`;
}

type LedgerRow = {
  kind: 'notify' | 'decline' | 'invite' | 'manual' | 'digest' | 'inbound';
  to_email?: string | null;
  from_email?: string | null;
  client_id?: string | null;
  project_id?: string | null;
  subject?: string | null;
  body?: string | null;
  status?: 'sent' | 'scheduled' | 'canceled' | 'failed' | 'received';
  scheduled_for?: string | null;
  sent_at?: string | null;
  error?: string | null;
};

/** Write to the ledger and never let bookkeeping break the thing it records. */
export async function logMail(row: LedgerRow): Promise<void> {
  try {
    await db().from('mail_ledger').insert(row);
  } catch {
    // The send mattered; the receipt did not.
  }
}

/** The wire itself: wrap, send, report. No bookkeeping here, so the ledger can
 *  hold exactly one row per letter whether it went now or with the morning post. */
async function deliver(to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY missing' };
  const home = (process.env.STUDIO_NOTIFY_EMAIL ?? '').split(',')[0]?.trim();
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.STUDIO_NOTIFY_FROM ?? 'Pentinian <hello@pentinian.com>',
        to: [to],
        ...(home ? { reply_to: home } : {}),
        subject,
        html: wrapBrand(body),
      }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'send threw' };
  }
}

/** Send a branded letter now and record it: one letter, one ledger row. */
export async function sendBranded(opts: {
  to: string;
  subject: string;
  body: string;
  kind?: LedgerRow['kind'];
  client_id?: string | null;
  project_id?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const r = await deliver(opts.to, opts.subject, opts.body);
  await logMail({
    kind: opts.kind ?? 'manual',
    to_email: opts.to,
    client_id: opts.client_id ?? null,
    project_id: opts.project_id ?? null,
    subject: opts.subject,
    body: opts.body,
    status: r.ok ? 'sent' : 'failed',
    sent_at: r.ok ? new Date().toISOString() : null,
    error: r.ok ? null : r.error,
  });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** The morning post: everything scheduled for now or earlier goes out, and the
 *  plan row itself becomes the sent row. Marked before sending so a crashed
 *  flush cannot double-send tomorrow; a letter lost to a crash shows as sent
 *  with no delivery, which the Resend log disambiguates. */
export async function flushDue(): Promise<{ sent: number; failed: number }> {
  const client = db();
  const { data: due } = await client
    .from('mail_ledger')
    .select('id,to_email,subject,body')
    .eq('status', 'scheduled')
    .lte('scheduled_for', new Date().toISOString())
    .limit(40);

  let sent = 0, failed = 0;
  for (const m of due ?? []) {
    if (!m.to_email || !m.subject || !m.body) {
      await client.from('mail_ledger').update({ status: 'failed', error: 'missing fields' }).eq('id', m.id);
      failed += 1;
      continue;
    }
    await client.from('mail_ledger').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', m.id);
    const r = await deliver(m.to_email, m.subject, m.body);
    if (!r.ok) {
      await client.from('mail_ledger').update({ status: 'failed', error: r.error ?? 'send failed' }).eq('id', m.id);
      failed += 1;
    } else sent += 1;
  }
  return { sent, failed };
}
