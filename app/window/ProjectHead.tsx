'use client';

import { useEffect, useState } from 'react';
import Console, { type Face } from './Console';

// The project header, with the console's tabs always on it.
//
// There was a pile-of-prints widget here that opened a shelf. It was nice to look at
// and it was in the way: one more thing to click before the tabs, which are the
// actual navigation. The tabs sit on the header now and each one toggles, so a second
// press closes what the first opened.

export default function ProjectHead({
  name,
  phase,
  progress,
  status,
  projectId,
  staff = false,
  openTo = null,
  openToken = 0,
}: {
  name: string;
  phase: string;
  progress: number;
  status: string | null;
  projectId: string | null;
  staff?: boolean;
  /** Set by Get in touch, which opens straight onto Requests rather than making
   *  someone find the face themselves. */
  openTo?: Face | null;
  /** Bumped each press, so it reopens after a close rather than doing nothing. */
  openToken?: number;
}) {
  const [face, setFace] = useState<Face | null>(null);

  useEffect(() => {
    if (!openTo || !openToken) return;
    setFace(openTo);
  }, [openTo, openToken]);

  return (
    <div className={'pj-wrap' + (face ? ' open' : '')}>
      <div className="pj-head">
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
      </div>

      {projectId && (
        <Console
          projectId={projectId}
          projectName={name}
          staff={staff}
          face={face}
          // Clicking the open tab closes it, which is the behaviour of a drawer
          // rather than a set of pages.
          setFace={(f) => setFace((cur) => (cur === f ? null : f))}
        />
      )}
    </div>
  );
}
