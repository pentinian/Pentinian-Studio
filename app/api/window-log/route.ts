import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildLog, toCsv, toPdf, type LogEntry } from '@/lib/worklog/document';

// The work log as a file: GET /api/window-log?project=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD&format=pdf|csv
//
// Read through the CALLER'S OWN session, never the service key, so the database's
// row rules decide what lands in the file exactly as they decide what the Window
// shows: a client receives only their own project and only the days released to
// them; staff receive every day, and the ones not yet shown are marked held in
// their copy. Nothing here widens a read, and there is no id to change that
// would reach another project, because the database refuses it first.
//
// 401 signed out, 403 a project the caller cannot read, 400 a malformed ask.
// `disposition=inline` opens the PDF in the browser to read rather than save.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD that names a real date, read as UTC midnight. */
function at(key: string): Date | null {
  if (!DAY.test(key)) return null;
  const d = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== key ? null : d;
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const project = q.get('project') ?? '';
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  const format = q.get('format') ?? 'pdf';
  const inline = q.get('disposition') === 'inline';

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in to read the work log.' }, { status: 401 });

  const f = at(from);
  const t = at(to);
  if (!UUID.test(project) || !f || !t || f > t || (format !== 'pdf' && format !== 'csv')) {
    return NextResponse.json({ error: 'project, from, to and format (pdf or csv) required' }, { status: 400 });
  }
  // A month is the longest period the Window offers; a quarter is room to spare.
  if ((t.getTime() - f.getTime()) / 86400000 > 92) {
    return NextResponse.json({ error: 'At most 92 days at a time.' }, { status: 400 });
  }

  const { data: proj } = await supabase.from('projects').select('id,name').eq('id', project).maybeSingle();
  if (!proj) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

  const staff = user.app_metadata?.role === 'admin';

  // Widened by a day each side so an entry near the edge still lands on its
  // studio day once shifted into Pacific time; buildLog keeps only from..to.
  const lo = new Date(f.getTime() - 86400000).toISOString();
  const hi = new Date(t.getTime() + 2 * 86400000).toISOString();
  const { data, error } = await supabase
    .from('work_log_released')
    .select('id,title,eli5,why,started_at,ended_at,minutes,visible,release_at')
    .eq('project_id', project)
    .not('started_at', 'is', null)
    .gte('started_at', lo)
    .lt('started_at', hi)
    .order('started_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'The log could not be read.' }, { status: 500 });

  const now = Date.now();
  const entries: LogEntry[] = [];
  for (const r of (data ?? []) as any[]) {
    const held = r.visible === false || (r.release_at != null && new Date(r.release_at).getTime() > now);
    // The database already keeps held entries from a client. This is the same
    // rule said twice, so a policy slip never becomes a held day in their file.
    if (held && !staff) continue;
    entries.push({ ...r, held });
  }

  let model;
  try {
    model = buildLog({ project: proj.name ?? 'Your project', from, to, staff, entries });
  } catch (e) {
    // The sheet disagreed with itself. Refuse rather than serve wrong figures.
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }

  const name = `work-log-${from}-to-${to}.${format}`;
  const headers: Record<string, string> = {
    'Content-Disposition': `${inline && format === 'pdf' ? 'inline' : 'attachment'}; filename="${name}"`,
    'Cache-Control': 'private, no-store',
    'X-Work-Log-Hours': String(model.totalMinutes / 60),
    'X-Work-Log-Days': String(model.days.length),
  };

  if (format === 'csv') {
    return new NextResponse(toCsv(model), {
      headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' },
    });
  }
  const pdf = await toPdf(model);
  return new NextResponse(Buffer.from(pdf), {
    headers: { ...headers, 'Content-Type': 'application/pdf' },
  });
}
