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

## Access control (built; verified 2026-09-14)

All three items this section used to list as TODO are done. They are described here as
built, because a README that understates a security posture invites the next reader to
"fix" a gate that already exists.

- **Admin gate.** Shipped 2026-07-27 in `14b2aba`. `/window` needs a session; `/atelier`
  needs a session AND `app_metadata.role === 'admin'`. The role lives in `app_metadata`,
  not `user_metadata`, because a user can write their own `user_metadata` and would
  otherwise be able to promote themselves. Non-admins land on `/no-access`. This is
  defense in depth, not a single gate: every admin API route re-checks the role
  server-side, so bypassing the middleware does not grant anything. Grant admin with
  `scripts/grant-admin.mjs` (service key), invite a client with `scripts/invite-client.mjs`.
- **Row Level Security.** Applied to the live database, not just written in
  `supabase/rls.sql`. Verified 2026-09-14 by querying nine tables with the public anon
  key the way any visitor's browser can: `clients`, `projects`, `work_log_raw`,
  `work_log_released`, `sessions`, `questions`, `site_config`, `project_notes`, and
  `comments` each returned `401` / Postgres `42501`. Zero rows leaked. Note that
  `comments` has no policy in `rls.sql` and is protected by table grants instead, so it
  is covered by a different mechanism than the others. The Atelier and the Notion sync
  run server-side with the service role and bypass RLS by design.
- **Client-to-project mapping.** Done. `app/window/page.tsx` selects the signed-in
  person's projects and no longer uses `.limit(1)`. RLS filters the rows; the interface
  does not rely on the database to save it from itself.

**What is not proven:** the signed-in non-admin path has been read in the code but never
executed, because testing it means creating a second Supabase user and this is a
pre-first-client system. The code path is `/no-access`, that page renders, and every API
re-checks the role independently. Low risk, but it is inference, not measurement.

## How the calibration reaches the public site

The Atelier writes to the `site_config` row. To make the public site honor it, have the public
site read that row on load (a small fetch), or regenerate the static site when it's saved. Wiring
that is the natural next step.

## Stubbed for the next pass

- The question-approval buttons are gone rather than stubbed. They used to render above
  a write path that did not exist. A client now replies on any entry and raises a request
  from the header, both of which are real. The `questions` and `sessions` tables stay in
  the schema under RLS, unused, because dropping a table is not a decision to make in
  passing.
- Screenshot attachment works from the Window (`app/window/Attach.tsx` uploads to the
  `shots` bucket, `Files.tsx` and `Log.tsx` read it back through signed URLs). There is no
  upload control in the Atelier: `Curation.tsx` displays the count and the images but
  cannot add one. That is the real remaining gap, and it is narrower than "not writing back."
- There is no separate auto-release scheduler and none is needed. `release_at` is enforced
  at read time, by the RLS policy on `work_log_released` (`release_at is null or
  release_at <= now()`) and again in `app/api/mail/route.ts` before a digest goes out. An
  entry becomes visible when its time passes, with nothing having to run. The one cron
  (`/api/cron/sync`, daily at 14:00 UTC) pulls from Notion and deliberately never releases.

Point me at any of these and I'll build it out.
