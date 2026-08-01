import { createClient } from '@supabase/supabase-js';

// Telling the studio a client said something.
//
// Deliberately a no-op until Resend is configured. The reply inbox in the Atelier is
// the source of truth and works on its own; this only shortens the time before
// someone looks at it. So a missing key, a bad key, or a Resend outage must never
// turn into a client being told their message did not send. It logs and moves on.
//
// See docs/email-setup.md. The same key that lifts the two-per-hour ceiling on
// sign-in links makes this work.

type Reply = {
  commentId: string;
  projectId: string;
  from: string;
  text: string;
};

/** STUDIO_NOTIFY_EMAIL may hold one address or a comma-separated few. */
const recipients = (to: string) => to.split(',').map((s) => s.trim()).filter(Boolean);

/** Escape anything that came from a person before it goes near HTML. */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function notifyOfReply(reply: Reply): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.STUDIO_NOTIFY_EMAIL;
  if (!key || !to) return; // not configured yet, and that is fine

  // The project name makes the subject readable at a glance. Read with the service
  // key because this runs after the response is already on its way to the client.
  let project = 'a project';
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    const { data } = await db.from('projects').select('name').eq('id', reply.projectId).single();
    if (data?.name) project = data.name;
  } catch {
    // a missing name is not worth losing the notification over
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const body = reply.text.length > 600 ? reply.text.slice(0, 600) + '…' : reply.text;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.STUDIO_NOTIFY_FROM ?? 'Pentinian <hello@pentinian.com>',
      to: recipients(to),
      // Replies go to the inbox, not to a mailbox, so the studio answers in one place
      // and the client sees it where they wrote it.
      subject: `${project}: a reply from ${reply.from}`,
      html: `
        <p style="font:400 15px/1.6 system-ui,sans-serif;color:#23251E">
          <b>${esc(reply.from)}</b> replied on <b>${esc(project)}</b>.
        </p>
        <blockquote style="font:400 15px/1.6 system-ui,sans-serif;color:#5B5C51;
          border-left:2px solid #7E9270;margin:0 0 18px;padding:2px 0 2px 14px">
          ${esc(body)}
        </blockquote>
        <p style="font:400 13px/1.6 system-ui,sans-serif;color:#8E8D7F">
          Answer it in the Atelier: <a href="${site}/atelier">${site}/atelier</a>
        </p>`,
    }),
  });

  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

// ------------------------------------------------------------ console notes
//
// A request, a brand suggestion or a rebrand ask. These landed silently before: the
// Atelier showed a waiting count, which only helps once you are already looking at it.
// Same no-op contract as above, so this is dark until Resend has a verified domain and
// then starts working with no further change.

type Note = {
  projectId: string;
  kind: 'brand' | 'inspiration' | 'request';
  from: string;
  title: string;
  body: string;
  /** True when the note points at an existing brand item, so the subject can say so. */
  about?: string | null;
};

export async function notifyOfNote(note: Note): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.STUDIO_NOTIFY_EMAIL;
  if (!key || !to) return;

  let project = 'a project';
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    const { data } = await db.from('projects').select('name').eq('id', note.projectId).single();
    if (data?.name) project = data.name;
  } catch {
    // a missing name is not worth losing the notification over
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const isRebrand = /^rebrand:/i.test(note.title);
  // The subject carries the weight of the thing. A rebrand ask and a spacing note are
  // not the same message and should not arrive looking the same.
  const what = isRebrand
    ? 'is asking about a rebrand'
    : note.kind === 'brand'
      ? `suggests a brand change${note.about ? ` to ${note.about}` : ''}`
      : note.kind === 'request'
        ? 'has a request'
        : 'pinned a reference';

  const text = [note.title, note.body].filter(Boolean).join('\n\n');
  const trimmed = text.length > 600 ? text.slice(0, 600) + '…' : text;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.STUDIO_NOTIFY_FROM ?? 'Pentinian <hello@pentinian.com>',
      to: recipients(to),
      subject: `${project}: ${esc(note.from)} ${what}`,
      html: `
        <p style="font:400 15px/1.6 system-ui,sans-serif;color:#23251E">
          <b>${esc(note.from)}</b> ${what} on <b>${esc(project)}</b>.
        </p>
        <blockquote style="font:400 15px/1.6 system-ui,sans-serif;color:#5B5C51;
          border-left:2px solid ${isRebrand ? '#B0805C' : '#7E9270'};margin:0 0 18px;padding:2px 0 2px 14px">
          ${esc(trimmed).replace(/\n/g, '<br>')}
        </blockquote>
        <p style="font:400 13px/1.6 system-ui,sans-serif;color:#8E8D7F">
          Nothing has changed on their side. It is waiting in the Atelier under Console:
          <a href="${site}/atelier">${site}/atelier</a>
        </p>`,
    }),
  });

  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

