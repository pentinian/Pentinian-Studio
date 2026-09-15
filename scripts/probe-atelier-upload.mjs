#!/usr/bin/env node
/**
 * THE ATELIER UPLOADS A SCREENSHOT, and a client sees it only when it is released.
 *
 *   set -a; source .env.local; set +a
 *   APP=http://127.0.0.1:3001 node scripts/probe-atelier-upload.mjs
 *
 * This is a claim about what two different people can do and see, so it is
 * driven in a real browser from a CLEAN context rather than argued from the
 * source or run from a session that happens to be lying around. Two browser
 * contexts are used, one per person, because a single context carrying a staff
 * cookie is the classic way a privacy check passes for the wrong reason.
 *
 * WHAT IT PROVES, in order:
 *
 *   1. Staff opens Build in a fresh browser, picks an entry, and the upload
 *      control is on screen. (It did not exist before 2026-09-15: Curation
 *      showed a count of screenshots and offered no way to add one.)
 *   2. Choosing a file puts a real object in the shots bucket AND records its
 *      path on the work_log_raw row. Both are read back from the database, not
 *      inferred from the interface saying so.
 *   3. The client, in their OWN clean browser, cannot reach that object while
 *      the entry is unreleased. This is supabase/shots-gate.sql doing its job,
 *      and Pen ruled on 2026-09-15 that this is the correct behavior.
 *   4. Staff releases the entry. The same client can now sign the same object
 *      and the image is actually on their Window, measured as a rendered <img>
 *      with a nonzero natural width, not as a URL that resolved.
 *   5. Taking the screenshot off removes it from the row, from the released row,
 *      and from storage.
 *
 * AND THE FENCE THAT STOPS THIS PASSING BY BREAKING THINGS: step 3 is only
 * meaningful if step 4 works. A probe that asserted "the client cannot see it"
 * would pass beautifully against a completely broken bucket. Both directions
 * are required, against the same object, in the same run.
 */
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const A = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const S = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Empty is not absent: .env.local ships APP= blank and `??` would keep it.
const APP = process.env.APP || 'http://127.0.0.1:3001';
if (!U || !A || !S) { console.error('Missing env. Run: set -a; source .env.local; set +a'); process.exit(1); }

const PW_DIR = process.env.PLAYWRIGHT_DIR
  ?? join(process.env.HOME, 'Studio/_pentinian/Pentinian-Site/node_modules');
const { chromium } = await import(join(PW_DIR, 'playwright-chromium/index.mjs'));

const svc = createClient(U, S, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (m, d = '') => { pass++; console.log('  PASS  ' + m + (d ? '   ' + d : '')); };
const bad = (m, d = '') => { fail++; console.log('  FAIL  ' + m + (d ? '   ' + d : '')); };

const made = { users: [], clients: [], projects: [], raw: [], released: [], objects: [] };
const pw = randomUUID() + 'Aa1!';
const staffEmail = `upload-staff-${Date.now()}@pentinian.test`;
const clientEmail = `upload-client-${Date.now()}@pentinian.test`;

/* A recognisable image rather than a 1x1 pixel. It has to survive being
 * rendered and measured at the far end, and a one-pixel PNG scaled into a
 * thumbnail proves nothing about whether an image arrived. 240x150 of solid
 * color, written as an uncompressed BMP so no encoder is needed. */
function bmp(w, h, [r, g, b]) {
  const rowRaw = w * 3, pad = (4 - (rowRaw % 4)) % 4, row = rowRaw + pad;
  const size = 54 + row * h;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0);
  buf.writeUInt32LE(size, 2); buf.writeUInt32LE(54, 10); buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = 54 + y * row + x * 3;
    buf[o] = b; buf[o + 1] = g; buf[o + 2] = r;
  }
  return buf;
}

