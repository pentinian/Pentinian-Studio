import { NextResponse } from 'next/server';
import { record } from '@/lib/events';
import { flushDue } from '@/lib/mail';

// The scheduled pull from Notion.
//
// Once a day at 6am Pacific, written as 14:00 UTC because Vercel crons run in UTC and
// do not follow daylight saving. It drifts by an hour twice a year, which for filling a
// staging queue is not worth a timezone library.
//
// Once and not three times because this account is on Vercel's Hobby plan, where cron
// jobs are capped at two per project and fire once daily regardless of what the
// expression asks for. Writing 0 14,20,2 * * * would have looked like three pulls and
// delivered one, which is the kind of quiet mismatch that gets debugged a month later.
// The button in the Atelier covers every case where waiting until tomorrow is too slow.
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
    // Separate from the sync's own record: "the schedule fired" and "the pull worked"
    // are different questions, and a cron that stops firing is the quieter failure.
    await record('cron', res.ok, res.ok ? undefined : `HTTP ${res.status}`, body);

    // The morning post: scheduled letters due by now go out with the same bell.
    try {
      const post = await flushDue();
      if (post.sent || post.failed) {
        console.log('morning post', JSON.stringify(post));
        await record('notify', post.failed === 0, `morning post: ${post.sent} sent, ${post.failed} failed`);
      }
    } catch (e: any) {
      console.error('morning post threw', e?.message);
      await record('notify', false, e?.message ?? 'morning post threw');
    }

    return NextResponse.json({ ok: res.ok, ...body }, { status: res.ok ? 200 : 502 });
  } catch (e: any) {
    console.error('scheduled sync threw', e?.message);
    await record('cron', false, e?.message ?? 'threw');
    return NextResponse.json({ error: e?.message ?? 'sync failed' }, { status: 502 });
  }
}
