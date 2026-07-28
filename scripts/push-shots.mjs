#!/usr/bin/env node
/**
 * Upload work screenshots into the private `shots` bucket and print the storage
 * paths to paste into the Notion entry's "Shot paths" field.
 *
 *   set -a; source .env.local; set +a
 *   node scripts/push-shots.mjs "Pentinian Studio Build" ~/Studio/_shots/pentinian/2026-07-27
 *   node scripts/push-shots.mjs "Caveman Gems" shot1.png shot2.png
 *
 * Runs locally on purpose. The sync route is serverless and can never read a file
 * on your Mac, so the upload has to happen from the machine that holds the images.
 *
 * Objects land at <project_id>/<date>-<filename>, and the first path segment is
 * exactly what the storage policy checks, so a client can only ever fetch their own.
 */
import { createClient } from '@supabase/supabase-js';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SVC) {
  console.error('Missing env. Run: set -a; source .env.local; set +a');
  process.exit(1);
}

const [projectName, ...paths] = process.argv.slice(2);
if (!projectName || !paths.length) {
  console.error('Usage: node scripts/push-shots.mjs "<project name>" <file-or-folder> [more...]');
  process.exit(1);
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX = 10 * 1024 * 1024;

const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

const { data: projects, error: pErr } = await admin.from('projects').select('id,name');
if (pErr) { console.error(pErr.message); process.exit(1); }

const project = (projects ?? []).find(
  (p) => String(p.name).trim().toLowerCase() === projectName.trim().toLowerCase()
);
if (!project) {
  console.error(`No project named "${projectName}". Known: ${(projects ?? []).map((p) => p.name).join(', ')}`);
  process.exit(1);
}

// expand folders one level, keep only images
const files = [];
for (const p of paths) {
  const full = resolve(p);
  const s = await stat(full).catch(() => null);
  if (!s) { console.error('skip, not found:', p); continue; }
  if (s.isDirectory()) {
    for (const name of await readdir(full)) {
      if (MIME[extname(name).toLowerCase()]) files.push(join(full, name));
    }
  } else if (MIME[extname(full).toLowerCase()]) {
    files.push(full);
  } else {
    console.error('skip, not an image:', p);
  }
}

if (!files.length) { console.error('Nothing to upload.'); process.exit(1); }

console.log(`\nProject: ${project.name}  (${project.id})`);
console.log(`Uploading ${files.length} image(s)\n`);

const day = new Date().toISOString().slice(0, 10);
const uploaded = [];

for (const file of files) {
  const body = await readFile(file);
  if (body.length > MAX) {
    console.log(`  SKIP  ${basename(file)}  too large, ${(body.length / 1048576).toFixed(1)}MB > 10MB`);
    continue;
  }
  const safe = basename(file).replace(/[^a-zA-Z0-9._-]+/g, '-');
  const path = `${project.id}/${day}-${safe}`;
  const { error } = await admin.storage
    .from('shots')
    .upload(path, body, { contentType: MIME[extname(file).toLowerCase()], upsert: true });
  if (error) { console.log(`  FAIL  ${basename(file)}  ${error.message}`); continue; }
  uploaded.push(path);
  console.log(`  ok    ${basename(file)}`);
}

if (!uploaded.length) { console.log('\nNothing uploaded.\n'); process.exit(1); }

console.log('\nPaste into the Notion entry, field "Shot paths":\n');
console.log(uploaded.join('\n'));
console.log('\nA reminder before you do: open each image and look at the whole frame.');
console.log('No other client on screen, no keys, no personal data. Once a client can');
console.log('fetch it, you cannot unsee it for them.\n');
