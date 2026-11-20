// The lane map, explicit and honest. A project name maps to at most one
// bundle slug; projects with no bundle render an empty brain state that says
// so rather than borrowing a parent's. Kept in code rather than a column
// because the map is a decision, not data: adding a lane should be a diff
// someone reviews, not a row someone forgets.
//
// limicon and unimpact bundles exist on disk but have no Atelier project;
// they are ignored here until Pen adds lanes.

// LimIcon and UnImpact are wired ahead of their projects: the day a studio
// project carries one of these exact names, its lane, canon, and seeded
// ratified palette all connect without a code change. A near miss name shows
// up in the sync report's lanesWithoutProject, loudly.
export const LANES: Record<string, string> = {
  // The two houses share one Window since 2026-10-29. Their own bundles keep
  // their own slugs (see FAMILY_LANES); this slug is for what the family
  // project itself produces from here on.
  'Artinian Gems and Caveman Gems': 'family',
  'Pentinian Website': 'pentinian',
  // Thin until this codebase's own record grows, and thin is honest.
  'Pentinian App': 'atelier',
  // Fixture data, marked as fixture by the bundle itself.
  'Rehearsal Client': 'rehearsal',
  // Wired ahead of arrival; see the note above.
  LimIcon: 'limicon',
  UnImpact: 'unimpact',
};

// Lanes a project also reads and receives: bundles that were cut before two
// projects became one. The Hekate bundles for artinian and caveman keep their
// slugs on disk; this says whose brain they fill now.
export const FAMILY_LANES: Record<string, string[]> = {
  'Artinian Gems and Caveman Gems': ['artinian', 'caveman'],
};

// Projects folded into another. The Notion work log still points its entries
// at the old project pages, and the sync must land them on the project that
// holds the record now, not drop them as unmatched. Keyed by the old project
// name (what Notion's page title says) and by the old page id (exact).
export const MERGED_INTO: Record<string, string> = {
  'Artinian Gems': 'Artinian Gems and Caveman Gems',
  'Artinian Inventory Sync': 'Artinian Gems and Caveman Gems',
  'Caveman Rebrand': 'Artinian Gems and Caveman Gems',
  '3b2fd641-0792-81d6-9cb8-e6224ecd2ec6': 'Artinian Gems and Caveman Gems',
  '3a7fd641-0792-81c4-b68e-c007618754c7': 'Artinian Gems and Caveman Gems',
  '3a7fd641-0792-811d-b95e-c89e67372dbd': 'Artinian Gems and Caveman Gems',
};

export function slugForProject(name: string | null | undefined): string | null {
  if (!name) return null;
  return LANES[name.trim()] ?? null;
}

/** Every slug whose entries belong on this project's brain: its own lane first, then the lanes it absorbed. */
export function lanesForProject(name: string | null | undefined): string[] {
  if (!name) return [];
  const own = LANES[name.trim()];
  return [...(own ? [own] : []), ...(FAMILY_LANES[name.trim()] ?? [])];
}

/** The project a bundle slug fills: the lane's own project, or the project that absorbed that lane. */
export function projectNameForSlug(slug: string): string | null {
  for (const [name, s] of Object.entries(LANES)) if (s === slug) return name;
  for (const [name, slugs] of Object.entries(FAMILY_LANES)) if (slugs.includes(slug)) return name;
  return null;
}
