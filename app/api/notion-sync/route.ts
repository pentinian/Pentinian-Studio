import { fetchWorkLog } from '@/lib/notion';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Pulls the Notion work log into the Quarry (work_log_raw). Server-only, uses the service role.
// Call this from the Atelier "Sync" button, or on a schedule (Vercel Cron).
export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  }

  let entries;
  try {
    entries = await fetchWorkLog();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Notion pull failed' }, { status: 502 });
  }

  const admin = createAdminClient(url, serviceKey, { auth: { persistSession: false } });
  const rows = entries.map((e) => ({
    notion_id: e.notion_id,
    logged_at: e.logged_at,
    body: e.body,
    out_of_scope: e.out_of_scope,
  }));

  if (rows.length) {
    const { error } = await admin.from('work_log_raw').upsert(rows, { onConflict: 'notion_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, pulled: rows.length });
}
