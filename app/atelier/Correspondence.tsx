'use client';

import { useCallback, useEffect, useState } from 'react';

// The post room: everything the studio says and everyone asking to be spoken to.
//
// One room, four surfaces. Write a letter (now, or laid on the pile for the
// morning post at 6am Pacific). The pile itself, cancelable until it goes. The
// people at the door, moved here from Access. And the ledger: every email the
// app has ever sent or received, newest first, because a studio should be able
// to answer "what did we tell them and when" without opening a different tool.

/** Only what the composer needs: somewhere to send a letter. */
type Recipient = { id: string; name: string; email?: string | null };

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

export default function Correspondence({ onWaiting }: { onWaiting?: (n: number) => void }) {
  const [ledger, setLedger] = useState<Mail[]>([]);
  const [people, setPeople] = useState<Recipient[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // The letter being written.
  const [toClient, setToClient] = useState('');
  const [toFree, setToFree] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendOn, setSendOn] = useState('');
  // A drafted check-in remembers whose week it is, so the ledger can file it.
  const [draftIds, setDraftIds] = useState<{ client_id?: string | null; project_id?: string | null } | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  // A ledger row that is open, and the answer being written under it.
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  // Which slice of the record is being looked at, and which months are folded shut.
  const [lens, setLens] = useState<'all' | 'waiting' | 'inbound' | 'sent'>('all');
  const [shut, setShut] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const [m, p] = await Promise.all([
      fetch('/api/mail', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/people', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (m) {
      setLedger(m.ledger ?? []);
      onWaiting?.(m.waiting ?? 0);
    }
    // Still needed here, but only as a list of addresses to write to.
    if (p) setPeople(p.people ?? []);
    const pr = await fetch('/api/projects', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
    if (pr) setProjects((pr.projects ?? []).filter((x: any) => x.client_facing).map((x: any) => ({ id: x.id, name: x.name })));
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
        client_id: chosen?.id ?? draftIds?.client_id ?? null,
        project_id: draftIds?.project_id ?? null,
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
    setDraftIds(null);
    load();
  }

  async function draftWeek(projectId: string) {
    setMsg('');
    setBusy(true);
    const res = await fetch('/api/mail?digest=' + projectId, { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(j.error ?? 'Could not draft that week.');
      return;
    }
    setToClient('');
    setToFree(j.draft.to ?? '');
    setSubject(j.draft.subject ?? '');
    setBody(j.draft.body ?? '');
    setDraftIds({ client_id: j.draft.client_id, project_id: j.draft.project_id });
    setMsg('Drafted from the released log. Read it, shape it, then send or pile it.');
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

  /* Opening a letter is reading it, so nothing else has to be pressed. Optimistic on
     purpose: the row should stop shouting the moment it is looked at, and a write that
     fails only means it is still waiting, which is the safe way for this to be wrong. */
  async function markRead(m: Mail) {
    if (m.kind !== 'inbound' || m.status !== 'received') return;
    setLedger((rows) => rows.map((r) => (r.id === m.id ? { ...r, status: 'read' } : r)));
    onWaiting?.(Math.max(0, ledger.filter((r) => r.kind === 'inbound' && r.status === 'received').length - 1));
    try {
      const res = await fetch('/api/mail', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: m.id, action: 'read' }),
      });
      if (res.ok) return;
      // It did not stick, so put it back rather than let the count quietly lie. A
      // letter still waiting is the safe way for this to be wrong.
      const j = await res.json().catch(() => ({}));
      setLedger((rows) => rows.map((r) => (r.id === m.id ? { ...r, status: 'received' } : r)));
      onWaiting?.(ledger.filter((r) => r.kind === 'inbound' && r.status === 'received').length);
      setMsg(j.error ?? 'That letter could not be marked read.');
    } catch {
      setLedger((rows) => rows.map((r) => (r.id === m.id ? { ...r, status: 'received' } : r)));
    }
  }

  // Answering where the letter is, rather than scrolling back up to the composer and
  // retyping who it is to. It goes out as an ordinary letter, so it lands in the
  // ledger under the same client and the thread stays whole.
  async function answer(m: Mail) {
    const to = (m.from_email ?? '').match(/<([^>]+)>/)?.[1] ?? m.from_email ?? '';
    if (!to || !reply.trim()) return;
    setBusy(true);
    setMsg('');
    const subj = /^re:/i.test(m.subject ?? '') ? m.subject! : `Re: ${m.subject ?? '(no subject)'}`;
    const res = await fetch('/api/mail', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to, subject: subj, body: reply, client_id: null, send_on: null }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(j.error ?? 'That did not go through.');
      return;
    }
    setMsg('Answered.');
    setReply('');
    setOpenId(null);
    load();
  }

  const pile = ledger.filter((m) => m.status === 'scheduled');

  /* The ledger is meant to be permanent, which means it is meant to get long. A flat
     list of everything ever said stops being a record and becomes a scroll, so it is
     read through a lens and folded by month, with the current month always open.
     Nothing is hidden that a lens would not show; folding is only folding. */
  const LENSES = [
    ['all', 'Everything'],
    ['waiting', 'Waiting on you'],
    ['inbound', 'Received'],
    ['sent', 'Sent'],
  ] as const;

  const matches = (m: Mail) =>
    lens === 'all' ? true
    : lens === 'waiting' ? m.kind === 'inbound' && m.status === 'received'
    : lens === 'inbound' ? m.kind === 'inbound'
    : m.kind !== 'inbound';

  const flow = ledger.filter((m) => m.status !== 'scheduled' && matches(m));

  const monthOf = (m: Mail) => {
    const d = new Date(m.sent_at ?? m.created_at);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  };
  const months: { key: string; label: string; items: Mail[] }[] = [];
  for (const m of flow) {
    const { key, label } = monthOf(m);
    const last = months[months.length - 1];
    if (last && last.key === key) last.items.push(m);
    else months.push({ key, label, items: [m] });
  }
  const thisMonth = months[0]?.key;
  const isShut = (k: string) => (k in shut ? shut[k] : k !== thisMonth);
  const unreadIn = (items: Mail[]) =>
    items.filter((m) => m.kind === 'inbound' && m.status === 'received').length;
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
          {projects.length > 0 && (
            <div className="cor-checkins">
              <span className="cor-or">Prebuild this week from the log:</span>
              {projects.map((p) => (
                <button key={p.id} className="mini-btn" disabled={busy} onClick={() => draftWeek(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
          )}
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
      {/* ------------------------------------------------------------- the ledger */}
      <div className="wp">
        <div className="wph">
          <h4>The ledger</h4>
          <span className="tag">Everything said by email, newest first</span>
        </div>
        <div className="wpb">
          <div className="led-lens" role="group" aria-label="What to show">
            {LENSES.map(([k, label]) => {
              const n = ledger.filter((m) => m.status !== 'scheduled' && (
                k === 'all' ? true
                : k === 'waiting' ? m.kind === 'inbound' && m.status === 'received'
                : k === 'inbound' ? m.kind === 'inbound'
                : m.kind !== 'inbound'
              )).length;
              return (
                <button
                  key={k}
                  className={'led-l' + (lens === k ? ' on' : '') + (k === 'waiting' && n > 0 ? ' hot' : '')}
                  aria-pressed={lens === k}
                  onClick={() => setLens(k)}
                >
                  {label}<i>{n}</i>
                </button>
              );
            })}
          </div>

          {flow.length === 0 && (
            <p className="pk-none">
              {lens === 'all'
                ? 'Nothing yet. The first letter starts the record.'
                : lens === 'waiting'
                  ? 'Nothing waiting. Every letter that arrived has been read.'
                  : 'Nothing under this one.'}
            </p>
          )}

          {months.map((g) => (
            <section className={'led-mo' + (isShut(g.key) ? ' shut' : '')} key={g.key}>
              <button
                className="led-mo-h"
                aria-expanded={!isShut(g.key)}
                onClick={() => setShut((s) => ({ ...s, [g.key]: !isShut(g.key) }))}
              >
                <span className="led-mo-n">{g.label}</span>
                {unreadIn(g.items) > 0 && <i className="led-mo-w">{unreadIn(g.items)} waiting</i>}
                <span className="led-mo-c">{g.items.length}</span>
                <span className="led-mo-x" aria-hidden="true">{isShut(g.key) ? '+' : '−'}</span>
              </button>
              {!isShut(g.key) && g.items.map((m) => {
            const open = openId === m.id;
            const from = (m.from_email ?? '').match(/<([^>]+)>/)?.[1] ?? m.from_email ?? '';
            return (
              <div
                key={m.id}
                className={'led-item' + (open ? ' open' : '') +
                  (m.kind === 'inbound' && m.status === 'received' ? ' unread' : '')}
              >
                {/* Every letter opens. What was said is the record, and a record you
                    cannot read is a list of subject lines. */}
                <button
                  className="led-row"
                  title={m.error ?? undefined}
                  aria-expanded={open}
                  onClick={() => { setOpenId(open ? null : m.id); setReply(''); if (!open) markRead(m); }}
                >
                  <span className={'led-kind ' + m.status}>{KIND_LABEL[m.kind] ?? m.kind}</span>
                  <span className="led-what">
                    <b>{m.subject ?? '(no subject)'}</b>{' '}
                    <span className="led-to">
                      {m.kind === 'inbound' ? `from ${m.from_email ?? '?'}` : `to ${m.to_email ?? '?'}`}
                    </span>
                  </span>
                  <span className="led-when">
                    {m.status === 'failed' ? 'failed · ' : ''}
                    {when(m.sent_at ?? m.created_at)}
                  </span>
                </button>

                {open && (
                  <div className="led-open">
                    {m.body ? (
                      <p className="led-body">{m.body}</p>
                    ) : (
                      <p className="led-body led-empty">Nothing was kept of this one beyond its subject.</p>
                    )}
                    {m.error && (
                      <p className="led-err">
                        {m.kind === 'inbound'
                          ? `The body did not come back from Resend: ${m.error}`
                          : m.error}
                      </p>
                    )}

                    {/* Only a letter from a person can be answered. The studio's own
                        sends already have their reply sitting further up the list. */}
                    {m.kind === 'inbound' && from && (
                      <div className="led-reply">
                        <span className="led-reply-to">Answering {from}</span>
                        <textarea
                          className="uline"
                          rows={4}
                          maxLength={8000}
                          value={reply}
                          placeholder="Blank lines make paragraphs. It goes out wrapped in the house look, like everything else."
                          onChange={(e) => setReply(e.target.value)}
                        />
                        <div className="led-reply-do">
                          <button
                            className="mini-btn pri"
                            disabled={busy || !reply.trim()}
                            onClick={() => answer(m)}
                          >
                            {busy ? 'Sending…' : 'Send the answer'}
                          </button>
                          <button className="mini-btn" disabled={busy} onClick={() => setOpenId(null)}>
                            Not now
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
