'use client';

import { Suspense, useEffect, useState } from 'react';
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
  const [pkBusy, setPkBusy] = useState(false);
  // Only offer the passkey door where the browser can actually open it. An offer
  // that fails on click is worse than no offer.
  const [canPasskey, setCanPasskey] = useState(false);

  useEffect(() => {
    setCanPasskey(typeof window !== 'undefined' && !!window.PublicKeyCredential);
  }, []);

  async function passkey() {
    setError('');
    setPkBusy(true);
    const supabase = createClient();
    const { error } = await (supabase.auth as any).signInWithPasskey();
    setPkBusy(false);
    if (error) {
      // Cancelling the system prompt is not a failure, so it should not read as one.
      const cancelled = /abort|cancel|NotAllowed/i.test(error.message ?? '');
      if (cancelled) return;
      setError(
        /webauthn_credential_not_found|passkey_disabled/i.test(error.code ?? error.message ?? '')
          ? 'No passkey is registered for this site yet. Sign in with a link once, then add one from the Atelier.'
          : error.message
      );
      return;
    }
    // A full page load rather than a client transition, so the server sees the new
    // cookie and the hallway can send us through the right door.
    window.location.assign(next || '/');
  }

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
              Access is by invitation. Use your passkey if you have one, otherwise I'll
              send a one-time link. Either way there is no password to remember.
            </p>

            {canPasskey && (
              <>
                <button className="btn-line sage pk-btn" onClick={passkey} disabled={pkBusy}>
                  {pkBusy ? 'Waiting for you…' : 'Use a passkey ↗'}
                </button>
                <div className="auth-or">
                  <span>or</span>
                </div>
              </>
            )}

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
