-- Pentinian app schema. Run this in the Supabase SQL editor.
-- Auth is handled by Supabase (auth.users). These tables hold the app's data.

-- One row per client login. Links a client to their Supabase auth user.
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  created_at timestamptz default now()
);

-- Projects (Caveman, Artinian, etc.). Each belongs to a client.
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  name text not null,
  phase text,
  status text default 'in_progress',
  progress int default 0,
  created_at timestamptz default now()
);

-- The Quarry: raw work-log entries pulled from Notion. Never shown to the client directly.
create table if not exists work_log_raw (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  notion_id text unique,
  logged_at timestamptz,
  body text,
  out_of_scope boolean default false,
  created_at timestamptz default now()
);

-- The Bench + Cadence: curated, sanitized entries approved for the client Window.
create table if not exists work_log_released (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  raw_id uuid references work_log_raw(id) on delete set null,
  title text not null,
  note text,
  release_at timestamptz,        -- when it becomes visible in the Window
  visible boolean default true,
  created_at timestamptz default now()
);

-- Working sessions (the hours shown in the Window), authored/approved in the Atelier.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  started_at timestamptz,
  minutes int default 0,
  label text,
  visible boolean default true
);

-- Questions flagged to the client, awaiting their approval before work continues.
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  raised_at timestamptz default now(),
  body text not null,
  status text default 'awaiting'  -- awaiting | approved | discuss
);

-- Site calibration. A single JSON row that governs the public site
-- (which project cards are public, order, availability text, and so on).
create table if not exists site_config (
  id int primary key default 1,
  config jsonb not null default '{}',
  updated_at timestamptz default now()
);
insert into site_config (id, config)
values (1, '{"open_for_work": true, "availability": "One slot, Q3", "public_projects": ["Artinian","Caveman","LimIcon","UnImpact","Studiolo"]}')
on conflict (id) do nothing;

-- Before production: enable Row Level Security on the client-visible tables and add policies
-- so a signed-in client can read only their own project's released entries, sessions, and
-- questions. The Atelier and the Notion sync run server-side with the service role key.
