#!/usr/bin/env node
/**
 * Mint a sign-in link without sending an email.
 *
 *   set -a; source .env.local; set +a
 *   node scripts/sign-in-link.mjs you@example.com
 *
 * The built-in Supabase email service allows two emails per hour across the whole
 * project, and that ceiling can only be raised with custom SMTP. Hit it and email
 * sign-in stops working entirely until the hour rolls over. This is the way back in
 * when that happens: the admin API returns the same link the email would have
 * carried, so nothing is sent and nothing is counted.
 *
 * The link is a live credential. It grants whatever the account grants, so treat it
 * the way you would treat the email itself: it prints to your terminal and nowhere
 * else, do not paste it into a chat or a ticket, and it dies the moment it is used.
 *
 * The service key is read from the environment on purpose. It is never taken as an
 * argument, because arguments end up in shell history.
 */
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

if (!URL_ || !SVC) {
  console.error('Missing env. Run: set -a; source .env.local; set +a');
  process.exit(1);
}

const email = process.argv[2];
if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/sign-in-link.mjs you@example.com');
  process.exit(1);
}

const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

// Only ever for someone who already exists. generateLink would happily create an
// account otherwise, and access here is invite only.
const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
if (listErr) {
  console.error('Could not read the user list:', listErr.message);
  process.exit(1);
}
const user = (list?.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  console.error(`No account for ${email}. This script never creates one.`);
  process.exit(1);
}

const { data, error } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: { redirectTo: `${SITE}/auth/callback` },
});

if (error) {
  console.error('Could not mint a link:', error.message);
  process.exit(1);
}

const role = user.app_metadata?.role ?? 'client';

console.log(`
  Account   ${email}   (${role})
  No email was sent, so your hourly quota is untouched.

  Open this once, in the browser you want to stay signed in:

  ${data.properties.action_link}

  It is single use and short lived. Once you are in, add a passkey from
  Atelier, Access, and you should not need this again.
`);
