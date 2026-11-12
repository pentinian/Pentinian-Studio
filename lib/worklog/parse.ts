// A day's work log entry, read back into its parts.
//
// From October on, a worked day is ONE released entry whose eli5 is plain text in
// a fixed grammar, written by the day builder (p20-days.mjs, then p33-days.mjs):
//
//   Purpose: <one sentence>
//   8:30 AM to 10 PM. Artinian Gems 4.25 h, Caveman Gems 7.25 h. Office 5 h, remote 6.5 h.
//   8:30 AM to 12 PM: <title> [<REASON>] (<Company>, in parallel, office)
//     <why it was needed>
//     <what was done, one sentence>
//     • <item>
//   10:05 PM to 11:58 PM, not counted: <title> [<REASON>] (<Company>, outside 5 AM to 10 PM)
//
// The structure is recovered here, on render, so nothing stored is rewritten and no
// column is added. The rule is strict on purpose: a body with any line this cannot
// place returns no chunks, and every reader then shows the raw text exactly as it
// did before. Text is never dropped to make a parse succeed.
//
// Chunk hours are not written in the body; only the spans are. They are recomputed
// with the builder's own rule (build_worklog_v2.py, clusters()): chunks whose spans
// overlap form one block, the block's clock hours are counted once, and each chunk
// but the last takes a share in proportion to its own length, in quarter hours,
// with the last taking what is left. The result is checked against the body's own
// sentence ("Artinian Gems 4.25 h, Caveman Gems 7.25 h"); when the two disagree the
// per chunk hours are withheld (null) rather than shown wrong.

export type Job = 'artinian' | 'caveman' | 'both' | null;
export type Place = 'office' | 'remote' | null;

export type Chunk = {
  /** 24 hour "HH:MM", studio time. */
  start: string;
  end: string;
  title: string;
  job: Job;
  /** Null when the chunk crossed from one to the other ("office, then remote");
   *  placeLabel then says so in words, and switchAt says when. */
  place: Place;
  parallel: boolean;
  /** Sentence case ("Data integrity"), as reason.ts spells the fixed list. */
  reason: string | null;
  /** Charged hours (see the header). Null for work outside the counted window,
   *  and null when the day's own sentence does not agree with the recount. */
  hours: number | null;
  /** Every body line under the chunk, in order, trimmed, bullet marks removed. */
  lines: string[];

  /* Additions beyond the contract's shape; optional to read, always present. */
  /** The company as written ("Artinian Gems"). */
  company: string | null;
  /** The place words as written, capitalized ("Office", "Office, then remote"). */
  placeLabel: string | null;
  /** For a chunk that crossed from office to remote, the hour it did ("16:00"). */
  switchAt: string | null;
  /** False for "not counted" work that ran outside 5 AM to 10 PM. */
  counted: boolean;
  /** The plain sentences under the header (why it was needed, what was done). */
  notes: string[];
  /** The bullet lines. */
  items: string[];
  /** Office and remote share of `hours`, in quarter hours; null with hours. */
  office: number | null;
  remote: number | null;
};

export type DayTotals = {
  hours: number;
  jobs: { job: Job; label: string; hours: number }[];
  office: number | null;
  remote: number | null;
};

export type Day = {
  ran?: { start: string; end: string };
  purpose?: string;
  chunks: Chunk[];
  raw: string;
  /** The day's own sentence, when it has one. */
  totals?: DayTotals;
  /** True when the recounted chunk hours agree with the day's sentence. */
  hoursAgree?: boolean;
};

const T = String.raw`(\d{1,2}(?::\d{2})?\s?[AP]M)`;
const SUMMARY = new RegExp(`^${T} to ${T}\\. (.+)$`);
const HEAD = new RegExp(`^${T} to ${T}(, not counted)?: (.+)$`);
const TAIL = /^(.*?)(?:\s\[([^\]]+)\])?\s\(([^()]*)\)$/;

/** "8:30 AM" -> "08:30", "12 PM" -> "12:00", "12 AM" -> "00:00". */
export function to24(t: string): string {
  const m = /^(\d{1,2})(?::(\d{2}))?\s?([AP])M$/.exec(t.trim());
  if (!m) return t;
  let h = Number(m[1]) % 12;
  if (m[3] === 'P') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
}

/** "13:00" -> "1 PM", "08:30" -> "8:30 AM". The studio's own way of writing a time. */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
}

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Span length in hours; an end at or before the start is read as past midnight. */
function spanHours(start: string, end: string) {
  let d = minutesOf(end) - minutesOf(start);
  if (d <= 0) d += 24 * 60;
  return d / 60;
}

/** Quarter hours, rounded the way the builder rounds (Python's round: a tie goes to
 *  the even quarter). Math.round sends 24.5 up and turned October 25's 6 h into 6.25. */
