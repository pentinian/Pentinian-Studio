# What is left, in order

Written 28 July 2026. Everything below is either yours because it needs a credential
or a judgement, or mine because it is code. Each step says which, what it unblocks, and
how to tell it worked.

The order matters. Steps 1 and 2 unblock everything else.

---

## 1. Deploy. Yours, five minutes.

Nothing built today is live. The app is seven commits behind, the public site one.

```
cd ~/Downloads/Pentinian-Studio && git push deploy HEAD:main
cd ~/Downloads/pentinian-site  && git push deploy HEAD:main
```

App first. The public site's calibration script asks the app for its settings, and if
the app answers 404 the site quietly shows everything, which is the correct fallback
but not what you want to be looking at while checking your work.

**Worked when:** `pentinian-studio.vercel.app/api/site-config` returns JSON rather than
a 404, and the public site's page source contains `data-proj`.

---

## 2. Add the missing environment variables to Vercel. Yours, five minutes.

**This one is easy to miss and will look like a bug later.** `.env.local` is your
machine only. Vercel has the Supabase keys from the original setup, but the Notion
variables were added locally during this session and were never put there.

Without them the **Sync Notion** button in the Atelier fails in production, and it will
fail in a way that reads like the sync being broken rather than a missing setting.

Vercel, your project, Settings, Environment Variables. Add for Production:

| Variable | Where the value is |
|---|---|
| `NOTION_TOKEN` | already in your local `.env.local` |
| `NOTION_WORKLOG_DB` | already in your local `.env.local` |
| `NOTION_PROJECTS_DB` | already in your local `.env.local` |
| `NOTION_CLIENTS_DB` | already in your local `.env.local` |
| `CRON_SECRET` | already in your local `.env.local` |

Copy them across yourself. I do not handle keys.

Redeploy after adding them, since Vercel does not apply new variables to an existing
build.

**Worked when:** Sync Notion in the Atelier reports entries pulled instead of an error.

---

## 3. Turn on passkeys. Yours, three minutes.

This is what stops the email round trip that has been costing you time all day. The code
shipped in step 1; the project setting is separate and only you can set it.

Supabase, Authentication, Passkeys:

| Field | Value |
|---|---|
| Enable Passkey authentication | on |
| Relying Party Display Name | `Pentinian` |
| Relying Party ID | `pentinian-studio.vercel.app` |
| Relying Party Origins | `https://pentinian-studio.vercel.app` |

Then get in (step 4 if email is still rate limited), open **Atelier, Access, Add a
passkey**, and approve with Touch ID.

> A passkey is bound to the domain it was made on. When the app moves to its own
> address these stop working and you add one again there. Seconds, and it is the
> binding that makes a passkey unphishable, so it is the feature working rather than
> breaking.

**Worked when:** signing out and back in takes a fingerprint and no email.

---

## 4. If you are locked out, the escape hatch. Yours, one minute.

The built-in email sender allows two messages an hour for the whole project. If you hit
it again:

```
cd ~/Downloads/Pentinian-Studio
set -a; source .env.local; set +a
node scripts/sign-in-link.mjs epipenany@gmail.com
```

Nothing is sent, nothing is counted. The line it prints is a live credential: terminal
only, single use.

---

## 5. Walk the loop with real work in it. Yours, ten minutes. This is the good part.

Today's session is already logged and synced. The Quarry holds **eight entries, six of
them with real times and plain-language summaries**. Nothing has ever been released, so
your own Window is currently empty.

1. **Atelier, Curation.** Pick one of today's entries. Read the preview on the right,
   which renders with the same markup the client's Window uses, so it cannot drift from
   what they will actually see.
2. Edit the title or the plain-words summary if you want it to sound more like you.
3. Press **Release**.
4. Click **Window** in the top right to see it as a client would: the day appears on the
   month calendar, shaded by how long it was, and opening it shows the hours inside.
5. Write a reply on the entry from the Window, then go back to **Atelier, Replies** and
   confirm it is sitting there waiting. Answer it, and watch it appear back in the
   Window where you wrote it.

That is the entire loop, working, with true content in it for the first time.

