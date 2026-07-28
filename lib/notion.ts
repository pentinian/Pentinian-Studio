// Reader for the Pentinian Work Log in Notion.
//
// Property names here must match the database exactly. As of 2026-07-27 they are:
//   Entry (title) · Detail · ELI5 · Why · Area · Start · End · Date · Hours
//   Project (relation) · Stage (select) · Client-visible (checkbox) · Release date
//   Shot paths (rich_text, storage paths written by scripts/push-shots.mjs)
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
        project_page_id: props.Project?.relation?.[0]?.id ?? null,
        out_of_scope: props['Out of scope']?.checkbox ?? false,
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
