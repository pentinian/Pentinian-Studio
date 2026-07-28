#!/usr/bin/env node
/**
 * Does a client's reply reach the studio, and does the studio's answer reach back?
 *
 *   # with the app running locally
 *   set -a; source .env.local; set +a
 *   APP=http://127.0.0.1:3000 node scripts/verify-replies.mjs
 *
 * Walks the whole conversation through the real HTTP endpoint, as a real client and
 * a real admin, using cookies built by the same library the app reads them with.
 *
 * The reason this exists: routing comments through the app added a server hop, and a
 * server hop is exactly where authority tends to leak in by accident. The insert is
 * supposed to still run on the caller's own session, so a client must not be able to
 * reach another project through it, and must not be able to post as staff. Those two
 * are the point of the test.
 */
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID } from 'node:crypto';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const A = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const S = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.env.APP ?? 'http://127.0.0.1:3000';
if (!U || !A || !S) { console.error('Missing env. set -a; source .env.local; set +a'); process.exit(1); }

const svc = createClient(U, S, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const ok = (m, d = '') => { pass++; console.log('  PASS  ' + m + (d ? '   ' + d : '')); };
const bad = (m, d = '') => { fail++; console.log('  FAIL  ' + m + (d ? '   ' + d : '')); };

/** A cookie header for this user, made the way the app makes it. */
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

const call = (cookie, method, body) =>
  fetch(`${APP}/api/comments`, {
    method,
    headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const made = { users: [], clients: [], projects: [] };
const pw = randomUUID() + 'Aa1!';

try {
  const up = await fetch(APP, { redirect: 'manual' }).then(() => true).catch(() => false);
  if (!up) { console.error(`\nNothing answering at ${APP}. Start the app first.\n`); process.exit(1); }

  console.log('\n=== seeding ===');
  const clientEmail = `reply-client-${Date.now()}@pentinian.test`;
  const staffEmail = `reply-staff-${Date.now()}@pentinian.test`;

  const { data: cu } = await svc.auth.admin.createUser({ email: clientEmail, password: pw, email_confirm: true });
  made.users.push(cu.user.id);
  const { data: su } = await svc.auth.admin.createUser({
    email: staffEmail, password: pw, email_confirm: true, app_metadata: { role: 'admin' },
  });
  made.users.push(su.user.id);

  const { data: cl } = await svc.from('clients')
    .insert({ name: 'Reply Test Co', email: clientEmail, user_id: cu.user.id }).select().single();
  made.clients.push(cl.id);
  const { data: pr } = await svc.from('projects')
    .insert({ client_id: cl.id, name: 'Reply Test Project', client_facing: true }).select().single();
  made.projects.push(pr.id);

  const { data: oc } = await svc.from('clients').insert({ name: 'Other Reply Co' }).select().single();
  made.clients.push(oc.id);
  const { data: op } = await svc.from('projects')
    .insert({ client_id: oc.id, name: 'Other Reply Project', client_facing: true }).select().single();
  made.projects.push(op.id);

  const t = new Date(); t.setHours(t.getHours() - 3);
  const mk = (project_id, title) => ({
    project_id, title, area: 'Storefront', eli5: 'plain words', visible: true,
    started_at: t.toISOString(), ended_at: new Date(t.getTime() + 36e5).toISOString(), minutes: 60,
  });
  const { data: mine } = await svc.from('work_log_released').insert(mk(pr.id, 'Their entry')).select().single();
  const { data: theirs } = await svc.from('work_log_released').insert(mk(op.id, 'Not their entry')).select().single();

  const asClient = await cookieFor(clientEmail, pw);
  const asStaff = await cookieFor(staffEmail, pw);
  console.log('  a client and an admin, both signed in');

  console.log('\n=== the client writes ===');
  const r1 = await call(asClient, 'POST', {
    entry_id: mine.id, project_id: pr.id, body: 'Does this mean the old prices are gone entirely?',
  });
  const d1 = await r1.json();
  r1.ok ? ok('the reply is accepted') : bad('the reply was refused', d1.error);
  d1.comment?.from_staff === false
    ? ok('and is recorded as coming from them, not the studio')
    : bad('from_staff was wrong', String(d1.comment?.from_staff));

  console.log('\n=== what the server hop must not have loosened ===');
  const r2 = await call(asClient, 'POST', {
    entry_id: theirs.id, project_id: op.id, body: 'reaching into another project',
  });
  r2.ok ? bad('a client REACHED ANOTHER PROJECT through the endpoint') : ok('another project is refused', String(r2.status));

  const r3 = await call(asClient, 'POST', {
    entry_id: mine.id, project_id: pr.id, body: 'posing as staff', from_staff: true,
  });
  const d3 = await r3.json();
  d3.comment?.from_staff === true
    ? bad('a client POSTED AS STAFF by asking nicely')
    : ok('asking to be staff is ignored');

  const r4 = await call(asClient, 'GET');
  r4.status === 403 ? ok('a client cannot read the studio inbox', '403') : bad('THE INBOX IS READABLE BY A CLIENT', String(r4.status));

  console.log('\n=== the studio reads it ===');
  const inbox = await call(asStaff, 'GET').then((r) => r.json());
  const thread = (inbox.threads ?? []).find((t) => t.id === d1.comment.id);
  thread ? ok('the reply is in the inbox') : bad('the reply never surfaced');
  thread?.answered === false ? ok('it shows as waiting') : bad('it was already marked answered');
  thread?.client === 'Reply Test Co' ? ok('named with the client who wrote it') : bad('wrong client', thread?.client);
  thread?.entry?.title === 'Their entry' ? ok('carries the entry they wrote against') : bad('lost the context');
  (inbox.threads ?? []).some((t) => t.project === 'Other Reply Project')
    ? ok('the studio sees every project, which is the point of an inbox')
    : ok('no other project had comments to show');

  console.log('\n=== the studio answers ===');
  const r5 = await call(asStaff, 'POST', {
    entry_id: mine.id, project_id: pr.id, body: 'Gone from the page entirely unless you are signed in.',
  });
  const d5 = await r5.json();
  d5.comment?.from_staff === true ? ok('the answer is marked as from the studio') : bad('staff reply not marked as staff');

  const after = await call(asStaff, 'GET').then((r) => r.json());
  const done = (after.threads ?? []).find((t) => t.id === d1.comment.id);
  done?.answered ? ok('the thread falls out of the waiting list') : bad('still showing as unanswered');
  done?.replies?.length === 1 ? ok('the answer is attached to the thread') : bad('answer not attached');

  console.log('\n=== and the client sees the answer ===');
  const asClientDb = createClient(U, A, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + (await createClient(U, A, { auth: { persistSession: false } })
      .auth.signInWithPassword({ email: clientEmail, password: pw })).data.session.access_token } },
  });
  const { data: seen } = await asClientDb.from('comments')
    .select('body,from_staff').eq('entry_id', mine.id).order('created_at');
  // Not a count: the refused "posing as staff" probe above was correctly saved as an
  // ordinary comment from them, so three is the right number, and asserting on two
  // would only be testing my own fixture.
  const answer = (seen ?? []).find((c) => c.from_staff);
  answer && (seen ?? []).some((c) => !c.from_staff)
    ? ok('both sides of the conversation are readable to them', `${seen.length} messages`)
    : bad('the client cannot see the answer', JSON.stringify(seen));
  (seen ?? []).filter((c) => c.from_staff).length === 1
    ? ok('exactly one message carries the studio mark')
    : bad('wrong number of staff-marked messages');
} catch (e) {
  bad('threw', e.message);
} finally {
  console.log('\n=== tearing down ===');
  for (const p of made.projects) {
    await svc.from('comments').delete().eq('project_id', p);
    await svc.from('work_log_released').delete().eq('project_id', p);
    await svc.from('projects').delete().eq('id', p);
  }
  for (const c of made.clients) await svc.from('clients').delete().eq('id', c);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
  console.log('  removed');
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
