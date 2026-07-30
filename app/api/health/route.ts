import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// What the studio can say about itself.
//
// Three things fail without telling anyone. The cron logs to Vercel, which nobody reads.
// Notifications are fire and forget by design, so a dead key is invisible. And a sync
// that stopped working is discovered by noticing the Quarry looks thin, days later.
//
// This answers "when did each of those last work, and did it" in one request, so the
// Atelier can show one line instead of asking someone to go looking.
//
// It reports CONFIGURATION as well as events, because the most common cause of silence
// is that a thing was never switched on. "No notifications yet" and "notifications are
// broken" look identical from the outside and need different answers.

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.app_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  const db = createAdminClient(url, key, { auth: { persistSession: false } });

  // Newest of each kind. Tolerates the table not existing yet, so the strip degrades to
  // "not recording yet" rather than breaking the page before health.sql is applied.
  const latest = async (kind: string) => {
    const { data, error } = await db
      .from('system_events')
      .select('ok,detail,meta,at')
      .eq('kind', kind)
      .order('at', { ascending: false })
      .limit(1);
    if (error) return { missing: true as const };
    return data?.[0] ?? null;
  };

  const [sync, cron, notify] = await Promise.all([latest('sync'), latest('cron'), latest('notify')]);

  // Counts worth knowing at a glance: work waiting, and clients who cannot get in yet.
  const [{ count: quarry }, { data: projects }] = await Promise.all([
    db.from('work_log_raw').select('id', { count: 'exact', head: true }),
    db.from('projects').select('id,name,client_facing,client_id'),
  ]);
  const { data: clients } = await db.from('clients').select('id,name,user_id');
  const uninvited = (projects ?? [])
    .filter((p: any) => p.client_facing)
    .map((p: any) => (clients ?? []).find((c: any) => c.id === p.client_id))
    .filter((c: any) => c && !c.user_id).length;

  return NextResponse.json({
    sync,
    cron,
    notify,
    config: {
      // Presence only, never a value. This endpoint says whether a key exists, and a
      // route that reports on secrets must not be able to leak one by being extended
      // carelessly later.
      notifications: Boolean(process.env.RESEND_API_KEY && process.env.STUDIO_NOTIFY_EMAIL),
      cronSecret: Boolean(process.env.CRON_SECRET),
      notionWorkLog: Boolean(process.env.NOTION_WORKLOG_DB),
      notionConsole: Boolean(process.env.NOTION_CONSOLE_DB),
    },
    counts: { quarry: quarry ?? 0, uninvitedClients: uninvited },
  });
}
