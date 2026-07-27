#!/usr/bin/env node
/**
 * Grant or revoke studio access.
 *
 *   node scripts/grant-admin.mjs you@domain.com          # make admin
 *   node scripts/grant-admin.mjs you@domain.com --revoke # take it away
 *
 * Reads the keys from the environment so no secret is ever written into the repo:
 *
 *   set -a; source .env.local; set +a
 *   node scripts/grant-admin.mjs you@domain.com
 *
 * Writes app_metadata.role, which a user cannot change about themselves. That is
 * the whole reason the gate trusts it.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];
const revoke = process.argv.includes('--revoke');

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
if (!email) {
  console.error('Usage: node scripts/grant-admin.mjs <email> [--revoke]');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

// listUsers is paginated; walk until we find the address or run out.
async function findUser(target) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === target.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

const user = await findUser(email);
if (!user) {
  console.error(`No account for ${email}. Invite them first (see invite-client.mjs).`);
  process.exit(1);
}

const { error } = await admin.auth.admin.updateUserById(user.id, {
  app_metadata: { ...user.app_metadata, role: revoke ? null : 'admin' },
});
if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`${revoke ? 'Revoked' : 'Granted'} studio access for ${email}.`);
console.log('They need to sign out and back in for the new role to reach their session.');
