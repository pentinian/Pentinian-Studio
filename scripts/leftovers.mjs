#!/usr/bin/env node
/**
 * Counts test residue left behind by the verify-* scripts.
 *
 *   set -a; source .env.local; set +a
 *   node scripts/leftovers.mjs
 *
 * Every verifier here creates a throwaway user, client and project, then deletes
 * them. That teardown is the data net for this repo, so it has to be readable
 * rather than assumed: a verifier that dies mid-run leaves rows behind, and the
 * next person to look at the clients table finds test companies in it.
 *
 * Exits nonzero when residue exists, so it can gate work the way a smoke does.
 */
import { createClient } from '@supabase/supabase-js';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const S = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !S) {
  console.error('Missing env. Run: set -a; source .env.local; set +a');
  process.exit(1);
}

const svc = createClient(U, S, { auth: { persistSession: false } });

// The address every verifier stamps its throwaway users with. A real person can
// never hold one: .test is reserved by RFC 2606 and resolves nowhere.
const TEST_DOMAIN = '@pentinian.test';
const TEST_CO = /Test Co|Test Project|Privacy Test|Reply Test|Other Co|Other Project/i;

let residue = 0;

const { data: users, error: uErr } = await svc.auth.admin.listUsers({ perPage: 1000 });
if (uErr) { console.error('could not list users:', uErr.message); process.exit(1); }
const testUsers = (users?.users ?? []).filter((u) => (u.email ?? '').endsWith(TEST_DOMAIN));
console.log(`\nusers on ${TEST_DOMAIN}: ${testUsers.length}`);
for (const u of testUsers) console.log(`  LEFTOVER  ${u.email}  ${u.id}  created ${u.created_at}`);
residue += testUsers.length;

const { data: clients } = await svc.from('clients').select('id,name,email');
const testClients = (clients ?? []).filter(
  (c) => (c.email ?? '').endsWith(TEST_DOMAIN) || TEST_CO.test(c.name ?? '')
);
console.log(`test-shaped clients: ${testClients.length}`);
for (const c of testClients) console.log(`  LEFTOVER  ${c.name}  ${c.id}`);
residue += testClients.length;

const { data: projects } = await svc.from('projects').select('id,name');
const testProjects = (projects ?? []).filter((p) => TEST_CO.test(p.name ?? ''));
console.log(`test-shaped projects: ${testProjects.length}`);
for (const p of testProjects) console.log(`  LEFTOVER  ${p.name}  ${p.id}`);
residue += testProjects.length;

console.log(
  residue === 0
    ? '\nCLEAN: no test residue in the database.\n'
    : `\nRESIDUE: ${residue} row(s) above were left by a verifier that did not finish.\n`
);
process.exit(residue === 0 ? 0 : 1);