/** Cookies for this person, built the way the app itself builds them. */
async function cookiesFor(email) {
  const { data, error } = await createClient(U, A, { auth: { persistSession: false } })
    .auth.signInWithPassword({ email, password: pw });
  if (error) throw new Error(email + ': ' + error.message);
  const jar = [];
  const w = createServerClient(U, A, { cookies: { getAll: () => [], setAll: (l) => jar.push(...l) } });
  await w.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  const { hostname } = new URL(APP);
  return jar.map((c) => ({
    name: c.name, value: c.value, domain: hostname, path: '/',
    httpOnly: false, secure: false, sameSite: 'Lax',
  }));
}

let browser, tmpFile;
try {
  const up = await fetch(APP, { redirect: 'manual' }).then(() => true).catch(() => false);
  if (!up) { console.error(`\nNothing answering at ${APP}. Start the app first.\n`); process.exit(1); }
  console.log(`\nagainst ${APP}`);

  console.log('\n=== seeding: a staff member, a client, one unreleased entry ===');
  const { data: su, error: sErr } = await svc.auth.admin.createUser({
    email: staffEmail, password: pw, email_confirm: true, app_metadata: { role: 'admin' },
  });
  if (sErr) throw sErr;
  made.users.push(su.user.id);

  const { data: cu, error: cErr } = await svc.auth.admin.createUser({
    email: clientEmail, password: pw, email_confirm: true,
  });
  if (cErr) throw cErr;
  made.users.push(cu.user.id);

  const { data: cl } = await svc.from('clients')
    .insert({ name: 'Upload Test Co', email: clientEmail, user_id: cu.user.id }).select().single();
  made.clients.push(cl.id);
  const { data: pr } = await svc.from('projects')
    .insert({ client_id: cl.id, name: 'Upload Test Project', phase: 'test', client_facing: true })
    .select().single();
  made.projects.push(pr.id);

  // Placed on today at a fixed hour, because the Atelier refuses to release an
  // entry with no time on it and the Window is organised by day.
  const start = new Date(); start.setHours(10, 0, 0, 0);
  const { data: rawRow, error: rawErr } = await svc.from('work_log_raw').insert({
    project_id: pr.id,
    body: 'A screenshot belongs on this\n\nthe staff-only detail',
    eli5: 'plain words about it', why: 'because it needed doing', area: 'test',
    started_at: start.toISOString(),
    ended_at: new Date(start.getTime() + 3600e3).toISOString(),
    minutes: 60, logged_at: start.toISOString(), notion_id: 'upload-' + Date.now(),
  }).select().single();
  if (rawErr) throw rawErr;
  made.raw.push(rawRow.id);
  console.log('  entry', rawRow.id, 'placed at 10:00 today, unreleased');

  /* Named like something a person would actually upload.
   *
   * It was `atelier-upload-<Date.now()>.png` on the first run, and that broke the
   * caption fence below for a reason that was MY fault rather than the page's:
   * pretty() strips the date prefix and the upload stamp the app adds, and then
   * the epoch I had baked into the fixture's own name was still sitting there,
   * so a correct caption read as a raw filename. The measurement was wrong, not
   * the page. A fixture that does not look like real input is not a fixture. */
  tmpFile = join(tmpdir(), 'the-header-as-it-stands.png');
  // Named .png so the accept filter and the mime allowlist both take it; the
  // bytes are a BMP, which every browser and Supabase treat as opaque anyway.
  await writeFile(tmpFile, bmp(240, 150, [122, 146, 112]));

  browser = await chromium.launch({ args: ['--no-sandbox'] });

  /* ------------------------------------------------ 1. staff, clean browser */
  console.log('\n=== 1. the Atelier, in a browser that has never been signed in ===');
  const staffCtx = await browser.newContext({ viewport: { width: 1382, height: 950 } });
  await staffCtx.addCookies(await cookiesFor(staffEmail));
  const atelier = await staffCtx.newPage();
  const errors = [];
  atelier.on('pageerror', (e) => errors.push(e.message));

  await atelier.goto(`${APP}/atelier`, { waitUntil: 'networkidle' });
  !atelier.url().includes('/login') && !atelier.url().includes('/no-access')
    ? ok('staff stands in the Atelier', atelier.url().replace(APP, ''))
    : bad('staff could not reach the Atelier', atelier.url());

  // Select the project on the rail, then Build.
  await atelier.waitForTimeout(1500);
  const railBtn = atelier.locator('.rail .ri', { hasText: 'Upload Test Project' }).first();
  await railBtn.waitFor({ timeout: 15000 });
  await railBtn.click();
  await atelier.waitForTimeout(500);
  await atelier.locator('.tabs button', { hasText: 'Build' }).first().click();
  await atelier.waitForTimeout(1200);

  // The list view finds the entry by its words, which is steadier than
  // clicking a calendar cell whose position depends on today's date.
  await atelier.locator('button.cur-view').first().click();
  await atelier.waitForTimeout(600);
  const row = atelier.locator('button.cur-row', { hasText: 'A screenshot belongs on this' }).first();
  await row.waitFor({ timeout: 15000 });
  await row.click();
  await atelier.waitForTimeout(800);

  const control = atelier.locator('.cur-shots .at button');
  const controlThere = await control.count();
  controlThere > 0
    ? ok('the upload control is on screen in Build', `${controlThere} control`)
    : bad('NO UPLOAD CONTROL: the Atelier still cannot add a screenshot');
  if (!controlThere) throw new Error('nothing to drive; the rest would measure nothing');

  const noteBefore = await atelier.locator('.cur-shots .cn-note').first().innerText();
  /cannot see it until you release/i.test(noteBefore)
    ? ok('and it says when the client will be able to see it', JSON.stringify(noteBefore.slice(0, 54)))
    : bad('the control does not say what the client can see', JSON.stringify(noteBefore));

  /* ------------------------------------------------------- 2. the upload */
  console.log('\n=== 2. choosing a file ===');
  await atelier.locator('.cur-shots input[type=file]').first().setInputFiles(tmpFile);
  await atelier.waitForTimeout(3500);

  const { data: afterUpload } = await svc.from('work_log_raw')
    .select('shots').eq('id', rawRow.id).single();
  const recorded = afterUpload?.shots ?? [];
  recorded.length === 1
    ? ok('the path is recorded on the Quarry row', recorded[0])
    : bad('the path did NOT reach the database', JSON.stringify(recorded));
  if (recorded.length) made.objects.push(recorded[0]);

  const objPath = recorded[0];
  // Written into the project ROOT, not files/. That is the security posture:
  // files/ is readable by the client immediately and this must not be.
  objPath && objPath.split('/').length === 2 && objPath.split('/')[0] === pr.id
    ? ok('and it is at the project root, so the gate governs it', objPath.split('/')[1])
    : bad('the object is not where the gate expects it', String(objPath));

  const { data: listed } = await svc.storage.from('shots').list(pr.id, { limit: 100 });
  const realObject = (listed ?? []).find((o) => `${pr.id}/${o.name}` === objPath);
  realObject
    ? ok('a real object exists in the bucket', `${realObject.metadata?.size ?? '?'} bytes`)
    : bad('the row names a file that is not in storage', String(objPath));

  const shownInPanel = await atelier.locator('.cur-shots .cn-thumb img').count();
  shownInPanel > 0
    ? ok('and staff can see the picture in the gate', `${shownInPanel} thumbnail`)
    : bad('the screenshot uploaded but the panel shows no image');

  /* The caption, measured because vision caught it and no probe did.
   *
   * The first build of this panel printed the RAW storage filename, which is
   * `<date>-<epoch>-<original>` by design so two screenshot.png cannot collide.
   * On a 104px tile that wrapped to three lines of digits and made the tile
   * taller than the picture it captioned. Every assertion above passed while it
   * looked like that, which is the whole reason this fence exists.
   *
   * app/window/Files.tsx already had the rule (pretty()); it now lives in
   * app/Attach.tsx and both rooms call it. So: the caption must not be the raw
   * name, and must not carry the epoch stamp. */
  const caption = await atelier.locator('.cur-shots .cn-cap').first().innerText();
  const rawName = objPath.split('/').pop();
  const capLines = caption.split('\n')[0].trim();
  !capLines.includes(rawName) && !/\d{10,}/.test(capLines)
    ? ok('the caption is readable, not the raw storage name', JSON.stringify(capLines.slice(0, 40)))
    : bad('the caption prints the raw filename', JSON.stringify(capLines.slice(0, 60)));

  // And the tile is not taller than it needs to be because of that caption.
  const tileBox = await atelier.locator('.cur-shots .cn-thumb').first().boundingBox();
  tileBox && tileBox.height < 220
    ? ok('and the tile stays a tile', `${Math.round(tileBox.width)}x${Math.round(tileBox.height)}`)
    : bad('the tile is overgrown, probably a wrapping caption', JSON.stringify(tileBox));

  /* ------------------------------ 3. the client, while it is still unreleased */
  console.log('\n=== 3. the client, in their own clean browser, before release ===');
  const clientCtx = await browser.newContext({ viewport: { width: 1382, height: 950 } });
  await clientCtx.addCookies(await cookiesFor(clientEmail));
  const win = await clientCtx.newPage();
  await win.goto(`${APP}/window`, { waitUntil: 'networkidle' });
  !win.url().includes('/login')
    ? ok('the client stands in their Window')
    : bad('the client could not sign in', win.url());

  // Asked at the database, not at the interface. A client holds a real session
  // and can call storage directly, which is the whole reason the gate is a
  // policy rather than a rendering decision.
  const asClient = createClient(U, A, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: 'Bearer ' + (await createClient(U, A, { auth: { persistSession: false } })
          .auth.signInWithPassword({ email: clientEmail, password: pw })).data.session.access_token,
      },
    },
  });
  const beforeRelease = await asClient.storage.from('shots').createSignedUrl(objPath, 60);
  !beforeRelease.data?.signedUrl
    ? ok('they cannot sign it while the work is unreleased', beforeRelease.error?.message?.slice(0, 34))
    : bad('THE CLIENT CAN ALREADY READ UNRELEASED WORK', objPath);

  const imgsBefore = await win.locator('.we-gal img, .we-thumb').count();
  imgsBefore === 0
    ? ok('and nothing of it is on their Window')
    : bad('an unreleased screenshot is rendered in the Window', String(imgsBefore));

  /* ------------------------------------------------------ 4. release it */
  console.log('\n=== 4. staff releases the entry ===');
  await atelier.locator('.cur-actions button', { hasText: 'Release' }).first().click();
  await atelier.waitForTimeout(3000);

  const { data: rel } = await svc.from('work_log_released')
    .select('id,shots,visible').eq('raw_id', rawRow.id).single();
  if (rel) made.released.push(rel.id);
  rel?.visible
    ? ok('the released row exists and is visible')
    : bad('the entry did not release', JSON.stringify(rel));
  (rel?.shots ?? []).includes(objPath)
    ? ok('and it carries the screenshot path', String((rel?.shots ?? []).length))
    : bad('the released row does not name the screenshot', JSON.stringify(rel?.shots));

  const afterRelease = await asClient.storage.from('shots').createSignedUrl(objPath, 60);
  afterRelease.data?.signedUrl
    ? ok('NOW the client can sign it, which is the gate opening')
    : bad('the client still cannot read a released screenshot', afterRelease.error?.message);

  /* The reading that actually matters: not that a URL resolved, but that an
   * image arrived and painted. naturalWidth is zero for a broken frame, and a
   * broken frame is exactly what a signed URL to a missing object produces. */
  console.log('\n=== 5. and it is really on their Window ===');
  await win.reload({ waitUntil: 'networkidle' });
  await win.waitForTimeout(2500);
  const dayBtn = win.locator('button.wl-day.worked').first();
  await dayBtn.waitFor({ timeout: 15000 });
  await dayBtn.click();
  await win.waitForTimeout(1000);
  const entryBtn = win.locator('.we-head').first();
  await entryBtn.click();
  await win.waitForTimeout(2500);

  const painted = await win.evaluate(() =>
    Array.from(document.querySelectorAll('.we-gal img'))
      .map((i) => ({ w: i.naturalWidth, h: i.naturalHeight }))
      .filter((d) => d.w > 0)
  );
  painted.length > 0
    ? ok('the screenshot is rendered in their Window', `${painted[0].w}x${painted[0].h}`)
    : bad('the Window shows no painted screenshot', 'naturalWidth 0 or no img');

  painted.some((d) => d.w === 240 && d.h === 150)
    ? ok('and it is the exact image that was uploaded', '240x150')
    : bad('an image painted but not the one uploaded', JSON.stringify(painted));

  await win.screenshot({ path: 'docs/proof/atelier-upload-window.png' });
  await atelier.screenshot({ path: 'docs/proof/atelier-upload-gate.png' });

  /* ------------------------------------------------------- 6. take it off */
  console.log('\n=== 6. taking it off again ===');
  await atelier.locator('.cur-shots .cn-x').first().click();
  await atelier.waitForTimeout(3000);

  const { data: rawAfter } = await svc.from('work_log_raw').select('shots').eq('id', rawRow.id).single();
  (rawAfter?.shots ?? []).length === 0
    ? ok('the Quarry row no longer names it')
    : bad('the path survived removal', JSON.stringify(rawAfter?.shots));

  const { data: relAfter } = await svc.from('work_log_released')
    .select('shots').eq('raw_id', rawRow.id).single();
  (relAfter?.shots ?? []).length === 0
    ? ok('and neither does the released row, so the client stops seeing it')
    : bad('the RELEASED row still names it: the client still sees it', JSON.stringify(relAfter?.shots));

  const { data: listAfter } = await svc.storage.from('shots').list(pr.id, { limit: 100 });
  const stillThere = (listAfter ?? []).some((o) => `${pr.id}/${o.name}` === objPath);
  if (!stillThere) { made.objects = made.objects.filter((p) => p !== objPath); }
  !stillThere
    ? ok('and the file is gone from storage')
    : bad('the object was orphaned in the bucket', objPath);

  console.log('\n=== console errors during all of it ===');
  errors.length === 0
    ? ok('the Atelier threw nothing')
    : bad(`${errors.length} page error(s)`, errors.slice(0, 2).join(' | ').slice(0, 120));

} catch (e) {
  bad('threw: ' + (e?.message ?? e));
} finally {
  if (browser) await browser.close();
  if (tmpFile) await unlink(tmpFile).catch(() => {});
  console.log('\n=== tearing down ===');
  try {
    if (made.objects.length) await svc.storage.from('shots').remove(made.objects);
    for (const id of made.projects) {
      const { data: leftover } = await svc.storage.from('shots').list(id, { limit: 200 });
      if (leftover?.length) await svc.storage.from('shots').remove(leftover.map((o) => `${id}/${o.name}`));
      await svc.from('comments').delete().eq('project_id', id);
      await svc.from('work_log_released').delete().eq('project_id', id);
      await svc.from('work_log_raw').delete().eq('project_id', id);
      await svc.from('projects').delete().eq('id', id);
    }
    for (const id of made.clients) await svc.from('clients').delete().eq('id', id);
    for (const id of made.users) await svc.auth.admin.deleteUser(id);
    console.log('  removed', made.users.length, 'users,', made.projects.length, 'projects');
  } catch (e) { console.log('  cleanup issue:', e.message); }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
