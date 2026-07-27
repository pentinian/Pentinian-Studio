#!/usr/bin/env node
/**
 * Invite a client. Access is invitation only, so this is the only way in.
 *
 *   set -a; source .env.local; set +a
 *   node scripts/invite-client.mjs client@theircompany.com
 *
 * Sends Supabase's invite email, which creates the account and lets them set a
 * session by clicking through. After that they sign in with a magic link like
 * anyone else. They land on their Window; they are never staff.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const email = process.argv[2];

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
if (!email) {
  console.error('Usage: node scripts/invite-client.mjs <email>');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
  redirectTo: `${site}/auth/callback`,
});

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`Invited ${email} (id ${data.user.id}).`);
console.log(`Redirect set to ${site}/auth/callback. Make sure that URL is in Supabase > Authentication > URL Configuration.`);
