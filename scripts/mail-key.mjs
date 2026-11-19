#!/usr/bin/env node
/**
 * Mint a mail key: the link a letter carries so its reader arrives signed in.
 *
 *   set -a; source .env.local; set +a
 *   node scripts/mail-key.mjs someone@example.com                 the Window, 8 days
 *   node scripts/mail-key.mjs someone@example.com --days 3
 *   node scripts/mail-key.mjs someone@example.com --next '/api/window-log?...'
 *   node scripts/mail-key.mjs someone@example.com --revoke        end every key they hold
 *
 * The address is the one their ACCOUNT carries, which is not always the one the
 * letter is mailed to. The key names the account, not the mailbox.
 *
 * The link is a live credential for as long as it says. It prints to stdout and
 * nowhere else, so a builder can take it straight into a letter: do not paste it
 * into a chat or a ticket. Everything a person should read prints to stderr.
 *
 * Never for staff: the route refuses an admin, and so does this.
 *
 * The signing lines below are a copy of lib/auth/mail-key.ts on purpose (a
 * script cannot import the app's TypeScript). verify-mail-key.mjs mints here and
 * reads through the route, so if the two ever disagree the gate goes red.
 */
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function mailKeySecret() {
  if (process.env.MAIL_KEY_SECRET) return process.env.MAIL_KEY_SECRET;
  return createHmac('sha256', SVC).update('pentinian mail key v1').digest('hex');
}

/** `issued` is in seconds; passing it is how the verifier makes an old key. */
export function mintMailKey(userId, days, issued = Math.floor(Date.now() / 1000)) {
  const body = Buffer.from(
    JSON.stringify({ u: userId, i: issued, e: issued + Math.round(days * 86400) })
  ).toString('base64url');
  return `${body}.${createHmac('sha256', mailKeySecret()).update(body).digest('base64url')}`;
}

export function mailKeyUrl(site, key, next) {
  const u = new URL('/auth/mail', site);
  u.searchParams.set('k', key);
  if (next) u.searchParams.set('next', next);
  return u.toString();
}

const direct = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (direct) {
  if (!URL_ || !SVC) {
    console.error('Missing env. Run: set -a; source .env.local; set +a');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const email = args.find((a) => a.includes('@'));
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (!email) {
    console.error('Usage: node scripts/mail-key.mjs someone@example.com [--days 8] [--next /window] [--site URL] [--revoke]');
    process.exit(1);
  }
  const days = Number(flag('--days') ?? 8);
  if (!(days > 0 && days <= 31)) {
    console.error('--days must be between 0 and 31. A letter should not be a key for longer than a month.');
    process.exit(1);
  }
  const next = flag('--next') ?? '/window';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/atelier')) {
    console.error('--next must be a path on this site, and never the Atelier.');
    process.exit(1);
  }
  // Blank is not unset: .env.local ships NEXT_PUBLIC_SITE_URL= with nothing after it.
  const site = flag('--site') || process.env.NEXT_PUBLIC_SITE_URL || 'https://studio.pentinian.com';

  const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
  const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) {
    console.error('Could not read the user list:', error.message);
    process.exit(1);
  }
  const user = (list?.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`No account for ${email}. This script never creates one.`);
    process.exit(1);
  }
  if (user.app_metadata?.role === 'admin') {
    console.error('That account is staff. A letter never carries a key to the Atelier.');
    process.exit(1);
  }

  if (args.includes('--revoke')) {
    const now = Math.floor(Date.now() / 1000);
    const { error: upErr } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, mail_keys_after: now },
    });
    if (upErr) {
      console.error('Could not revoke:', upErr.message);
      process.exit(1);
    }
    console.error(`Every mail key issued to ${email} before now is dead. Sessions already open are not ended by this.`);
    process.exit(0);
  }

  const key = mintMailKey(user.id, days);
  const ends = new Date((Math.floor(Date.now() / 1000) + Math.round(days * 86400)) * 1000);
  console.error(`Mail key for ${email}, opens ${next}, good until ${ends.toISOString().slice(0, 16).replace('T', ' ')} UTC.`);
  process.stdout.write(mailKeyUrl(site, key, next) + '\n');
}
