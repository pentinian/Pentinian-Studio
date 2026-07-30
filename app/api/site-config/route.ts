import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// The one public endpoint in the whole app.
//
// The Foyer (pentinian.com) is static HTML with no database of its own, so this is
// how the calibration you set in the Atelier reaches it. Deliberately narrow:
//
//   - GET only. There is no way to write the config from outside a staff session.
//   - The response is built field by field from a whitelist, never spread from the
//     row. If site_config later gains a private field, it cannot leak through here.
//   - No auth, because everything it returns is already visible to any visitor.
//
// site_config stays staff-only under RLS. This route reads it with the service key
// server side, so the key never leaves the server and the browser never touches
// Supabase at all.
export const dynamic = 'force-dynamic';

const CORS = {
  // The payload is public by definition, so any origin may read it. This lets the
  // Foyer work from pentinian.com, its vercel.app URL, and a local file alike.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  // A minute of edge cache. A calibration change lands within a minute, and a
  // burst of traffic does not become a burst of database reads.
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Fail open. A missing env var must not blank someone's portfolio.
    return NextResponse.json({ ok: false, reason: 'not configured' }, { headers: CORS });
  }

  const db = createAdminClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db.from('site_config').select('config').eq('id', 1).single();

  if (error || !data?.config) {
    return NextResponse.json({ ok: false, reason: 'no config' }, { headers: CORS });
  }

  const c = data.config as Record<string, unknown>;

  return NextResponse.json(
    {
      ok: true,
      open_for_work: c.open_for_work !== false,
      availability: typeof c.availability === 'string' ? c.availability : '',
      // Only sent when it is genuinely an array. Anything else is treated as unset
      // by the Foyer, which then shows every card rather than guessing.
      public_projects: Array.isArray(c.public_projects) ? c.public_projects.map(String) : null,
      // The words on the page, keyed by the data-cms attribute that carries them.
      //
      // Still assembled rather than spread, which is the rule this whole route exists
      // to keep: a private field added to that JSON later cannot ride along to a public
      // endpoint by accident. Values are coerced to strings and anything else is
      // dropped, so a malformed record cannot put an object where text belongs.
      content: (() => {
        const raw = c.content;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof v !== 'string') continue;
          const text = v.trim();
          // Empty means "leave the page as authored", which is what makes this safe:
          // a blank record can never blank the site.
          if (!text) continue;
          if (!/^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/i.test(k)) continue;
          out[k] = text.slice(0, 4000);
        }
        return Object.keys(out).length ? out : null;
      })(),
    },
    { headers: CORS }
  );
}
