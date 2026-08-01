import { createClient } from '@supabase/supabase-js';

// Recording that something happened, so the Atelier can say when it last worked.
//
// Deliberately swallows its own failures. This exists to make other failures visible,
// and a health recorder that can break the thing it is watching is worse than no
// recorder at all: a sync must never fail because its bookkeeping did.
//
// It also tolerates the table not existing yet, so the app runs normally before
// supabase/health.sql has been applied.

export type EventKind = 'sync' | 'cron' | 'notify' | 'release' | 'access';

export async function record(
  kind: EventKind,
  ok: boolean,
  detail?: string,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const db = createClient(url, key, { auth: { persistSession: false } });
    await db.from('system_events').insert({
      kind,
      ok,
      detail: detail ? detail.slice(0, 500) : null,
      meta: meta ?? null,
    });
  } catch {
    // Nothing here is worth propagating. See above.
  }
}
