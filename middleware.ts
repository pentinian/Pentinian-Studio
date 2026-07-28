import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the Supabase session on every request and guards the private routes.
//
// Two gates, not one:
//   /window   any signed-in person
//   /atelier  signed in AND app_metadata.role === 'admin'
//
// The role lives in app_metadata rather than user_metadata on purpose: a user can
// write their own user_metadata, so trusting it would let any client promote
// themselves to staff. app_metadata is writable only with the service key.

/**
 * Move any cookies written during this request onto whatever response is actually
 * returned.
 *
 * This is the fix for a real bug. The Supabase client writes refreshed auth cookies
 * onto the response object it was handed, but every redirect below builds a brand
 * new response. Returning that one silently discarded the refresh, so an hour-old
 * session could be thrown away at the exact moment it was being renewed, and the
 * browser would be sent back to the login screen holding a token it had just been
 * given a replacement for. Any response leaving this file goes through here.
 */
function carry(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((c) => to.cookies.set(c));
  return to;
}

/** The one host sessions live on. */
function canonicalHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? '').host || null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  // Cookies are scoped to a hostname, so a session created on the stable alias does
  // not exist on a preview deployment, and every push mints a new preview hostname.
  // Landing on one reads as being logged out for no reason. Passkeys are stricter
  // still: they are bound to a relying-party domain and simply will not work
  // anywhere else. So preview hosts hand the visitor back to the real one.
  //
  // Deliberately narrow: only *.vercel.app is redirected. A custom domain that is
  // not yet in NEXT_PUBLIC_SITE_URL is left alone rather than bounced into a loop.
  const host = request.headers.get('host') ?? '';
  const canonical = canonicalHost();
  if (canonical && host !== canonical && host.endsWith('.vercel.app')) {
    const url = request.nextUrl.clone();
    url.host = canonical;
    url.port = '';
    url.protocol = 'https:';
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const needsSession = path.startsWith('/window') || path.startsWith('/atelier');
  const needsAdmin = path.startsWith('/atelier');

  if (needsSession && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    const redirect = carry(response, NextResponse.redirect(url));

    // A refresh that genuinely failed leaves a dead token in the jar. Nothing used
    // to clear it, so the browser kept presenting the same corpse on every visit
    // and the state could not heal itself: sign in, work an hour, get bounced, and
    // stay bounced. If the session is unrecoverable, take the cookie with it.
    if (error) {
      request.cookies
        .getAll()
        .filter((c) => c.name.startsWith('sb-'))
        .forEach((c) => redirect.cookies.set(c.name, '', { path: '/', maxAge: 0 }));
    }
    return redirect;
  }

  if (needsAdmin && user?.app_metadata?.role !== 'admin') {
    // Signed in, but not staff. Say so plainly rather than bouncing them somewhere
    // confusing, and never hint at what sits behind the door.
    const url = request.nextUrl.clone();
    url.pathname = '/no-access';
    url.search = '';
    return carry(response, NextResponse.redirect(url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|no-access|auth|api).*)'],
};
