import { NextResponse } from 'next/server';

// The scheduled pull from Notion.
//
// Three times a day, at 6am, noon and 6pm Pacific, expressed in UTC because Vercel
// crons run in UTC and do not follow daylight saving. The times drift by an hour twice
// a year, which for filling a staging queue is nothing worth a timezone library.
//
// It pulls. It does not release. That distinction is the whole system: the Quarry and
// the staged console fill on their own, and a human still decides what a client sees.
// If a future version of this file ever calls the release path, the gate is gone.
//
// GET rather than POST because Vercel crons issue a GET. Vercel signs the request with
// CRON_SECRET as a bearer token, which /api/notion-sync already knows how to check, so
// this forwards rather than reimplementing the authorisation. A stray public GET
// carrying no secret is refused there, not here.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;

  try {
    const res = await fetch(`${base}/api/notion-sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));

    // Logged rather than swallowed. A sync that has been quietly failing for a week is
    // the sort of thing you discover by noticing the Quarry is oddly empty, which is a
    // slow and unpleasant way to find out.
    if (!res.ok) console.error('scheduled sync failed', res.status, body);
    else console.log('scheduled sync', JSON.stringify(body));

    return NextResponse.json({ ok: res.ok, ...body }, { status: res.ok ? 200 : 502 });
  } catch (e: any) {
    console.error('scheduled sync threw', e?.message);
    return NextResponse.json({ error: e?.message ?? 'sync failed' }, { status: 502 });
  }
}
