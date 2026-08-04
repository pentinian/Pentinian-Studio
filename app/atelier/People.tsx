'use client';

import { useCallback, useEffect, useState } from 'react';

// Who can walk in.
//
// This lived in the post room for a while, which was a category error: the post
// room is what was said, and this is who is allowed through the door. They share
// nothing except that both involve email, and that is not enough.
//
// Three states, and every one of them has something to press. Nobody should read
// "no sign-in yet" with no way to act on it.

type Person = {
  id: string;
  name: string;
  email?: string | null;
  user_id?: string | null;
  suspended: boolean;
};

export default function People() {
  const [people, setPeople] = useState<Person[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const p = await fetch('/api/people', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
    if (p) setPeople(p.people ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(p: Person, action: 'suspend' | 'restore' | 'invite') {
    if (
      action === 'suspend' &&
      !window.confirm(`Suspend ${p.name}? They cannot sign in until restored. Their Window and history stay.`)
    )
      return;
    if (
      action === 'invite' &&
      !window.confirm(`Invite ${p.name} at ${p.email}? They get an email that lets them into their own Window.`)
    )
      return;

    setBusy(true);
    setMsg('');
    const res = await fetch('/api/people', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: p.id, action }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? 'That did not go through.');
      return;
    }
    setMsg(
      action === 'suspend'
        ? `${p.name} is suspended. Restore any time.`
        : action === 'invite'
          ? `Invited. ${p.name} has an email waiting, and their Window is ready the moment they follow it.`
          : `${p.name} is back in.`
    );
    load();
  }

  return (
    <div className="wp">
      <div className="wph">
        <h4>People</h4>
        <span className="tag">Who can walk in</span>
      </div>
      <div className="wpb">
        {msg && <p className="cur-msg">{msg}</p>}
        {people.length === 0 && <p className="pk-none">Nobody yet.</p>}
        {people.map((p) => (
          <div key={p.id} className="ppl-row">
            <span className="ppl-who">
              <b>{p.name}</b>
              {p.email && <span className="wi-mail">{p.email}</span>}
            </span>
            <span className={'wi-st ' + (p.suspended ? 'declined' : p.user_id ? 'approved' : '')}>
              {p.suspended ? 'suspended' : p.user_id ? 'can sign in' : 'no sign-in yet'}
            </span>
            <span className="led-do">
              {p.suspended ? (
                <button className="mini-btn" disabled={busy} onClick={() => act(p, 'restore')}>
                  Restore
                </button>
              ) : p.user_id ? (
                <button className="mini-btn warn" disabled={busy} onClick={() => act(p, 'suspend')}>
                  Suspend
                </button>
              ) : (
                /* Nobody should be stuck at "no sign-in yet" with nothing to press. */
                <button
                  className="mini-btn pri"
                  disabled={busy || !p.email}
                  title={p.email ? undefined : 'No email address on file, so there is nowhere to send it'}
                  onClick={() => act(p, 'invite')}
                >
                  Let them in
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
