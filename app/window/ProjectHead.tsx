'use client';

import { useEffect, useState } from 'react';
import Console, { type Face } from './Console';

// The project header, with the console's tabs always on it.
//
// There was a pile-of-prints widget here that opened a shelf. It was nice to look at
// and it was in the way: one more thing to click before the tabs, which are the
// actual navigation. The tabs sit on the header now and each one toggles, so a second
// press closes what the first opened.

/** Effort as a client should read it: approximate, never to the minute. */
function hours(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m}m`;
  return m >= 30 ? `${h + 0.5}h` : `${h}h`;
}

export default function ProjectHead({
  name,
  phase,
  progress,
  effort,
  status,
  projectId,
  staff = false,
  openTo = null,
  openToken = 0,
}: {
  name: string;
  /** Null until someone says what stage this is at. */
  phase: string | null;
  /** Null until someone sets one. Not the same as zero. */
  progress: number | null;
  /** Minutes released, all time. The honest figure when there is no percentage. */
  effort: number;
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
        {/* A percentage is a claim about how much is left, and nobody has made that
            claim on most projects. Rather than invent one, the ring shows the hours
            actually released, which is a fact. A percentage that has been set wins:
            it is the more useful of the two, and it was said on purpose.

            Zero counts as unset. The column defaults to zero, so there is no null to
            distinguish, and a project sitting at zero percent with ten hours released
            is not a state anyone means to publish: it is a number nobody has touched. */}
        {typeof progress === 'number' && progress > 0 ? (
          <div className="ring" style={{ ['--p' as any]: progress }}>
            <b>{progress}%</b>
          </div>
        ) : (
          <div className={'ring ring-effort' + (effort > 0 ? '' : ' ring-none')} style={{ ['--p' as any]: 0 }}>
            {effort > 0 ? (
              <>
                <b>{hours(effort)}</b>
                <i>released</i>
              </>
            ) : (
              <i>not started</i>
            )}
          </div>
        )}
        <div className="pj-info">
          <h3>
            {name}
            <span className="pill">
              <span className="sdot" /> {status === 'on_track' ? 'On track' : 'In progress'}
            </span>
          </h3>
          <p className="phase">{phase ?? (effort > 0 ? 'Underway' : 'Getting started')}</p>
        </div>
      </div>

      {projectId && (
        <Console
          projectId={projectId}
          projectName={name}
          phase={phase}
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
