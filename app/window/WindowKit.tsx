'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Kit, { type Entry } from '@/app/Kit';

// The client's brand book: the same Kit the Atelier reads, mounted over the
// window_brain view. Released projections only, no press function at all,
// so its read only nature is structural rather than styled. The view has
// already done the redaction; nothing here decides what a client may see.

export default function WindowKit({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('window_brain')
        .select('id,project_id,slug,type,title,body,payload,released_at,created')
        .eq('project_id', projectId)
        .order('created', { ascending: false })
        .limit(500);
      if (!alive) return;
      if (error) {
        setErr('The brand book could not be read.');
        setEntries([]);
        return;
      }
      setEntries(
        (data ?? []).map((r: any) => ({
          id: r.id,
          slug: r.slug,
          type: r.type,
          source: '',
          title: r.title ?? '',
          body: r.body ?? null,
          payload: r.payload ?? {},
          asset_path: null,
          provenance: '',
          entry_key: '',
          visibility: 'released' as const,
          released_at: r.released_at,
          created: r.created,
        }))
      );
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Every state sits inside .cn-body, the panel's inset, as the other faces do. The
  // empty, loading and error lines used to return bare, which put them on the panel's
  // left border, 22px left of every other face's first line (R109, frame 130).
  const head = (
    <header className="bg-head fc-head">
      <div>
        <span className="bg-kicker">Brand book</span>
        <h4>What we have settled</h4>
      </div>
    </header>
  );

  if (entries === null) return <div className="cn-body">{head}<p className="cur-empty">Reading the brand book…</p></div>;
  if (err) return <div className="cn-body">{head}<p className="cur-msg bad">{err}</p></div>;
  if (!entries.length)
    return (
      <div className="cn-body fc-face">
        {head}
        <p className="cur-empty">
          Nothing released to the book yet. What appears here is chosen deliberately, piece by
          piece.
        </p>
      </div>
    );

  // The book carries its own title (Kit), so it is not given a second one here.
  return (
    <div className="cn-body">
      <Kit entries={entries} projectName={projectName} lane={null} />
    </div>
  );
}
