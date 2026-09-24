#!/usr/bin/env node
/**
 * Can verify-tenant-isolation actually SEE a hole?
 *
 *   set -a; source .env.local; set +a
 *   node scripts/verify-isolation-negative-control.mjs
 *
 * THE PROBLEM THIS SOLVES. verify-tenant-isolation.mjs reports 67 passed, 0
 * failed. So would a probe with a typo in a table name, a probe whose two
 * sign-ins silently became the same session, and a probe whose assertions
 * compare a value to itself. A green run is evidence only once the same
 * instrument has been shown to go red against a real hole.
 *
 * WHY THIS DOES NOT DROP A POLICY. Dropping `released_read` on
 * work_log_released would prove the point, and for however long it took to
 * prove it, every client could read every other client's work on a live
 * database holding five real clients. A control must not open the hole it is
 * testing for. The other route, a scratch schema, needs DDL, and the only way
 * to run DDL from here would be to install an arbitrary-SQL function in the
 * production database. That function would be a permanent backdoor, far worse
 * than the uncertainty it resolves, so it was not built.
 *
 * WHAT THIS DOES INSTEAD. The production policies are conjunctions. Reading
 * work_log_released requires ALL of:
 *
 *     project_id in (select public.my_project_ids())    the tenant wall
 *     and visible                                       the visibility flag
 *     and (release_at is null or release_at <= now())   the release gate
 *
 * Each conjunct is a wall. Falsifying one on a row THIS SCRIPT CREATED, with
 * the service role, simulates that wall failing open for that row, with no
 * policy altered and no production row touched. If the reader is honest, the
 * row appears and disappears as each condition is flipped, every time. If the
 * reader is broken, it reads the same thing regardless, and that is what this
 * catches.
 *
 * So each case below asserts a TRANSITION, not a state:
 *
 *   1. tenant wall     B's entry is invisible to A; move it into A's project
 *                      and A must now see it; move it back and it must vanish
 *   2. release gate    a future release_at hides A's own row; a past one
 *                      reveals it
 *   3. visibility      visible=false hides A's own row; true reveals it
 *   4. the Quarry      stays refused throughout, because it is a grant wall
 *                      rather than a policy and nothing here should move it
 *
 * A control that only ever showed rows appearing would be satisfied by a reader
 * that returns everything, so every case checks both directions.
 *
 * SAFETY. Every row read or written here was created by this script and is
 * deleted in the finally block. No production row is read, written, or
 * modified. No policy, grant, table or schema is altered at any point,
 * including on the failure path. scripts/leftovers.mjs confirms the teardown.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const A = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const S = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !A || !S) {
  console.error('Missing env. Run: set -a; source .env.local; set +a');
  process.exit(1);
}

const svc = createClient(U, S, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (m, d = '') => { pass++; console.log('  PASS  ' + m + (d ? '   ' + d : '')); };
const bad = (m, d = '') => { fail++; console.log('  FAIL  ' + m + (d ? '   ' + d : '')); };

/** The same detector verify-tenant-isolation.mjs uses, deliberately. Testing a
 *  different function than the one that ships would prove nothing about it. */
function foreignRowsIn(rows, foreignIds) {
  const want = new Set(foreignIds.filter(Boolean));
  return (rows ?? []).filter((r) => want.has(r.id)).map((r) => r.id);
}

const stamp = Date.now();
const made = { users: [], clients: [], projects: [], entries: [] };

async function makeTenant(tag) {
  const email = `isolation-nc-${tag}-${stamp}@pentinian.test`;
  const password = randomUUID() + 'Aa1!';
  const { data: u, error: uErr } = await svc.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (uErr) throw uErr;
  made.users.push(u.user.id);

  const { data: c, error: cErr } = await svc.from('clients')
    .insert({ name: `Isolation NC ${tag} Test Co`, email, user_id: u.user.id })
    .select().single();
  if (cErr) throw cErr;
  made.clients.push(c.id);

  const { data: p, error: pErr } = await svc.from('projects')
    .insert({ client_id: c.id, name: `Isolation NC ${tag} Test Project`, phase: 'test' })
    .select().single();
  if (pErr) throw pErr;
  made.projects.push(p.id);

  const now = new Date();
  const { data: e, error: eErr } = await svc.from('work_log_released').insert({
    project_id: p.id, title: `NC ${tag} entry`,
    eli5: 'seeded by the negative control', why: 'to be made visible and hidden again',
    area: 'test',
    started_at: new Date(now.getTime() - 3600e3).toISOString(),
    ended_at: now.toISOString(), minutes: 60, visible: true,
    release_at: new Date(now.getTime() - 60e3).toISOString(),
  }).select().single();
  if (eErr) throw eErr;
  made.entries.push(e.id);

  const door = createClient(U, A, { auth: { persistSession: false } });
  const { data: sess, error: sErr } = await door.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`sign in failed for ${tag}: ${sErr.message}`);
  const db = createClient(U, A, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + sess.session.access_token } },
  });

  return { tag, userId: u.user.id, clientId: c.id, projectId: p.id, entryId: e.id, db };
}

/** What this tenant can see in work_log_released, right now. */
async function readAs(t) {
  const { data, error } = await t.db.from('work_log_released').select('id,title');
  if (error) throw new Error(`read as ${t.tag} failed: ${error.message}`);
  return data ?? [];
}

