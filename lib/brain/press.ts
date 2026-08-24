// The press. The one deliberate act.
//
// Everything in the brain arrives with a standing, and after arrival exactly
// one thing may change it: this. Ingestion cannot release; the folds mirror
// the old system's standing once, on arrival, and never touch it again. A
// release stamps released_at; a demotion clears it; the database constraint
// brain_released_has_stamp makes a half release impossible even here.
//
// Deliberate means singular: one entry, one movement, one person. There is
// no bulk press on purpose. Releasing fifty things is fifty decisions.

export type Standing = 'internal' | 'staged' | 'released';

const LADDER: Standing[] = ['internal', 'staged', 'released'];

export type PressResult = {
  id: string;
  title: string;
  from: Standing;
  to: Standing;
  released_at: string | null;
};

export async function pressEntry(db: any, id: string, to: Standing): Promise<PressResult> {
  if (!LADDER.includes(to)) throw new Error(`no such standing: ${to}`);

  const { data: entry, error } = await db
    .from('brain_entries')
    .select('id,title,visibility,released_at')
    .eq('id', id)
    .single();
  if (error || !entry) throw new Error('no such entry');

  const from: Standing = entry.visibility;
  if (from === to) {
    return { id: entry.id, title: entry.title, from, to, released_at: entry.released_at };
  }

  const released_at = to === 'released' ? new Date().toISOString() : null;
  const { error: upErr } = await db
    .from('brain_entries')
    .update({ visibility: to, released_at, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (upErr) throw new Error(`press failed: ${upErr.message}`);

  return { id: entry.id, title: entry.title, from, to, released_at };
}