// ------------------------------------------------------------ the knock at the door
//
// Somebody at the login asked for access. This is the one notification that must not
// wait for a glance at the Atelier, because the person on the other end is a prospect
// standing at the door right now. Same no-op contract as everything above: if Resend
// is not configured, the Wants In panel still carries the ask and nothing is lost but
// speed.

type Knock = {
  email: string;
  name?: string | null;
  note?: string | null;
};

export async function notifyOfAccessRequest(knock: Knock): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.STUDIO_NOTIFY_EMAIL;
  if (!key || !to) return;

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const who = knock.name ? `${knock.name} (${knock.email})` : knock.email;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.STUDIO_NOTIFY_FROM ?? 'Pentinian <hello@pentinian.com>',
      to: recipients(to),
      subject: `Someone wants in: ${who}`,
      html: `
        <p style="font:400 15px/1.6 system-ui,sans-serif;color:#23251E">
          <b>${esc(who)}</b> asked for access to the studio.
        </p>
        ${knock.note ? `<blockquote style="font:400 15px/1.6 system-ui,sans-serif;color:#5B5C51;border-left:2px solid #7E9270;margin:0 0 18px;padding:2px 0 2px 14px">${esc(knock.note.slice(0, 600))}</blockquote>` : ''}
        <p style="font:400 13px/1.6 system-ui,sans-serif;color:#8E8D7F">
          Approve or decline under Access in the Atelier:
          <a href="${site}/atelier">${site}/atelier</a>
        </p>`,
    }),
  });

  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

// A declined ask gets one line back. Pen chose this over silence: a stranger who
// hears nothing checks their inbox for a week, and a stranger who hears a kind no
// is free to move on. This is the only email the studio ever sends to someone who
// is not a client, so it stays short, warm, and final without being cold.
//
// Returns whether it actually went out, so the Atelier can tell Pen the truth
// instead of implying a send that the missing Resend key quietly swallowed.

type Farewell = { email: string; name?: string | null };

export async function notifyOfDecline(farewell: Farewell): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const first = (farewell.name ?? '').trim().split(/\s+/)[0];
  const hello = first ? `Hello ${esc(first)}.` : 'Hello.';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.STUDIO_NOTIFY_FROM ?? 'Pentinian <hello@pentinian.com>',
      to: [farewell.email],
      subject: 'Pentinian: not right now',
      html: `
        <p style="font:400 15px/1.6 system-ui,sans-serif;color:#23251E">${hello}</p>
        <p style="font:400 15px/1.6 system-ui,sans-serif;color:#23251E">
          Thank you for knocking. Pentinian is a small studio on purpose, and right
          now I do not have room to take this on, so I am closing your request rather
          than leaving it open to wonder about.
        </p>
        <p style="font:400 15px/1.6 system-ui,sans-serif;color:#23251E">
          Nothing about your ask was wrong. If the timing changes, you are welcome to
          knock again.
        </p>
        <p style="font:400 15px/1.6 system-ui,sans-serif;color:#5B5C51">Pen</p>`,
    }),
  });

  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return true;
}
