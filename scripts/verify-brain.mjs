#!/usr/bin/env node
/**
 * The brain's boundaries, checked from the outside.
 *
 *   set -a; source .env.local; set +a
 *   node scripts/verify-brain.mjs
 *
 * A pass means: no browser key can read the brain at all, and no released
 * row exists without its stamp. The Window tests join in Phase C; this is
 * the floor they stand on.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SVC) {
  console.error('Missing env. Run: set -a; source .env.local; set +a');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const ok = (m, d = '') => { pass++; console.log('  PASS  ' + m + (d ? '   ' + d : '')); };
const bad = (m, d = '') => { fail++; console.log('  FAIL  ' + m + (d ? '   ' + d : '')); };

const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const svc = createClient(URL, SVC, { auth: { persistSession: false } });

console.log('\n=== the brain from outside ===');
{
  const { error } = await anon.from('brain_entries').select('id').limit(1);
  error ? ok('anon read denied', error.code ?? '') : bad('anon can read the brain');
}
{
  const { error } = await anon
    .from('brain_entries')
    .insert({ slug: 'x', type: 'brand', source: 'manual', title: 'x', entry_key: 'x', content_hash: 'x' });
  error ? ok('anon write denied', error.code ?? '') : bad('anon can write the brain');
}

console.log('=== standing invariants ===');
{
  const { count } = await svc
    .from('brain_entries')
    .select('id', { count: 'exact', head: true })
    .eq('visibility', 'released')
    .is('released_at', null);
  count === 0 ? ok('every released row carries its stamp') : bad(`${count} released rows without a stamp`);
}
{
  const { count } = await svc
    .from('brain_entries')
    .select('id', { count: 'exact', head: true })
    .neq('visibility', 'released')
    .not('released_at', 'is', null);
  count === 0 ? ok('no unreleased row keeps a stale stamp') : bad(`${count} unreleased rows still stamped`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
