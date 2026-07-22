# Pentinian, app tier (Window + Atelier)

The private side of Pentinian: the client **Window** and your **Atelier**. A Next.js app on
Supabase, meant to live at app.pentinian.com, separate from the public site.

## What's here

- `app/window`: the client's curated view (released work log, working sessions, open questions).
- `app/atelier`: your admin. The curation queue (Quarry, Bench, Cadence) and the site-calibration
  panel that governs the public site (which cards are public, the availability signal).
- `app/login` + `app/auth/callback`: magic-link sign-in via Supabase.
- `app/api/notion-sync`: pulls the Notion work log into the Quarry.
- `supabase/schema.sql`: the database.

## Setup (about 15 minutes)

1. Install: `npm install`
2. Supabase: create a project at supabase.com. In the SQL editor, paste and run
   `supabase/schema.sql`. Under Authentication, keep Email enabled (magic link).
3. Copy `.env.example` to `.env.local` and fill it from Supabase (Settings, API): the project URL,
   the anon key, and the service role key.
4. Notion (optional, for the sync): create an integration, share your work-log database with it,
   set `NOTION_TOKEN` and `NOTION_WORKLOG_DB`, and adjust the property names in `lib/notion.ts` to
   match your database's columns.
5. Run: `npm run dev`, open http://localhost:3000, sign in with your email.

## Deploy

Import the repo to Vercel as a second project. Add every env var. Point a subdomain at it
(app.pentinian.com) under Settings, Domains. In Supabase, set the Auth redirect URL to
`https://app.pentinian.com/auth/callback`.

## Before real clients (important)

This is a working foundation. Three things to harden before it holds real client data:

- **Row Level Security.** Enable RLS on `clients`, `projects`, `work_log_released`, `sessions`, and
  `questions`, with policies so a signed-in client reads only their own project. The Atelier and
  the Notion sync run server-side with the service role and bypass RLS.
- **Admin gate.** Right now any signed-in user can reach `/atelier`. Gate it to your email (check
  `user.email` against an `ADMIN_EMAIL` env var in the middleware or the page).
- **Client-to-project mapping.** The Window loads the first project as a scaffold. Wire it to the
  signed-in user through the `clients` table (`clients.user_id` = the auth user) and filter by
  that client's project.

## How the calibration reaches the public site

The Atelier writes to the `site_config` row. To make the public site honor it, have the public
site read that row on load (a small fetch), or regenerate the static site when it's saved. Wiring
that is the natural next step.

## Stubbed for the next pass

- The hours tracker's before/after screenshots and the question-approval buttons are present in the
  UI but not yet writing back.
- Scheduled release times use `release_at`; the auto-release scheduler (a Vercel Cron hitting an
  endpoint on a cadence) is still a TODO.

Point me at any of these and I'll build it out.
