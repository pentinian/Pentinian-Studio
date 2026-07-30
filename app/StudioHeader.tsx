'use client';

// One header for both rooms.
//
// The Window and the Atelier were built with their own top bars, and they read as two
// different products rather than two rooms in the same building. This is the single
// header both use: the wordmark always goes back to the public site, and the switcher
// only shows doors this person is actually entitled to open. A client sees no switcher
// at all, because for them there is only one room and a control that goes nowhere is
// worse than no control.

const FOYER = process.env.NEXT_PUBLIC_FOYER_URL || 'https://pentinian-site.vercel.app';

/** "Pen Artinian" gives PA. An address gives the first two letters, which is the
 *  fallback and looks like one, so a missing name is visible rather than disguised. */
function initialsFrom(name: string | null, email: string | null) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'P';
  }
  return (email ?? 'C').slice(0, 2).toUpperCase();
}

// Vercel sets this at build time when System Environment Variables are exposed, which
// they are on this project. Read once at module scope: it cannot change while the page
// is open, and if it is absent the stamp simply does not render.
const sha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? '';

export default function StudioHeader({
  room,
  staff,
  email,
  name = null,
  children,
}: {
  room: 'window' | 'atelier';
  staff: boolean;
  email: string | null;
  /** Display name. An address is an identifier, not a name, and a client reading
   *  their own Window should see a person there rather than a login. */
  name?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="topbar">
      <a className="brand" href={FOYER} title="Back to pentinian.com">
        <svg viewBox="0 0 32 32" fill="none">
          <g stroke="#7E9270" strokeWidth="1.5">
            <circle cx="16" cy="16" r="10" />
            <circle cx="16" cy="16" r="5.5" />
          </g>
          <circle cx="16" cy="16" r="1.8" fill="#B0805C" />
        </svg>
        Pentinian
      </a>

      {staff ? (
        <nav className="rooms" aria-label="Rooms">
          <a className={room === 'window' ? 'on' : ''} href="/window">
            Window
          </a>
          <a className={room === 'atelier' ? 'on' : ''} href="/atelier">
            Atelier
          </a>
        </nav>
      ) : (
        <span className="room-solo">Your project</span>
      )}

      {children}

      <span className="tb-right">
        {/* Which build you are actually looking at.
            Three separate exchanges were spent on "it looks the same", every one of
            them a browser holding a cached bundle or a deploy that had not finished.
            The question was unanswerable from inside the page, so the page answers it:
            hover for the full sha, and if it does not match what was just pushed, the
            thing on screen is not the thing that was built. */}
        {sha && (
          <a
            className="tb-build"
            href={`https://github.com/pentinian/Pentinian-Studio/commit/${sha}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Deployed build ${sha}. If this is not the commit you just pushed, reload with Cmd+Shift+R.`}
          >
            {sha.slice(0, 7)}
          </a>
        )}
        {/* The address stays as the tooltip, so which account you are in is one hover
            away rather than gone. */}
        <span className="tb-who" title={email ?? undefined}>
          {name || email}
        </span>
        <span className="ava">{initialsFrom(name, email)}</span>
        <form action="/auth/signout" method="post">
          <button className="signout" type="submit">
            Sign out
          </button>
        </form>
      </span>
    </div>
  );
}
