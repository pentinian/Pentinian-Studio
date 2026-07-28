#!/usr/bin/env node
/**
 * End to end privacy test.
 *
 *   set -a; source .env.local; set +a
 *   node scripts/verify-privacy.mjs
 *
 * Creates a throwaway client with their own project, signs in AS them, and checks
 * every boundary from their side. Then deletes everything it made.
 *
 * A pass here means: a real signed-in client cannot reach the Quarry, cannot see
 * another project's work, days, or screenshots, and cannot forge a comment.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SVC) { console.error('Missing env. Run: set -a; source .env.local; set +a'); process.exit(1); }

const svc = createClient(URL, SVC, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok  = (m, d = '') => { pass++; console.log('  PASS  ' + m + (d ? '   ' + d : '')); };
const bad = (m, d = '') => { fail++; console.log('  FAIL  ' + m + (d ? '   ' + d : '')); };

const email = `privacy-test-${Date.now()}@pentinian.test`;
const password = randomUUID() + 'Aa1!';
const made = { user: null, client: null, project: null, entries: [], objects: [] };

// 1 x 1 transparent png
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

try {
  console.log('\n=== seeding ===');

  const { data: u, error: uErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (uErr) throw uErr;
  made.user = u.user.id;
  console.log('  test client user', email);

  const { data: c, error: cErr } = await svc.from('clients')
    .insert({ name: 'Privacy Test Co', email, user_id: made.user }).select().single();
  if (cErr) throw cErr;
  made.client = c.id;

  const { data: p, error: pErr } = await svc.from('projects')
    .insert({ client_id: c.id, name: 'Privacy Test Project', phase: 'test' }).select().single();
  if (pErr) throw pErr;
  made.project = p.id;
  console.log('  their project  ', made.project);

  // the incumbent project, which they must never see
  const { data: others } = await svc.from('projects').select('id,name').neq('id', made.project).limit(1);
  const foreign = others?.[0];
  console.log('  foreign project', foreign ? foreign.id + ' (' + foreign.name + ')' : 'none, seeding one');

  let foreignId = foreign?.id;
  if (!foreignId) {
    const { data: fc } = await svc.from('clients').insert({ name: 'Other Co' }).select().single();
    const { data: fp } = await svc.from('projects').insert({ client_id: fc.id, name: 'Other Project' }).select().single();
    foreignId = fp.id; made.extraClient = fc.id; made.extraProject = fp.id;
  }

  const now = new Date();
  const mk = (project_id, title) => ({
    project_id, title, eli5: 'plain words', why: 'because', area: 'test',
    started_at: new Date(now.getTime() - 3600e3).toISOString(), ended_at: now.toISOString(),
    minutes: 60, visible: true, release_at: null,
  });
  const { data: mine, error: e1 } = await svc.from('work_log_released').insert(mk(made.project, 'Theirs')).select().single();
  if (e1) throw e1;
  const { data: theirs, error: e2 } = await svc.from('work_log_released').insert(mk(foreignId, 'Not theirs')).select().single();
  if (e2) throw e2;
  made.entries = [mine.id, theirs.id];

  // the Quarry, which no client may ever read
  await svc.from('work_log_raw').insert({ project_id: made.project, body: 'raw internal note', notion_id: 'test-' + Date.now() });

  for (const [pid, tag] of [[made.project, 'mine'], [foreignId, 'foreign']]) {
    const path = `${pid}/test-${tag}.png`;
    const { error } = await svc.storage.from('shots').upload(path, PNG, { contentType: 'image/png', upsert: true });
    if (!error) made.objects.push(path);
  }
  console.log('  screenshots    ', made.objects.length, 'uploaded');

  console.log('\n=== signing in as the client ===');
  // IMPORTANT: sign in on a separate instance. signInWithPassword stores the session on
  // whichever client makes the call, so reusing `anon` would silently make the
  // signed-out checks below run as the logged-in client and pass for the wrong reason.
  const loginClient = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: sess, error: sErr } = await loginClient.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error('could not sign in as test client: ' + sErr.message);
  const jwt = sess.session.access_token;
  const asClient = createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + jwt } },
  });
  console.log('  signed in, role =', JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString()).role);

  console.log('\n=== what the client can reach ===');

  const r1 = await asClient.from('projects').select('id,name');
  (r1.data?.length === 1 && r1.data[0].id === made.project)
    ? ok('projects: only their own', `saw ${r1.data.length}`)
    : bad('projects: leaked', JSON.stringify(r1.data?.map(x => x.name)));

  const r2 = await asClient.from('work_log_raw').select('*');
  (r2.error || (r2.data ?? []).length === 0)
    ? ok('work_log_raw: unreachable', r2.error ? r2.error.message.slice(0, 38) : '0 rows')
    : bad('work_log_raw: EXPOSED', (r2.data?.length ?? 0) + ' rows of internal notes');

  const r3 = await asClient.from('work_log_released').select('id,title');
  (r3.data?.length === 1 && r3.data[0].id === made.entries[0])
    ? ok('released entries: only theirs', `saw ${r3.data.length}`)
    : bad('released entries: leaked', JSON.stringify(r3.data?.map(x => x.title)));

  const r4 = await asClient.from('work_days').select('*');
  (r4.data ?? []).every(d => d.project_id === made.project)
    ? ok('work_days calendar: only their days', `${(r4.data ?? []).length} day(s)`)
    : bad('work_days: LEAKED other projects', JSON.stringify(r4.data));

  console.log('\n=== what the client cannot forge ===');

  const c1 = await asClient.from('comments').insert({
    project_id: made.project, entry_id: made.entries[0], author_id: made.user, body: 'looks good, thanks',
  });
  c1.error ? bad('own comment rejected', c1.error.message.slice(0, 50)) : ok('own comment accepted');

  const c2 = await asClient.from('comments').insert({
    project_id: made.project, entry_id: made.entries[1], author_id: made.user, body: 'comment on someone else entry',
  });
  c2.error ? ok('comment onto a foreign entry refused', c2.error.code) : bad('FORGED comment onto a foreign entry');

  const c3 = await asClient.from('comments').insert({
    project_id: made.project, entry_id: made.entries[0], author_id: made.user, from_staff: true, body: 'pretending to be staff',
  });
  c3.error ? ok('comment posing as staff refused', c3.error.code) : bad('client POSTED AS STAFF');

  const c4 = await asClient.from('comments').insert({
    project_id: made.project, entry_id: made.entries[0], author_id: randomUUID(), body: 'as someone else',
  });
  c4.error ? ok('comment as another author refused', c4.error.code) : bad('client posted as ANOTHER USER');

  console.log('\n=== screenshots ===');
  for (const path of made.objects) {
    const isTheirs = path.startsWith(made.project);
    const { data, error } = await asClient.storage.from('shots').createSignedUrl(path, 60);
    const got = !!data?.signedUrl && !error;
    if (isTheirs) got ? ok('own screenshot: signed') : bad('own screenshot refused', error?.message?.slice(0, 40));
    else got ? bad('FOREIGN screenshot signed', path) : ok('foreign screenshot refused', error?.message?.slice(0, 34) || 'denied');
  }

  console.log('\n=== signed out entirely ===');
  const guest = createClient(URL, ANON, { auth: { persistSession: false } });
  for (const t of ['clients', 'projects', 'work_log_raw', 'work_log_released', 'comments', 'site_config']) {
    const { data, error } = await guest.from(t).select('*');
    (error || (data ?? []).length === 0) ? ok(`${t}: blocked`) : bad(`${t}: EXPOSED`, (data?.length ?? 0) + ' rows');
  }
} catch (e) {
  console.error('\nTEST ERROR:', e.message);
  fail++;
} finally {
  console.log('\n=== tearing down ===');
  try {
    if (made.objects.length) await svc.storage.from('shots').remove(made.objects);
    await svc.from('comments').delete().eq('project_id', made.project);
    if (made.entries.length) await svc.from('work_log_released').delete().in('id', made.entries);
    await svc.from('work_log_raw').delete().eq('project_id', made.project);
    if (made.project) await svc.from('projects').delete().eq('id', made.project);
    if (made.extraProject) await svc.from('projects').delete().eq('id', made.extraProject);
    if (made.client) await svc.from('clients').delete().eq('id', made.client);
    if (made.extraClient) await svc.from('clients').delete().eq('id', made.extraClient);
    if (made.user) await svc.auth.admin.deleteUser(made.user);
    console.log('  removed');
  } catch (e) { console.log('  cleanup issue:', e.message); }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