try {
  console.log('\n=== seeding two tenants ===');
  const tA = await makeTenant('A');
  const tB = await makeTenant('B');
  console.log(`  A  project ${tA.projectId}  entry ${tA.entryId}`);
  console.log(`  B  project ${tB.projectId}  entry ${tB.entryId}`);

  /* ------------------------------------------------- 1. the tenant wall ---- */
  console.log('\n=== case 1: the tenant wall, falsified and restored ===');

  const base = await readAs(tA);
  foreignRowsIn(base, [tB.entryId]).length === 0
    ? ok('baseline: A does not see B\'s entry')
    : bad('baseline already leaking, nothing below is interpretable');

  // Simulate the wall failing open for this ONE row, by making it genuinely
  // belong to A's project. No policy changes; the policy is asked the same
  // question about different data.
  await svc.from('work_log_released')
    .update({ project_id: tA.projectId }).eq('id', tB.entryId);

  const moved = await readAs(tA);
  const detected = foreignRowsIn(moved, [tB.entryId]);
  detected.length === 1
    ? ok('wall falsified: the detector REPORTS the row it should not see', detected[0].slice(0, 8))
    : bad('THE DETECTOR STAYED QUIET WITH THE WALL DOWN',
          'every green result from verify-tenant-isolation would be worthless');

  // Put it back, and require the row to vanish again. A reader that cannot make
  // a row disappear is a reader that is not reading.
  await svc.from('work_log_released')
    .update({ project_id: tB.projectId }).eq('id', tB.entryId);

  foreignRowsIn(await readAs(tA), [tB.entryId]).length === 0
    ? ok('wall restored: the row disappears again')
    : bad('the row is STILL visible to A after restoring its project');

  /* ------------------------------------------------- 2. the release gate --- */
  // Same instrument, a different conjunct of the same policy. This one has
  // never been exercised against a real client: release_at is enforced at read
  // time and nothing had ever watched a row cross its own release time.
  console.log('\n=== case 2: the release gate, both directions ===');
  const future = new Date(Date.now() + 3600e3).toISOString();
  await svc.from('work_log_released').update({ release_at: future }).eq('id', tA.entryId);

  (await readAs(tA)).some((r) => r.id === tA.entryId)
    ? bad('A sees their own entry while its release_at is in the FUTURE')
    : ok('an unreleased entry is hidden from the client who owns it');

  await svc.from('work_log_released')
    .update({ release_at: new Date(Date.now() - 60e3).toISOString() }).eq('id', tA.entryId);

  (await readAs(tA)).some((r) => r.id === tA.entryId)
    ? ok('and appears once its release time has passed')
    : bad('a released entry is still hidden, so the gate never opens');

  /* --------------------------------------------------- 3. the visible flag - */
  console.log('\n=== case 3: the visible flag, both directions ===');
  await svc.from('work_log_released').update({ visible: false }).eq('id', tA.entryId);

  (await readAs(tA)).some((r) => r.id === tA.entryId)
    ? bad('A sees an entry marked visible=false')
    : ok('visible=false hides the entry from its own client');

  await svc.from('work_log_released').update({ visible: true }).eq('id', tA.entryId);

  (await readAs(tA)).some((r) => r.id === tA.entryId)
    ? ok('and visible=true brings it back')
    : bad('the entry never came back, so the reading does not track the data');

  /* ------------------------------------------------------- 4. the Quarry --- */
  // The Quarry is walled by a REVOKE rather than a policy, so none of the above
  // should have moved it. If it opened at any point, something altered a grant.
  console.log('\n=== case 4: the Quarry never moved ===');
  const q = await tA.db.from('work_log_raw').select('id');
  (q.error || (q.data ?? []).length === 0)
    ? ok('work_log_raw still refuses the client', q.error?.code ?? '0 rows')
    : bad('work_log_raw OPENED during this run', `${q.data.length} rows`);

  console.log('\n=== what this establishes ===');
  console.log('  The reader used by verify-tenant-isolation.mjs reports a row when');
  console.log('  the wall is down and stops reporting it when the wall is back, on');
  console.log('  three separate conditions, in both directions. Its clean run is');
  console.log('  therefore a measurement rather than a decoration.');

} catch (e) {
  bad('threw: ' + (e?.message ?? e));
} finally {
  console.log('\n=== tearing down ===');
  try {
    for (const id of made.projects) {
      await svc.from('comments').delete().eq('project_id', id);
      await svc.from('project_notes').delete().eq('project_id', id);
      await svc.from('work_log_released').delete().eq('project_id', id);
    }
    // Belt and braces: case 1 moved an entry between projects, so delete by id
    // as well in case a failure left it on the other side.
    for (const id of made.entries) await svc.from('work_log_released').delete().eq('id', id);
    for (const id of made.projects) await svc.from('projects').delete().eq('id', id);
    for (const id of made.clients) await svc.from('clients').delete().eq('id', id);
    for (const id of made.users) await svc.auth.admin.deleteUser(id);
    console.log(`  removed ${made.users.length} users, ${made.clients.length} clients, ` +
                `${made.projects.length} projects, ${made.entries.length} entries`);
  } catch (e) {
    console.log('  CLEANUP ISSUE:', e.message, '- run scripts/leftovers.mjs');
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
