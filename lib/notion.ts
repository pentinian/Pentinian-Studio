// Reader for the Pentinian Work Log in Notion.
//
// Property names here must match the database exactly. As of 2026-07-27 they are:
//   Entry (title) · Detail · ELI5 · Why · Area · Start · End · Date · Hours
//   Project (relation) · Stage (select) · Client-visible (checkbox) · Release date
//   Shot paths (rich_text, storage paths written by scripts/push-shots.mjs)
//   Links (url or rich_text, whitespace separated, http(s) only)
//
// Detail is staff-only and lands in the Quarry. ELI5 and Why are the only fields
// ever shown to a client, and only after release in the Atelier.

const NOTION_VERSION = '2022-06-28';

export type NotionEntry = {
  notion_id: string;
  title: string;
  detail: string;
  eli5: string;
  why: string;
  area: string;
  started_at: string | null;
  ended_at: string | null;
  logged_at: string | null;
  minutes: number | null;
  hours: number | null;
  stage: string | null;
  client_visible: boolean;
  release_at: string | null;
  shots: string[];
  links: string[];
  project_page_id: string | null;
  out_of_scope: boolean;
};

const text = (rich: any[] | undefined) =>
  (rich ?? []).map((t: any) => t.plain_text).join('').trim();

async function notion(path: string, init?: RequestInit) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN is not set');
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Notion ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Every work-log entry, newest first. Pages through Notion's 100-row limit. */
export async function fetchWorkLog(): Promise<NotionEntry[]> {
  const db = process.env.NOTION_WORKLOG_DB;
  if (!process.env.NOTION_TOKEN || !db) return [];

  const out: NotionEntry[] = [];
  let cursor: string | undefined;

  do {
    const data = await notion(`databases/${db}/query`, {
      method: 'POST',
      body: JSON.stringify({
        page_size: 100,
        start_cursor: cursor,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      }),
    });

    for (const p of data.results ?? []) {
      const props = p.properties ?? {};
      const start = props.Start?.date?.start ?? null;
      const end = props.End?.date?.end ?? props.End?.date?.start ?? null;
      const hours = props.Hours?.number ?? null;

      // Prefer real clock times. Fall back to the Hours number so older rows still
      // carry a duration, and never invent a block that was not recorded.
      const minutes =
        start && end
          ? Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000))
          : hours != null
            ? Math.round(hours * 60)
            : null;

      out.push({
        notion_id: p.id,
        title: text(props.Entry?.title) || '(untitled)',
        detail: text(props.Detail?.rich_text),
        eli5: text(props.ELI5?.rich_text),
        why: text(props.Why?.rich_text),
        area: text(props.Area?.rich_text),
        started_at: start,
        ended_at: end,
        logged_at: start ?? props.Date?.date?.start ?? p.created_time ?? null,
        minutes,
        hours,
        stage: props.Stage?.select?.name ?? null,
        client_visible: props['Client-visible']?.checkbox ?? false,
        release_at: props['Release date']?.date?.start ?? null,
        // Storage paths, comma or newline separated, written by push-shots.
        shots: text(props['Shot paths']?.rich_text)
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        // Split on newlines and whitespace only, never commas: a URL may contain one.
        links: (props.Links?.url ? [props.Links.url] : [])
          .concat(text(props.Links?.rich_text).split(/\s+/))
          .map((s) => s.trim())
          .filter((s) => /^https?:\/\//.test(s)),
        project_page_id: props.Project?.relation?.[0]?.id ?? null,
        out_of_scope: props['Out of scope']?.checkbox ?? false,
      });
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return out;
}

// ------------------------------------------------------------------- the Console
//
// A second database, feeding the four faces on the project header. Property names must
// match exactly. As of 2026-07-29 they are:
//   Item (title) · Project (relation) · Face (select) · Facet (select)
//   Purpose · Swatch · Link (url) · Shot path · Order (number)
//
// There is deliberately no Stage here, unlike the Work Log. Two places that look like
// they release something, only one of which does, is how a control stops being
// trusted. Everything in this database arrives staged; the Atelier is the only gate.

export type NotionConsoleItem = {
  notion_id: string;
  notion_url: string | null;
  kind: 'brand' | 'inspiration' | 'request';
  facet: 'color' | 'type' | 'rule' | 'asset' | null;
  title: string;
  body: string;
  swatch: string | null;
  url: string | null;
  shot: string | null;
  sort: number;
  project_page_id: string | null;
};

const FACE: Record<string, NotionConsoleItem['kind']> = {
  brand: 'brand', inspiration: 'inspiration', request: 'request', requests: 'request',
};
const FACET: Record<string, NonNullable<NotionConsoleItem['facet']>> = {
  color: 'color', /* tolerate the British spelling on input */ colour: 'color', type: 'type', typeface: 'type',
  rule: 'rule', asset: 'asset',
};

/** A hex, normalised, or null. Anything that is not one is not a colour and is
 *  dropped rather than passed along to be rendered as a grey box. */
const hex = (s: string): string | null => {
  const v = s.trim().replace(/^#?/, '#').toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(v)) return v;
  if (/^#[0-9A-F]{3}$/.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join('');
  return null;
};

export async function fetchConsole(): Promise<NotionConsoleItem[]> {
  const db = process.env.NOTION_CONSOLE_DB;
  if (!process.env.NOTION_TOKEN || !db) return [];

  const out: NotionConsoleItem[] = [];
  let cursor: string | undefined;

  do {
    const data = await notion(`databases/${db}/query`, {
      method: 'POST',
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });

    for (const p of data.results ?? []) {
      const props = p.properties ?? {};
      const kind = FACE[(props.Face?.select?.name ?? '').trim().toLowerCase()];
      // A row with no Face has not been decided yet. Skipping it is right: guessing
      // would put a half-written thought on a client's brand board.
      if (!kind) continue;

      const facet = kind === 'brand'
        ? FACET[(props.Facet?.select?.name ?? '').trim().toLowerCase()] ?? 'rule'
        : null;

      out.push({
        notion_id: p.id,
        notion_url: p.url ?? null,
        kind,
        facet,
        title: text(props.Item?.title),
        body: text(props.Purpose?.rich_text),
        swatch: facet === 'color' ? hex(text(props.Swatch?.rich_text)) : null,
        url: (props.Link?.url ?? '').trim() || null,
        shot: text(props['Shot path']?.rich_text).split(/[\n,]+/)[0]?.trim() || null,
        sort: props.Order?.number ?? 0,
        project_page_id: props.Project?.relation?.[0]?.id ?? null,
      });
    }

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return out;
}

/** Title of a Notion page, used to match a project row by name. */
export async function fetchPageTitle(pageId: string): Promise<string | null> {
  try {
    const page = await notion(`pages/${pageId}`);
    for (const v of Object.values<any>(page.properties ?? {})) {
      if (v?.type === 'title') return text(v.title) || null;
    }
  } catch {
    // A page the integration cannot see should not fail the whole sync.
  }
  return null;
}
