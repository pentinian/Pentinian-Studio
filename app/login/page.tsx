'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
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
            <p className="auth-sub">Enter your email and I'll send a one-time link. No password to remember.</p>
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
