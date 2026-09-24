#!/usr/bin/env node
/**
 * Two-context tenant isolation: can client A read client B's rows?
 *
 *   set -a; source .env.local; set +a
 *   node scripts/verify-tenant-isolation.mjs
 *
 * WHY THIS EXISTS, given verify-privacy.mjs already runs.
 *
 * verify-privacy signs in as ONE client and checks four tables, using whatever
 * foreign project already happens to sit in the database as the other side. It
 * is a good test and it leaves three holes that matter before a real client
 * arrives:
 *
 *   1. `sessions`, `questions` and `comments` hold ZERO rows in production
 *      (measured 2026-09-24). Their RLS policies are applied: a signed-in
 *      stranger gets 200 with an empty array rather than a grant refusal. But
 *      an empty array from an EMPTY TABLE is not evidence of a wall. That
 *      reading is identical to the one a table with no policy at all would
 *      give, and it is what "a proof that cannot fail is not a proof" means
 *      here. Nothing has ever put a row in those tables and been refused it.
 *
 *   2. Only one side is ever authenticated. A wall proven in one direction is
 *      half a wall; the 1fcb312 upload probe established two-context as the
 *      house discipline for exactly this reason, and the table reads never
 *      adopted it.
 *
 *   3. The foreign project is a REAL client's row. Reading production data to
 *      prove a denial works, and it means the probe cannot seed the foreign
 *      side, so it can only ever check the tables that already have rows.
 *
 * So this constructs BOTH sides. Two throwaway clients, each with their own
 * user, their own project, and a seeded row on every table the hardening row
 * names. Then it signs in as each and requires, per table and in BOTH
 * directions: their own row is visible, and the other's is not.
 *
 * THE POSITIVE CONTROL IS NOT OPTIONAL. "A sees zero of B" is satisfied by a
 * database that denies everything to everyone, which is also what a broken
 * cookie looks like. Every table therefore asserts A sees their OWN row in the
 * same breath. A table that refuses both is reported as a failure, not a pass.
 *
 * THE NEGATIVE CONTROL. Two of them, because a wall checker that cannot see a
 * hole has not checked the wall:
 *
 *   a. The detector is fed a constructed leak before any real reading is taken
 *      (a row set carrying a foreign id) and MUST report it. If it does not,
 *      the run aborts without touching the database, because every clean
 *      result afterwards would be worthless.
 *   b. Each foreign row is read back with the service role, which bypasses RLS.
 *      That is what makes the client's empty result mean something: the row
 *      demonstrably exists and is demonstrably selectable, so the zero is the
 *      policy refusing and not an empty table.
 *
 * SAFETY. Everything written here is created by this script and deleted in the
 * finally block: two users on @pentinian.test (RFC 2606, resolves nowhere), two
 * clients and two projects named so scripts/leftovers.mjs recognises them as
 * residue. No production row is read, written, or deleted. No policy is
 * changed. The service role is used to seed and to tear down, never to prove a
 * wall.
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

/**
 * Does this result set contain any row belonging to the other tenant?
 * Returns the offending ids, so a leak is reported with evidence rather than
 * as a bare boolean.
 */
function foreignRowsIn(rows, foreignIds) {
  const want = new Set(foreignIds.filter(Boolean));
  return (rows ?? []).filter((r) => want.has(r.id)).map((r) => r.id);
}

/* ------------------------------------------------- negative control (a) ----
 * Prove the detector fires BEFORE trusting a single clean reading from it. A
 * checker that always returns "no leak" passes every wall, including one that
 * is not there. This runs against constructed data and touches nothing. */
{
  const fakeForeign = randomUUID();
  const detected = foreignRowsIn(
    [{ id: randomUUID() }, { id: fakeForeign }],
    [fakeForeign]
  );
  if (detected.length !== 1 || detected[0] !== fakeForeign) {
    console.error('\nNEGATIVE CONTROL FAILED: the leak detector did not report a');
    console.error('constructed leak. Every clean result from this probe would be');
    console.error('meaningless, so nothing was measured and nothing was seeded.\n');
    process.exit(1);
  }
  const quiet = foreignRowsIn([{ id: randomUUID() }], [randomUUID()]);
  if (quiet.length !== 0) {
    console.error('\nNEGATIVE CONTROL FAILED: the detector reported a leak that does');
    console.error('not exist, so it would fail every build for the wrong reason.\n');
    process.exit(1);
  }
  console.log('\n=== negative control ===');
  console.log('  PASS  the leak detector reports a constructed leak, and only that');
}

