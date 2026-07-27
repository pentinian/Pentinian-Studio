import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// Exchanges the magic-link code for a session, then sends the user on:
// back to where they were heading if they came from a deep link, otherwise to
// the Atelier for staff and the Window for everyone else.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const raw = searchParams.get('next') ?? '';
  // Same-origin paths only, so ?next= cannot be used as an open redirect.
  const wanted = raw.startsWith('/') && !raw.startsWith('//') ? raw : '';

  if (code) {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const isAdmin = user?.app_metadata?.role === 'admin';
      // A client who deep-linked into the Atelier still is not staff, so do not
      // send them somewhere middleware will only bounce them off again.
      const landing = wanted && !(wanted.startsWith('/atelier') && !isAdmin)
        ? wanted
        : isAdmin
          ? '/atelier'
          : '/window';
      return NextResponse.redirect(`${origin}${landing}`);
    }
  }

  // No code, or the exchange failed (expired or already-used link).
  return NextResponse.redirect(`${origin}/login?e=link`);
}
