'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Attach, { isImage } from './Attach';

// Everything the project holds, in two halves.
//
// Screenshots are evidence: they came out of a released piece of work and belong to the
// entry that produced them, so they stay grouped that way. Files are everything
// deliberately attached, and grouping those by entry would be a fiction, since a brief
// or a font does not come from an afternoon.
//
// THE RULE THAT MATTERS HERE. This used to list the storage folder and show whatever
// was in it, with anything unclaimed collected under "Loose images". That quietly
// bypassed the release gate: push-shots uploads a screenshot the moment it is captured,
// so an image belonging to a work-log entry still sitting in the Quarry was rendered in
// the client's Window. Found by probing the live bucket against work_log_raw, where
// exactly one such image was already visible to a client who was never meant to see it.
//
// So: nothing is shown because it happens to exist in storage. A screenshot appears
// only when the work that produced it has been released. A file appears only when it
// was put there deliberately, which is what the files/ segment records.

type Entry = { id: string; title: string | null; started_at: string | null; shots: string[] | null };
type Item = { path: string; name: string; url?: string; size?: number };

const KB = (n?: number) =>
  n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
const when = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
const pretty = (n: string) =>
  n.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/^\d{10,}-/, '')
   .replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
const ext = (p: string) => (p.split('.').pop() ?? '').toUpperCase();

export default function Files({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [shots, setShots] = useState<{ entry: Entry; items: Item[] }[]>([]);
  const [files, setFiles] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    setLoading(true);

    // Two reads, and neither of them is "list the folder and show it".
    const [{ data: attached }, { data: entries }] = await Promise.all([
      supabase.storage.from('shots').list(`${projectId}/files`, {
        limit: 500, sortBy: { column: 'name', order: 'desc' },
      }),
      supabase.from('work_log_released')
        .select('id,title,started_at,shots').eq('project_id', projectId)
        .order('started_at', { ascending: false, nullsFirst: false }),
    ]);

    // Screenshots come from the released entries themselves, so an entry still in the
    // Quarry can never contribute one. This is the release gate, not a filter over it.
    const claimed: Item[] = [];
    const groups = (entries ?? []).map((e: any) => {
      const items: Item[] = (e.shots ?? []).map((p: string) => {
        const it = { path: p, name: p.split('/').pop() ?? p };
        claimed.push(it);
        return it;
      });
      return { entry: e as Entry, items };
    }).filter((g) => g.items.length);

    const attachedItems: Item[] = (attached ?? [])
      .filter((o: any) => o.name && !o.name.startsWith('.'))
      .map((o: any) => ({ path: `${projectId}/files/${o.name}`, name: o.name, size: o.metadata?.size }));

    const all = [...claimed, ...attachedItems];
    if (all.length) {
      const { data: signed } = await supabase.storage
        .from('shots').createSignedUrls(all.map((i) => i.path), 60 * 30);
      const byPath = new Map(all.map((i) => [i.path, i]));
      for (const s of signed ?? []) {
        if (s.signedUrl && s.path) { const it = byPath.get(s.path); if (it) it.url = s.signedUrl; }
      }
    }

    setShots(groups);
    setFiles(attachedItems);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const total = shots.reduce((n, g) => n + g.items.length, 0) + files.length;

  return (
    <div className="cn-body">
      {loading && <p className="cur-empty">Opening the shelf…</p>}
      {!loading && total === 0 && (
        <p className="cur-empty">Nothing here yet. Screenshots arrive as work is released.</p>
      )}

      {shots.length > 0 && (
        <div className="cn-row">
          <span className="cn-row-l">Screenshots</span>
          <div className="cn-row-b">
            {shots.map((g) => (
              <div className="fl-group" key={g.entry.id}>
                <div className="fl-group-h">
                  <b>{g.entry.title || 'Work'}</b>
                  <i>{when(g.entry.started_at)}</i>
                </div>
                <div className="cn-grid">
                  {g.items.map((it) => <Tile key={it.path} item={it} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="cn-row">
          <span className="cn-row-l">Files</span>
          <div className="cn-row-b">
            <div className="cn-grid">{files.map((it) => <Tile key={it.path} item={it} />)}</div>
          </div>
        </div>
      )}

      <div className="cn-add">
        <div className="cn-add-row">
          <Attach
            projectId={projectId}
            label="Add a file"
            accept="image/*,application/pdf,application/zip,font/*,text/plain,text/csv"
            onDone={() => load()}
          />
          <span className="cn-note">Anything useful to {projectName}. Up to 25 MB.</span>
        </div>
      </div>
    </div>
  );
}

function Tile({ item }: { item: Item }) {
  return (
    <div className="cn-thumb">
      {item.url && isImage(item.path) ? (
        <a href={item.url} target="_blank" rel="noopener noreferrer" title={item.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt="" loading="lazy" />
        </a>
      ) : item.url ? (
        <a className="cn-doc" href={item.url} target="_blank" rel="noopener noreferrer" title={item.name}>
          {ext(item.path)}
        </a>
      ) : (
        <span className="cn-doc" />
      )}
      <span className="cn-cap">
        {pretty(item.name)}
        <i>{KB(item.size)}</i>
      </span>
    </div>
  );
}
