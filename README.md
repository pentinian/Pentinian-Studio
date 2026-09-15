# Pentinian, app tier (Window + Atelier)

The private side of Pentinian: the client **Window** and your **Atelier**. A Next.js app on
Supabase, live at **studio.pentinian.com**, separate from the public site.

Note the hostname. This README said `app.pentinian.com` until 2026-09-15, and
`docs/whats-left.md` still describes moving there as a future step. Live is
`studio.pentinian.com`: `app.pentinian.com` returns 404, and the `.vercel.app` alias
307s to studio. Measured, not assumed.

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
(this is `studio.pentinian.com` today) under Settings, Domains. In Supabase, set the Auth
redirect URL to `https://studio.pentinian.com/auth/callback`.

## Checking it still works

**One command: `bash gate.sh`** (add `--fast` to skip the database checks). It runs the
author fence, `tsc`, a production build, all seven verifiers and two browser probes,
then confirms the verifiers left no test rows behind. 160 checks as of 2026-09-15.

Do not run the verifiers by hand unless you know about these two, which cost a session
each:

- `.env.local` ships `APP=` and `NEXT_PUBLIC_SITE_URL=` **empty**, and the scripts read
  them with `??`, which keeps an empty string. So sourcing the env file made the
  HTTP-level checks fail with `Failed to parse URL from /api/...` while running them
  without it worked. `gate.sh` sets both explicitly.
- `next build` overwrites `.next` underneath a running `next dev`, after which the dev
  server serves pages with no JavaScript and any browser probe fails for a reason
  unrelated to the code. `gate.sh` builds first and starts its own server after.

## Access control (built; verified 2026-09-14, extended 2026-09-15)

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
- **The signed-in non-admin path. Executed 2026-09-15, no longer inference.**
  `scripts/verify-nonadmin.mjs` creates a real non-admin user and measures what they
  reach: `/atelier` answers 307 to `/no-access` (not to `/login`, which would loop a
  person who holds a session), `/no-access` renders and never names what it hides,
  their own `/window` still opens, and **all 22 staff API endpoints refuse them 403 or
  401** when called directly with their cookie, which is the check the middleware
  cannot make for itself. It also tries the privilege climb: the user writes
  `user_metadata.role = 'admin'` on themselves, which Supabase permits, and it buys
  them nothing. A staff control runs alongside every refusal, so "everything 403s"
  cannot pass by way of a broken cookie. Both users are deleted afterwards and
  `scripts/leftovers.mjs` confirms it.

## How the calibration reaches the public site

The Atelier writes to the `site_config` row. To make the public site honor it, have the public
site read that row on load (a small fetch), or regenerate the static site when it's saved. Wiring
that is the natural next step.

## Stubbed for the next pass

Measured 2026-09-15 rather than carried forward. Three claims that were in this
section did not survive contact with the running app and are struck below, because a
README that invents missing work is as expensive as one that hides a security hole:
somebody rebuilds what already exists.

- ~~The hours tracker buttons do not write back.~~ **False.** The DayBoard writes
  through `/api/quarry`, and `scripts/verify-console.mjs` proves the round trip:
  "moving a block reaches the Quarry row", "and reaches the released row through
  raw_id", "so the client sees the new time, not the old one", "parking a piece clears
  the released row too". 59 checks, all passing.
- ~~There are no success or error messages on the forms.~~ **Mostly false, and one
  real defect underneath it.** `Attach.tsx`, `Console.tsx`, `Curation.tsx`,
  `DayBoard.tsx`, `ConsoleDesk.tsx`, `People.tsx`, `Passkeys.tsx`, `WantsIn.tsx`,
  `Studies.tsx` and `Correspondence.tsx` all carry a message channel. Two write paths
  did not, and both were the same bug: `if (!res.ok) return;` threw away an error the
  route had gone to the trouble of writing. Fixed, see below.
- ~~The Atelier tabs are non-functional.~~ **False.** All ten tabs mount a real
  component with a live read or write behind it. Seven go through an API route
  (`/api/quarry`, `/api/comments`, `/api/people`, `/api/access-request`, `/api/mail`,
  `/api/console`, `/api/brain/press`); Home, Studies and Passkeys talk to Supabase
  directly from the client instead, which is worth knowing before assuming a route
  exists for them.

