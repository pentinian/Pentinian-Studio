'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Attach, { isImage, pretty } from '../Attach';

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
/** `at` is when the item came to be: its entry's start for a screenshot, the upload
 *  for a file. `tab` is the tab it sits under, set once the tabs are chosen. */
type Item = { path: string; name: string; url?: string; size?: number; at?: string | null; tab?: string };

// Months are the studio's months, the same clock as the log.
const STUDIO_TZ = 'America/Los_Angeles';
const monthKey = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-CA', { timeZone: STUDIO_TZ }).slice(0, 7) : 'undated';
const monthName = (k: string, withYear: boolean) =>
  k === 'undated' ? 'Undated'
    : new Date(`${k}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', ...(withYear ? { year: 'numeric' } : {}) });
const kindOf = (p: string) => (isImage(p) ? 'Images' : ext(p) || 'Other');

type Tab = { key: string; label: string; n: number };

/* The tabs come from what the face holds, so they stay right as it grows.
 *
 * By kind when there are three or more kinds with at least three items each, since
 * then a reader looking for "the PDFs" has somewhere to go. Otherwise by month, newest
 * first, because the question is then "what came in when". One month (or one kind)
 * is no choice at all, so it draws no tabs. Counted on 2026-11-12 for Artinian Gems
 * and Caveman Gems: 8 items, 5 images, 2 PDF, 1 CSV, so by month (August 5,
 * October 3). */
function chooseTabs(items: Item[]): Tab[] {
  const count = (key: (i: Item) => string) => {
    const m = new Map<string, number>();
    for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
    return m;
  };
  const kinds = count((i) => kindOf(i.path));
  const byKind = [...kinds.values()].filter((n) => n >= 3).length >= 3;
  for (const i of items) i.tab = byKind ? kindOf(i.path) : monthKey(i.at);
  if (byKind) {
    return [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, label: k, n }));
  }
  const months = count((i) => monthKey(i.at));
  const years = new Set([...months.keys()].map((k) => k.slice(0, 4)));
  return [...months.entries()]
    .sort((a, b) => (a[0] === 'undated' ? 1 : b[0] === 'undated' ? -1 : b[0].localeCompare(a[0])))
    .map(([k, n]) => ({ key: k, label: monthName(k, years.size > 1), n }));
}

const KB = (n?: number) =>
  n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
const when = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
// `pretty` used to be declared here. It moved to app/Attach.tsx on 2026-09-15 when
// the Atelier's screenshot shelf needed the same rule, so that a storage filename
// reads one way everywhere rather than two ways in two rooms.
const ext = (p: string) => (p.split('.').pop() ?? '').toUpperCase();

export default function Files({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [shots, setShots] = useState<{ entry: Entry; items: Item[] }[]>([]);
  const [files, setFiles] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [tab, setTab] = useState<string | null>(null);

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
      // A document under files/ that an entry also names is listed once, under Files,
      // where it already appears because it was deliberately attached.
      const items: Item[] = (e.shots ?? [])
        .filter((p: string) => !p.startsWith(`${projectId}/files/`))
        .map((p: string) => {
          const it: Item = { path: p, name: p.split('/').pop() ?? p, at: e.started_at };
          claimed.push(it);
          return it;
        });
      return { entry: e as Entry, items };
    }).filter((g) => g.items.length);

    const attachedItems: Item[] = (attached ?? [])
      .filter((o: any) => o.name && !o.name.startsWith('.'))
      .map((o: any) => ({
        path: `${projectId}/files/${o.name}`, name: o.name, size: o.metadata?.size,
        at: o.created_at ?? o.updated_at ?? null,
      }));

    const all = [...claimed, ...attachedItems];
    if (all.length) {
      const { data: signed } = await supabase.storage
        .from('shots').createSignedUrls(all.map((i) => i.path), 60 * 30);
      const byPath = new Map(all.map((i) => [i.path, i]));
      for (const s of signed ?? []) {
        if (s.signedUrl && s.path) { const it = byPath.get(s.path); if (it) it.url = s.signedUrl; }
      }
    }

    const t = chooseTabs(all);
    setTabs(t.length > 1 ? t : []);
    setTab((cur) => (cur && t.some((x) => x.key === cur) ? cur : t[0]?.key ?? null));
    setShots(groups);
    setFiles(attachedItems);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const total = shots.reduce((n, g) => n + g.items.length, 0) + files.length;
  // With tabs, a face shows one tab's items; without, everything.
  const inTab = (i: Item) => !tabs.length || i.tab === tab;
  const shown = shots
    .map((g) => ({ ...g, items: g.items.filter(inTab) }))
    .filter((g) => g.items.length);
  const shownFiles = files.filter(inTab);
  let n = 0;
  const no = () => String(++n).padStart(2, '0');

  return (
    <div className="cn-body">
      <header className="bg-head fc-head">
        <div>
          <span className="bg-kicker">Files</span>
          <h4>Everything the project holds</h4>
        </div>
      </header>

      {loading && <p className="cur-empty">Opening the shelf…</p>}
      {!loading && total === 0 && (
        <p className="cur-empty">Nothing here yet. Screenshots arrive as work is released.</p>
      )}

      {/* R108: one month (or one kind) at a time, so nobody scrolls one long list to
          reach the oldest thing on the shelf. */}
      {tabs.length > 0 && (
        <div className="tabs fc-tabs" role="tablist" aria-label="Files">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} data-files-tab={t.key}
                    className={tab === t.key ? 'on' : undefined} onClick={() => setTab(t.key)}>
              {t.label}<b>{t.n}</b>
            </button>
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <div className="cn-row">
          <span className="cn-row-l"><em>{no()}</em>Screenshots</span>
          <div className="cn-row-b">
            {shown.map((g) => (
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

      {shownFiles.length > 0 && (
        <div className="cn-row">
          <span className="cn-row-l"><em>{no()}</em>Files</span>
          <div className="cn-row-b">
            <div className="cn-grid">{shownFiles.map((it) => <Tile key={it.path} item={it} />)}</div>
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
