#!/usr/bin/env node
/**
 * What a client SEES when a reply fails to send.
 *
 *   set -a; source .env.local; set +a
 *   APP=http://127.0.0.1:3001 node scripts/probe-reply-failure.mjs
 *
 * Log.tsx line 292 reads `if (!res.ok) return;`. The route on the other side is
 * careful: it returns a JSON error with a 403 or a 400, and every one of those
 * is a sentence written for a person. The caller throws all of it away.
 *
 * This is a claim about what somebody sees, so it is measured in a browser
 * rather than argued from the source. The reply is forced to fail by refusing
 * the POST at the network layer, which is the same thing the server does when a
 * session has lapsed under an open page, and the middleware's own comments say
 * that is a case that really happens: "the token would quietly expire under a
 * page that looked fine".
 *
 * It counts what the page shows afterwards. Not whether an error variable was
 * set: whether a human would learn that their message did not send.
 */
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const A = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const S = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.env.APP || 'http://127.0.0.1:3001';
if (!U || !A || !S) { console.error('Missing env. Run: set -a; source .env.local; set +a'); process.exit(1); }

const PW_DIR = process.env.PLAYWRIGHT_DIR
  ?? join(process.env.HOME, 'Studio/_pentinian/Pentinian-Site/node_modules');
const { chromium } = await import(join(PW_DIR, 'playwright-chromium/index.mjs'));

const svc = createClient(U, S, { auth: { persistSession: false } });
const made = { users: [], clients: [], projects: [], entries: [] };
const pw = randomUUID() + 'Aa1!';
const email = `replyfail-${Date.now()}@pentinian.test`;

let pass = 0, fail = 0;
const ok = (m, d = '') => { pass++; console.log('  PASS  ' + m + (d ? '   ' + d : '')); };
const bad = (m, d = '') => { fail++; console.log('  FAIL  ' + m + (d ? '   ' + d : '')); };

