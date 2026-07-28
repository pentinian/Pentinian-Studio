#!/usr/bin/env node
/**
 * Mirror the Notion Projects and Clients databases into Supabase, keyed by Notion
 * page id so the two sides can never drift on spelling.
 *
 *   set -a; source .env.local; set +a
 *   node scripts/link-projects.mjs            # show what it would do
 *   node scripts/link-projects.mjs --apply    # actually write
 *
 * Run this before the first sync, and again whenever a project is added in Notion.
 *
 * Nothing here makes a project client-facing. That stays a deliberate choice, set
 * with --client-facing "Project Name", because a Window is a promise to someone.
 */
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TOKEN = process.env.NOTION_TOKEN;
const PROJECTS_DB = process.env.NOTION_PROJECTS_DB ?? '3a7fd641-0792-8192-b9f7-ccd898e5e915';
const CLIENTS_DB = process.env.NOTION_CLIENTS_DB ?? '3a7fd641-0792-81d0-ad5c-f733d480b28f';

if (!URL_ || !SVC) { console.error('Missing Supabase env. set -a; source .env.local; set +a'); process.exit(1); }
if (!TOKEN) { console.error('Missing NOTION_TOKEN. Add it to .env.local first.'); process.exit(1); }

const apply = process.argv.includes('--apply');
const facingIdx = process.argv.indexOf('--client-facing');
const makeFacing = facingIdx > -1 ? process.argv[facingIdx + 1] : null;

const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

async function notionQuery(db) {
  const out = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    if (!res.ok) throw new Error(`Notion ${db}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    out.push(...(data.results ?? []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return out;
}

const titleOf = (page) => {
  for (const v of Object.values(page.properties ?? {})) {
    if (v?.type === 'title') return (v.title ?? []).map((t) => t.plain_text).join('').trim();
  }
  return null;
};

console.log(apply ? '\nApplying.\n' : '\nDry run. Add --apply to write.\n');

// ---- clients ----
const notionClients = await notionQuery(CLIENTS_DB);
const clientByPage = new Map();

for (const page of notionClients) {
  const name = titleOf(page);
  if (!name) continue;
  const { data: existing } = await admin.from('clients').select('id,name')
    .or(`notion_page_id.eq.${page.id},name.eq.${name}`).limit(1);
  const row = existing?.[0];
  if (row) {
    clientByPage.set(page.id, row.id);
    console.log(`  client  linked   ${name}`);
    if (apply) await admin.from('clients').update({ notion_page_id: page.id }).eq('id', row.id);
  } else {
    console.log(`  client  create   ${name}`);
    if (apply) {
      const { data, error } = await admin.from('clients')
        .insert({ name, notion_page_id: page.id }).select().single();
      if (error) console.log('          error  ' + error.message);
      else clientByPage.set(page.id, data.id);
    }
  }
}

// ---- projects ----
const notionProjects = await notionQuery(PROJECTS_DB);
console.log('');

for (const page of notionProjects) {
  const name = titleOf(page);
  if (!name) continue;
  const clientPage = page.properties?.Client?.relation?.[0]?.id ?? null;
  const clientId = clientPage ? clientByPage.get(clientPage) ?? null : null;

  const { data: existing } = await admin.from('projects').select('id,name')
    .or(`notion_page_id.eq.${page.id},name.eq.${name}`).limit(1);
  const row = existing?.[0];

  const patch = { name, notion_page_id: page.id, ...(clientId ? { client_id: clientId } : {}) };

  if (row) {
    console.log(`  project linked   ${name}${clientId ? '' : '   (no client linked)'}`);
    if (apply) await admin.from('projects').update(patch).eq('id', row.id);
  } else {
    console.log(`  project create   ${name}${clientId ? '' : '   (no client linked)'}`);
    if (apply) {
      const { error } = await admin.from('projects').insert(patch);
      if (error) console.log('          error  ' + error.message);
    }
  }
}

// ---- optional: mark one project client-facing ----
if (makeFacing) {
  console.log('');
  const { data, error } = apply
    ? await admin.from('projects').update({ client_facing: true }).eq('name', makeFacing).select()
    : { data: [{ name: makeFacing }], error: null };
  if (error) console.log('  client-facing failed: ' + error.message);
  else if (!data?.length) console.log(`  no project named "${makeFacing}"`);
  else console.log(`  client-facing    ${makeFacing}`);
}

console.log('\nA project only reaches a Window once it is client-facing AND its client row');
console.log('has a user_id, which happens when you invite them.\n');
