'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Putting a file into the project's own folder.
//
// The path is <project_id>/<name>, which is the same rule the storage policy checks,
// so a client can only ever write into their own project. Nothing here grants that;
// the database does, and this only declines to offer what would be refused anyway.

export const isImage = (p: string) => /\.(png|jpe?g|webp|gif|svg)$/i.test(p);

export default function Attach({
  projectId,
  onDone,
  label = 'Attach',
  accept = 'image/*',
}: {
  projectId: string;
  onDone: (path: string) => void;
  label?: string;
  accept?: string;
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
    const path = `${projectId}/${new Date().toISOString().slice(0, 10)}-${Date.now()}-${safe}`;
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
