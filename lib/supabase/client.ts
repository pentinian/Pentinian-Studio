import { createBrowserClient } from '@supabase/ssr';

// Browser Supabase client (use in Client Components).
//
// Passkeys are opt-in because the API is still experimental upstream. Worth the
// opt-in: a passkey is bound to this exact domain, so it cannot be phished onto a
// lookalike, and nothing shared ever leaves the device. The private key stays in the
// Secure Enclave or the password manager, and Supabase only ever holds the public
// half, which is useless to anyone who steals it.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { experimental: { passkey: true } } } as any
  );
}
