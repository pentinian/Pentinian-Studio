import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Who is this, asked from the public site.
//
// The public site is static and lives on its own hostname, so it has no way to know
// whether someone is signed in. This is how it asks. It returns the least it can:
// whether there is a session, which door that person is entitled to, and nothing
// else. No email, no name, no ids. A nav bar needs to know which link to draw and
// that is all it gets.
//
// WHY THIS DOES NOTHING TODAY, AND WILL WORK ON FRIDAY.
//
// Cookies are sent on a cross-origin request only when the two hosts are same-SITE,
// meaning they share a registrable domain. pentinian-site.vercel.app and
// pentinian-studio.vercel.app do not: vercel.app sits on the Public Suffix List, so
// the browser treats them as unrelated sites and withholds the session cookie by
// design. No code can change that, and code that tried would be code working around
// a protection that exists for good reason.
//
// Once the pair is pentinian.com and app.pentinian.com they share a registrable
// domain, the cookie rides along, and this answers truthfully. Until then it answers
// "signed out" to the public site, which is exactly the fallback the nav expects.
export const dynamic = 'force-dynamic';

// Credentialed CORS cannot use a wildcard, so the origin is echoed back only when it
// is one we actually publish. Anything else gets no CORS headers at all and the
// browser drops the response, which is the correct outcome for a stranger asking.
const ALLOWED = new Set([
  'https://pentinian.com',
  'https://www.pentinian.com',
  'https://pentinian-site.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function cors(origin: string | null) {
  const h: Record<string, string> = {
    Vary: 'Origin',
    'Cache-Control': 'private, no-store',
  };
  if (origin && ALLOWED.has(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Credentials'] = 'true';
    h['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  }
  return h;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: cors(request.headers.get('origin')) });
}

export async function GET(request: Request) {
  const headers = cors(request.headers.get('origin'));
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';

  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ signedIn: false }, { headers });

    const isAdmin = user.app_metadata?.role === 'admin';
    return NextResponse.json(
      {
        signedIn: true,
        // Just enough to draw the right links, and deliberately not enough to
        // identify anyone to a page that has not signed them in itself.
        staff: isAdmin,
        window: `${site}/window`,
        atelier: isAdmin ? `${site}/atelier` : null,
      },
      { headers }
    );
  } catch {
    // Fail closed. An error here means the nav shows Sign in, which is never wrong.
    return NextResponse.json({ signedIn: false }, { headers });
  }
}
