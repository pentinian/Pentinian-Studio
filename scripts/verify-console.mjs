#!/usr/bin/env node
//
// Walks the console pipeline against the live database.
//
//   node scripts/verify-console.mjs          (after: set -a; source .env.local; set +a)
//
// Schema files are not evidence. Row Level Security was once believed to be on when it
// was not, and only a probe found it. Everything below asks the database, as a real
// client with a real session, and reports what it actually answered.
//
// Creates a scratch project, a scratch client and a scratch user, and tears all three
// down in a finally block so a timeout cannot leave test debris in Pen's Atelier. That
// has happened twice.

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

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${extra ? '  ' + extra : ''}`); }
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

  // ------------------------------------------------------------- the schema itself
  console.log('\nschema');
  for (const col of ['facet', 'notion_id', 'released_at', 'notion_url']) {
    const { error } = await db.from('project_notes').select(col).limit(1);
    ok(`project_notes.${col} exists`, !error, error?.message);
  }
  {
    const { error } = await db.from('project_notes')
      .insert({ project_id: pr.id, kind: 'brand', facet: 'colour', title: 'x' });
    ok('facet refuses the British spelling', Boolean(error));
  }
  {
    const { error } = await db.from('project_notes')
      .insert({ project_id: pr.id, kind: 'brand', facet: 'nonsense', title: 'x' });
    ok('facet refuses anything outside the four', Boolean(error));
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

  const client = await asUser(clientEmail, pw);
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
    ok('but may NOT author one as Pentinian', Boolean(error));
  }
  {
    const { error } = await client.from('project_notes').insert({
      project_id: pr.id, kind: 'brand', facet: 'color', title: `${TAG} self approved`,
      from_client: true, author_id: cu.user.id, status: 'done',
    });
    ok('and may NOT mark their own suggestion accepted', Boolean(error));
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
    ok('a client may NOT release their own row', Boolean(error));
  }
  {
    const { error } = await client.from('project_notes').insert({
      project_id: pr.id, kind: 'request', title: `${TAG} not mine`,
      from_client: false, author_id: cu.user.id,
    });
    ok('a client may NOT post as Pentinian', Boolean(error));
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
  const stranger = await asUser(strangerEmail, pw);
  {
    const { data } = await stranger.from('project_notes').select('id').eq('project_id', pr.id);
    ok('a stranger sees nothing on a project that is not theirs', (data ?? []).length === 0);
  }
  {
    const { error } = await stranger.from('project_notes').insert({
      project_id: pr.id, kind: 'request', title: `${TAG} trespass`,
      from_client: true, author_id: su.user.id,
    });
    ok('a stranger may not write into it either', Boolean(error));
  }

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
} catch (e) {
  fail += 1;
  console.log(`\n  FAIL threw: ${e.message}`);
} finally {
  // Teardown lives here so a timeout, a throw or a failed assertion still cleans up.
  // Test debris has twice been left in the real Atelier; never again.
  for (const id of made.projects) await db.from('project_notes').delete().eq('project_id', id);
  for (const id of made.projects) await db.from('projects').delete().eq('id', id);
  for (const id of made.clients) await db.from('clients').delete().eq('id', id);
  for (const id of made.users) await db.auth.admin.deleteUser(id);

  const { data: leftover } = await db.from('project_notes').select('id').ilike('title', `%${TAG}%`);
  console.log(`\ntorn down. leftover rows tagged ${TAG}: ${(leftover ?? []).length}`);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
