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
export async function middleware(request: NextRequest) {
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
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const needsSession = path.startsWith('/window') || path.startsWith('/atelier');
  const needsAdmin = path.startsWith('/atelier');

  if (needsSession && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  if (needsAdmin && user?.app_metadata?.role !== 'admin') {
    // Signed in, but not staff. Say so plainly rather than bouncing them somewhere
    // confusing, and never hint at what sits behind the door.
    const url = request.nextUrl.clone();
    url.pathname = '/no-access';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|no-access|auth|api).*)'],
};
