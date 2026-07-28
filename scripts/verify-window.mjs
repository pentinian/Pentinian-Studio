#!/usr/bin/env node
/**
 * Does the Window show the right person the right hours, and nothing else?
 *
 *   set -a; source .env.local; set +a
 *   node scripts/verify-window.mjs
 *
 * Builds a throwaway client with their own project and a second project belonging to
 * someone else, signs in AS the client, then runs the exact queries the Window runs.
 * Deletes everything it made.
 *
 * The interesting cases are the ones that are easy to get wrong and invisible when
 * they are: an entry held back, an entry scheduled for later, and another project's
 * day appearing in the calendar. A leak there is silent, which is why it is tested
 * rather than eyeballed.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SVC) {
  console.error('Missing env. Run: set -a; source .env.local; set +a');
  process.exit(1);
}

const svc = createClient(URL_, SVC, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (m, d = '') => { pass++; console.log('  PASS  ' + m + (d ? '   ' + d : '')); };
const bad = (m, d = '') => { fail++; console.log('  FAIL  ' + m + (d ? '   ' + d : '')); };

const STUDIO_TZ = 'America/Los_Angeles';
const keyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: STUDIO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const dayKey = (iso) => keyFmt.format(new Date(iso));

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const email = `window-test-${Date.now()}@pentinian.test`;
const password = randomUUID() + 'Aa1!';
const made = { user: null, clients: [], projects: [], objects: [] };

/** A time block on a given day, in the studio's timezone. */
function block(daysAgo, startHour, minutes) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(startHour, 0, 0, 0);
  return {
    started_at: d.toISOString(),
    ended_at: new Date(d.getTime() + minutes * 60000).toISOString(),
    minutes,
  };
}

