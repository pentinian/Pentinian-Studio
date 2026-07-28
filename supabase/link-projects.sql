-- Key projects and clients to their Notion pages, so the sync never depends on
-- two systems spelling a name the same way. Safe to run more than once.
alter table projects add column if not exists notion_page_id text;
alter table clients  add column if not exists notion_page_id text;

create unique index if not exists projects_notion_page_id_key
  on projects (notion_page_id) where notion_page_id is not null;
create unique index if not exists clients_notion_page_id_key
  on clients (notion_page_id) where notion_page_id is not null;

-- Whether a project is delivered to a client at all. Internal work (a plugin, the
-- studio's own site) still logs hours, but has no Window and no client to show it to.
alter table projects add column if not exists client_facing boolean default false;
