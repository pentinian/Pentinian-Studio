#!/usr/bin/env node
//
// Walks the console pipeline against the live database.
//
//   set -a; source .env.local; set +a
//   node scripts/verify-console.mjs                 everything
//   node scripts/verify-console.mjs --part=1        schema, gate, who may write
//   node scripts/verify-console.mjs --part=2        sync contract, storage, endpoint
//   node scripts/verify-console.mjs --part=3        the day board: the Quarry, the move contract
//   node scripts/verify-console.mjs --sweep         remove debris from a killed run
//
// Schema files are not evidence. Row Level Security was once believed to be on when it
// was not, and only a probe found it. Everything below asks the database, as a real
// client with a real session, and reports what it actually answered.
//
// Teardown is in a finally block, which covers a throw and a failed assertion but NOT a
// kill: a process that is terminated does not run its own finally. That happened, and
// left a scratch project and two users in the real Atelier. Hence --part, so each half
// finishes inside a short window, and --sweep, so cleaning up is one documented command
// rather than something reconstructed under pressure.

import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !SERVICE || !ANON) {
  console.error('Missing env. Run: set -a; source .env.local; set +a');
  process.exit(1);
}

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
const TAG = `vc-${Date.now()}`;
const ARGS = process.argv.slice(2);
const PART = Number((ARGS.find((a) => a.startsWith('--part=')) ?? '').split('=')[1] || 0);
const wants = (p) => PART === 0 || PART === p;

// Everything this script creates is prefixed vc-, in every table it touches, so a sweep
// can find all of it by name without needing to know what a given run got as far as.
if (ARGS.includes('--sweep')) {
  const { data: projects } = await db.from('projects').select('id,name').ilike('name', 'vc-%');
  const { data: clients } = await db.from('clients').select('id').ilike('name', 'vc-%');
  const { data: users } = await db.auth.admin.listUsers();
  const stray = (users?.users ?? []).filter((u) => (u.email ?? '').startsWith('vc-'));

  for (const p of projects ?? []) {
    const { data: objs } = await db.storage.from('shots').list(p.id, { limit: 200 });
    const paths = (objs ?? []).map((o) => `${p.id}/${o.name}`);
    if (paths.length) await db.storage.from('shots').remove(paths);
    await db.from('project_notes').delete().eq('project_id', p.id);
    await db.from('work_log_released').delete().eq('project_id', p.id);
    await db.from('work_log_raw').delete().eq('project_id', p.id);
  }
  await db.from('project_notes').delete().ilike('title', 'vc-%');
  await db.from('work_log_raw').delete().ilike('notion_id', 'vc-%');
  for (const p of projects ?? []) await db.from('projects').delete().eq('id', p.id);
  for (const c of clients ?? []) await db.from('clients').delete().eq('id', c.id);
  for (const u of stray) await db.auth.admin.deleteUser(u.id);

  console.log(`swept ${projects?.length ?? 0} project(s), ${clients?.length ?? 0} client(s), ${stray.length} user(s)`);
  process.exit(0);
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${extra ? '  ' + extra : ''}`); }
};

// A negative assertion must check that the refusal is the RIGHT refusal.
//
// Every "may NOT" test here used to assert only that an error came back. Then a policy
// recursed, every insert failed for that reason, and the whole suite read green except
// the two positive cases. A test that passes when the thing it guards is broken is worse
// than no test, because it is trusted. So: a refusal counts only if it is a policy
// refusal or a constraint refusal, and anything else is reported as the fault it is.
const refused = (name, error) => {
  if (!error) return ok(name, false, 'it was ALLOWED');
  const m = error.message ?? String(error);
  const policy = /row-level security|violates row-level|new row violates|permission denied|check constraint/i.test(m);
  return ok(name, policy, policy ? '' : `refused for the wrong reason: ${m}`);
};

const made = { users: [], projects: [], clients: [] };

async function asUser(email, password) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in failed for ${email}: ${error.message}`);
  return c;
}

