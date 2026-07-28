---
name: pentinian-worklog
description: How a Cowork session works inside Pentinian. Log time in real blocks, capture screenshots safely into the project folder, write the ELI5 and the why, and update the Notion documentation for any code area you touched. Use at the start of every Pentinian working session, and whenever a piece of work lands. Trigger on pentinian worklog, start a work session, log this work, close out the session, update the docs.
---

# Working inside Pentinian

You are doing paid work that a client will read about. Two audiences, always:

- **Pen** needs the truth, in detail, so they can find what happened and why, months later.
- **The client** needs to understand what moved and why it mattered, in plain words, without
  seeing code, internal reasoning, or anything belonging to another client.

Everything below exists to serve both without mixing them up.

---

## 0. How to refer to Pen

Not a style preference. Get this right every time.

- **Inside a Cowork session**, talking with Pen: **she / her**.
- **In anything written down**: **they / them**. That means this file, every Notion entry,
  every doc, every commit message, every line of client-facing copy, every README, and
  anything that could ever be read outside the studio.
- **Never he / him**, anywhere, in any context.

When unsure whether something counts as written output, it does. Use they / them. The
safest habit is to write around the pronoun entirely: "Pen releases it in the Atelier"
rather than "Pen releases it once they have reviewed it".

---

## 1. Open the session

Before touching anything, note the wall-clock time and the project. A session is one
continuous block of attention. If you stop for more than about twenty minutes, close the
block and open a new one. Do not round hours up, and never log time you did not work.

Ask, or infer from the folder you are working in, which Pentinian project this is:
Artinian, Caveman, LimIcon, UnImpact, Studiolo, or Pentinian itself.

---

## 2. Capture as you go, not at the end

When a piece of work visibly lands, take a screenshot. A piece has landed when something
looks different, works that did not work before, or is now provably correct.

Save into `~/Studio/_shots/<project>/<YYYY-MM-DD>/` with a filename that says what it shows:

```
~/Studio/_shots/pentinian/2026-07-27/console-beats-snap-into-place.png
```

### What must never appear in a screenshot

This is the rule that matters most, because no database policy can undo a leaked image.
Before you save, look at the whole frame, not just the thing you are proud of.

- **No other client's data.** Not in a background tab, not in a sidebar, not in a file tree.
  If you are in Artinian's project, Caveman must not be on screen.
- **No secrets.** API keys, tokens, service-role keys, `.env` contents, connection strings,
  passwords, session cookies, or a Supabase dashboard with a key revealed.
- **No personal data** belonging to real people: customer emails, addresses, order records,
  anything from a production table with real humans in it.
- **No internal financials**, invoices, or rates belonging to anyone.

If the useful part of a shot sits next to something forbidden, crop it or retake it. Never
paint over a secret and call it redacted, because the pixels underneath can survive
compression. Retake the shot instead.

When in doubt, do not capture it. A missing screenshot costs almost nothing. A leaked one
costs a client relationship.

### Then push them

Screenshots have to be uploaded from this machine, because the sync runs serverless and
cannot read your disk. Once a block's shots are saved and you have looked at each one whole:

```
set -a; source .env.local; set +a
node scripts/push-shots.mjs "<project name>" ~/Studio/_shots/<project>/<date>
```

It prints the storage paths. Those go in **Shot paths**, not the local ones. Images land
under the project id, which is exactly what the storage policy checks, so a client can only
ever fetch their own.

---

## 3. Write the entry

At the end of each block, write one Work Log entry in Notion (Pentinian workspace, **Work
Log** database). Fill every field:

| Field | What goes in it | Who reads it |
| --- | --- | --- |
| **Entry** | A short, concrete title. "Console beats snap into place", not "UI work". | Both |
| **Start** / **End** | The real clock times of the block. | Both |
| **Hours** | Decimal hours, matching Start and End. | Both |
| **Project** | The relation to the project row. | Both |
| **Area** | Which part of their build this touched. "The client Window", "checkout". | Both |
| **Detail** | The full technical truth. What you changed, why, what you tried that failed, what is still fragile. Write this for a developer picking it up cold in six months. | **Pen only** |
| **ELI5** | What happened, in plain words, no jargon, two or three sentences. | **The client** |
| **Why** | Why it mattered and how it fits the larger build. One or two sentences. | **The client** |
| **Shot paths** | The **storage** paths printed by `push-shots`, not the local ones. | Pipeline |
| **Session** | A short id for the session, so several blocks can be grouped. | Pen |
| **Stage** | `🫘 Raw` when you write it. Pen moves it on. | Pen |
| **Client-visible** | Leave **unchecked**. Only Pen decides what a client sees. | Pen |

### Writing the ELI5 well

Assume an intelligent person who does not build software. No framework names, no file
paths, no function names, no "refactored" or "endpoint" or "schema".

- Bad: "Refactored the RLS policies and added a security_invoker view."
- Good: "Locked down the database so each client can only ever load their own project.
  Tested it by creating a second account and trying to reach yours, which it refused."

Say what is now true that was not true before. If a block was spent on something that
failed, say that plainly too. Clients trust a log that admits dead ends far more than one
where everything always worked.

### The line you must not cross

The ELI5 and Why are the only fields a client will read, but write as though they might see
any of it. Never put another client's name, another project's details, credentials, or
internal commercial information into any field.

---

## 4. Update the documentation you invalidated

**If you edited code, you own the doc for that code.** This is not optional and it is the
main reason the Documentation database exists.

1. Look in Notion → **Documentation** for a row whose **Paths** covers what you touched.
2. If one exists: bring it back to true. Update the body, set **Last verified** to today,
   set **Verified by** to the session id, and set **Status** to `Current`.
3. If none exists and you touched something a future developer would need explained,
   create the row. Fill Doc, Area, Project, Kind, Paths, and Summary.
4. If you found the doc already wrong, fix it and say so in your work log Detail. A doc
   that lies is worse than no doc, because it gets trusted.

A doc should answer: what this area is for, how it fits the rest, the decisions that are
load-bearing and must not be casually reversed, and what will bite someone who changes it.
Not a line-by-line description of the code, which the code already provides.

---

## 5. Close the block

Before moving on, confirm:

- [ ] Start and End are real times, and Hours agrees with them
- [ ] Detail would let a stranger pick this up cold
- [ ] ELI5 and Why contain no jargon, no code, no other client
- [ ] Every screenshot has been looked at whole, and holds no secrets or foreign data
- [ ] Shot paths recorded
- [ ] Documentation for any code you edited is now true
- [ ] Client-visible left unchecked

The sync moves entries into the Quarry, where they are staff-only. Nothing reaches a client
until Pen releases it in the Atelier, seeing exactly what the client will see before it goes.
Your job is to make that decision easy, not to make it for them.