try {
  console.log('\n=== seeding ===');

  const { data: u, error: uErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (uErr) throw uErr;
  made.user = u.user.id;

  const { data: mineClient } = await svc.from('clients')
    .insert({ name: 'Window Test Co', email, user_id: made.user }).select().single();
  made.clients.push(mineClient.id);
  const { data: mine } = await svc.from('projects')
    .insert({ client_id: mineClient.id, name: 'Window Test Project', client_facing: true }).select().single();
  made.projects.push(mine.id);

  const { data: otherClient } = await svc.from('clients').insert({ name: 'Someone Else Co' }).select().single();
  made.clients.push(otherClient.id);
  const { data: other } = await svc.from('projects')
    .insert({ client_id: otherClient.id, name: 'Someone Else Project', client_facing: true }).select().single();
  made.projects.push(other.id);

  const shot = `${mine.id}/window-test.png`;
  const foreignShot = `${other.id}/window-test.png`;
  for (const p of [shot, foreignShot]) {
    const { error } = await svc.storage.from('shots').upload(p, PNG, { contentType: 'image/png', upsert: true });
    if (!error) made.objects.push(p);
  }

  const soon = new Date(Date.now() + 7 * 864e5).toISOString();
  const rows = [
    // two blocks on the same day, so the day panel has to order them
    { project_id: mine.id, title: 'Morning block', area: 'Storefront', eli5: 'Plainly what happened.',
      why: 'Why it mattered.', visible: true, release_at: null, shots: [shot], ...block(3, 9, 90) },
    { project_id: mine.id, title: 'Afternoon block', area: 'Storefront', eli5: 'More plain words.',
      visible: true, release_at: null, ...block(3, 14, 45) },
    { project_id: mine.id, title: 'A different day', area: 'Backend', eli5: 'Another day of work.',
      visible: true, release_at: null, ...block(1, 11, 120) },
    // must not appear: held back, and scheduled for later
    { project_id: mine.id, title: 'HELD BACK', eli5: 'should never be read',
      visible: false, release_at: null, ...block(2, 10, 60) },
    { project_id: mine.id, title: 'NOT DUE YET', eli5: 'should never be read',
      visible: true, release_at: soon, ...block(2, 12, 60) },
    // must not appear: belongs to someone else
    { project_id: other.id, title: 'SOMEONE ELSE WORK', eli5: 'not theirs to read',
      visible: true, release_at: null, shots: [foreignShot], ...block(3, 9, 200) },
  ];
  const { data: inserted, error: insErr } = await svc.from('work_log_released').insert(rows).select();
  if (insErr) throw insErr;
  const idOf = (t) => inserted.find((r) => r.title === t).id;
  console.log(`  ${inserted.length} entries across 2 projects`);

  console.log('\n=== signing in as the client ===');
  const loginClient = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: sess, error: sErr } = await loginClient.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error('could not sign in: ' + sErr.message);
  const as = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + sess.session.access_token } },
  });

  console.log('\n=== the month read, exactly as the Window makes it ===');
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 0).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 2).toISOString();
  const { data: month } = await as
    .from('work_log_released')
    .select('id,project_id,title,started_at,minutes,shots')
    .eq('project_id', mine.id)
    .not('started_at', 'is', null)
    .gte('started_at', from).lte('started_at', to)
    .order('started_at', { ascending: true });

  const titles = (month ?? []).map((r) => r.title);
  titles.length === 3 && !titles.some((t) => /HELD BACK|NOT DUE|SOMEONE ELSE/.test(t))
    ? ok('only released, due, own-project entries', titles.join(' / '))
    : bad('the month read is wrong', titles.join(' / '));

  titles.includes('HELD BACK') ? bad('a held-back entry was readable') : ok('held back stays back');
  titles.includes('NOT DUE YET') ? bad('a future-dated entry leaked early') : ok('scheduled work waits its turn');

  console.log('\n=== the calendar ===');
  const byDay = {};
  for (const r of month ?? []) (byDay[dayKey(r.started_at)] ??= []).push(r);
  Object.keys(byDay).length === 2
    ? ok('two days marked', Object.keys(byDay).sort().join(', '))
    : bad('wrong number of days', JSON.stringify(Object.keys(byDay)));

  const busy = Object.values(byDay).find((es) => es.length === 2);
  busy && busy[0].title === 'Morning block' && busy[1].title === 'Afternoon block'
    ? ok('two blocks on one day, in order')
    : bad('the day did not order its hours', JSON.stringify(busy?.map((e) => e.title)));

  // The other project has a day in this same month. It must not be in this calendar.
  const anyForeign = await as.from('work_log_released').select('id').eq('project_id', other.id);
  (anyForeign.data ?? []).length === 0
    ? ok("another project's month is unreachable")
    : bad('LEAKED another project', `${anyForeign.data.length} rows`);

  console.log('\n=== screenshots ===');
  const own = await as.storage.from('shots').createSignedUrl(shot, 60);
  own.data?.signedUrl ? ok('own screenshot signs') : bad('own screenshot refused', own.error?.message);
  const notOwn = await as.storage.from('shots').createSignedUrl(foreignShot, 60);
  notOwn.data?.signedUrl ? bad("signed someone else's screenshot") : ok('foreign screenshot refused');

  console.log('\n=== commenting ===');
  const c1 = await as.from('comments').insert({
    project_id: mine.id, entry_id: idOf('Morning block'), author_id: made.user,
    from_staff: false, body: 'Reading this back, makes sense.',
  }).select().single();
  c1.error ? bad('own comment rejected', c1.error.message.slice(0, 46)) : ok('comment on their own entry lands');

  const c2 = await as.from('comments').insert({
    project_id: mine.id, entry_id: idOf('SOMEONE ELSE WORK'), author_id: made.user,
    from_staff: false, body: 'should not be possible',
  });
  c2.error ? ok("comment onto another project's entry refused", c2.error.code) : bad('FORGED a comment across projects');

  const c3 = await as.from('comments').insert({
    project_id: mine.id, entry_id: idOf('HELD BACK'), author_id: made.user,
    from_staff: false, body: 'should not be possible',
  });
  c3.error ? ok('comment onto a held-back entry refused', c3.error.code) : bad('commented on something they cannot see');

  const back = await as.from('comments').select('body,from_staff').eq('entry_id', idOf('Morning block'));
  (back.data ?? []).length === 1 ? ok('the comment reads back') : bad('comment did not read back');
} catch (e) {
  bad('threw', e.message);
} finally {
  console.log('\n=== tearing down ===');
  if (made.objects.length) await svc.storage.from('shots').remove(made.objects);
  for (const p of made.projects) await svc.from('work_log_released').delete().eq('project_id', p);
  for (const p of made.projects) await svc.from('comments').delete().eq('project_id', p);
  for (const p of made.projects) await svc.from('projects').delete().eq('id', p);
  for (const c of made.clients) await svc.from('clients').delete().eq('id', c);
  if (made.user) await svc.auth.admin.deleteUser(made.user);
  console.log('  removed');
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
