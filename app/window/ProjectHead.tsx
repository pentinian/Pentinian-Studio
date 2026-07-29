'use client';

import { useState } from 'react';
import Files from './Files';

// The project header, which opens.
//
// It was a static summary sitting above everything and doing nothing. It is the
// obvious place to reach for when you want the project's material rather than one
// day of it, so that is what it now does. The ring, the name and the phase are
// unchanged; the whole strip is simply a control as well as a label.

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

  return (
    <div className={'pj-wrap' + (open ? ' open' : '')}>
      <button
        className="pj-head"
        onClick={() => projectId && setOpen(!open)}
        disabled={!projectId}
        aria-expanded={open}
        title={projectId ? 'Everything this project has collected' : undefined}
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
          <span className="pj-open">
            {open ? 'Close' : 'Files and screenshots'} <i>{open ? '▴' : '▾'}</i>
          </span>
        )}
      </button>

      {open && projectId && <Files projectId={projectId} projectName={name} />}
    </div>
  );
}
