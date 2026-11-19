import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { readMailKey } from '@/lib/auth/mail-key';

// The door a letter opens. A link in mail from the studio carries a mail key
// (lib/auth/mail-key.ts); pressing it lands here, and the person it was written
// to arrives signed in, with nothing to type.
//
//   /auth/mail?k=<key>&next=/window
//
// Someone who comes to the site cold never sees this door. They meet /login and
// use their own password, a passkey, or ask for a link.
//
// Order of refusals, each ending at /login?e=mailkey with the password door open
// and the place they were heading kept:
//   1. no key, a forged key, or one past its end date;
//   2. the key names nobody, or names staff (a letter never opens the Atelier);
//   3. the key was issued before that person's keys were revoked.
//
// A session that already exists always wins. If the reader is signed in, as
// themselves or as anyone else, nothing is swapped: Pen opening the copy of a
// letter she sent stays Pen.

export const dynamic = 'force-dynamic';

const sealed = (to: string) => {
  const res = NextResponse.redirect(to);
  // The key is in this request's URL. Keep it out of caches and out of the
  // Referer of whatever loads next.
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
};

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const raw = searchParams.get('next') ?? '';
  // Same-origin paths only, and never the Atelier: a letter is for a client.
  const wanted =
    raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/atelier') ? raw : '/window';
  const refuse = () =>
    sealed(`${origin}/login?e=mailkey&next=${encodeURIComponent(wanted)}`);

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
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }
  );

  const {
    data: { user: already },
  } = await supabase.auth.getUser();
  if (already) return sealed(`${origin}${wanted}`);

  let key = null;
  try {
    key = readMailKey(searchParams.get('k'));
  } catch {
    key = null;
  }
  if (!key) return refuse();

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: found } = await admin.auth.admin.getUserById(key.userId);
  const person = found?.user;
  if (!person?.email) return refuse();
  if (person.app_metadata?.role === 'admin') return refuse();
  const revokedBefore = Number(person.app_metadata?.mail_keys_after ?? 0);
  if (revokedBefore && key.issued < revokedBefore) return refuse();

  // The key is good. Open a real session for them: mint a one-time link with the
  // service key (nothing is mailed) and spend it here, on this response's cookies.
  // Note for whoever reads the auth tables: this replaces any sign-in or reset
  // link that person had outstanding, because Supabase keeps one at a time.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: person.email,
  });
  const token_hash = link?.properties?.hashed_token;
  if (linkErr || !token_hash) return refuse();

  let { data: opened, error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash });
  if (error) ({ data: opened, error } = await supabase.auth.verifyOtp({ type: 'email', token_hash }));
  if (error || !opened?.session) return refuse();

  // Mark this session as the letter's. The middleware lets a reader who still
  // holds a starter password through only when this cookie names the very
  // session they are in (see openedByLetter there). It grants nothing by itself.
  let sessionId = '';
  try {
    sessionId = JSON.parse(
      Buffer.from(opened.session.access_token.split('.')[1], 'base64url').toString('utf8')
    ).session_id ?? '';
  } catch {
    sessionId = '';
  }
  if (sessionId) {
    cookieStore.set('pt-letter', sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: origin.startsWith('https://'),
      maxAge: 60 * 60 * 24 * 400,
    });
  }

  return sealed(`${origin}${wanted}`);
}
