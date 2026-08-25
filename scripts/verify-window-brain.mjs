#!/usr/bin/env node
/**
 * The two tests that are the whole point, plus the redactions around them.
 *
 *   set -a; source .env.local; set +a
 *   node scripts/verify-window-brain.mjs
 *
 * Seeds a throwaway client with their own project, plants probe rows in the
 * brain (internal, staged, released, a released RETIRED value, a released
 * worklog with a body, and a foreign released row), signs in AS the client,
 * and reads window_brain from their side. Then deletes everything it made.
 *
 * A pass means: a real signed-in client sees released brand projections for
 * their own project and nothing else. Not internal, not staged, not another
 * project's, not a retired value however it was pressed, not a worklog body,
 * and never the brain table itself.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SVC) {
  console.error('Missing env. Run: set -a; source .env.local; set +a');
  process.exit(1);
}

const svc = createClient(URL, SVC, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const ok = (m, d = '') => { pass++; console.log('  PASS  ' + m + (d ? '   ' + d : '')); };
const bad = (m, d = '') => { fail++; console.log('  FAIL  ' + m + (d ? '   ' + d : '')); };

const email = `window-brain-test-${Date.now()}@pentinian.test`;
const password = randomUUID() + 'Aa1!';
const made = { user: null, client: null, project: null, foreign: null, entries: [] };

const plant = async (row) => {
  const { data, error } = await svc
    .from('brain_entries')
    .insert({ provenance: 'window brain probe', ...row })
    .select('id')
    .single();
  if (error) throw new Error('planting: ' + error.message);
  made.entries.push(data.id);
  return data.id;
};

try {
  console.log('\n=== seeding ===');
  const { data: u, error: uErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (uErr) throw uErr;
  made.user = u.user.id;

  const { data: c } = await svc.from('clients')
    .insert({ name: 'Window Brain Test Co', email, user_id: made.user }).select().single();
  made.client = c.id;
  const { data: p } = await svc.from('projects')
    .insert({ name: 'Window Brain Probe', client_id: c.id }).select().single();
  made.project = p.id;
  const { data: fp } = await svc.from('projects').insert({ name: 'Foreign Probe' }).select().single();
  made.foreign = fp.id;
  console.log('  client, own project, foreign project ready');

  const stamp = new Date().toISOString();
  const key = (s) => `probe:${s}:${Date.now()}`;
  await plant({ project_id: p.id, slug: 'probe', type: 'brand', source: 'manual', title: 'Released token',
    payload: { kind: 'token', name: 'Probe', value: '#123456', purpose: 'released and visible' },
    entry_key: key('rel'), content_hash: '1', visibility: 'released', released_at: stamp });
  await plant({ project_id: p.id, slug: 'probe', type: 'brand', source: 'manual', title: 'Internal token',
    payload: { kind: 'token', name: 'Hidden', value: '#654321' },
    entry_key: key('int'), content_hash: '2', visibility: 'internal' });
  await plant({ project_id: p.id, slug: 'probe', type: 'brand', source: 'manual', title: 'Staged token',
    payload: { kind: 'token', name: 'Waiting', value: '#111111' },
    entry_key: key('stg'), content_hash: '3', visibility: 'staged' });
  await plant({ project_id: p.id, slug: 'probe', type: 'brand', source: 'manual', title: 'Retired, released anyway',
    payload: { kind: 'retired', name: '--dead', value: '#d1b375' },
    entry_key: key('ret'), content_hash: '4', visibility: 'released', released_at: stamp });
  await plant({ project_id: p.id, slug: 'probe', type: 'worklog', source: 'manual', title: 'Secret first line',
    body: 'STAFF ONLY DETAIL TEXT', payload: { kind: 'worklog', eli5: 'safe words', why: 'safe why' },
    entry_key: key('wl'), content_hash: '5', visibility: 'released', released_at: stamp });
  await plant({ project_id: fp.id, slug: 'probe-f', type: 'brand', source: 'manual', title: 'Foreign released',
    payload: { kind: 'token', name: 'NotYours', value: '#abcdef' },
    entry_key: key('for'), content_hash: '6', visibility: 'released', released_at: stamp });
  console.log('  six probes planted');

  console.log('\n=== reading as the client ===');
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: inErr } = await anon.auth.signInWithPassword({ email, password });
  if (inErr) throw inErr;

  const { data: seen, error: vErr } = await anon.from('window_brain').select('*');
  if (vErr) {
    bad('window_brain readable by a client', vErr.message);
  } else {
    const titles = (seen ?? []).map((r) => r.title);
    titles.includes('Released token')
      ? ok('released brand projection visible')
      : bad('released brand projection missing');
    !titles.includes('Internal token')
      ? ok('internal entry unreachable')
      : bad('INTERNAL ENTRY VISIBLE');
    !titles.includes('Staged token')
      ? ok('staged entry unreachable')
      : bad('STAGED ENTRY VISIBLE');
    !(seen ?? []).some((r) => r.payload?.kind === 'retired')
      ? ok('retired value never rendered, even released')
      : bad('RETIRED VALUE VISIBLE');
    !(seen ?? []).some((r) => r.type === 'worklog')
      ? ok('worklog rows never in the view')
      : bad('WORKLOG ROW IN VIEW');
    !JSON.stringify(seen ?? []).includes('STAFF ONLY DETAIL')
      ? ok('no staff detail text anywhere in the projection')
      : bad('STAFF DETAIL LEAKED');
    !titles.includes('Foreign released')
      ? ok("another project's released row unreachable")
      : bad('FOREIGN ROW VISIBLE');
  }

  const { error: tblErr } = await anon.from('brain_entries').select('id').limit(1);
  tblErr ? ok('brain table itself denied', tblErr.code ?? '') : bad('BRAIN TABLE READABLE');
} catch (e) {
  bad('harness error', e?.message ?? String(e));
} finally {
  console.log('\n=== tearing down ===');
  for (const id of made.entries) await svc.from('brain_entries').delete().eq('id', id);
  if (made.project) await svc.from('projects').delete().eq('id', made.project);
  if (made.foreign) await svc.from('projects').delete().eq('id', made.foreign);
  if (made.client) await svc.from('clients').delete().eq('id', made.client);
  if (made.user) await svc.auth.admin.deleteUser(made.user);
  console.log('  removed');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
