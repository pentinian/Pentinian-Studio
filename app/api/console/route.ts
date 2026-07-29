import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// The console's release gate, and the staff editor behind it.
//
// This is the twin of /api/quarry. Same shape on purpose: a client's Window shows
// nothing that a person did not deliberately pass, and the deciding happens in exactly
// one place so there is never a question of which switch won.
//
// Three verbs:
//   GET    everything on a project, staged and released, for the Atelier
//   PATCH  edit a field, or release, or pull back
//   POST   author a new item by hand, for the things that never came through Notion
//   DELETE remove one
//
// Staff only, every path. /api sits outside the middleware matcher, so the check here
// is the only thing standing between this endpoint and the open internet.

export const dynamic = 'force-dynamic';

const FACETS = ['color', 'type', 'rule', 'asset'];
const KINDS = ['brand', 'inspiration', 'request'];
const STATUSES = ['none', 'open', 'doing', 'done', 'declined'];

// What a staff edit is allowed to touch. An allowlist rather than a spread, so a
// column added to this table later cannot be written from the browser by accident.
const EDITABLE = new Set([
  'kind', 'facet', 'title', 'body', 'swatch', 'url', 'shot', 'status', 'sort',
]);

async function staff() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.app_metadata?.role === 'admin' ? user : null;
  } catch {
    return null;
  }
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false } });
}

const hex = (s: any): string | null => {
  if (typeof s !== 'string') return null;
  const v = s.trim().replace(/^#?/, '#').toUpperCase();
  return /^#[0-9A-F]{6}$/.test(v) ? v : null;
};

export async function GET(request: Request) {
  if (!(await staff())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
  const db = admin();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const projectId = new URL(request.url).searchParams.get('project');
  if (!projectId) return NextResponse.json({ error: 'No project' }, { status: 400 });

  const { data, error } = await db
    .from('project_notes')
    .select('*')
    .eq('project_id', projectId)
    .order('kind', { ascending: true })
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function PATCH(request: Request) {
  const user = await staff();
  if (!user) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
  const db = admin();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const { id, release, ...fields } = body ?? {};
  if (!id) return NextResponse.json({ error: 'No id' }, { status: 400 });

  const { data: row } = await db.from('project_notes').select('*, projects(client_facing, name)').eq('id', id).single();
  if (!row) return NextResponse.json({ error: 'No such item' }, { status: 404 });

  const patch: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!EDITABLE.has(k)) continue;
    if (k === 'swatch') { patch[k] = hex(v); continue; }
    if (k === 'facet' && v != null && !FACETS.includes(String(v))) continue;
    if (k === 'kind' && !KINDS.includes(String(v))) continue;
    if (k === 'status' && !STATUSES.includes(String(v))) continue;
    if (k === 'sort') { patch[k] = Number(v) || 0; continue; }
    patch[k] = typeof v === 'string' ? (v.trim() || null) : v;
  }

  if (release === true) {
    // The same rule the work log obeys: a project that is not client-facing has no
    // client to receive anything, so releasing into it would create something visible
    // in principle and reachable by nobody. Refuse loudly rather than pretend.
    if (!(row as any).projects?.client_facing) {
      return NextResponse.json(
        { error: `${(row as any).projects?.name ?? 'This project'} is internal. Make it client-facing first.` },
        { status: 409 }
      );
    }
    // A color with no hex, or anything with no words at all, would render as an empty
    // box in someone's Window. Caught here rather than there.
    const next = { ...row, ...patch };
    if (next.kind === 'brand' && next.facet === 'color' && !hex(next.swatch)) {
      return NextResponse.json({ error: 'That color has no hex value yet.' }, { status: 409 });
    }
    if (!String(next.title ?? '').trim() && !String(next.body ?? '').trim() && !next.shot) {
      return NextResponse.json({ error: 'Nothing to show yet: no title, no text, no image.' }, { status: 409 });
    }
    patch.released_at = new Date().toISOString();
  }
  if (release === false) patch.released_at = null;

  if (!Object.keys(patch).length) return NextResponse.json({ ok: true, item: row });

  const { data, error } = await db.from('project_notes').update(patch).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: data });
}

export async function POST(request: Request) {
  const user = await staff();
  if (!user) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
  const db = admin();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const b = await request.json().catch(() => ({}));
  if (!b?.project_id || !KINDS.includes(b.kind)) {
    return NextResponse.json({ error: 'Need a project and a kind' }, { status: 400 });
  }

  const row: Record<string, any> = {
    project_id: b.project_id,
    kind: b.kind,
    facet: b.kind === 'brand' ? (FACETS.includes(b.facet) ? b.facet : 'rule') : null,
    title: String(b.title ?? '').trim() || null,
    body: String(b.body ?? '').trim() || null,
    swatch: b.kind === 'brand' && b.facet === 'color' ? hex(b.swatch) : null,
    url: String(b.url ?? '').trim() || null,
    shot: String(b.shot ?? '').trim() || null,
    sort: Number(b.sort) || 0,
    status: b.kind === 'request' ? 'open' : 'none',
    from_client: false,
    author_id: user.id,
    // Authored here, so it starts staged like everything else. Nothing skips the gate
    // just because it was typed on this side of it.
    released_at: null,
  };

  const { data, error } = await db.from('project_notes').insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: data });
}

export async function DELETE(request: Request) {
  if (!(await staff())) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
  const db = admin();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'No id' }, { status: 400 });

  const { error } = await db.from('project_notes').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
