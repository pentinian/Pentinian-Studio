// The reason a piece of work was necessary, read at a glance.
//
// The client reads the log line by line and asks of each "did I need that?".
// Every released entry answers first: a reason from a fixed list, then one
// sentence on what would have gone wrong without the work, in the client's
// own nouns. The two ride together in work_log_released.why as
// "<reason>\n<sentence>" (the reason is a decision, the column was already
// there, and a second column was not worth a migration). This splits them.
export const REASONS = [
  'You asked for it',
  'A customer hit it',
  'Keeps the store selling',
  'Stops a wrong price, stone, or order',
  'Saves office hours',
  'Required by Google, Apple, or the law',
  'Had to happen before launch',
  'Caught before a customer saw it',
] as const;

export type Why = { reason: string | null; sentence: string | null };

export function splitWhy(why: string | null | undefined): Why {
  if (!why) return { reason: null, sentence: null };
  const nl = why.indexOf('\n');
  if (nl < 0) return { reason: null, sentence: why };
  const head = why.slice(0, nl).trim();
  const rest = why.slice(nl + 1).trim();
  const known = (REASONS as readonly string[]).includes(head) || head.startsWith('Groundwork for ');
  return known ? { reason: head, sentence: rest || null } : { reason: null, sentence: why };
}
