#!/usr/bin/env node
/**
 * The two doors, measured: a letter's link signs its reader in, and the site
 * asks for a password.
 *
 *   set -a; source .env.local; set +a
 *   APP=http://127.0.0.1:3001 node scripts/verify-mail-key.mjs
 *
 * Pen, 2026-11-19: "I want david to use his own password if he tries to join
 * through the site without being logged in, but if he logs in through the weekly
 * email it should sign him in automatically."
 *
 * What is asked here, each against the running app and never read off the source:
 *
 *   the letter's door   a good key opens the Window with nothing typed;
 *                       a forged, expired, revoked or nobody's key does not;
 *                       a key never opens anything for staff;
 *                       a key cannot be pointed at the Atelier or off the site;
 *                       a reader who is already signed in is not swapped out.
 *   the site's door     someone holding a starter password who arrives by the
 *                       letter goes straight in, and the SAME person arriving
 *                       by that starter password is still held until they have
 *                       chosen their own. The hold is the part that must not be
 *                       lost while the letter's door is being opened.
 *
 * Keys are minted with scripts/mail-key.mjs and read by the route through
 * lib/auth/mail-key.ts. They are two copies of the same few lines, so every PASS
 * below is also the proof that the copies agree.
 *
 * Creates three throwaway users and deletes them in the finally block. Confirm
 * with scripts/leftovers.mjs afterwards.
 */
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID } from 'node:crypto';
import { mintMailKey, mailKeyUrl } from './mail-key.mjs';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const A = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const S = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Empty is not absent: .env.local ships APP= with nothing after it.
const APP = process.env.APP || 'http://127.0.0.1:3001';

if (!U || !A || !S) {
  console.error('Missing env. Run: set -a; source .env.local; set +a');
  process.exit(1);
}

