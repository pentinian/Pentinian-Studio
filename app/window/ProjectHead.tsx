'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Files from './Files';

// The project header, which opens onto everything the project has collected.
//
// The control used to be a pill that said "Files and screenshots", which is a label
// pretending to be an object. It is now a small stack of the three most recent shots,
// sitting slightly askew the way a pile of prints sits on a desk. It shows what is
// inside rather than naming it, and the count does the rest.
//
// Restraint on purpose: a few degrees of rotation, a gentle lift, nothing that
// bounces. The stack straightens when the shelf is open, which is the only animation
// that carries meaning here.

export default function ProjectHead({
  name,
  phase,
  progress,
  status,
  projectId,
}: {
  name: string;
  phase: string;
  progress: number;
  status: string | null;
  projectId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState<string[]>([]);
  const [count, setCount] = useState<number | null>(null);

  // A small, cheap look at the shelf: newest three, signed just for the preview.
  const load = useCallback(async () => {
    if (!projectId) return;
    const supabase = createClient();
    const { data: objects } = await supabase.storage
      .from('shots')
      .list(projectId, { limit: 100, sortBy: { column: 'name', order: 'desc' } });

    const files = (objects ?? []).filter((o: any) => o.name && !o.name.startsWith('.'));
    setCount(files.length);
    if (!files.length) return;

    const paths = files.slice(0, 3).map((o: any) => `${projectId}/${o.name}`);
    const { data: signed } = await supabase.storage.from('shots').createSignedUrls(paths, 60 * 30);
    setPeek((signed ?? []).map((s: any) => s.signedUrl).filter(Boolean));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const has = (count ?? 0) > 0;

  return (
    <div className={'pj-wrap' + (open ? ' open' : '')}>
      <button
        className="pj-head"
        onClick={() => projectId && has && setOpen(!open)}
        disabled={!projectId || !has}
        aria-expanded={open}
        title={has ? 'Everything this project has collected' : undefined}
      >
        <div className="ring" style={{ ['--p' as any]: progress }}>
          <b>{progress}%</b>
        </div>

        <div className="pj-info">
          <h3>
            {name}
            <span className="pill">
              <span className="sdot" /> {status === 'on_track' ? 'On track' : 'In progress'}
            </span>
          </h3>
          <p className="phase">{phase}</p>
        </div>

        {projectId && (
          <span className={'pj-stack' + (has ? '' : ' bare')}>
            <span className="pj-pile" aria-hidden="true">
              {has ? (
                peek.length ? (
                  peek.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={u} src={u} alt="" style={{ ['--i' as any]: i }} />
                  ))
                ) : (
                  // The shape is known before the images arrive, so the header does not
                  // reflow when they land.
                  [0, 1, 2].map((i) => <span key={i} className="ph" style={{ ['--i' as any]: i }} />)
                )
              ) : (
                <span className="ph lone" />
              )}
            </span>
            <span className="pj-meta">
              <b>{count == null ? '' : has ? count : 'Nothing yet'}</b>
              {has && <i>{open ? 'close' : count === 1 ? 'file' : 'files'}</i>}
            </span>
          </span>
        )}
      </button>

      {open && projectId && <Files projectId={projectId} projectName={name} />}
    </div>
  );
}
