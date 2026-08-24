// The lane map, explicit and honest. A project name maps to at most one
// bundle slug; projects with no bundle render an empty brain state that says
// so rather than borrowing a parent's. Kept in code rather than a column
// because the map is a decision, not data: adding a lane should be a diff
// someone reviews, not a row someone forgets.
//
// limicon and unimpact bundles exist on disk but have no Atelier project;
// they are ignored here until Pen adds lanes.

export const LANES: Record<string, string> = {
  'Artinian Gems': 'artinian',
  'Caveman Rebrand': 'caveman',
  'Pentinian Website': 'pentinian',
  // Thin until this codebase's own record grows, and thin is honest.
  'Pentinian App': 'atelier',
  // Fixture data, marked as fixture by the bundle itself.
  'Rehearsal Client': 'rehearsal',
};

export function slugForProject(name: string | null | undefined): string | null {
  if (!name) return null;
  return LANES[name.trim()] ?? null;
}
