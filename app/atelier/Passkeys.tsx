'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Passkey management for the signed-in account.
//
// Nothing secret passes through this component. Registering runs the WebAuthn
// ceremony in the browser: the private key is minted inside the Secure Enclave or
// the password manager and never leaves it, and Supabase stores only the public
// half. There is no shared secret here to leak, phish, or reuse on another site,
// because the credential is cryptographically bound to this domain.

type Passkey = {
  id: string;
  friendly_name?: string | null;
  created_at: string;
  last_used_at?: string | null;
};

const when = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'never';

export default function Passkeys() {
  const [keys, setKeys] = useState<Passkey[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await (supabase.auth as any).passkey.list();
    if (error) setMsg(error.message);
    else setKeys(data ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && !!window.PublicKeyCredential);
    load();
  }, [load]);

  async function add() {
    setBusy(true);
    setMsg('');
    const supabase = createClient();
    const { error } = await (supabase.auth as any).registerPasskey();
    setBusy(false);
    if (error) {
      if (/abort|cancel|NotAllowed/i.test(error.message ?? '')) return;
      setMsg(
        /webauthn_credential_exists/i.test(error.code ?? error.message ?? '')
          ? 'That authenticator is already registered to this account.'
          : error.message
      );
      return;
    }
    setMsg('Added. You can sign in with it from now on.');
    load();
  }

  async function rename(k: Passkey) {
    const name = window.prompt('Name this passkey', k.friendly_name ?? '');
    if (name == null) return;
    const supabase = createClient();
    await (supabase.auth as any).passkey.update({
      passkeyId: k.id,
      friendlyName: name.slice(0, 120),
    });
    load();
  }

  async function remove(k: Passkey) {
    const last = keys.length === 1;
    const ok = window.confirm(
      last
        ? 'This is your only passkey. Removing it means signing in by email link until you add another. Remove it?'
        : `Remove "${k.friendly_name ?? 'this passkey'}"? The device it lives on will no longer be able to sign in.`
    );
    if (!ok) return;
    const supabase = createClient();
    const { error } = await (supabase.auth as any).passkey.delete({ passkeyId: k.id });
    setMsg(error ? error.message : 'Removed.');
    load();
  }

  return (
    <div className="wp">
      <div className="wph">
        <h4>Passkeys</h4>
        <span className="tag sage">This device, this domain</span>
      </div>
      <div className="wpb">
        <p className="pk-lede">
          A passkey signs you in with Touch ID instead of an emailed link. The key itself
          never leaves your device, and it only works on this exact domain, so it cannot
          be phished onto a lookalike. Add one per device you actually work from.
        </p>

        {!supported && (
          <p className="cur-warn">This browser does not support passkeys. Email links still work.</p>
        )}

        {loaded && keys.length === 0 && (
          <p className="pk-none">None yet. Adding one takes about three seconds.</p>
        )}

        {keys.map((k) => (
          <div key={k.id} className="pk-row">
            <span className="pk-name">{k.friendly_name || 'Unnamed passkey'}</span>
            <span className="pk-meta">
              added {when(k.created_at)} · last used {when(k.last_used_at)}
            </span>
            <button className="mini-btn" onClick={() => rename(k)}>
              Rename
            </button>
            <button className="mini-btn warn" onClick={() => remove(k)}>
              Remove
            </button>
          </div>
        ))}

        <div style={{ marginTop: 16 }}>
          <button className="btn-line sage" onClick={add} disabled={busy || !supported}>
            {busy ? 'Waiting for you…' : 'Add a passkey ↗'}
          </button>
        </div>

        {msg && <p className="cur-msg">{msg}</p>}

        <p className="pk-note">
          Passkeys are bound to the domain they were made on. When the app moves to its
          own address, these stop working and you add one again there. That is the
          binding doing its job, not a fault.
        </p>
      </div>
    </div>
  );
}