let browser;
try {
  console.log(`\nagainst ${APP}`);
  console.log('\n=== seeding a client with one released entry ===');
  const { data: u, error: uErr } = await svc.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (uErr) throw uErr;
  made.users.push(u.user.id);
  const { data: cl } = await svc.from('clients')
    .insert({ name: 'Replyfail Test Co', email, user_id: u.user.id }).select().single();
  made.clients.push(cl.id);
  const { data: pr } = await svc.from('projects')
    .insert({ client_id: cl.id, name: 'Replyfail Test Project', phase: 'test' }).select().single();
  made.projects.push(pr.id);

  const now = new Date();
  const { data: entry, error: eErr } = await svc.from('work_log_released').insert({
    project_id: pr.id, title: 'A released piece of work', eli5: 'plain words about it',
    why: 'because it needed doing', area: 'test',
    started_at: new Date(now.getTime() - 3600e3).toISOString(), ended_at: now.toISOString(),
    minutes: 60, visible: true, release_at: null,
  }).select().single();
  if (eErr) throw eErr;
  made.entries.push(entry.id);
  console.log('  entry released today, so it lands on the current month');

  browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1382, height: 900 } });

  /* Sign in by planting the same cookies the app itself would set.
   *
   * The obvious route, generateLink plus a navigation, does not work here: the
   * action link carries a redirect_to that Supabase checks against its own
   * allowlist, and a local port is not on it, so the visit lands back on
   * /login having proven nothing about the Window. Building the cookie jar
   * with createServerClient is what scripts/verify-replies.mjs already does,
   * so this reuses the incumbent mechanism rather than inventing a second one. */
  const { data: sess, error: sErr } = await createClient(U, A, { auth: { persistSession: false } })
    .auth.signInWithPassword({ email, password: pw });
  if (sErr) throw sErr;
  const jar = [];
  const w = createServerClient(U, A, { cookies: { getAll: () => [], setAll: (l) => jar.push(...l) } });
  await w.auth.setSession({
    access_token: sess.session.access_token,
    refresh_token: sess.session.refresh_token,
  });
  const { hostname } = new URL(APP);
  await ctx.addCookies(jar.map((c) => ({
    name: c.name, value: c.value, domain: hostname, path: '/',
    httpOnly: false, secure: false, sameSite: 'Lax',
  })));

  const page = await ctx.newPage();
  await page.goto(`${APP}/window`, { waitUntil: 'networkidle' });

  const signedIn = !page.url().includes('/login');
  signedIn ? ok('signed in and standing in the Window', page.url().replace(APP, ''))
           : bad('could not sign in', page.url());
  if (!signedIn) throw new Error('sign-in failed, the rest would measure nothing');

  // Open today, then the entry, to reach the reply box.
  await page.waitForTimeout(1500);
  const dayBtn = page.locator('button.wl-day.worked').first();
  await dayBtn.waitFor({ timeout: 15000 });
  await dayBtn.click();
  await page.waitForTimeout(800);
  const entryBtn = page.locator('.we-head, button:has(.we-headline)').first();
  await entryBtn.click();
  await page.waitForTimeout(800);

  const box = page.locator('.wl-say input');
  await box.waitFor({ timeout: 10000 });
  ok('the reply box is on screen');

  /* Force the failure at the network layer. This is the lapsed-session case:
   * the page is open and looks fine, the cookie is dead, the route answers 403
   * with a sentence in it. */
  await page.route('**/api/comments', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Not permitted' }),
    })
  );

  const typed = 'Can we make the header a little calmer?';
  await box.fill(typed);
  const before = await page.evaluate(() => document.body.innerText);
  await page.locator('.wl-say button.mini-btn').first().click();
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => document.body.innerText);
  const added = after.replace(before, '').trim();

  console.log('\n=== what the page says after the send fails ===');
  const stillInBox = await box.inputValue();
  /* Two independent readings, because each alone can lie.
   *
   * A word list alone is a trap I walked into on the first run of this probe:
   * it reported "the client is told nothing" while the page was plainly
   * carrying "Your session has expired", because "expired" was not in my list.
   * The measurement was wrong, not the page. So the primary reading is now
   * structural (did an error element appear, did the text grow), and the word
   * list is kept only as a description of what it says. */
  const shown = await page.locator('.wl-say-err').count();
  const appeared = await page.evaluate(() => {
    const t = document.body.innerText.toLowerCase();
    const words = ['not permitted', 'did not save', 'did not send', 'try again', 'failed',
                   'could not', 'error', 'went wrong', 'not sent', 'unable', 'expired'];
    return words.filter((w) => t.includes(w));
  });

  console.log(`  text the page gained: ${JSON.stringify(added).slice(0, 120)}`);
  console.log(`  error elements on screen: ${shown}`);
  console.log(`  words of failure found: ${appeared.length ? appeared.join(', ') : 'none'}`);
  console.log(`  what is still in the box: ${JSON.stringify(stillInBox)}`);

  shown > 0 && added.length > 0
    ? ok('the client is told the send failed', `${shown} message, ${added.length} chars`)
    : bad('THE CLIENT IS TOLD NOTHING: the send failed and the page said nothing');

  appeared.length > 0
    ? ok('and it reads as a failure rather than a shrug', appeared.join(', '))
    : bad('an element appeared but says nothing that reads as a failure', JSON.stringify(added).slice(0, 80));

  // The second half of the defect, and the worse half. If the box also empties,
  // the page has actively said the opposite of what happened: their words are
  // gone from the screen exactly as they would be after a successful send.
  stillInBox === typed
    ? ok('at least their words are still in the box to retry')
    : bad('AND THEIR WORDS WERE CLEARED, which reads as success', JSON.stringify(stillInBox));

  /* Named for what it depicts, not for a point in time. This probe always runs
   * against whatever the code currently does, so a file called "before" would
   * be a lie every run after the fix landed. It shows a failed send as the
   * client sees it. */
  await page.screenshot({ path: 'docs/proof/reply-failure.png' });
  console.log('\n  shot: docs/proof/reply-failure.png');

  /* The other half of the test, and the one that stops this being a probe that
   * passes by breaking the app. An error message is easy to make appear; the
   * point is that it appears ONLY when something went wrong. So: drop the
   * interception, send for real, and require that the reply lands, the error
   * clears, and the box empties. */
  console.log('\n=== and the same box on a send that works ===');
  await page.unroute('**/api/comments');
  await box.fill('This one should actually land.');
  await page.locator('.wl-say button.mini-btn').first().click();
  await page.waitForTimeout(2000);

  const afterGood = await page.evaluate(() => document.body.innerText);
  afterGood.includes('This one should actually land.')
    ? ok('a real reply appears in the thread')
    : bad('the reply did not appear after a successful send');

  const errGone = await page.locator('.wl-say-err').count();
  errGone === 0
    ? ok('and the failure message is gone')
    : bad('the failure message survived a successful send', String(errGone));

  const emptied = await box.inputValue();
  emptied === ''
    ? ok('and the box emptied, which is what success looks like')
    : bad('the box kept the text after a successful send', JSON.stringify(emptied));

  const { count: landed } = await svc
    .from('comments').select('id', { count: 'exact' }).eq('entry_id', entry.id);
  landed === 1
    ? ok('exactly one comment reached the database', String(landed))
    : bad('wrong number of comments in the database', String(landed));

} catch (e) {
  bad('threw: ' + (e?.message ?? e));
} finally {
  if (browser) await browser.close();
  console.log('\n=== tearing down ===');
  for (const id of made.entries) await svc.from('comments').delete().eq('entry_id', id);
  for (const id of made.entries) await svc.from('work_log_released').delete().eq('id', id);
  for (const id of made.projects) await svc.from('projects').delete().eq('id', id);
  for (const id of made.clients) await svc.from('clients').delete().eq('id', id);
  for (const id of made.users) await svc.auth.admin.deleteUser(id);
  console.log('  removed', made.users.length, 'users,', made.projects.length, 'projects');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
