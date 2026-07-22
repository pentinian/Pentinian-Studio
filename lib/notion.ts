// Minimal Notion work-log reader. Pulls pages from NOTION_WORKLOG_DB.
// Adjust the property names below to match your actual work-log database columns.

export type NotionEntry = {
  notion_id: string;
  logged_at: string | null;
  body: string;
  out_of_scope: boolean;
};

export async function fetchWorkLog(): Promise<NotionEntry[]> {
  const token = process.env.NOTION_TOKEN;
  const db = process.env.NOTION_WORKLOG_DB;
  if (!token || !db) return [];

  const res = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      page_size: 100,
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    }),
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`Notion query failed: ${res.status}`);
  const data = await res.json();

  return (data.results ?? []).map((p: any) => {
    const props = p.properties ?? {};
    const title =
      props.Name?.title?.[0]?.plain_text ?? props.Entry?.title?.[0]?.plain_text ?? '';
    const rich = props.Body?.rich_text ?? props.Log?.rich_text ?? [];
    const body = title || rich.map((t: any) => t.plain_text).join('') || '';
    return {
      notion_id: p.id as string,
      logged_at: (p.created_time as string) ?? null,
      body,
      out_of_scope: props['Out of scope']?.checkbox ?? false,
    };
  });
}
