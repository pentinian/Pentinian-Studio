'use client';

import { useCallback, useEffect, useState } from 'react';
import WantsIn from './WantsIn';

// The post room: everything the studio says and everyone asking to be spoken to.
//
// One room, four surfaces. Write a letter (now, or laid on the pile for the
// morning post at 6am Pacific). The pile itself, cancelable until it goes. The
// people at the door, moved here from Access. And the ledger: every email the
// app has ever sent or received, newest first, because a studio should be able
// to answer "what did we tell them and when" without opening a different tool.

type Mail = {
  id: string;
  kind: 'notify' | 'decline' | 'invite' | 'manual' | 'digest' | 'inbound';
  to_email?: string | null;
  from_email?: string | null;
  subject?: string | null;
  body?: string | null;
  status: string;
  scheduled_for?: string | null;
  sent_at?: string | null;
  created_at: string;
  error?: string | null;
};

type Person = {
  id: string;
  name: string;
  email?: string | null;
  user_id?: string | null;
  suspended: boolean;
};

const KIND_LABEL: Record<Mail['kind'], string> = {
  notify: 'to the studio',
  decline: 'kind no',
  invite: 'invitation',
  manual: 'letter',
  digest: 'check-in',
  inbound: 'received',
};

const when = (s?: string | null) =>
  s
    ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ', ' +
      new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

export default function Correspondence({ onKnock }: { onKnock?: (n: number) => void }) {
  const [ledger, setLedger] = useState<Mail[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // The letter being written.
  const [toClient, setToClient] = useState('');
  const [toFree, setToFree] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendOn, setSendOn] = useState('');

  const load = useCallback(async () => {
    const [m, p] = await Promise.all([
      fetch('/api/mail', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/people', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (m) setLedger(m.ledger ?? []);
    if (p) setPeople(p.people ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chosen = people.find((p) => p.id === toClient) ?? null;
  const toEmail = chosen?.email?.trim() || toFree.trim();

  async function write(now: boolean) {
    setMsg('');
    setBusy(true);
    const res = await fetch('/api/mail', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: toEmail,
        client_id: chosen?.id ?? null,
        subject,
        body,
        send_on: now ? null : sendOn || null,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(j.error ?? 'That did not go through.');
      return;
    }
    setMsg(j.scheduled ? 'On the pile. It goes out with the morning post.' : 'Sent.');
    setSubject('');
    setBody('');
    setSendOn('');
    load();
  }

  async function pileAction(m: Mail, action: 'cancel' | 'send-now') {
    setBusy(true);
    const res = await fetch('/api/mail', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: m.id, action }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? 'That did not go through.');
      return;
    }
    setMsg(action === 'cancel' ? 'Taken off the pile.' : 'Sent.');
    load();
  }

  async function personAction(p: Person, action: 'suspend' | 'restore') {
    if (
      action === 'suspend' &&
      !window.confirm(`Suspend ${p.name}? They cannot sign in until restored. Their Window and history stay.`)
    )
      return;
    setBusy(true);
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
    setMsg(action === 'suspend' ? `${p.name} is suspended. Restore any time.` : `${p.name} is back in.`);
    load();
  }

  const pile = ledger.filter((m) => m.status === 'scheduled');
  const flow = ledger.filter((m) => m.status !== 'scheduled').slice(0, 30);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      {/* ------------------------------------------------------ write a letter */}
      <div className="wp">
        <div className="wph">
          <h4>Write a letter</h4>
          <span className="tag sage">Branded, from hello@pentinian.com</span>
        </div>
        <div className="wpb">
          <div className="cor-form">
            <select className="uline" value={toClient} onChange={(e) => setToClient(e.target.value)}>
              <option value="">To an address I type</option>
              {people
                .filter((p) => p.email)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.email}
                  </option>
                ))}
            </select>
            {!chosen && (
              <input
                className="uline"
                type="email"
                placeholder="them@domain.com"
                value={toFree}
                onChange={(e) => setToFree(e.target.value)}
              />
            )}
            <input
              className="uline"
              placeholder="Subject"
              maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <textarea
              className="uline cor-body"
              placeholder="The letter itself. Blank lines make paragraphs; it goes out wrapped in the house look."
              maxLength={8000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="cor-act">
              <button className="btn-line sage" disabled={busy || !toEmail || !subject || !body} onClick={() => write(true)}>
                {busy ? 'Working…' : 'Send now ↗'}
              </button>
              <span className="cor-or">or with the morning post of</span>
              <input
                className="uline cor-date"
                type="date"
                min={today}
                value={sendOn}
                onChange={(e) => setSendOn(e.target.value)}
              />
              <button
                className="mini-btn"
                disabled={busy || !toEmail || !subject || !body || !sendOn}
                onClick={() => write(false)}
              >
                Lay it on the pile
              </button>
            </div>
          </div>

          {pile.length > 0 && (
            <div className="cor-pile">
              {pile.map((m) => (
                <div key={m.id} className="led-row">
                  <span className="led-kind scheduled">pile</span>
                  <span className="led-what">
                    <b>{m.subject}</b> <span className="led-to">to {m.to_email}</span>
                  </span>
                  <span className="led-when">
                    {m.scheduled_for
                      ? new Date(m.scheduled_for).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : ''}
                  </span>
                  <span className="led-do">
                    <button className="mini-btn" disabled={busy} onClick={() => pileAction(m, 'send-now')}>
                      Send now
                    </button>
                    <button className="mini-btn warn" disabled={busy} onClick={() => pileAction(m, 'cancel')}>
                      Cancel
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {msg && <p className="cur-msg">{msg}</p>}
        </div>
      </div>

      {/* -------------------------------------------------- the people at the door */}
      <WantsIn onCount={onKnock} />

      {/* ----------------------------------------------------------- who is inside */}
      <div className="wp">
        <div className="wph">
          <h4>People</h4>
          <span className="tag">Who can walk in</span>
        </div>
        <div className="wpb">
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
                  <button className="mini-btn" disabled={busy} onClick={() => personAction(p, 'restore')}>
                    Restore
                  </button>
                ) : (
                  p.user_id && (
                    <button className="mini-btn warn" disabled={busy} onClick={() => personAction(p, 'suspend')}>
                      Suspend
                    </button>
                  )
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------- the ledger */}
      <div className="wp">
        <div className="wph">
          <h4>The ledger</h4>
          <span className="tag">Everything said by email, newest first</span>
        </div>
        <div className="wpb">
          {flow.length === 0 && <p className="pk-none">Nothing yet. The first letter starts the record.</p>}
          {flow.map((m) => (
            <div key={m.id} className="led-row" title={m.error ?? undefined}>
              <span className={'led-kind ' + m.status}>{KIND_LABEL[m.kind] ?? m.kind}</span>
              <span className="led-what">
                <b>{m.subject ?? '(no subject)'}</b>{' '}
                <span className="led-to">{m.kind === 'inbound' ? `from ${m.from_email ?? '?'}` : `to ${m.to_email ?? '?'}`}</span>
              </span>
              <span className="led-when">
                {m.status === 'failed' ? 'failed · ' : ''}
                {when(m.sent_at ?? m.created_at)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
