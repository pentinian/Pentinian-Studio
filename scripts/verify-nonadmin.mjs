#!/usr/bin/env node
/**
 * The signed-in NON-ADMIN path, executed rather than inferred.
 *
 *   set -a; source .env.local; set +a
 *   APP=http://127.0.0.1:3001 node scripts/verify-nonadmin.mjs
 *
 * This is the one gap the README named as unproven on 2026-09-14: every other
 * boundary had been measured, but the middle case had only been read in the
 * source. Reading is not measurement. The three cases are:
 *
 *   signed out       -> bounced to /login          (proven 2026-09-14)
 *   signed in, staff -> the Atelier opens          (used daily)
 *   signed in, NOT staff -> ???                    <- this file
 *
 * A non-admin is the most interesting caller in the system, because they hold a
 * real session. Every check that merely asks "is anyone signed in" passes for
 * them. So the questions are: does the middleware send them to /no-access, does
 * their own Window still open, and does every staff API refuse them at the
 * route, independently of the middleware.
 *
 * That last point is why the API probes carry a cookie and expect 403 rather
 * than trusting the redirect: the middleware is one gate, and a gate you cannot
 * bypass in a test is a gate you have not tested. These call the routes
 * directly.
 *
 * Creates two throwaway users and deletes them in the finally block. Confirm
 * with scripts/leftovers.mjs afterwards.
 */
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID } from 'node:crypto';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const A = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const S = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Empty is not absent. `??` keeps an empty string, and .env.local ships APP= with
// nothing after it, so sourcing the env file and then relying on `??` produces
// fetch('/api/...') with no origin and a thrown URL parse. Treat blank as unset.
const APP = process.env.APP || 'http://127.0.0.1:3001';

if (!U || !A || !S) {
  console.error('Missing env. Run: set -a; source .env.local; set +a');
  process.exit(1);
}