try {
  // ------------------------------------------------------------------ scaffolding
  const pw = `${TAG}-Aa1!longenough`;
  const clientEmail = `${TAG}-client@example.invalid`;
  const strangerEmail = `${TAG}-stranger@example.invalid`;

  const { data: cu } = await db.auth.admin.createUser({
    email: clientEmail, password: pw, email_confirm: true,
  });
  const { data: su } = await db.auth.admin.createUser({
    email: strangerEmail, password: pw, email_confirm: true,
  });
  made.users.push(cu.user.id, su.user.id);

  const { data: cl } = await db.from('clients')
    .insert({ name: `${TAG} client`, user_id: cu.user.id }).select().single();
  made.clients.push(cl.id);

  const { data: pr } = await db.from('projects')
    .insert({ name: `${TAG} project`, client_id: cl.id, client_facing: true }).select().single();
  made.projects.push(pr.id);

  // Both halves need real sessions, so these are created outside the part blocks.
  const client = await asUser(clientEmail, pw);
  const stranger = await asUser(strangerEmail, pw);

  if (wants(1)) {
  // ------------------------------------------------------------- the schema itself
  console.log('\nschema');
  for (const col of ['facet', 'notion_id', 'released_at', 'notion_url']) {
    const { error } = await db.from('project_notes').select(col).limit(1);
    ok(`project_notes.${col} exists`, !error, error?.message);
  }
  {
    const { error } = await db.from('project_notes')
      .insert({ project_id: pr.id, kind: 'brand', facet: 'colour', title: 'x' });
    refused('facet refuses the British spelling', error);
  }
  {
    const { error } = await db.from('project_notes')
      .insert({ project_id: pr.id, kind: 'brand', facet: 'nonsense', title: 'x' });
    refused('facet refuses anything outside the four', error);
  }

  // -------------------------------------------------------------------- the gate
  console.log('\nthe release gate');
  const { data: staged } = await db.from('project_notes').insert({
    project_id: pr.id, kind: 'brand', facet: 'color', title: `${TAG} staged`,
    body: 'held back', swatch: '#7E9270', from_client: false, released_at: null,
  }).select().single();

  const { data: live } = await db.from('project_notes').insert({
    project_id: pr.id, kind: 'brand', facet: 'rule', title: `${TAG} released`,
    body: 'passed', from_client: false, released_at: new Date().toISOString(),
  }).select().single();

  const { data: seen } = await client.from('project_notes').select('id,title').eq('project_id', pr.id);
  const ids = new Set((seen ?? []).map((r) => r.id));
  ok('a released item reaches the client', ids.has(live.id));
  ok('a staged item does NOT reach the client', !ids.has(staged.id));

  // --------------------------------------------------- what a client may write
  console.log('\nwhat a client may write');
  {
    const { data, error } = await client.from('project_notes').insert({
      project_id: pr.id, kind: 'request', title: `${TAG} their request`,
      from_client: true, author_id: cu.user.id, status: 'open',
    }).select().single();
    ok('a client may write a request', !error, error?.message);
    if (data) {
      const { data: back } = await client.from('project_notes').select('id').eq('id', data.id);
      ok('and sees it at once, without any release', (back ?? []).length === 1);
    }
  }

  // ------------------------------------------------------- brand suggestions
  console.log('\nbrand suggestions');
  let suggestion = null;
  {
    const { data, error } = await client.from('project_notes').insert({
      project_id: pr.id, kind: 'brand', facet: 'color', parent_id: live.id,
      title: `${TAG} the sage is too soft`, body: 'a touch deeper',
      from_client: true, author_id: cu.user.id, status: 'open',
    }).select().single();
    ok('a client MAY suggest a brand change', !error, error?.message);
    suggestion = data;
  }
  {
    const { error } = await client.from('project_notes').insert({
      project_id: pr.id, kind: 'brand', facet: 'color', title: `${TAG} sneaked in`,
      from_client: false, author_id: cu.user.id,
    });
    refused('but may NOT author one as Pentinian', error);
  }
  {
    const { error } = await client.from('project_notes').insert({
      project_id: pr.id, kind: 'brand', facet: 'color', title: `${TAG} self approved`,
      from_client: true, author_id: cu.user.id, status: 'done',
    });
    refused('and may NOT mark their own suggestion accepted', error);
  }
  if (suggestion) {
    const { data } = await client.from('project_notes')
      .update({ from_client: false }).eq('id', suggestion.id).select();
    ok('a client may NOT promote their suggestion to a decision', (data ?? []).length === 0);

    // Adopting is what the Atelier does: it becomes Pentinian's and it releases.
    await db.from('project_notes').update({
      from_client: false, status: 'none', parent_id: null,
      released_at: new Date().toISOString(),
    }).eq('id', suggestion.id);
    const { data: after } = await client.from('project_notes')
      .select('id,from_client,released_at').eq('id', suggestion.id).single();
    ok('adopting keeps the same row, so their card moves rather than vanishing',
      after?.id === suggestion.id);
    ok('and it is now a released decision', after?.from_client === false && after?.released_at !== null);
  }
  {
    const { error } = await client.from('project_notes').insert({
      project_id: pr.id, kind: 'request', title: `${TAG} self released`,
      from_client: true, author_id: cu.user.id, released_at: new Date().toISOString(),
    });
    refused('a client may NOT release their own row', error);
  }
  {
    const { error } = await client.from('project_notes').insert({
      project_id: pr.id, kind: 'request', title: `${TAG} not mine`,
      from_client: false, author_id: cu.user.id,
    });
    refused('a client may NOT post as Pentinian', error);
  }
  {
    // The one an insert-only policy would miss: reaching a staged row through UPDATE.
    const { data } = await client.from('project_notes')
      .update({ released_at: new Date().toISOString() }).eq('id', staged.id).select();
    ok('a client may NOT release a staged row by updating it', (data ?? []).length === 0);
    const { data: still } = await db.from('project_notes').select('released_at').eq('id', staged.id).single();
    ok('and it is still staged afterwards', still?.released_at === null);
  }

  // ------------------------------------------------------ another client's project
  console.log('\nreach across projects');
  {
    const { data } = await stranger.from('project_notes').select('id').eq('project_id', pr.id);
    ok('a stranger sees nothing on a project that is not theirs', (data ?? []).length === 0);
  }
  {
    const { error } = await stranger.from('project_notes').insert({
      project_id: pr.id, kind: 'request', title: `${TAG} trespass`,
      from_client: true, author_id: su.user.id,
    });
    refused('a stranger may not write into it either', error);
  }

  } // end part 1

  if (wants(2)) {
  // ------------------------------------------------------------- the sync contract
  console.log('\nthe sync contract');
  {
    const nid = `${TAG}-notion-page`;
    const { data: first } = await db.from('project_notes').insert({
      project_id: pr.id, kind: 'brand', facet: 'rule', title: 'first text',
      notion_id: nid, from_client: false,
    }).select().single();
    await db.from('project_notes').update({ released_at: new Date().toISOString() }).eq('id', first.id);

    // A re-sync sends everything EXCEPT released_at, which is what lets a typo fix in
    // Notion reach a released row without retracting it.
    const { error: upErr } = await db.from('project_notes').upsert({
      notion_id: nid, project_id: pr.id, kind: 'brand', facet: 'rule',
      title: 'second text', from_client: false,
    }, { onConflict: 'notion_id' });
    ok('a re-sync upserts on notion_id', !upErr, upErr?.message);

    const { data: rows } = await db.from('project_notes').select('*').eq('notion_id', nid);
    ok('it edits in place rather than duplicating', (rows ?? []).length === 1);
    ok('the new text landed', rows?.[0]?.title === 'second text');
    ok('and it is STILL released', rows?.[0]?.released_at !== null);
  }
  {
    // A client's own row has no notion_id, so no sync can ever key onto it.
    const { data: theirs } = await db.from('project_notes')
      .select('id,notion_id').eq('project_id', pr.id).eq('from_client', true);
    ok('client-authored rows carry no notion_id',
      (theirs ?? []).every((r) => r.notion_id === null));
  }

  // ------------------------------------------------- the gate reaches into storage
  //
  // The one a policy test suite would miss if it only tested tables. push-shots uploads
  // a screenshot the moment it is captured, so an image belonging to unreleased work
  // sits in the bucket immediately. Hiding it in the interface is not a gate; a client
  // holds a real session and can sign a URL for anything the policy permits.
  console.log('\nscreenshots and the release gate');
  {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const held = `${pr.id}/${TAG}-unreleased-work.png`;
    const shown = `${pr.id}/${TAG}-released-work.png`;
    const attached = `${pr.id}/files/${TAG}-a-real-attachment.png`;
    for (const p of [held, shown, attached]) {
      await db.storage.from('shots').upload(p, png, { contentType: 'image/png', upsert: true });
    }

    // One in the Quarry, one released. Same folder, same client.
    await db.from('work_log_raw').insert({
      notion_id: `${TAG}-raw`, project_id: pr.id, body: `${TAG} still in the quarry`,
      shots: [held],
    });
    await db.from('work_log_released').insert({
      project_id: pr.id, title: `${TAG} released`, eli5: 'out', shots: [shown],
    });

    const sign = async (p) => {
      const { data } = await client.storage.from('shots').createSignedUrl(p, 60);
      return Boolean(data?.signedUrl);
    };
    ok('a screenshot of RELEASED work signs for the client', await sign(shown));
    ok('a deliberate attachment under files/ signs', await sign(attached));
    ok('a screenshot of UNRELEASED work does NOT sign', !(await sign(held)),
      'the release gate does not reach storage yet: run supabase/shots-gate.sql');

    const { data: listed } = await client.storage.from('shots').list(pr.id, { limit: 100 });
    const names = (listed ?? []).map((o) => o.name);
    ok('and it is not even listed', !names.includes(`${TAG}-unreleased-work.png`));

    await db.storage.from('shots').remove([held, shown, attached]);
    await db.from('work_log_raw').delete().eq('notion_id', `${TAG}-raw`);
    await db.from('work_log_released').delete().eq('project_id', pr.id);
  }

  // -------------------------------------------------------- staff-only endpoints
  console.log('\nthe console endpoint');
  {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://pentinian-studio.vercel.app';
    const res = await fetch(`${base}/api/console?project=${pr.id}`, { cache: 'no-store' });
    if (res.status === 404) {
      // Not a failure, and it must not be reported as a pass either. The route exists
      // in the repo and has not reached production yet.
      console.log('  skip /api/console is not deployed yet, so it cannot be probed');
    } else {
      ok('/api/console refuses a caller with no session', res.status === 403 || res.status === 401,
        `got ${res.status}`);
    }
  }
  } // end part 2

  if (wants(3)) {
  // ======================================================================= the day board
  //
  // The Quarry, the hour grid, the workbench and release-a-day were the last things here
  // with no probe on them, and two of them write straight into what a client reads. The
  // interface for them is a drag: it looks like it worked whether or not anything landed.

  // ---------------------------------------------------------------- the door
  //
  // /api/quarry holds the service key. staffOnly() is the whole of its protection, and
  // nothing tested that it was there. PATCH in particular rewrites released rows, so a
  // regression here is not a leak, it is a stranger editing somebody's Window.
  console.log('\nthe quarry endpoint');
  {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://pentinian-studio.vercel.app';
    const calls = [
      ['GET', { method: 'GET' }],
      ['POST', { method: 'POST', headers: { 'content-type': 'application/json' },
                 body: JSON.stringify({ create: { project_id: pr.id, title: `${TAG} trespass` } }) }],
      ['PATCH', { method: 'PATCH', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ moves: [{ id: '00000000-0000-0000-0000-000000000000', started_at: new Date().toISOString(), minutes: 60 }] }) }],
    ];
    for (const [verb, init] of calls) {
      const res = await fetch(`${base}/api/quarry`, { ...init, cache: 'no-store' });
      if (res.status === 404) { console.log(`  skip /api/quarry ${verb} is not deployed yet`); continue; }
      ok(`/api/quarry ${verb} refuses a caller with no session`,
        res.status === 401 || res.status === 403, `got ${res.status}`);
    }
  }

  // -------------------------------------------------------- the Quarry is staff only
  //
  // The route's comment says work_log_raw is revoked from the authenticated role outright,
  // so that no browser JWT can read the unsanitised notes even if a policy were loosened
  // by accident. That claim had never been checked against the live database.
  console.log('\nthe quarry itself');
  {
    const { error } = await client.from('work_log_raw').select('id').limit(1);
    refused('a client may NOT read the Quarry at all', error);
  }
  {
    const { error } = await client.from('work_log_raw')
      .insert({ project_id: pr.id, body: `${TAG} written by a client` });
    refused('and may NOT write into it', error);
  }

  // ------------------------------------------------- what a released day looks like
  console.log('\nwhat a client sees of a day');
  const day = new Date(); day.setUTCHours(10, 0, 0, 0);
  const at = (h, m = 60) => ({
    started_at: new Date(day.getTime() + h * 3600000).toISOString(),
    ended_at: new Date(day.getTime() + h * 3600000 + m * 60000).toISOString(),
    minutes: m,
  });

  const { data: rawShown } = await db.from('work_log_raw').insert({
    notion_id: `${TAG}-raw-shown`, project_id: pr.id, body: `${TAG} the piece they see`, ...at(0),
  }).select().single();
  const { data: rawParked } = await db.from('work_log_raw').insert({
    notion_id: `${TAG}-raw-parked`, project_id: pr.id, body: `${TAG} on the workbench`,
    started_at: null, ended_at: null, minutes: null,
  }).select().single();

  // Released the way releaseOne writes it, raw_id and all.
  const { data: relShown } = await db.from('work_log_released').insert({
    project_id: pr.id, raw_id: rawShown.id, title: `${TAG} the piece they see`,
    eli5: 'out', visible: true, release_at: null, ...at(0),
  }).select().single();
  const { data: relHidden } = await db.from('work_log_released').insert({
    project_id: pr.id, title: `${TAG} hidden`, eli5: 'hidden', visible: false, ...at(2),
  }).select().single();
  const { data: relLater } = await db.from('work_log_released').insert({
    project_id: pr.id, title: `${TAG} scheduled`, eli5: 'later', visible: true,
    release_at: new Date(Date.now() + 864e5).toISOString(), ...at(4),
  }).select().single();

  const clientSees = async () => {
    const { data } = await client.from('work_log_released')
      .select('id,title,started_at,minutes').eq('project_id', pr.id);
    return data ?? [];
  };
  {
    const seen = await clientSees();
    const has = (id) => seen.some((r) => r.id === id);
    ok('a released, visible entry reaches them', has(relShown.id));
    ok('one hidden in the Atelier does NOT', !has(relHidden.id));
    ok('and one scheduled for tomorrow does NOT either', !has(relLater.id));
  }
  {
    // Scheduling has to actually arrive, or it is just a way of losing work.
    await db.from('work_log_released')
      .update({ release_at: new Date(Date.now() - 6e4).toISOString() }).eq('id', relLater.id);
    const seen = await clientSees();
    ok('once its moment passes, the scheduled one arrives', seen.some((r) => r.id === relLater.id));
    await db.from('work_log_released')
      .update({ release_at: new Date(Date.now() + 864e5).toISOString() }).eq('id', relLater.id);
  }
  {
    const { data } = await stranger.from('work_log_released').select('id').eq('project_id', pr.id);
    ok('a stranger sees none of the day', (data ?? []).length === 0);
  }

  // ----------------------------------------------------------- the move contract
  //
  // Arranging a day writes to work_log_raw AND to the released row, and the only thing
  // joining the two is work_log_released.raw_id. If that is ever null, or the column is
  // renamed, .eq('raw_id', id) matches nothing: PATCH still answers { moved: 1 }, the
  // grid still shows the block where you dropped it, and the client's Window keeps the
  // old time forever. A silent failure that looks exactly like a success is the reason
  // this section exists, so the assertions below count affected rows rather than trusting
  // a response.
  console.log('\narranging a day');
  {
    const { data: back } = await db.from('work_log_released').select('raw_id').eq('id', relShown.id).single();
    ok('a released entry remembers which Quarry row it came from', back?.raw_id === rawShown.id);
  }
  {
    const moved = at(3, 90);
    const { data: rawHit } = await db.from('work_log_raw').update(moved).eq('id', rawShown.id).select('id');
    const { data: relHit } = await db.from('work_log_released').update(moved).eq('raw_id', rawShown.id).select('id');
    ok('moving a block reaches the Quarry row', (rawHit ?? []).length === 1);
    ok('and reaches the released row through raw_id', (relHit ?? []).length === 1);

    const seen = (await clientSees()).find((r) => r.id === relShown.id);
    ok('so the client sees the new time, not the old one', seen?.started_at === moved.started_at);
    ok('and the new length with it', seen?.minutes === 90);
  }
  {
    // Parking. A null time is a decision, and it has to reach the client too: a piece
    // pulled back onto the workbench must not keep occupying an hour in their day.
    const cleared = { started_at: null, ended_at: null, minutes: null };
    await db.from('work_log_raw').update(cleared).eq('id', rawShown.id);
    const { data: relHit } = await db.from('work_log_released')
      .update(cleared).eq('raw_id', rawShown.id).select('id');
    ok('parking a piece clears the released row too', (relHit ?? []).length === 1);
    const seen = (await clientSees()).find((r) => r.id === relShown.id);
    ok('so it stops occupying an hour in their day', seen?.started_at === null);
  }
  {
    // The workbench. A row with no time is not missing data, it is a piece waiting to be
    // placed, and it has to survive as such rather than being tidied away by a default.
    const { data: parked } = await db.from('work_log_raw')
      .select('started_at,minutes').eq('id', rawParked.id).single();
    ok('an untimed entry keeps its null rather than acquiring a time',
      parked?.started_at === null && parked?.minutes === null);
  }

  // ------------------------------------------------- where the client_facing guard is
  //
  // Not an assertion, because either answer is defensible and a test that fails when
  // somebody tightens a policy is a test that teaches people to loosen it back. It is
  // printed because it says which layer is load bearing, and that is worth knowing before
  // anybody edits either one.
  {
    await db.from('projects').update({ client_facing: false }).eq('id', pr.id);
    const seen = await clientSees();
    await db.from('projects').update({ client_facing: true }).eq('id', pr.id);
    console.log(
      `  note   client_facing is enforced ${seen.length > 0
        ? 'in the release route only: the policy would still show these rows, so the route is the guard'
        : 'in the policy as well as the route, which is stricter than the route assumes'}`
    );
  }

  await db.from('work_log_released').delete().eq('project_id', pr.id);
  await db.from('work_log_raw').delete().eq('project_id', pr.id);
  } // end part 3
} catch (e) {
  fail += 1;
  console.log(`\n  FAIL threw: ${e.message}`);
} finally {
  // Teardown lives here so a timeout, a throw or a failed assertion still cleans up.
  // Test debris has twice been left in the real Atelier; never again.
  for (const id of made.projects) await db.from('project_notes').delete().eq('project_id', id);
  // The work log tables too. Part 3 leaves rows in both, and a released row that outlived
  // its project is precisely the kind of orphan that turns up months later in a Window.
  for (const id of made.projects) await db.from('work_log_released').delete().eq('project_id', id);
  for (const id of made.projects) await db.from('work_log_raw').delete().eq('project_id', id);
  for (const id of made.projects) await db.from('projects').delete().eq('id', id);
  for (const id of made.clients) await db.from('clients').delete().eq('id', id);
  for (const id of made.users) await db.auth.admin.deleteUser(id);

  const { data: leftover } = await db.from('project_notes').select('id').ilike('title', `%${TAG}%`);
  console.log(`\ntorn down. leftover rows tagged ${TAG}: ${(leftover ?? []).length}`);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
