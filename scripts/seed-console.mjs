#!/usr/bin/env node
//
// Writes console rows into the Notion Console database for projects that have none.
//
//   set -a; source .env.local; set +a
//   node scripts/seed-console.mjs            what it would write
//   node scripts/seed-console.mjs --write    actually write it
//
// Everything here is drawn from the case studies on pentinian.com, which were written
// from the real builds. Nothing is invented. Where a fact does not exist in the record
// it is simply absent: Artinian and Caveman have documented palettes and documented
// principles, and no documented typeface, so they get no Typography section rather
// than a plausible guess. A brand guide that quietly contains one made-up entry is
// worse than a short one, because the client cannot tell which entry it is.
//
// These land in Notion, which the sync stages, which means Pen sees every one of them
// in the Atelier before a client ever does. That is the point of writing them here
// rather than straight into the database.

import { createClient } from '@supabase/supabase-js';

const WRITE = process.argv.includes('--write');
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const notion = async (path, body, method = 'POST') => {
  const r = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};

// Notion project page ids, so a row lands against the right project.
const PAGE = {
  'Artinian Inventory Sync': '3a7fd641-0792-81c4-b68e-c007618754c7',
  'Caveman Rebrand': '3a7fd641-0792-811d-b95e-c89e67372dbd',
  'Pentinian Website': '3a7fd641-0792-8128-a933-c7a011fedba9',
  'Switchboard Plugin': '3a7fd641-0792-8156-a457-f3e7640cc3c2',
};

const c = (title, purpose, swatch) => ({ facet: 'Color', title, purpose, swatch });
const t = (title, purpose) => ({ facet: 'Type', title, purpose });
const r = (title, purpose) => ({ facet: 'Rule', title, purpose });

// The Pentinian system, shared by anything Pentinian builds for itself.
const PENTINIAN = [
  c('Paper', 'the page itself', '#F1ECE1'),
  c('Bone', 'anything raised off it', '#FAF7EF'),
  c('Ink', 'everything you read', '#23251E'),
  c('Sage', 'the one accent that means something', '#7E9270'),
  c('Clay', 'attention rather than decoration', '#B0805C'),
  t('Newsreader', 'Headings, and anything that should read as written rather than rendered'),
  t('Inter', 'Interface text, labels, numbers'),
  r('No em dashes, anywhere',
    'Not in the interface, not in the log, not in a commit message. They are a tell, and the sentence is almost always better with a full stop or a comma.'),
  r('American spelling',
    'Color, not colour. It has bitten twice, once in interface copy and once as a database value, where two spellings of one thing meant rows that could never match.'),
  r('Motion only when it means something',
    'A thing may move to show it opened or closed. Nothing moves to be charming.'),
  r('An empty row is not drawn',
    'A heading with nothing under it is a promise of content that is not there. Sections appear when they have something to hold.'),
];

