'use client';

import { useCallback, useEffect, useState } from 'react';

// The studio side of a conversation the client started.
//
// Without this the Window's reply box was a hole: a client could write and it would
// sit in the database unread. Everything a client has said is here, newest first,
// with the entry they said it against, so the reply can be written without going to
// find what they were looking at.

type Thread = {
  id: string;
  body: string;
  created_at: string;
  answered: boolean;
  entry_id: string;
  project_id: string;
  project: string;
  client: string | null;
  entry: { id: string; title: string | null; area: string | null; started_at: string | null; eli5: string | null } | null;
  replies: { id: string; body: string; created_at: string }[];
};

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  const d = Math.round(mins / 60 / 24);
  return d < 8 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function Replies() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/comments', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setThreads(d.threads ?? []);
      setWaiting(d.waiting ?? 0);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function reply(t: Thread) {
    const body = (draft[t.id] ?? '').trim();
    if (!body) return;
    setBusy(t.id);
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_id: t.entry_id, project_id: t.project_id, body }),
    });
    setBusy('');
    if (!res.ok) return;
    setDraft((p) => ({ ...p, [t.id]: '' }));
    load();
  }

  const shown = showAll ? threads : threads.filter((t) => !t.answered);

  return (
    <div className="wp">
      <div className="wph">
        <h4>Replies</h4>
        {waiting > 0 && <span className="tag clay">{waiting} waiting</span>}
        <button className="cur-scope" style={{ marginLeft: 'auto' }} onClick={() => setShowAll(!showAll)}>
          {showAll ? 'only unanswered' : 'everything'}
        </button>
      </div>
      <div className="wpb">
        {loaded && shown.length === 0 && (
          <p className="cur-empty">
            {threads.length ? 'Everything has been answered.' : 'Nobody has written yet.'}
          </p>
        )}

        {shown.map((t) => (
          <div key={t.id} className={'rp' + (t.answered ? ' done' : '')}>
            <div className="rp-head">
              <span className="rp-who">{t.client ?? 'A client'}</span>
              <span className="rp-proj">{t.project}</span>
              <span className="rp-when">{ago(t.created_at)}</span>
            </div>

            {/* What they were reading when they wrote. Context, not decoration: a
                reply written without it tends to answer the wrong question. */}
            {t.entry && (
              <div className="rp-ctx">
                <span className="rp-ctx-l">on</span> {t.entry.title || 'an entry'}
                {t.entry.area && <i>{t.entry.area}</i>}
              </div>
            )}

            <p className="rp-body">{t.body}</p>

            {t.replies.map((r) => (
              <div key={r.id} className="rp-mine">
                <span className="who">You</span>
                <p>{r.body}</p>
              </div>
            ))}

            <div className="wl-say">
              <input
                placeholder="Reply, and it appears where they wrote it…"
                value={draft[t.id] ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, [t.id]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && reply(t)}
              />
              <button
                className="mini-btn pri"
                onClick={() => reply(t)}
                disabled={busy === t.id || !(draft[t.id] ?? '').trim()}
              >
                Send
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
