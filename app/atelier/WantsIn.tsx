'use client';

import { useCallback, useEffect, useState } from 'react';

// The people standing at the door.
//
// Every ask from the login lands here, newest first, with whatever line they wrote
// about themselves. Approve does the whole job in one press: the client row, their
// project, and the invitation email, so the person goes from stranger to a Window of
// their own without Pen touching anything else. Decline closes the request and sends
// one kind not-right-now back, so nobody is left checking their inbox for a yes that
// is not coming.

type Req = {
  id: string;
  email: string;
  name?: string | null;
  note?: string | null;
  status: 'pending' | 'approved' | 'declined';
  created_at: string;
  decided_at?: string | null;
};

const when = (s: string) =>
  new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
  ', ' +
  new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export default function WantsIn({ onCount }: { onCount?: (n: number) => void }) {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/access-request', { cache: 'no-store' });
    if (!res.ok) {
      setMsg(res.status === 500 ? 'The door is not wired up yet. Run supabase/access-requests.sql.' : '');
      setLoaded(true);
      return;
    }
    const j = await res.json();
    setReqs(j.requests ?? []);
    onCount?.(j.waiting ?? 0);
    setLoaded(true);
  }, [onCount]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(r: Req, action: 'approve' | 'decline') {
    if (
      action === 'approve' &&
      !window.confirm(
        `Let ${r.name || r.email} in? This creates their project and emails them an invitation.`
      )
    )
      return;
    setBusy(r.id);
    setMsg('');
    const res = await fetch('/api/access-request', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: r.id, action }),
    });
    setBusy(null);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error ?? 'That did not go through.');
      return;
    }
    setMsg(
      action === 'approve'
        ? `${r.name || r.email} is in. Their invitation is on its way and their Window exists.`
        : j.noted
          ? 'Closed, with a gentle not right now on its way to them.'
          : 'Closed. The not-right-now note starts sending once Resend is set up.'
    );
    load();
  }

  const pending = reqs.filter((r) => r.status === 'pending');
  const decided = reqs.filter((r) => r.status !== 'pending').slice(0, 8);

  return (
    <div className="wp">
      <div className="wph">
        <h4>Wants in</h4>
        <span className="tag clay">People asking for access</span>
      </div>
      <div className="wpb">
        <p className="pk-lede">
          Anyone at the sign-in page can ask for access, and the ask lands here and in
          your email. Approving creates their project and sends the invitation in one
          press; the moment they follow it, their own Window is waiting.
        </p>

        {loaded && pending.length === 0 && <p className="pk-none">Nobody is waiting.</p>}

        {pending.map((r) => (
          <div key={r.id} className="wi-row">
            <div className="wi-who">
              <b>{r.name || r.email}</b>
              {r.name && <span className="wi-mail">{r.email}</span>}
              <span className="wi-when">asked {when(r.created_at)}</span>
            </div>
            {r.note && <p className="wi-note">{r.note}</p>}
            <div className="wi-act">
              <button
                className="btn-line sage"
                disabled={busy === r.id}
                onClick={() => decide(r, 'approve')}
              >
                {busy === r.id ? 'Working…' : 'Let them in ↗'}
              </button>
              <button className="mini-btn warn" disabled={busy === r.id} onClick={() => decide(r, 'decline')}>
                Decline
              </button>
            </div>
          </div>
        ))}

        {decided.length > 0 && (
          <div className="wi-past">
            {decided.map((r) => (
              <div key={r.id} className="wi-past-row">
                <span>{r.name || r.email}</span>
                <span className={'wi-st ' + r.status}>{r.status}</span>
                <span className="wi-when">{r.decided_at ? when(r.decided_at) : ''}</span>
              </div>
            ))}
          </div>
        )}

        {msg && <p className="cur-msg">{msg}</p>}
      </div>
    </div>
  );
}