const stamp = Date.now();
const pw = () => randomUUID() + 'Aa1!';
const made = { users: [], clients: [], projects: [], rows: [] };

/** Sign in on a DEDICATED instance and return a client bound to that JWT.
 *  signInWithPassword stores the session on whichever instance makes the call,
 *  so reusing one instance for both tenants would silently make B's reads run
 *  as A and the whole probe would pass for the wrong reason. */
async function signInAs(email, password) {
  const door = createClient(U, A, { auth: { persistSession: false } });
  const { data, error } = await door.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in failed for ${email}: ${error.message}`);
  return createClient(U, A, {
    auth: { persistSession: false },
    global: { headers: { Authorization: 'Bearer ' + data.session.access_token } },
  });
}

/** Seed one tenant: user, clients row, project, and a row on every table. */
async function makeTenant(tag) {
  const email = `isolation-${tag}-${stamp}@pentinian.test`;
  const password = pw();

  const { data: u, error: uErr } = await svc.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (uErr) throw uErr;
  made.users.push(u.user.id);

  const { data: c, error: cErr } = await svc.from('clients')
    .insert({ name: `Isolation ${tag} Test Co`, email, user_id: u.user.id })
    .select().single();
  if (cErr) throw cErr;
  made.clients.push(c.id);

  const { data: p, error: pErr } = await svc.from('projects')
    .insert({ client_id: c.id, name: `Isolation ${tag} Test Project`, phase: 'test' })
    .select().single();
  if (pErr) throw pErr;
  made.projects.push(p.id);

  const now = new Date();
  const rows = {};

  // Released, visible, and already due, so the client's OWN row is readable and
  // the positive control can actually pass. release_at in the past rather than
  // null, because null and past are different branches of the same policy and
  // the past one is the one nothing has ever exercised.
  const { data: rel, error: relErr } = await svc.from('work_log_released').insert({
    project_id: p.id,
    title: `Isolation ${tag} entry`,
    eli5: 'seeded by verify-tenant-isolation', why: 'to be refused to the other tenant',
    area: 'test',
    started_at: new Date(now.getTime() - 3600e3).toISOString(),
    ended_at: now.toISOString(), minutes: 60, visible: true,
    release_at: new Date(now.getTime() - 60e3).toISOString(),
  }).select().single();
  if (relErr) throw relErr;
  rows.work_log_released = rel.id;

  const { data: ses, error: sesErr } = await svc.from('sessions').insert({
    project_id: p.id, started_at: now.toISOString(), minutes: 30,
    label: `Isolation ${tag} session`, visible: true,
  }).select().single();
  if (sesErr) throw sesErr;
  rows.sessions = ses.id;

  const { data: q, error: qErr } = await svc.from('questions').insert({
    project_id: p.id, body: `Isolation ${tag} question`, status: 'awaiting',
  }).select().single();
  if (qErr) throw qErr;
  rows.questions = q.id;

  const { data: cm, error: cmErr } = await svc.from('comments').insert({
    project_id: p.id, entry_id: rel.id, author_id: u.user.id,
    from_staff: true, body: `Isolation ${tag} comment`,
  }).select().single();
  if (cmErr) throw cmErr;
  rows.comments = cm.id;

  /* Two notes, because project_notes has a release gate that the other tables
   * do not, and seeding only one measured the wrong thing.
   *
   * The live read policy is console-pipeline.sql:62, which SUPERSEDES the one
   * in notes.sql: a client sees a note in their own project only when it is
   * `released_at is not null OR from_client`. A staff-authored, unreleased note
   * is STAGED and is correctly invisible to the client whose project it is.
   *
   * A first version of this probe seeded exactly that row and reported "the
   * client cannot see their own note" as a failure in both directions. That was
   * the instrument, not a defect: it had constructed a row the gate is designed
   * to hide and then complained that it was hidden. Recorded here rather than
   * quietly corrected, because the next reader will seed the obvious row too. */
  const { data: nt, error: ntErr } = await svc.from('project_notes').insert({
    project_id: p.id, kind: 'request', title: `Isolation ${tag} note`,
    body: 'seeded, released', status: 'open', from_client: false,
    released_at: new Date(now.getTime() - 60e3).toISOString(),
  }).select().single();
  if (ntErr) throw ntErr;
  rows.project_notes = nt.id;

  const { data: staged, error: stErr } = await svc.from('project_notes').insert({
    project_id: p.id, kind: 'brand', title: `Isolation ${tag} staged note`,
    body: 'seeded, never released', status: 'none', from_client: false,
    released_at: null,
  }).select().single();
  if (stErr) throw stErr;
  rows.project_notes_staged = staged.id;

  made.rows.push({ project: p.id, ...rows });
  return { tag, email, password, userId: u.user.id, clientId: c.id, projectId: p.id, rows };
}

/* Every table the plan's hardening row names, plus the two that carry client
 * content beside them. `own` and `foreign` name the row id each tenant should
 * and should not see. Written out per table rather than looped over a schema,
 * so adding a table without deciding its isolation story shows up in a diff. */
function tablesFor(self, other) {
  return [
    ['clients',           self.clientId,               other.clientId],
    ['projects',          self.projectId,              other.projectId],
    ['work_log_released', self.rows.work_log_released, other.rows.work_log_released],
    ['sessions',          self.rows.sessions,          other.rows.sessions],
    ['questions',         self.rows.questions,         other.rows.questions],
    ['comments',          self.rows.comments,          other.rows.comments],
    ['project_notes',     self.rows.project_notes,     other.rows.project_notes],
  ];
}

try {
  console.log('\n=== seeding two tenants ===');
  const tenantA = await makeTenant('A');
  const tenantB = await makeTenant('B');
  console.log(`  A  client ${tenantA.clientId}  project ${tenantA.projectId}`);
  console.log(`  B  client ${tenantB.clientId}  project ${tenantB.projectId}`);

  /* ---------------------------------------------- negative control (b) ----
   * The service role bypasses RLS. If it cannot see the foreign rows either,
   * they do not exist and every "A saw 0" below is an empty-table reading
   * rather than a wall. This is what makes the zeros mean something. */
  console.log('\n=== negative control: the rows exist and are selectable ===');
  let seedOk = true;
  for (const [table, , foreignId] of tablesFor(tenantA, tenantB)) {
    const { data, error } = await svc.from(table).select('id').eq('id', foreignId);
    const found = (data ?? []).length === 1;
    if (found) {
      ok(`${table}: B's row is readable when nothing filters it`, foreignId.slice(0, 8));
    } else {
      seedOk = false;
      bad(`${table}: the seeded row is NOT readable even to the service role`,
          error?.message?.slice(0, 50) ?? 'not found');
    }
  }
  if (!seedOk) {
    throw new Error('seeding did not produce readable foreign rows; the isolation ' +
                    'readings below would be empty-table readings, so the run stops here');
  }

  /* -------------------------------------------------- both directions ----- */
  const sessionA = await signInAs(tenantA.email, tenantA.password);
  const sessionB = await signInAs(tenantB.email, tenantB.password);

  for (const [self, other, db, label] of [
    [tenantA, tenantB, sessionA, 'A reading, B hidden'],
    [tenantB, tenantA, sessionB, 'B reading, A hidden'],
  ]) {
    console.log(`\n=== ${label} ===`);
    for (const [table, ownId, foreignId] of tablesFor(self, other)) {
      const { data, error } = await db.from(table).select('*');
      if (error) {
        bad(`${table}: the tenant could not read the table at all`,
            error.message.slice(0, 50));
        continue;
      }
      const rows = data ?? [];
      const leaked = foreignRowsIn(rows, [foreignId]);
      const sawOwn = rows.some((r) => r.id === ownId);

      // Positive control first. Without it, a database that denies everything
      // passes the isolation check while being completely broken.
      sawOwn
        ? ok(`${table}: sees their own row`, `${rows.length} row(s) total`)
        : bad(`${table}: CANNOT see their own row, so the zero below proves nothing`,
              `${rows.length} row(s) total`);

      leaked.length === 0
        ? ok(`${table}: the other tenant's row is not among them`)
        : bad(`${table}: LEAKED the other tenant's row`, leaked.join(', '));

      // And nothing beyond the two tenants either. A policy that returned every
      // row in the table would satisfy both checks above if the other tenant
      // happened to be filtered by accident. The staged notes are excluded by
      // id here because they are the release gate's business, asserted in their
      // own block below rather than counted as strangers.
      const known = new Set([ownId, foreignId,
                             self.rows.project_notes_staged,
                             other.rows.project_notes_staged]);
      const strangers = rows.filter((r) => !known.has(r.id));
      strangers.length === 0
        ? ok(`${table}: and no third party's rows either`)
        : bad(`${table}: returned ${strangers.length} row(s) belonging to neither tenant`,
              strangers.slice(0, 3).map((r) => r.id).join(', '));
    }
  }

  /* ------------------------------------------------- the Quarry, both ----- */
  console.log('\n=== the Quarry refuses both of them ===');
  for (const [tag, db] of [['A', sessionA], ['B', sessionB]]) {
    const { data, error } = await db.from('work_log_raw').select('*');
    (error || (data ?? []).length === 0)
      ? ok(`${tag}: work_log_raw unreachable`, error ? error.code ?? 'denied' : '0 rows')
      : bad(`${tag}: work_log_raw EXPOSED`, `${data.length} rows of internal notes`);
  }

  /* ------------------------------------------------ the staff control ----- */
  // If nobody can see these rows, the denials above are indistinguishable from
  // a database that is simply broken. An admin must see BOTH tenants.
  console.log('\n=== staff control: an admin sees both ===');
  const adminEmail = `isolation-staff-${stamp}@pentinian.test`;
  const adminPw = pw();
  const { data: au, error: auErr } = await svc.auth.admin.createUser({
    email: adminEmail, password: adminPw, email_confirm: true,
    app_metadata: { role: 'admin' },
  });
  if (auErr) throw auErr;
  made.users.push(au.user.id);
  const sessionAdmin = await signInAs(adminEmail, adminPw);

  for (const [table, aId, bId] of tablesFor(tenantA, tenantB)) {
    const { data, error } = await sessionAdmin.from(table).select('id');
    const ids = new Set((data ?? []).map((r) => r.id));
    (!error && ids.has(aId) && ids.has(bId))
      ? ok(`${table}: staff see both tenants' rows`)
      : bad(`${table}: staff cannot see both, so the client denials prove nothing`,
            error?.message?.slice(0, 40) ?? `A:${ids.has(aId)} B:${ids.has(bId)}`);
  }

  /* --------------------------------------------- the console release gate --
   * project_notes is the one table here with a second gate inside the tenant
   * boundary: a staff-authored note is staged until released. A client must see
   * the released one and not the staged one, in their OWN project. Without this
   * the isolation pass above would be satisfied by a policy that showed a
   * client every draft decision written about their own brand. */
  console.log('\n=== the console release gate, inside each tenant ===');
  for (const [self, db] of [[tenantA, sessionA], [tenantB, sessionB]]) {
    const { data } = await db.from('project_notes').select('id');
    const ids = new Set((data ?? []).map((r) => r.id));
    ids.has(self.rows.project_notes)
      ? ok(`${self.tag}: sees the RELEASED note in their own project`)
      : bad(`${self.tag}: cannot see their own released note`);
    !ids.has(self.rows.project_notes_staged)
      ? ok(`${self.tag}: and never the STAGED one`)
      : bad(`${self.tag}: SAW A STAGED NOTE about their own project`,
            self.rows.project_notes_staged);
  }
  // Staff control: the staged note is not invisible to everybody, or the line
  // above passes on a row that simply is not there.
  {
    const { data } = await sessionAdmin.from('project_notes').select('id');
    const ids = new Set((data ?? []).map((r) => r.id));
    (ids.has(tenantA.rows.project_notes_staged) && ids.has(tenantB.rows.project_notes_staged))
      ? ok('CONTROL: staff see both staged notes, so the refusals above mean something')
      : bad('CONTROL FAILED: staff cannot see the staged notes either');
  }

  /* ----------------------------------------------- writing across ---------- */
  // Reading is half the wall. A tenant who cannot read another's row but can
  // WRITE one has still crossed it.
  console.log('\n=== A cannot write into B ===');
  const w1 = await sessionA.from('project_notes').insert({
    project_id: tenantB.projectId, kind: 'request', title: 'crossing over',
    body: 'should be refused', status: 'open', from_client: true,
    author_id: tenantA.userId,
  });
  w1.error ? ok('note into B\'s project refused', w1.error.code)
           : bad('A WROTE A NOTE INTO B\'S PROJECT');

  const w2 = await sessionA.from('comments').insert({
    project_id: tenantB.projectId, entry_id: tenantB.rows.work_log_released,
    author_id: tenantA.userId, body: 'crossing over',
  });
  w2.error ? ok('comment onto B\'s entry refused', w2.error.code)
           : bad('A COMMENTED ON B\'S ENTRY');

  const w3 = await sessionA.from('work_log_released')
    .update({ title: 'rewritten by the wrong tenant' })
    .eq('id', tenantB.rows.work_log_released).select();
  ((w3.data ?? []).length === 0)
    ? ok('update of B\'s released entry changed nothing',
         w3.error ? w3.error.code : '0 rows affected')
    : bad('A REWROTE B\'S RELEASED ENTRY');

  // And prove that last one by reading it back with the service role, because
  // "0 rows affected" is what both a refusal and a silent success look like
  // from the caller's side when RLS filters the returning clause.
  const { data: afterUpdate } = await svc.from('work_log_released')
    .select('title').eq('id', tenantB.rows.work_log_released).single();
  afterUpdate?.title === `Isolation B entry`
    ? ok('and B\'s title is untouched in the database', afterUpdate.title)
    : bad('B\'s row was actually modified', String(afterUpdate?.title));

} catch (e) {
  bad('threw: ' + (e?.message ?? e));
} finally {
  console.log('\n=== tearing down ===');
  try {
    for (const r of made.rows) {
      await svc.from('comments').delete().eq('project_id', r.project);
      await svc.from('project_notes').delete().eq('project_id', r.project);
      await svc.from('questions').delete().eq('project_id', r.project);
      await svc.from('sessions').delete().eq('project_id', r.project);
      await svc.from('work_log_released').delete().eq('project_id', r.project);
    }
    for (const id of made.projects) await svc.from('projects').delete().eq('id', id);
    for (const id of made.clients) await svc.from('clients').delete().eq('id', id);
    for (const id of made.users) await svc.auth.admin.deleteUser(id);
    console.log(`  removed ${made.users.length} users, ${made.clients.length} clients, ` +
                `${made.projects.length} projects and their rows`);
  } catch (e) {
    console.log('  CLEANUP ISSUE:', e.message, '- run scripts/leftovers.mjs');
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