Genuinely outstanding:

- ~~**No upload control in the Atelier.**~~ **Built 2026-09-15.** `Curation.tsx`
  now carries a Screenshots band: upload, thumbnails, and remove, beside the entry
  it belongs to. Proven end to end by `scripts/probe-atelier-upload.mjs`, which
  drives TWO clean browser contexts (staff and client, never one cookie jar) and
  checks 21 things, including that the client CANNOT reach the image while the
  work is unreleased and CAN the moment it is released. The probe was run against
  the unfixed code first and fails there, so it is a test rather than a decoration.

  A third README claim died proving it. This section used to say Curation
  "displays the screenshot count and the images." It displayed the count only:
  zero `<img>` tags, no `createSignedUrl` call, one sentence reading "N
  screenshot(s) attached" inside a panel whose entire job is showing what the
  client will see. Now it renders the pictures.

  How it works, because the shape is not obvious and it is a security posture
  rather than a preference. Measured 2026-09-15, not inferred:
  - An admin BROWSER JWT may write into the `shots` bucket, so the file goes
    straight from the machine to storage and no byte passes through a route.
  - That same JWT is refused `work_log_raw` outright (Postgres `42501`,
    permission denied for table). So the PATH is recorded through
    `/api/quarry`, which is also where the path is checked: a path naming
    another project's folder is refused, because a release would otherwise sign
    it for the wrong client.
  - The object lands at the project ROOT, not under `files/`. `shots-gate.sql`
    refuses a root object to the client until a released entry names it, so a
    work screenshot becomes visible when the work is passed and not before.
    `files/` is for what a client deliberately attached and is readable at once.
  - `app/window/Attach.tsx` moved to `app/Attach.tsx`, because it now serves both
    rooms and a second uploader beside it is how two copies of one path rule
    drift apart. `pretty()` moved with it for the same reason.
- The question-approval buttons are gone rather than stubbed. They used to render above
  a write path that did not exist. A client now replies on any entry and raises a
  request from the header, both of which are real. The `questions` and `sessions` tables
  stay in the schema under RLS, unused, because dropping a table is not a decision to
  make in passing.
- There is no separate auto-release scheduler and none is needed. `release_at` is
  enforced at read time, by the RLS policy on `work_log_released` (`release_at is null or
  release_at <= now()`) and again in `app/api/mail/route.ts` before a digest goes out. An
  entry becomes visible when its time passes, with nothing having to run. The one cron
  (`/api/cron/sync`, daily at 14:00 UTC) pulls from Notion and deliberately never releases.

## Fixed 2026-09-15: a failed message said nothing

Both sides of the conversation could fail silently. `app/window/Log.tsx` (the client
replying on an entry) and `app/atelier/Replies.tsx` (the studio answering) each ended
their send with `if (!res.ok) return;`, discarding a JSON error the route had written
in plain words.

The case that makes it matter is the one the middleware's own comments describe: a
session lapses under a page left open. The route answers 403, the page says nothing,
and the draft stays in the box. Nothing is lost, but nobody is told, so a client who
says something and hears nothing assumes it landed.

Measured before fixing, in a real browser: the page gained **zero characters** when the
POST failed. `scripts/probe-reply-failure.mjs` drives that case, and it was run against
the unfixed code to confirm it fails there and passes here, so it is a test rather than
a decoration. It also sends one message that succeeds, requiring the error to clear,
the box to empty and exactly one row to reach the database, so the probe cannot pass by
breaking the app.

## Corrected 2026-09-15: a verifier that demanded a security hole

`scripts/verify-privacy.mjs` asserted "own screenshot: signed" for a loose image at the
root of a client's own project folder. `supabase/shots-gate.sql` had since narrowed
exactly that: a root object is unreleased work and is refused, while anything under
`files/` is a deliberate attachment and is signed.

So the test failed against a correctly secured database and would have gone green again
only by reopening the hole. It now checks all three answers the gate actually gives
(root refused, `files/` signed, foreign project refused) and passes 17 of 17. Recorded
rather than quietly edited, because a test that disagrees with a migration is worth
knowing about.
