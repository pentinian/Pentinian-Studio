import { createHmac, timingSafeEqual } from 'node:crypto';

// A mail key: the thing a link in a letter from the studio carries so that the
// person it was written to arrives already signed in.
//
// Why not a Supabase magic link. Those die after one use and within the hour (a
// day at the very most), and the weekly letter is read on a Monday as often as
// on the Friday it goes out. A mail scanner that follows links before the reader
// does would also spend it. A mail key is checked here instead, by signature, so
// it works for as long as it says it does and as often as it is pressed.
//
// What that costs, stated plainly: for its lifetime the letter IS a key. Whoever
// holds the letter (a forward, a shared inbox) can open that person's Window. So:
//   - it is never minted for staff; the route refuses an admin outright;
//   - it carries an end date, and the route refuses it after;
//   - every key issued before `app_metadata.mail_keys_after` is dead, which is
//     how one letter that went astray is revoked without touching the others'
//     owners (scripts/mail-key.mjs --revoke).
//
// The signing secret is MAIL_KEY_SECRET when set. Otherwise it is derived from
// the service role key, so the feature needs no new setting to exist, and
// rotating that key ends every outstanding link, which is the right side to
// fail on. scripts/mail-key.mjs carries the same few lines; verify-mail-key.mjs
// mints with the script's copy and reads with the route, so the two cannot drift
// apart unnoticed.

export type MailKey = { userId: string; issued: number; expires: number };

function secret(): string {
  const own = process.env.MAIL_KEY_SECRET;
  if (own) return own;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svc) throw new Error('No signing secret: SUPABASE_SERVICE_ROLE_KEY is missing');
  return createHmac('sha256', svc).update('pentinian mail key v1').digest('hex');
}

const sign = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');

/** Mint a key for one person. `days` is how long the letter stays a key. */
export function signMailKey(userId: string, days: number, now = Date.now()): string {
  const issued = Math.floor(now / 1000);
  const body = Buffer.from(
    JSON.stringify({ u: userId, i: issued, e: issued + Math.round(days * 86400) })
  ).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** Read a key. Null for anything malformed, forged or past its end date. */
export function readMailKey(key: string | null | undefined, now = Date.now()): MailKey | null {
  if (!key || key.length > 600) return null;
  const [body, sig, extra] = key.split('.');
  if (!body || !sig || extra !== undefined) return null;
  let good: Buffer, given: Buffer;
  try {
    good = Buffer.from(sign(body));
    given = Buffer.from(sig);
  } catch {
    return null;
  }
  if (good.length !== given.length || !timingSafeEqual(good, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof p.u !== 'string' || typeof p.i !== 'number' || typeof p.e !== 'number') return null;
    if (p.e * 1000 <= now) return null;
    return { userId: p.u, issued: p.i, expires: p.e };
  } catch {
    return null;
  }
}