const svc = createClient(U, S, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (m, d = '') => { pass++; console.log('  PASS  ' + m + (d ? '   ' + d : '')); };
const bad = (m, d = '') => { fail++; console.log('  FAIL  ' + m + (d ? '   ' + d : '')); };

/** A cookie header for this user, built the way the app itself builds one. */
async function cookieFor(email, password) {
  const { data, error } = await createClient(U, A, { auth: { persistSession: false } })
    .auth.signInWithPassword({ email, password });
  if (error) throw new Error('sign in failed: ' + error.message);
  const jar = [];
  const w = createServerClient(U, A, { cookies: { getAll: () => [], setAll: (l) => jar.push(...l) } });
  await w.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  return jar.map((k) => `${k.name}=${k.value}`).join('; ');
}

/* Every staff-only route and the methods it exports. Written out rather than
 * discovered at runtime, so adding a route without adding it here is visible in
 * a diff. A route that forgets its own role check is exactly the bug this
 * catches, and the middleware would hide it on a normal navigation. */
const STAFF_ROUTES = [
  ['GET',    '/api/quarry'],
  ['POST',   '/api/quarry'],
  ['PATCH',  '/api/quarry'],
  ['GET',    '/api/projects'],
  ['PATCH',  '/api/projects'],
  ['GET',    '/api/people'],
  ['PATCH',  '/api/people'],
  ['GET',    '/api/mail'],
  ['POST',   '/api/mail'],
  ['PATCH',  '/api/mail'],
  ['GET',    '/api/health'],
  ['GET',    '/api/brain'],
  ['POST',   '/api/brain'],
  ['POST',   '/api/brain/press'],
  ['POST',   '/api/brain/sync-hekate'],
  ['POST',   '/api/notion-sync'],
  ['GET',    '/api/access-request'],
  ['PATCH',  '/api/access-request'],
  ['GET',    '/api/console'],
  ['PATCH',  '/api/console'],
  ['POST',   '/api/console'],
  ['DELETE', '/api/console'],
];

const made = { users: [], clients: [], projects: [] };
const pw = randomUUID() + 'Aa1!';

try {
  const up = await fetch(APP, { redirect: 'manual' }).then(() => true).catch(() => false);
  if (!up) { console.error(`\nNothing answering at ${APP}. Start the app first.\n`); process.exit(1); }
  console.log(`\nagainst ${APP}`);

  console.log('\n=== seeding ===');
  const clientEmail = `nonadmin-client-${Date.now()}@pentinian.test`;
  const staffEmail = `nonadmin-staff-${Date.now()}@pentinian.test`;

  const { data: cu, error: cuErr } = await svc.auth.admin.createUser({
    email: clientEmail, password: pw, email_confirm: true,
  });
  if (cuErr) throw cuErr;
  made.users.push(cu.user.id);

  // The control. If the staff user cannot reach a route either, the probe is
  // broken rather than the gate being strict, and every 403 below is worthless.
  const { data: su, error: suErr } = await svc.auth.admin.createUser({
    email: staffEmail, password: pw, email_confirm: true, app_metadata: { role: 'admin' },
  });
  if (suErr) throw suErr;
  made.users.push(su.user.id);

  const { data: cl } = await svc.from('clients')
    .insert({ name: 'Nonadmin Test Co', email: clientEmail, user_id: cu.user.id }).select().single();
  made.clients.push(cl.id);
  const { data: pr } = await svc.from('projects')
    .insert({ client_id: cl.id, name: 'Nonadmin Test Project', phase: 'test' }).select().single();
  made.projects.push(pr.id);
  console.log('  a client with no role, and a staff control');

  const clientCookie = await cookieFor(clientEmail, pw);
  const staffCookie = await cookieFor(staffEmail, pw);

  /* -------------------------------------------------- the role itself ----- */
  console.log('\n=== the role as the server sees it ===');
  const meRes = await fetch(`${APP}/api/me`, { headers: { cookie: clientCookie }, cache: 'no-store' });
  const me = await meRes.json().catch(() => ({}));
  meRes.status === 200
    ? ok('a non-admin is signed in', String(meRes.status))
    : bad('/api/me refused a signed-in non-admin', String(meRes.status));
  if (me?.staff === false || me?.user?.staff === false) ok('and the server does not call them staff');
  else if (JSON.stringify(me).includes('"staff":true')) bad('the server calls them staff', JSON.stringify(me).slice(0, 120));
  else ok('and the server does not call them staff', 'no staff flag set');

  /* ------------------------------------------------------ the pages ------- */
  console.log('\n=== the doors ===');

  const atelier = await fetch(`${APP}/atelier`, {
    headers: { cookie: clientCookie }, redirect: 'manual',
  });
  const atelierTo = atelier.headers.get('location') ?? '';
  atelier.status === 307 && atelierTo.includes('/no-access')
    ? ok('/atelier sends a signed-in non-admin to /no-access', `${atelier.status} -> ${atelierTo}`)
    : bad('/atelier did NOT send them to /no-access', `${atelier.status} -> ${atelierTo}`);

  // It must not send them to /login. That is the tell for a gate that checks a
  // session and forgets the role: it reads as secure and is not, because they
  // hold a session and would sail through on the retry.
  !atelierTo.includes('/login')
    ? ok('and not to /login, which would loop a signed-in person')
    : bad('/atelier bounced them to /login while signed in', atelierTo);

  const noAccess = await fetch(`${APP}/no-access`, { headers: { cookie: clientCookie } });
  const noAccessBody = await noAccess.text();
  noAccess.status === 200
    ? ok('/no-access renders', String(noAccess.status))
    : bad('/no-access did not render', String(noAccess.status));
  noAccessBody.includes('Not your door')
    ? ok('it says the door is not theirs')
    : bad('the /no-access page did not carry its own words');
  // It must not name what is behind the door.
  /atelier|quarry|Quarry/i.test(noAccessBody.replace(/<[^>]*>/g, ' '))
    ? bad('/no-access leaks the name of what it is hiding')
    : ok('and never names what is behind it');

  const win = await fetch(`${APP}/window`, { headers: { cookie: clientCookie }, redirect: 'manual' });
  win.status === 200
    ? ok('their own Window still opens', String(win.status))
    : bad('a non-admin cannot reach their own Window', `${win.status} -> ${win.headers.get('location')}`);

  // The staff control, on the same door.
  const staffAtelier = await fetch(`${APP}/atelier`, {
    headers: { cookie: staffCookie }, redirect: 'manual',
  });
  staffAtelier.status === 200
    ? ok('CONTROL: staff reach the Atelier', String(staffAtelier.status))
    : bad('CONTROL FAILED: staff cannot reach the Atelier, so the probe proves nothing',
          `${staffAtelier.status} -> ${staffAtelier.headers.get('location')}`);

  /* ------------------------------------------- every staff API route ------ */
  console.log('\n=== every staff API, called directly with a real session ===');
  let refused = 0, leaked = 0;
  for (const [method, path] of STAFF_ROUTES) {
    const res = await fetch(`${APP}${path}`, {
      method,
      headers: { cookie: clientCookie, 'Content-Type': 'application/json' },
      ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }),
      cache: 'no-store',
    });
    if (res.status === 403 || res.status === 401) refused++;
    else { leaked++; bad(`${method} ${path} answered a non-admin`, String(res.status)); }
  }
  refused === STAFF_ROUTES.length
    ? ok(`all ${refused} staff endpoints refused them`, '403/401')
    : bad(`${leaked} staff endpoint(s) did not refuse`, `${refused}/${STAFF_ROUTES.length} refused`);

  // The control again: staff must actually get through at least one of them, or
  // "everything 403s" is just a broken cookie.
  const staffProbe = await fetch(`${APP}/api/health`, { headers: { cookie: staffCookie }, cache: 'no-store' });
  staffProbe.status === 200
    ? ok('CONTROL: staff pass the same endpoint', String(staffProbe.status))
    : bad('CONTROL FAILED: staff were refused too, so the 403s above mean nothing',
          String(staffProbe.status));

  /* ------------------------------------------------ privilege climb ------- */
  console.log('\n=== trying to promote themselves ===');
  // user_metadata is writable by its owner. The gate reads app_metadata for
  // exactly this reason, and this is the proof that the distinction holds.
  const asThem = createClient(U, A, { auth: { persistSession: false } });
  await asThem.auth.signInWithPassword({ email: clientEmail, password: pw });
  const { error: upErr } = await asThem.auth.updateUser({ data: { role: 'admin' } });
  ok('a client may write their own user_metadata', upErr ? 'refused: ' + upErr.message : 'allowed, as expected');

  const climbCookie = await cookieFor(clientEmail, pw);
  const climb = await fetch(`${APP}/atelier`, { headers: { cookie: climbCookie }, redirect: 'manual' });
  const climbTo = climb.headers.get('location') ?? '';
  climb.status === 307 && climbTo.includes('/no-access')
    ? ok('and it buys them nothing: still /no-access', `${climb.status} -> ${climbTo}`)
    : bad('SELF PROMOTION WORKED', `${climb.status} -> ${climbTo}`);

  const climbApi = await fetch(`${APP}/api/quarry`, { headers: { cookie: climbCookie }, cache: 'no-store' });
  climbApi.status === 403 || climbApi.status === 401
    ? ok('the Quarry still refuses them', String(climbApi.status))
    : bad('SELF PROMOTION REACHED THE QUARRY', String(climbApi.status));

  const { data: after } = await svc.auth.admin.getUserById(cu.user.id);
  after?.user?.app_metadata?.role === undefined
    ? ok('app_metadata.role was never touched by any of it')
    : bad('app_metadata.role changed', String(after?.user?.app_metadata?.role));

} catch (e) {
  bad('threw: ' + (e?.message ?? e));
} finally {
  console.log('\n=== tearing down ===');
  for (const id of made.projects) await svc.from('projects').delete().eq('id', id);
  for (const id of made.clients) await svc.from('clients').delete().eq('id', id);
  for (const id of made.users) await svc.auth.admin.deleteUser(id);
  console.log('  removed', made.users.length, 'users,', made.clients.length, 'clients,', made.projects.length, 'projects');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
