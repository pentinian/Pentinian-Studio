'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function LoginForm() {
  const params = useSearchParams();
  // Only ever follow an in-app path, so a crafted ?next= cannot bounce someone offsite.
  const raw = params.get('next') ?? '';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '';

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const supabase = createClient();
    const cb = new URL('/auth/callback', window.location.origin);
    if (next) cb.searchParams.set('next', next);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      // Access is invite only: never provision an account from this form. An email
      // that has not been invited gets refused rather than silently created.
      options: { shouldCreateUser: false, emailRedirectTo: cb.toString() },
    });
    setBusy(false);
    if (error) {
      const unknown = /signups not allowed|user not found|invalid/i.test(error.message);
      setError(
        unknown
          ? 'That address is not on the list. If you should have access, reply to your last email from me.'
          : error.message
      );
    } else setSent(true);
  }

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="eyebrow">Pentinian</div>
        {sent ? (
          <>
            <h1 className="auth-h">Check your email.</h1>
            <p className="auth-sub">
              I sent a sign-in link to <b>{email}</b>. Open it on this device and you're in.
            </p>
          </>
        ) : (
          <>
            <h1 className="auth-h">Sign in.</h1>
            <p className="auth-sub">
              Enter your email and I'll send a one-time link. No password to remember.
              Access is by invitation.
            </p>
            <form onSubmit={submit} className="auth-form">
              <input
                className="uline"
                type="email"
                required
                placeholder="you@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button className="btn-line" type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send my link ↗'}
              </button>
            </form>
            {error && <p className="auth-err">{error}</p>}
          </>
        )}
      </div>
    </main>
  );
}

// useSearchParams needs a Suspense boundary for the static build to prerender this route.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
