'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Putting a file into the project's own folder.
//
// The path is <project_id>/<something>, which is the same rule the storage policy
// checks, so a client can only ever write into their own project. Nothing here grants
// that; the database does, and this only declines to offer what would be refused
// anyway.
//
// WHY THIS LIVES AT app/ RATHER THAN app/window/. It used to be app/window/Attach.tsx,
// which was true while only the client uploaded anything. The Atelier now uploads too,
// and a second uploader beside this one is exactly the shape that drifts: two places
// that both decide a storage path, one of which eventually stops matching the policy.
// Moved here beside Kit.tsx and StudioHeader.tsx, which are the shared components.

export const isImage = (p: string) => /\.(png|jpe?g|webp|gif|svg)$/i.test(p);

/**
 * A storage filename, as something a person reads.
 *
 * Objects are named `<date>-<epoch>-<original>` so that two files called
 * screenshot.png from different weeks cannot collide. That is right for the
 * bucket and unreadable on screen: the raw name wraps to three lines of digits
 * and buries the only part that means anything.
 *
 * Lived in app/window/Files.tsx as a local const until 2026-09-15, when the
 * Atelier's own screenshot shelf needed the same treatment. Copying it would
 * have been the third place in this repo where one object gets two display
 * rules, so it moved here beside isImage instead.
 */
export const pretty = (n: string) =>
  n.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/^\d{10,}-/, '')
   .replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');

export default function Attach({
  projectId,
  onDone,
  label = 'Attach',
  accept = 'image/*',
  folder = 'files',
}: {
  projectId: string;
  onDone: (path: string) => void;
  label?: string;
  accept?: string;
  /**
   * Which segment the object lands under, and it is a MEANING rather than a
   * preference. supabase/shots-gate.sql reads exactly this:
   *
   *   'files'  a deliberate attachment. A client may read it immediately.
   *   null     the project root, which is work in progress. A client may read it
   *            ONLY once a released entry names it in its shots array.
   *
   * So the client always passes 'files' (they are attaching something on purpose)
   * and the Atelier passes null when attaching a work screenshot, which is the
   * same path scripts/push-shots.mjs writes from the command line. Choosing the
   * wrong one here does not create a hole, because the policy decides; it would
   * just show a client a screenshot earlier or later than intended.
   */
  folder?: 'files' | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function pick(file: File) {
    setBusy(true); setErr('');
    const supabase = createClient();
    // Prefixed with the date and stripped of anything awkward, so two files called
    // screenshot.png from different weeks do not collide.
    const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);
    const stamp = `${new Date().toISOString().slice(0, 10)}-${Date.now()}-${safe}`;
    const path = folder ? `${projectId}/${folder}/${stamp}` : `${projectId}/${stamp}`;
    const { error } = await supabase.storage.from('shots').upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDone(path);
  }

  return (
    <span className="at">
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }}
      />
      <button className="mini-btn" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? 'Uploading…' : label}
      </button>
      {err && <i className="at-err">{err}</i>}
    </span>
  );
}
