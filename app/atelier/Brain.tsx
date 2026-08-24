'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Kit, { type Entry } from '@/app/Kit';

// The Brain tab: everything the studio knows about one project. The default
// face is the kit, a brand book projection of the same entries the flat lens
// lists raw. Curation operates on this; you cannot press what you cannot see.
//
// Brand entries are read only here. Edits happen at the source, through
// Hekate on the Mac, and flow back through the next bundle.

const TYPES = ['worklog', 'doc', 'file', 'shot', 'brand', 'inspiration'] as const;

export default function Brain({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [lane, setLane] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [view, setView] = useState<'kit' | 'flat'>('kit');
  const [filter, setFilter] = useState<(typeof TYPES)[number] | 'all'>('all');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/brain?project=${projectId}`);
    const j = await res.json();
    if (!res.ok) {
      setErr(j.error ?? 'Could not read the brain');
    } else {
      setEntries(j.entries ?? []);
      setLane(j.lane ?? null);
      setProjectName(j.project?.name ?? '');
      setErr('');
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of TYPES) c[t] = 0;
    for (const e of entries) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [entries]);

  const shown = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.type === filter)),
    [entries, filter]
  );

  if (loading) return <p className="muted">Reading the brain…</p>;
  if (err) return <p className="muted">{err}</p>;

  // A lane with no bundle and no entries is an honest emptiness, not an error.
  if (!entries.length) {
    return (
      <div className="brain-empty">
        <p>
          {lane
            ? `Nothing in the brain for ${projectName} yet. The ${lane} lane exists; sync the canon to fill it.`
            : `${projectName} has no brain lane yet. Nothing is borrowed from a parent project: when a canon exists for it, it will appear here and nowhere sooner.`}
        </p>
      </div>
    );
  }

  return (
    <div className="brain">
      <div className="kit-viewbar">
        <button
          className={'mini-btn' + (view === 'kit' ? ' pri' : '')}
          onClick={() => setView('kit')}
        >
          Kit
        </button>
        <button
          className={'mini-btn' + (view === 'flat' ? ' pri' : '')}
          onClick={() => setView('flat')}
        >
          Flat
        </button>
      </div>

      {view === 'kit' ? (
        <Kit entries={entries} projectName={projectName} lane={lane} />
      ) : (
        <>
          <div className="brain-chips">
            <button
              className={'mini-btn' + (filter === 'all' ? ' pri' : '')}
              onClick={() => setFilter('all')}
            >
              All {entries.length}
            </button>
            {TYPES.map((t) => (
              <button
                key={t}
                className={'mini-btn' + (filter === t ? ' pri' : '')}
                onClick={() => setFilter(t)}
                disabled={!counts[t]}
                title={counts[t] ? '' : `No ${t} entries yet`}
              >
                {t} {counts[t] || ''}
              </button>
            ))}
          </div>
          <div className="brain-list">
            {shown.map((e) => (
              <EntryCard key={e.id} e={e} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ value }: { value: string }) {
  const cls =
    value === 'released' ? 'tag sage' : value === 'staged' ? 'tag clay' : 'tag';
  // The tool is plumbing; the surface says what the source IS, not what
  // carried it.
  const label = value === 'hekate' ? 'canon' : value;
  return <span className={cls}>{label}</span>;
}

function EntryCard({ e }: { e: Entry }) {
  return (
    <div className="qcard brain-card">
      <div className="brain-card-head">
        <time>{new Date(e.created).toLocaleDateString()}</time>
        <strong>{e.title}</strong>
        <span className="brain-badges">
          <Badge value={e.type} />
          <Badge value={e.visibility} />
          <Badge value={e.source} />
        </span>
      </div>
      {e.body ? <p className="brain-body">{e.body.slice(0, 400)}</p> : null}
      <p className="brain-prov">
        {e.provenance}
        {e.released_at ? ` · released ${new Date(e.released_at).toLocaleDateString()}` : ''}
      </p>
    </div>
  );
}
