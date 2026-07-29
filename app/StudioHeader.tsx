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
