'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Everything the project has collected, in one place, sorted by the work it belongs to.
//
// Screenshots were only ever reachable by opening the exact entry that carried them,
// which is fine when you know which day you are looking for and useless when you do
// not. This is the other way in: the whole shelf, grouped by the piece of work each
// item came from, with anything unattached gathered at the end rather than hidden.
//
// It reads storage through the ordinary browser client, so the same path policy
// applies: objects live under <project_id>/ and a client can only ever list and sign
// their own. Nothing here widens that.

type Entry = { id: string; title: string | null; started_at: string | null; shots: string[] | null };
type Item = { path: string; name: string; url?: string; size?: number };

const KB = (n?: number) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const when = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

export default function Files({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [groups, setGroups] = useState<{ entry: Entry | null; items: Item[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    const supabase = createClient();
    setLoading(true);

    // Everything on the shelf, and everything the log says it belongs to.
    const [{ data: objects }, { data: entries }] = await Promise.all([
      supabase.storage.from('shots').list(projectId, { limit: 500, sortBy: { column: 'name', order: 'desc' } }),
      supabase
        .from('work_log_released')
        .select('id,title,started_at,shots')
        .eq('project_id', projectId)
        .order('started_at', { ascending: false, nullsFirst: false }),
    ]);

    const all: Item[] = (objects ?? [])
      .filter((o: any) => o.name && !o.name.startsWith('.'))
      .map((o: any) => ({
        path: `${projectId}/${o.name}`,
        name: o.name,
        size: o.metadata?.size,
      }));
    setCount(all.length);

    // Sign them all at once. Thirty minutes, minted per view, so nothing here is a
    // URL that outlives the visit.
    const byPath = new Map(all.map((i) => [i.path, i]));
    if (all.length) {
      const { data: signed } = await supabase.storage
        .from('shots')
        .createSignedUrls(all.map((i) => i.path), 60 * 30);
      for (const s of signed ?? []) {
        if (s.signedUrl && s.path) {
          const it = byPath.get(s.path);
          if (it) it.url = s.signedUrl;
        }
      }
    }

    const claimed = new Set<string>();
    const grouped: { entry: Entry | null; items: Item[] }[] = (entries ?? [])
      .map((e: any) => {
        const items = (e.shots ?? [])
          .map((p: string) => {
            claimed.add(p);
            return byPath.get(p);
          })
          .filter(Boolean) as Item[];
        return { entry: e as Entry, items };
      })
      .filter((g) => g.items.length);

    // Anything on the shelf that no released entry claims. Usually a shot uploaded
    // before its entry went out, which is worth showing rather than swallowing.
    const loose = all.filter((i) => !claimed.has(i.path));
    if (loose.length) grouped.push({ entry: null, items: loose });

    setGroups(grouped);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="pj-files">
      <div className="pj-files-h">
        <span className="ln">Everything from {projectName}</span>
        <span className="pj-files-n">{count} item{count === 1 ? '' : 's'}</span>
      </div>

      {loading && <p className="cur-empty">Opening the shelf…</p>}
      {!loading && count === 0 && (
        <p className="cur-empty">Nothing here yet. Screenshots appear as work is released.</p>
      )}

      {groups.map((g, i) => (
        <div className="pj-group" key={g.entry?.id ?? `loose${i}`}>
          <div className="pj-group-h">
            {g.entry ? (
              <>
                <b>{g.entry.title || 'Work'}</b>
                <i>{when(g.entry.started_at)}</i>
              </>
            ) : (
              <>
                <b>Not attached to an entry yet</b>
                <i>{g.items.length}</i>
              </>
            )}
          </div>
          <div className="pj-grid">
            {g.items.map((it) =>
              it.url ? (
                <a key={it.path} href={it.url} target="_blank" rel="noopener noreferrer" title={it.name}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.url} alt="" loading="lazy" />
                  <span className="pj-cap">
                    {it.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.(png|jpe?g|webp)$/i, '').replace(/-/g, ' ')}
                    <i>{KB(it.size)}</i>
                  </span>
                </a>
              ) : (
                <span key={it.path} className="pj-skel" />
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