One thing you will hit: the **Pentinian Website** entry refuses to release, because that
project is marked internal. That is the gate doing its job. Mark it client-facing from
the header toggle if you want it in your own Window.

**Worked when:** a day is shaded on your calendar and you have had a conversation with
yourself through it.

---

## 6. Replace the email sender. Yours, fifteen minutes. Do it before any client sees this.

Full runbook in `docs/email-setup.md`.

Two emails per hour is **project-wide, not per person**. Three clients signing in within
the same hour means the third is refused with nothing they can do about it. This is the
one thing standing between the Window and real clients, and it is not a nice-to-have.

Easier after step 7, since the domain verification and the DNS records happen in one
sitting.

While you are in there, add these two to `.env.local` **and Vercel**, which switches on
the reply notification I built dormant:

```
RESEND_API_KEY=...
STUDIO_NOTIFY_EMAIL=epipenany@gmail.com
```

**Worked when:** a sign-in link arrives from your own domain, and a second one a minute
later also arrives.

---

## 7. Buy the domain. Yours, Friday.

Then, in order:

1. Vercel, both projects, Settings, Domains: add `pentinian.com` to the public site and
   `app.pentinian.com` to the app.
2. Supabase, Authentication, URL Configuration: add `https://app.pentinian.com` to the
   redirect allow list.
3. Update `NEXT_PUBLIC_SITE_URL` to `https://app.pentinian.com` in Vercel.
4. Supabase, Authentication, Passkeys: change the Relying Party ID to `pentinian.com`
   and the origins to `https://app.pentinian.com`. **Every existing passkey stops
   working here.** Enrol again on the new domain.
5. Tell me, and I will flip the two hardcoded URLs on the public site. Both have comment
   markers on the line: the **Sign in** link in the nav, and `CONFIG_URL` in the
   calibration script.

---

## 8. Open a Window to a real client. Yours and mine, after 6.

Neither Artinian Gems nor Caveman Gems has a login, and both projects are internal, so
nothing can reach them yet. When you are ready for one of them to see their build:

1. Mark the project client-facing from the Atelier header.
2. `node scripts/invite-client.mjs` for that client.
3. Release two or three entries so their Window is not empty on the first visit.

Do not do this before step 6. Their first sign-in is an email, and on the built-in
sender it might simply not arrive.

---

## 9. Things I want to do next, when you have a moment

**The pixel pass on the Window.** I could not do it. The machine I run on is arm64 and
Chrome has no arm64 build, so there was no browser here to photograph it with. The
calendar, the day panel, and the reply threads are all new CSS that has been verified by
query and by markup but never actually looked at. Worth twenty minutes together once
step 1 is done.

**The three public-site widgets that predate the deep dive.** The LimIcon forge, the
UnImpact map, and the Pentinian window were built before I read the real project
histories. They are probably fine and they are probably not as true as the other
fifteen.

**Four intro paragraphs on the public site** were never checked against the case studies
that came after them.

**The optional map layer** for UnImpact: density, focus dimming, and a detail panel. Left
as optional in July and still optional.

**The questions and sessions tables** are unused. The Window used to render a panel
promising an approval flow that had no mechanism behind it, and I removed it today. Worth
deciding whether you want a question that genuinely halts a thread, or whether a reply on
an entry is enough. If the latter, the tables should go.

---

## One gotcha worth writing down

**Never pass an author on the git command line in these repos.** Both already have
`user.email` set to `308107907+pentinian@users.noreply.github.com`, which is the address
attached to the GitHub account. Vercel blocks any deployment whose commit author it
cannot match to that account, and the block reads as a broken deploy rather than a
rejected author: the push succeeds, GitHub is happy, and the site quietly keeps serving
yesterday.

This cost an hour on 28 July, twice, because two different guesses were substituted for
a setting that was already correct. Just run `git commit`.

If it happens again, the tell is a deployment marked **Blocked** rather than Failed, and
the fix is one empty commit with the right author at the tip of the push.

---

## The order, in one line

Deploy, then Vercel variables, then passkeys, then walk the loop. Email before any real
client. Domain Friday, and the passkey moves with it.
