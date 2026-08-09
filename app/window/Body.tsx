'use client';

import { useState } from 'react';
import StudioHeader from '../StudioHeader';
import ProjectHead from './ProjectHead';
import Log from './Log';

// The Window's shell, client side so the Contact button in the header can open the
// console onto Requests. That is the only reason this is not a server component: a
// button in one corner needs to reach a panel in another, and threading that through
// the URL would put a transient interface state into a link someone might bookmark.

type Project = {
  id: string; name: string; phase: string | null;
  progress: number | null; status: string | null;
};
type Face = 'files' | 'brand' | 'inspiration' | 'requests';

export default function Body({
  project,
  projects,
  isAdmin,
  email,
  name,
  fresh,
  effort,
}: {
  project: Project | null;
  projects: Project[];
  isAdmin: boolean;
  email: string | null;
  name: string | null;
  // True when this Window has never held released work: the first minute after an
  // invitation, not a quiet month. The greeting changes register accordingly.
  fresh?: boolean;
  /** Minutes released on this project, all time. */
  effort?: number;
}) {
  // Bumped rather than set, so pressing Contact twice reopens it after a close.
  const [openTo, setOpenTo] = useState<{ face: Face; n: number } | null>(null);

  return (
    <>
      <StudioHeader room="window" staff={isAdmin} email={email} name={name}>
        {isAdmin && projects.length > 1 ? (
          // Staff only. A client has one project and no choice to make, so they get
          // the plain label rather than a control that does nothing.
          <form className="switch" method="get">
            <label htmlFor="p">Viewing as</label>
            <select id="p" name="p" defaultValue={project?.id} className="proj-pick">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button type="submit" className="mini-btn">Open</button>
          </form>
        ) : (
          <span className="switch">
            Project: <b>{project?.name ?? 'Your project'}</b>
          </span>
        )}

        {project && (
          <button
            className="tb-contact"
            onClick={() => setOpenTo((o) => ({ face: 'requests', n: (o?.n ?? 0) + 1 }))}
            title="Ask for something, any time"
          >
            Get in touch
          </button>
        )}
      </StudioHeader>

      {/* The same weather the Foyer keeps, so the room a client is invited
          into is recognizably the same place they first walked past. */}
      <div className="sky" aria-hidden="true"><i className="k1" /><i className="k2" /></div>
      <div className="body">
        {fresh ? (
          <>
            {/* The first minute. They followed an invitation into a room with bare
                walls, and the room should say so before they wonder if something is
                broken. Received, not confronted with an empty calendar. */}
            <h2 className="hello">Welcome in.</h2>
            <p className="sub">
              This is your Window: the room where work on your project becomes
              visible. The walls are bare because we have not begun. From the first
              working session onward, everything I release lands below in plain
              language, hour by hour.
            </p>
            <p className="sub">
              <button
                className="linklike"
                onClick={() => setOpenTo((o) => ({ face: 'requests', n: (o?.n ?? 0) + 1 }))}
              >
                Start by telling me what brings you ↗
              </button>
            </p>
          </>
        ) : (
          <>
            <h2 className="hello">Welcome back.</h2>
            <p className="sub">Here is where things stand on your build.</p>
          </>
        )}

        <ProjectHead
          name={project?.name ?? 'Your project'}
          phase={project?.phase ?? null}
          progress={project?.progress ?? null}
          effort={effort ?? 0}
          status={project?.status ?? null}
          projectId={project?.id ?? null}
          staff={isAdmin}
          openTo={openTo?.face ?? null}
          openToken={openTo?.n ?? 0}
        />

        <div className="panel">
          <div className="ph">
            <h4>The work</h4>
            <span className="meta">Days work landed, and what each piece took</span>
          </div>
          <div style={{ padding: 16 }}>
            <Log projectId={project?.id ?? null} />
          </div>
        </div>
      </div>
    </>
  );
}