const SEED = {
  // The Specimen. Palette and both laws are stated verbatim in the case study.
  'Artinian Inventory Sync': [
    c('Garnet', 'acts. Every call to action, and a checked filter, because a choice is an act.', '#84221C'),
    c('Sapphire', 'informs. Never acts. It names what a thing is, or where you are.', '#234E8B'),
    c('Ink', 'text and thin strokes only', '#1B181E'),
    c('Alabaster', 'the ground', '#FAF5EE'),
    c('Hairline', 'the rule', '#DBD6D1'),
    r('Garnet acts, sapphire informs',
      'The distinction does real work. The outstanding-balance ledger moved from garnet to sapphire late in the build, because a garnet payment prompt reads as a demand and sapphire informs.'),
    r('No ink fills, hairlines survive',
      'Ink is legal for text and thin strokes, never for a filled block or a dark header.'),
    r('A jeweler does not want',
      'They source against a brief and triage. Every affordance built for wanting works against them, which is why the cart, the deals banner and save-for-later were retired rather than restyled.'),
    r('The wall holds by construction, not by vigilance',
      'Below the seam the payload is price-less by construction and real figures are re-injected for members only, so a new surface cannot leak by being forgotten.'),
    r('Heritage register, honest grading',
      'Sentence case, family-house framing rather than consumer hype. The trade expects candor about grading and the voice is built to give it.'),
  ],

  // The Surface. Palette verbatim; the principles are the ones the record states as rules.
  'Caveman Rebrand': [
    c('Teal deep', 'the slide-in ground', '#133D45'),
    c('Ink', 'text', '#0A252E'),
    c('Gold', 'accent', '#B8934A'),
    c('Cream', 'warm surface', '#E8DCC8'),
    c('Ice', 'page ground', '#F2F7F7'),
    r('Curated, not queried',
      'The surface has one job: make a catalog of 4,500 stones feel like a shop someone chose, not a database someone searched.'),
    r('Accessible behavior works through the animation, not beside it',
      'Focus returns to the element that opened a panel through a retry-until-focusable loop, because the opener is hidden mid-transition. That detail is the tell for how the whole front end is built.'),
    r('Measured, not asserted',
      'Contrast fixes are logged with their numbers. Two badges went from 1.08:1 and 1.42:1 to 8.70:1 and 6.13:1.'),
    r('Deleting a shipped feature is part of the system',
      'The more-filters drawer shipped, was measured, and was pulled six versions later.'),
    r('A documented wart beats a silent breakage',
      'Two source folders carry a trailing period and one misspells a word. The instruction is to leave both alone.'),
    r('Never work downstream of Dropbox',
      'Dropbox is the source of truth for media. Naming is load-bearing and case-sensitive.'),
  ],

  'Pentinian Website': PENTINIAN,
  'Switchboard Plugin': [
    ...PENTINIAN.filter((x) => x.facet !== 'Rule'),
    r('Credentials are never handled for you',
      'Keys are pasted by the person who owns them. Scripts read secrets from the environment rather than taking them as arguments, because arguments land in shell history.'),
    r('One account active at a time',
      'Switching is explicit and it persists for the session, so a call can never quietly run against the wrong workspace.'),
    r('No em dashes, anywhere',
      'Not in the interface, not in the log, not in a commit message.'),
  ],
};

const rt = (s) => (s ? { rich_text: [{ text: { content: s.slice(0, 1900) } }] } : { rich_text: [] });

const { data: projects } = await db.from('projects').select('id,name');
const { data: existing } = await db.from('project_notes').select('project_id,kind');

let planned = 0;
for (const [name, rows] of Object.entries(SEED)) {
  const project = projects.find((p) => p.name === name);
  const page = PAGE[name];
  if (!project || !page) { console.log(`skip ${name}: no project or no Notion page`); continue; }

  const already = existing.filter((e) => e.project_id === project.id && e.kind === 'brand').length;
  if (already) { console.log(`skip ${name}: already has ${already} brand rows`); continue; }

  console.log(`\n${name}  (${rows.length} rows)`);
  let order = 0;
  for (const row of rows) {
    order += 10;
    console.log(`   ${row.facet.padEnd(6)} ${row.title}${row.swatch ? '  ' + row.swatch : ''}`);
    planned += 1;
    if (!WRITE) continue;

    const props = {
      Item: { title: [{ text: { content: row.title } }] },
      Project: { relation: [{ id: page }] },
      Face: { select: { name: 'Brand' } },
      Facet: { select: { name: row.facet } },
      Purpose: rt(row.purpose),
      Order: { number: order },
    };
    if (row.swatch) props.Swatch = rt(row.swatch);
    await notion('pages', { parent: { database_id: process.env.NOTION_CONSOLE_DB }, properties: props });
  }
}

console.log(
  WRITE
    ? `\nwrote ${planned} rows to Notion. Press Sync Notion in the Atelier, then review and release.`
    : `\n${planned} rows would be written. Nothing has changed. Re-run with --write.`
);