const svc = createClient(U, S, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (m, d = '') => { pass++; console.log('  PASS  ' + m + (d ? '   ' + d : '')); };
const bad = (m, d = '') => { fail++; console.log('  FAIL  ' + m + (d ? '   ' + d : '')); };

/** A cookie header for a PASSWORD session, built the way the app builds one. */
async function passwordCookie(email, password) {
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

/** Press a letter's link. Returns where it sent us and the session it set, if any. */
async function press(url, cookie = '') {
  const res = await fetch(url, { redirect: 'manual', cache: 'no-store', headers: cookie ? { cookie } : {} });
  const set = res.headers.getSetCookie?.() ?? [];
  const session = set
    .map((c) => c.split(';')[0])
    .filter((c) => (c.startsWith('sb-') || c.startsWith('pt-letter=')) && c.split('=')[1]);
  return {
    status: res.status,
    // Path only. The dev server reports itself as localhost whatever host it was
    // asked on, so the origin in a Location header says nothing worth asserting.
    to: (() => { try { const u = new URL(res.headers.get('location') ?? '', APP); return u.pathname + u.search; } catch { return ''; } })(),
    offsite: (() => { try { return !['127.0.0.1', 'localhost', new URL(APP).hostname].includes(new URL(res.headers.get('location') ?? '', APP).hostname); } catch { return true; } })(),
    cookie: session.join('; '),
    referrer: res.headers.get('referrer-policy') ?? '',
    cache: res.headers.get('cache-control') ?? '',
  };
}

const refused = (r) => r.status === 307 && r.to.startsWith('/login?e=mailkey') && !r.cookie;
const show = (r) => `${r.status} -> ${r.to.slice(0, 60)}${r.cookie ? ' (session set)' : ''}`;

const made = { users: [], clients: [], projects: [] };
const pw = randomUUID() + 'Aa1!';
const nowS = () => Math.floor(Date.now() / 1000);

try {
  const up = await fetch(APP, { redirect: 'manual' }).then(() => true).catch(() => false);
  if (!up) { console.error(`\nNothing answering at ${APP}. Start the app first.\n`); process.exit(1); }
  console.log(`\nagainst ${APP}`);

  console.log('\n=== seeding ===');
  const stamp = Date.now();
  const mk = async (tag, extra = {}) => {
    const email = `mailkey-${tag}-${stamp}@pentinian.test`;
    const { data, error } = await svc.auth.admin.createUser({ email, password: pw, email_confirm: true, ...extra });
    if (error) throw error;
    made.users.push(data.user.id);
    return { id: data.user.id, email };
  };
  const reader = await mk('reader');
  const starter = await mk('starter', { user_metadata: { starter_password: true } });
  const staff = await mk('staff', { app_metadata: { role: 'admin' } });

  const { data: cl } = await svc.from('clients')
    .insert({ name: 'Mail Key Test Co', email: reader.email, user_id: reader.id }).select().single();
  made.clients.push(cl.id);
  const { data: pr } = await svc.from('projects')
    .insert({ client_id: cl.id, name: 'Mail Key Test Project', phase: 'test' }).select().single();
  made.projects.push(pr.id);
  console.log('  a reader with a project, a reader still holding a starter password, and a staff control');

  /* ------------------------------------------------ the letter's door ----- */
  console.log('\n=== the letter opens the Window ===');
  const good = await press(mailKeyUrl(APP, mintMailKey(reader.id, 8), '/window'));
  good.status === 307 && good.to === '/window' && good.cookie
    ? ok('a good key lands on the Window with a session and nothing typed', show(good))
    : bad('a good key did not open the door', show(good));
  good.referrer === 'no-referrer' && /no-store/.test(good.cache)
    ? ok('and the response keeps the key out of caches and referrers')
    : bad('the key can leak by cache or referrer', `${good.cache} | ${good.referrer}`);

  const win = await fetch(`${APP}/window`, { headers: { cookie: good.cookie }, redirect: 'manual' });
  win.status === 200
    ? ok('that session opens /window', String(win.status))
    : bad('the session the key made does not open /window', `${win.status} -> ${win.headers.get('location') ?? ''}`);

  // /api/me names nobody on purpose, so ask Supabase who this cookie is.
  const jar = good.cookie.split('; ').map((c) => ({ name: c.slice(0, c.indexOf('=')), value: decodeURIComponent(c.slice(c.indexOf('=') + 1)) }));
  const { data: who } = await createServerClient(U, A, { cookies: { getAll: () => jar, setAll: () => {} } }).auth.getUser();
  who?.user?.id === reader.id
    ? ok('and it is the reader the key names, nobody else')
    : bad('the session is not the reader', String(who?.user?.email ?? 'no user'));

  const again = await press(mailKeyUrl(APP, mintMailKey(reader.id, 8), '/window'));
  const twice = await press(mailKeyUrl(APP, mintMailKey(reader.id, 8), '/window'));
  again.cookie && twice.cookie
    ? ok('it opens on the second and third press too (a mail scanner cannot spend it)')
    : bad('the key stopped working after one use', `${show(again)} | ${show(twice)}`);

  const deep = `/api/window-log?project=${pr.id}&format=csv`;
  const dl = await press(mailKeyUrl(APP, mintMailKey(reader.id, 8), deep));
  dl.status === 307 && dl.to === deep && dl.cookie
    ? ok('a download link in the letter lands on its own file, signed in', show(dl))
    : bad('a deep link did not survive the door', show(dl));

  console.log('\n=== what the letter cannot do ===');
  const key = mintMailKey(reader.id, 8);
  const forged = key.slice(0, -2) + (key.endsWith('AA') ? 'BB' : 'AA');
  const r1 = await press(mailKeyUrl(APP, forged, '/window'));
  refused(r1) ? ok('a forged key is sent to the password door', show(r1)) : bad('A FORGED KEY WAS HONORED', show(r1));

  // The body of one person's key with another's signature: the swap an attacker
  // holding their own letter would try.
  const mine = mintMailKey(reader.id, 8), theirs = mintMailKey(starter.id, 8);
  const r2 = await press(mailKeyUrl(APP, `${theirs.split('.')[0]}.${mine.split('.')[1]}`, '/window'));
  refused(r2) ? ok('one reader\'s signature does not carry another reader\'s name', show(r2)) : bad('A SWAPPED KEY WAS HONORED', show(r2));

  const r3 = await press(mailKeyUrl(APP, mintMailKey(reader.id, 8, nowS() - 9 * 86400), '/window'));
  refused(r3) ? ok('a key past its end date is refused', show(r3)) : bad('AN EXPIRED KEY WAS HONORED', show(r3));

  const r4 = await press(mailKeyUrl(APP, mintMailKey(staff.id, 8), '/window'));
  refused(r4) ? ok('a key naming staff opens nothing', show(r4)) : bad('A KEY SIGNED STAFF IN', show(r4));

  const r5 = await press(mailKeyUrl(APP, mintMailKey(randomUUID(), 8), '/window'));
  refused(r5) ? ok('a key naming nobody is refused', show(r5)) : bad('a key for no account was honored', show(r5));

  const r6 = await press(`${APP}/auth/mail?next=/window`);
  refused(r6) ? ok('no key at all is refused', show(r6)) : bad('the door opened with no key', show(r6));

  const r7 = await press(mailKeyUrl(APP, mintMailKey(reader.id, 8), '/atelier'));
  r7.to === '/window'
    ? ok('a key pointed at the Atelier lands on the Window instead', show(r7))
    : bad('a key was allowed to aim at the Atelier', show(r7));

  const r8 = await press(mailKeyUrl(APP, mintMailKey(reader.id, 8), '//example.com/x'));
  r8.to === '/window' && !r8.offsite
    ? ok('a key cannot send its reader off the site', show(r8))
    : bad('OPEN REDIRECT through the mail door', show(r8));

  console.log('\n=== one letter gone astray can be called back ===');
  const old = mintMailKey(reader.id, 8, nowS() - 120);
  await svc.auth.admin.updateUserById(reader.id, { app_metadata: { mail_keys_after: nowS() - 60 } });
  const r9 = await press(mailKeyUrl(APP, old, '/window'));
  refused(r9) ? ok('a key issued before the revoke is dead', show(r9)) : bad('A REVOKED KEY WAS HONORED', show(r9));
  const r10 = await press(mailKeyUrl(APP, mintMailKey(reader.id, 8), '/window'));
  r10.cookie ? ok('and one issued after it works', show(r10)) : bad('revoking killed new keys too', show(r10));

  console.log('\n=== a reader already signed in is left alone ===');
  const staffCookie = await passwordCookie(staff.email, pw);
  const r11 = await press(mailKeyUrl(APP, mintMailKey(reader.id, 8), '/window'), staffCookie);
  r11.status === 307 && r11.to === '/window' && !r11.cookie
    ? ok('staff pressing a client\'s link stays staff: no session is swapped in', show(r11))
    : bad('pressing a link replaced an existing session', show(r11));

  /* --------------------------------------------------- the site's door ---- */
  console.log('\n=== the starter password: the letter passes, the password is held ===');
  const viaLetter = await press(mailKeyUrl(APP, mintMailKey(starter.id, 8), '/window'));
  const letterWin = await fetch(`${APP}/window`, { headers: { cookie: viaLetter.cookie }, redirect: 'manual' });
  viaLetter.cookie && letterWin.status === 200
    ? ok('holding a starter password and arriving by the letter: straight into the Window', String(letterWin.status))
    : bad('the letter\'s reader was held or refused', `${show(viaLetter)} then ${letterWin.status} -> ${letterWin.headers.get('location') ?? ''}`);

  const viaPassword = await passwordCookie(starter.email, pw);
  const pwWin = await fetch(`${APP}/window`, { headers: { cookie: viaPassword }, redirect: 'manual' });
  const pwTo = pwWin.headers.get('location') ?? '';
  pwWin.status === 307 && pwTo.includes('/account/password')
    ? ok('the same person arriving by the starter password is held until they choose their own', `${pwWin.status} -> ${pwTo.replace(APP, '')}`)
    : bad('THE STARTER PASSWORD HOLD IS GONE', `${pwWin.status} -> ${pwTo}`);

  const pwApi = await fetch(`${APP}/api/me`, { headers: { cookie: viaPassword }, redirect: 'manual', cache: 'no-store' });
  pwApi.status === 307
    ? ok('and held on /api as well, not only on pages', String(pwApi.status))
    : bad('a starter password session reached /api', String(pwApi.status));

  // A link asked for on the login page is the site's door, not the letter's. Same
  // kind of session underneath (a one-time link), and it must still be held.
  const { data: gl } = await svc.auth.admin.generateLink({ type: 'magiclink', email: starter.email });
  const siteJar = [];
  const siteClient = createServerClient(U, A, { cookies: { getAll: () => [], setAll: (l) => siteJar.push(...l) } });
  const { error: siteErr } = await siteClient.auth.verifyOtp({ type: 'magiclink', token_hash: gl?.properties?.hashed_token ?? '' });
  const siteCookie = siteJar.map((k) => `${k.name}=${k.value}`).join('; ');
  const siteWin = await fetch(`${APP}/window`, { headers: { cookie: siteCookie }, redirect: 'manual' });
  const siteTo = siteWin.headers.get('location') ?? '';
  !siteErr && siteWin.status === 307 && siteTo.includes('/account/password')
    ? ok('and so is a link they asked the login page for: only the letter passes', `${siteWin.status} -> ${siteTo.replace(APP, '')}`)
    : bad('a site link slipped past the hold', `${siteErr?.message ?? ''} ${siteWin.status} -> ${siteTo}`);

  // The letter's mark on somebody else's session buys nothing.
  const mark = viaLetter.cookie.split('; ').find((c) => c.startsWith('pt-letter=')) ?? 'pt-letter=missing';
  const borrowed = await fetch(`${APP}/window`, { headers: { cookie: `${viaPassword}; ${mark}` }, redirect: 'manual' });
  borrowed.status === 307 && (borrowed.headers.get('location') ?? '').includes('/account/password')
    ? ok('the letter\'s mark carried onto a password session does not lift the hold')
    : bad('THE MARK ALONE LIFTED THE HOLD', String(borrowed.status));

  const { data: still } = await svc.auth.admin.getUserById(starter.id);
  still?.user?.user_metadata?.starter_password === true
    ? ok('arriving by the letter did not quietly clear the starter flag')
    : bad('the starter flag changed', JSON.stringify(still?.user?.user_metadata));

  console.log('\n=== the site, cold ===');
  const cold = await fetch(`${APP}/window`, { redirect: 'manual' });
  const coldTo = cold.headers.get('location') ?? '';
  cold.status === 307 && coldTo.includes('/login')
    ? ok('no letter and no session: the login page', `${cold.status} -> ${coldTo.replace(APP, '')}`)
    : bad('a cold visitor did not meet the login page', `${cold.status} -> ${coldTo}`);

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