const q4 = (h: number) => {
  const x = h * 4, f = Math.floor(x);
  const r = Math.abs(x - f - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(x);
  return r / 4;
};
const same = (a: number, b: number) => Math.abs(a - b) < 0.001;

export function jobOf(company: string | null | undefined): Job {
  if (!company) return null;
  const a = /artinian/i.test(company), c = /caveman/i.test(company);
  return a && c ? 'both' : a ? 'artinian' : c ? 'caveman' : null;
}

/** "DATA INTEGRITY" -> "Data integrity"; "FOUNDATION FOR THE SECOND WALK'S ..." alike. */
function sentenceCase(s: string) {
  const t = s.trim();
  if (!t) return t;
  if (t !== t.toUpperCase()) return t;
  const low = t.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
}

function placeOf(where: string): { place: Place; label: string | null; split: boolean } {
  const w = where.trim().toLowerCase();
  if (!w) return { place: null, label: null, split: false };
  const label = w.charAt(0).toUpperCase() + w.slice(1);
  if (w === 'office') return { place: 'office', label, split: false };
  if (w === 'remote' || w === 'home') return { place: 'remote', label, split: false };
  if (/^office,? then remote$/.test(w) || /^remote,? then office$/.test(w)) return { place: null, label, split: true };
  return { place: null, label, split: false };
}

/** Office hours on an office day run to 4 PM (the log's own note). */
const OFFICE_START = '08:00';
const OFFICE_END = '16:00';

function overlapHours(a0: string, a1: string, b0: string, b1: string) {
  const s = Math.max(minutesOf(a0), minutesOf(b0));
  const e = Math.min(minutesOf(a1), minutesOf(b1));
  return Math.max(0, e - s) / 60;
}

export function parseDay(body: string | null | undefined): Day {
  const raw = body ?? '';
  const fail: Day = { chunks: [], raw };
  if (!raw.trim()) return fail;

  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  let purpose: string | undefined;
  let ran: Day['ran'];
  let totals: DayTotals | undefined;
  const chunks: Chunk[] = [];
  let cur: Chunk | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const indented = /^\s/.test(line);
    const text = line.trim();

    if (indented) {
      // A body line belongs to the chunk above it; one with no chunk above it is
      // text this reader cannot place, so the whole body falls back.
      if (!cur) return fail;
      const bullet = /^[•·*-]\s+/.test(text);
      const clean = text.replace(/^[•·*-]\s+/, '');
      cur.lines.push(clean);
      (bullet ? cur.items : cur.notes).push(clean);
      continue;
    }

    if (!chunks.length && !purpose && text.startsWith('Purpose:')) {
      purpose = text.slice('Purpose:'.length).trim();
      continue;
    }

    const s = !chunks.length && !totals ? SUMMARY.exec(text) : null;
    if (s) {
      ran = { start: to24(s[1]), end: to24(s[2]) };
      const rest = s[3];
      const jobs: DayTotals['jobs'] = [];
      const coPart = rest.split(/\.\s+Office /)[0];
      for (const m of coPart.matchAll(/([A-Z][A-Za-z' ]*?) (\d+(?:\.\d+)?) h\b/g)) {
        jobs.push({ job: jobOf(m[1]), label: m[1].trim(), hours: Number(m[2]) });
      }
      const or = /Office (\d+(?:\.\d+)?) h, remote (\d+(?:\.\d+)?) h/.exec(rest);
      totals = {
        hours: jobs.reduce((n, j) => n + j.hours, 0),
        jobs,
        office: or ? Number(or[1]) : null,
        remote: or ? Number(or[2]) : null,
      };
      continue;
    }

    const h = HEAD.exec(text);
    if (h) {
      const tail = TAIL.exec(h[4]);
      let title = h[4], reason: string | null = null, company: string | null = null;
      let parallel = false, where = '';
      if (tail) {
        title = tail[1];
        reason = tail[2] ? sentenceCase(tail[2]) : null;
        const parts = tail[3].split(',').map((p) => p.trim()).filter(Boolean);
        company = parts.shift() ?? null;
        if (parts[0] === 'in parallel') { parallel = true; parts.shift(); }
        where = parts.join(', ');
      }
      const outside = !!h[3] || /^outside\b/i.test(where);
      const p = outside ? { place: null as Place, label: null, split: false } : placeOf(where);
      const start = to24(h[1]), end = to24(h[2]);
      cur = {
        start, end, title: title.trim(), job: jobOf(company), place: p.place, parallel, reason,
        hours: null, lines: [], company, placeLabel: p.label,
        switchAt: p.split && /^office/i.test(where)
          ? (minutesOf(OFFICE_END) > minutesOf(start) && minutesOf(OFFICE_END) < minutesOf(end) ? OFFICE_END : null)
          : null,
        counted: !outside, notes: [], items: [], office: null, remote: null,
      };
      chunks.push(cur);
      continue;
    }

    // An unindented line that is none of the above: not this grammar.
    return fail;
  }

  if (!chunks.length) return fail;

  /* Hours, by the builder's block rule. */
  const counted = chunks.filter((c) => c.counted);
  const order = counted
    .map((c, i) => ({ c, i }))
    .sort((a, b) => minutesOf(a.c.start) - minutesOf(b.c.start) || a.i - b.i)
    .map((x) => x.c);
  const blocks: { end: number; start: number; rows: Chunk[] }[] = [];
  for (const c of order) {
    const s0 = minutesOf(c.start);
    const e0 = s0 + spanHours(c.start, c.end) * 60;
    const last = blocks[blocks.length - 1];
    if (last && s0 < last.end) { last.rows.push(c); last.end = Math.max(last.end, e0); }
    else blocks.push({ start: s0, end: e0, rows: [c] });
  }
  for (const b of blocks) {
    const H = (b.end - b.start) / 60;
    if (b.rows.length === 1) { b.rows[0].hours = H; continue; }
    const tot = b.rows.reduce((n, r) => n + spanHours(r.start, r.end), 0);
    let left = H;
    b.rows.forEach((r, i) => {
      const share = i === b.rows.length - 1 ? left : q4((H * spanHours(r.start, r.end)) / tot);
      r.hours = share;
      left -= share;
    });
  }

  /* Office and remote inside each chunk's hours. */
  for (const c of counted) {
    const h = c.hours ?? 0;
    if (c.place === 'office') { c.office = h; c.remote = 0; }
    else if (c.place === 'remote') { c.office = 0; c.remote = h; }
    else if (c.placeLabel) {
      const span = spanHours(c.start, c.end);
      const oh = q4((h * overlapHours(c.start, c.end, OFFICE_START, OFFICE_END)) / span);
      c.office = Math.min(h, Math.max(0, oh));
      c.remote = h - c.office;
    }
  }
  // The day's sentence is the record for office time; a crossing chunk's split is
  // the one estimate here, so it absorbs any difference, in quarter hours.
  if (totals?.office != null) {
    const split = counted.filter((c) => c.place === null && c.office != null);
    let diff = totals.office - counted.reduce((n, c) => n + (c.office ?? 0), 0);
    for (const c of split) {
      if (same(diff, 0)) break;
      const h = c.hours ?? 0;
      const next = Math.min(h, Math.max(0, (c.office ?? 0) + diff));
      diff -= next - (c.office ?? 0);
      c.office = next;
      c.remote = h - next;
    }
  }

  let hoursAgree: boolean | undefined;
  if (totals?.jobs.length) {
    hoursAgree = totals.jobs.every((j) =>
      same(j.hours, counted.filter((c) => c.job === j.job).reduce((n, c) => n + (c.hours ?? 0), 0))
    );
    if (!hoursAgree) for (const c of counted) { c.hours = null; c.office = null; c.remote = null; }
  }

  return { ran, purpose, chunks, raw, totals, hoursAgree };
}

/** Hours charged to one job on this day, from the chunks (or the day's sentence
 *  when the chunks carry none). Null job means the whole day. */
export function hoursFor(day: Day, job: Job): number {
  const pick = day.chunks.filter((c) => c.counted && (job == null || c.job === job));
  if (pick.every((c) => c.hours != null)) return pick.reduce((n, c) => n + (c.hours ?? 0), 0);
  if (job == null) return day.totals?.hours ?? 0;
  return day.totals?.jobs.find((j) => j.job === job)?.hours ?? 0;
}

/** The jobs this day touched, in the order the day's sentence names them. */
export function jobsOf(day: Day): { job: Exclude<Job, null>; label: string }[] {
  const out: { job: Exclude<Job, null>; label: string }[] = [];
  const add = (job: Job, label: string | null) => {
    if (!job || !label || out.some((o) => o.job === job)) return;
    out.push({ job, label });
  };
  for (const j of day.totals?.jobs ?? []) add(j.job, j.label);
  for (const c of day.chunks) add(c.job, c.company);
  return out;
}

export type Switch = { at: string; to: 'office' | 'remote' };

/** Where the day changed place, in time order: a chunk that starts in a different
 *  place from the one before it, or a chunk that crossed from office to remote. */
export function switchovers(day: Day, chunks: Chunk[] = day.chunks): Switch[] {
  const out: Switch[] = [];
  let here: Place = null;
  const sorted = [...chunks].filter((c) => c.counted).sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  for (const c of sorted) {
    const first: Place = c.place ?? (c.placeLabel?.toLowerCase().startsWith('office') ? 'office'
      : c.placeLabel?.toLowerCase().startsWith('remote') ? 'remote' : null);
    if (first && here && first !== here) out.push({ at: c.start, to: first });
    if (first) here = first;
    if (c.place === null && c.placeLabel && /then remote/i.test(c.placeLabel)) {
      out.push({ at: c.switchAt ?? c.end, to: 'remote' });
      here = 'remote';
    } else if (c.place === null && c.placeLabel && /then office/i.test(c.placeLabel)) {
      out.push({ at: c.end, to: 'office' });
      here = 'office';
    }
  }
  // Two parallel chunks crossing at the same hour say the same thing once.
  return out.filter((s, i) => !out.slice(0, i).some((p) => p.at === s.at && p.to === s.to));
}

/** 11.5 -> "11.5 h", 4.25 -> "4.25 h". The log writes hours this way; so does this. */
export const hoursText = (h: number) => `${Math.round(h * 100) / 100} h`;
