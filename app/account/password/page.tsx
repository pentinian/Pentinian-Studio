'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Choose your own password. Reached two ways: straight after a first sign in with
// a starter password (the middleware holds the person here until a password of
// their own exists), or from the reset link in the mail that first sign in sent.
// Either way the session is already in place; this page only replaces the key.
function PasswordForm() {
  const params = useSearchParams();
  const fromStarter = params.get('starter') === '1';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? ''));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 12) {
      setError('Twelve characters or more. A short sentence you will remember is ideal.');
      return;
    }
    if (password !== again) {
      setError('The two do not match.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      password,
      // The flag is what the middleware reads; clearing it is what lets the person
      // past this page. A new password that still carried it would be a trap.
      data: { starter_password: false },
    });
    setBusy(false);
    if (error) {
      setError(
        /same password|different from the old/i.test(error.message)
          ? 'That is the starter password. Choose one of your own.'
          : error.message
      );
      return;
    }
    setDone(true);
  }

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="eyebrow">Pentinian</div>
        {done ? (
          <>
            <h1 className="auth-h">Set.</h1>
            <p className="auth-sub">
              Your password is yours now, and the starter one no longer opens anything.
              {' '}
              <a className="auth-again" href="/window">Go to your project</a>
            </p>
          </>
        ) : (
          <>
            <h1 className="auth-h">Choose your password.</h1>
            <p className="auth-sub">
              {fromStarter
                ? 'The starter password worked once and is now spent. '
                : ''}
              Pick one of your own for <b>{email || 'this account'}</b>.
              {fromStarter
                ? ' A link to do the same thing is also in your email, in case you close this page.'
                : ''}
            </p>
            <form onSubmit={submit} className="auth-form">
              <input
                className="uline"
                type="password"
                required
                autoComplete="new-password"
                placeholder="New password (12 characters or more)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <input
                className="uline"
                type="password"
                required
                autoComplete="new-password"
                placeholder="Once more"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
              />
              <button className="btn-line sage" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save my password ↗'}
              </button>
            </form>
            {error && <p className="auth-err">{error}</p>}
          </>
        )}
      </div>
    </main>
  );
}

export default function PasswordPage() {
  return (
    <Suspense fallback={null}>
      <PasswordForm />
    </Suspense>
  );
}
