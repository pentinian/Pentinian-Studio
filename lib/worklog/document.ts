// The work log as a document: a day, a week or a month of the Window, set for
// reading away from the screen (a PDF) and for adding up (a CSV).
//
// The shape is the one the weekly work log settled on over many corrections: a
// cover with the hourly worksheet (Date, Day, Start, Finish, one column per job,
// Total) and a signature line, then the log by day. Every figure comes from the
// rows the caller was allowed to read. Nothing here decides who may see what;
// the route reads through the caller's own session and hands over only what the
// database returned.
//
// Two numbers must agree and are checked rather than trusted: the worksheet's
// total is the sum of the Window's own day hours (the entries' minutes), and the
// CSV's rows sum to that same total. buildLog() throws when they do not, so a
// sheet that disagrees with itself is never served.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
// ------------------------------------------------------------------ parse -----
// Contract interface 1 is lib/worklog/parse.ts, written by the day view. Until it
// lands on this branch, a thin copy of its signature lives here so this file
// builds and can be proven; the import replaces it the day it arrives.
type Chunk = {
  start: string;
  end: string;
  title: string;
  job: 'artinian' | 'caveman' | 'both' | null;
  place: 'office' | 'remote' | null;
  parallel: boolean;
  reason: string | null;
  hours: number | null;
  lines: string[];
};
type Day = { ran?: { start: string; end: string }; purpose?: string; chunks: Chunk[]; raw: string };

const T = String.raw`(\d{1,2}(?::\d{2})?\s*[AP]M)`;
const CHUNK_RE = new RegExp(String.raw`^${T} to ${T}(, not counted)?: (.+?)(?: \[([^\]]+)\])?(?: \(([^)]*)\)?)?$`, 'i');
const RAN_RE = new RegExp(String.raw`^${T} to ${T}\.`, 'i');

function parseDay(body: string): Day {
  const raw = body ?? '';
  const day: Day = { chunks: [], raw };
  let cur: Chunk | null = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const indented = /^\s/.test(line);
    const l = line.trim();
    if (indented && cur) {
      cur.lines.push(l);
      continue;
    }
    if (/^Purpose:/i.test(l)) {
      day.purpose = l.replace(/^Purpose:\s*/i, '');
      continue;
    }
    const c = l.match(CHUNK_RE);
    if (c) {
      const tail = (c[6] ?? '').toLowerCase();
      cur = {
        start: to24(c[1]),
        end: to24(c[2]),
        title: c[4].trim(),
        job: /artinian/.test(tail) && /caveman/.test(tail) ? 'both' : /artinian/.test(tail) ? 'artinian' : /caveman/.test(tail) ? 'caveman' : null,
        place: /\boffice\b/.test(tail) ? 'office' : /\bremote\b|\bhome\b/.test(tail) ? 'remote' : null,
        parallel: /in parallel/.test(tail),
        reason: c[5] ? c[5].charAt(0) + c[5].slice(1).toLowerCase() : null,
        hours: c[3] ? 0 : null,
        lines: [],
      };
      day.chunks.push(cur);
      continue;
    }
    const r = l.match(RAN_RE);
    if (r && !day.ran) {
      day.ran = { start: to24(r[1]), end: to24(r[2]) };
      continue;
    }
    cur = null;
  }
  return day;
}

export const STUDIO_TZ = 'America/Los_Angeles';

/** The columns the route reads from work_log_released. */
export type LogEntry = {
  id: string;
  title: string | null;
  eli5: string | null;
  why: string | null;
  started_at: string | null;
  ended_at: string | null;
  minutes: number | null;
  /** True when the reader is staff and this entry is not yet shown to the client. */
  held?: boolean;
};

type Job = 'artinian' | 'caveman';
const JOBS: Job[] = ['artinian', 'caveman'];
const JOB_NAME: Record<Job | 'both', string> = {
  artinian: 'Artinian Gems',
  caveman: 'Caveman Gems',
  both: 'Both',
};
const JOB_COL: Record<Job, string> = { artinian: 'Artinian', caveman: 'Caveman' };

export type LogRow = {
  date: string; // YYYY-MM-DD
  start: string; // HH:MM, 24 hour
  end: string;
  job: string;
  place: string;
  title: string;
  /** Hours charged to this row, two decimals at most. */
  hours: number;
};

/** One entry inside a day, already parsed. */
type Piece = {
  entry: LogEntry;
  day: Day;
  /** Minutes per job from the day line ("Artinian Gems 4.25 h, Caveman Gems 7.25 h"). */
  split: Partial<Record<Job, number>> | null;
  /** The day line itself, quiet under the purpose. */
  spanLine: string | null;
  counted: { chunk: Chunk; minutes: number }[];
  uncounted: Chunk[];
};

export type LogDay = {
  date: string;
  weekday: string;
  start: string | null; // display, "8:30 AM"
  finish: string | null;
  minutes: number;
  jobs: Partial<Record<Job, number>>;
  held: boolean;
  purpose: string | null;
  pieces: Piece[];
};

export type LogModel = {
  project: string;
  from: string;
  to: string;
  staff: boolean;
  days: LogDay[];
  jobs: Job[];
  totalMinutes: number;
  rows: LogRow[];
};

// ------------------------------------------------------------------ dates -----

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: STUDIO_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: STUDIO_TZ, hour: 'numeric', minute: '2-digit', hour12: true });

/** The studio day an instant belongs to. */
export const dayKey = (iso: string) => keyFmt.format(new Date(iso));

const parts = (key: string) => key.split('-').map(Number) as [number, number, number];
const weekdayOf = (key: string) => {
  const [y, m, d] = parts(key);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

/** "8:30 AM", and "8 AM" on the hour, which is how the log itself writes time. */
function clockOf(iso: string): string {
  return clockFmt.format(new Date(iso)).replace(':00 ', ' ');
}

/** "08:30" -> "8:30 AM" */
function clock24(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
}

/** "8:30 AM" -> "08:30" */
function to24(display: string): string {
  const m = display.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AP])M$/i);
  if (!m) return '';
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'P') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
}

const minutesOf = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

/** "November 5 to 11, 2026", "October 29 to November 4, 2026", "November 2026". */
export function periodTitle(from: string, to: string): string {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  const lastOfMonth = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  if (from === to) return `${weekdayOf(from)}, ${MONTHS[fm - 1]} ${fd}, ${fy}`;
  if (fy === ty && fm === tm && fd === 1 && td === lastOfMonth) return `${MONTHS[fm - 1]} ${fy}`;
  if (fy === ty && fm === tm) return `${MONTHS[fm - 1]} ${fd} to ${td}, ${fy}`;
  if (fy === ty) return `${MONTHS[fm - 1]} ${fd} to ${MONTHS[tm - 1]} ${td}, ${fy}`;
  return `${MONTHS[fm - 1]} ${fd}, ${fy} to ${MONTHS[tm - 1]} ${td}, ${ty}`;
}

/** Hours for print: 11.5, 6, 0.75. Never a trailing zero, never more than two places. */
export const hrs = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);

// ------------------------------------------------------------- the words -----

/**
 * What the PDF's standard fonts can draw, and the house rules for what may be
 * printed at all. The fonts carry WinAnsi only, so anything outside it is
 * replaced or dropped rather than allowed to throw mid document. Dashes of the
 * long kinds never reach the page: between figures they read as "to", elsewhere
 * as a comma.
 */
export function clean(s: string): string {
  return s
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1 to $2')
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/[\u2192\u21d2]/g, ' to ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u00a0\u2009\u202f]/g, ' ')
    .replace(/[^\x20-\x7e\u00a1-\u00ff\u2022]/g, '')
    .replace(/ {2,}/g, ' ');
}

const SPLIT_RE = /^(\d{1,2}(?::\d{2})?\s*[AP]M) to (\d{1,2}(?::\d{2})?\s*[AP]M)\.\s+(.*)$/i;

/** The day line: "8:30 AM to 10 PM. Artinian Gems 4.25 h, Caveman Gems 7.25 h. Office 5 h, remote 6.5 h." */
function readSplit(raw: string): { line: string; split: Partial<Record<Job, number>> | null } | null {
  for (const l of raw.split('\n')) {
    const m = l.trim().match(SPLIT_RE);
    if (!m) continue;
    const split: Partial<Record<Job, number>> = {};
    for (const j of JOBS) {
      const h = m[3].match(new RegExp(`${JOB_NAME[j]}\\s+([\\d.]+)\\s*h`, 'i'));
      if (h) split[j] = Math.round(Number(h[1]) * 60);
    }
    return { line: l.trim(), split: Object.keys(split).length ? split : null };
  }
  return null;
}

/** A chunk the log lists under its day but does not count ("10:05 PM to 11:58 PM, not counted: ..."). */
function isUncounted(day: Day, c: Chunk): boolean {
  if (c.hours === 0) return true;
  return day.raw
    .split('\n')
    .some((l) => /not counted/i.test(l) && l.includes(c.title) && to24(l.split(' to ')[0] ?? '') === c.start);
}

/**
 * Minutes divided among weighted rows, in whole units (a quarter hour when the
 * pool is made of them), largest remainder first, so the parts always sum to the
 * pool exactly.
 */
function apportion(pool: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const unit = pool % 15 === 0 ? 15 : 1;
  const units = Math.round(pool / unit);
  const w = weights.map((x) => (x > 0 ? x : 1));
  const sum = w.reduce((a, b) => a + b, 0);
  const exact = w.map((x) => (x / sum) * units);
  const out = exact.map(Math.floor);
  let left = units - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out.map((u) => u * unit);
}

const span = (c: Chunk) => {
  const d = minutesOf(c.end) - minutesOf(c.start);
  return d > 0 ? d : d + 24 * 60;
};

function readPiece(entry: LogEntry): Piece {
  const body = entry.eli5 ?? '';
  const day = parseDay(body);
  const s = readSplit(body);
  const minutes = entry.minutes ?? 0;
  const live = day.chunks.filter((c) => !isUncounted(day, c));
  const uncounted = day.chunks.filter((c) => isUncounted(day, c));

  // The day's minutes are the Window's figure. The day line splits them by job;
  // when that split adds up, each job's minutes go to that job's chunks by the
  // time each ran. When it does not (or a job has minutes and no chunk), the day
  // is one pool across every chunk. Either way the parts sum to the day.
  let counted: Piece['counted'] = [];
  const split = s?.split ?? null;
  const splitSum = split ? Object.values(split).reduce((a, b) => a + (b ?? 0), 0) : -1;
  const byJob =
    split &&
    splitSum === minutes &&
    JOBS.every((j) => !split[j] || live.some((c) => c.job === j || c.job === 'both'));
  if (live.length && byJob) {
    const alloc = new Map<Chunk, number>();
    for (const j of JOBS) {
      const mine = live.filter((c) => c.job === j);
      if (!split![j]) continue;
      const pool = mine.length ? mine : live.filter((c) => c.job === 'both');
      apportion(split![j]!, pool.map(span)).forEach((m, i) => alloc.set(pool[i], (alloc.get(pool[i]) ?? 0) + m));
    }
    counted = live.map((chunk) => ({ chunk, minutes: alloc.get(chunk) ?? 0 }));
  } else if (live.length) {
    counted = apportion(minutes, live.map(span)).map((m, i) => ({ chunk: live[i], minutes: m }));
  }

  return { entry, day, split: byJob ? split : null, spanLine: s?.line ?? null, counted, uncounted };
}

// --------------------------------------------------------------- the model -----

export function buildLog(opts: {
  project: string;
  from: string;
  to: string;
  staff: boolean;
  entries: LogEntry[];
}): LogModel {
  const byDay = new Map<string, LogEntry[]>();
  for (const e of [...opts.entries].sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''))) {
    if (!e.started_at) continue;
    const k = dayKey(e.started_at);
    if (k < opts.from || k > opts.to) continue;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(e);
  }

  const days: LogDay[] = [];
  const rows: LogRow[] = [];
  const seenJobs = new Set<Job>();

  for (const date of [...byDay.keys()].sort()) {
    const es = byDay.get(date)!;
    const pieces = es.map(readPiece);
    const minutes = es.reduce((n, e) => n + (e.minutes ?? 0), 0);

    const jobs: Partial<Record<Job, number>> = {};
    for (const p of pieces) {
      if (p.split) {
        for (const j of JOBS) if (p.split[j]) jobs[j] = (jobs[j] ?? 0) + p.split[j]!;
      } else {
        for (const { chunk, minutes: m } of p.counted)
          if (chunk.job === 'artinian' || chunk.job === 'caveman') jobs[chunk.job] = (jobs[chunk.job] ?? 0) + m;
      }
    }
    for (const j of JOBS) if (jobs[j]) seenJobs.add(j);

    // Start and finish as the log itself states them; the entry's own clock when
    // the text carries no span.
    const ran = pieces.map((p) => p.day.ran).filter(Boolean) as { start: string; end: string }[];
    const firstIso = es[0].started_at!;
    const lastEnd = es.map((e) => e.ended_at).filter(Boolean).sort().pop() ?? null;
    const start = ran.length ? clock24(ran.map((r) => r.start).sort()[0]) : clockOf(firstIso);
    const finish = ran.length ? clock24(ran.map((r) => r.end).sort().pop()!) : lastEnd ? clockOf(lastEnd) : null;

    days.push({
      date,
      weekday: weekdayOf(date),
      start,
      finish,
      minutes,
      jobs,
      held: opts.staff && es.some((e) => e.held),
      purpose: pieces.map((p) => p.day.purpose).find(Boolean) ?? null,
      pieces,
    });

    for (const p of pieces) {
      if (p.counted.length) {
        for (const { chunk, minutes: m } of p.counted) {
          rows.push({
            date,
            start: chunk.start,
            end: chunk.end,
            job: chunk.job ? JOB_NAME[chunk.job] : '',
            place: chunk.place ?? '',
            title: clean(chunk.title),
            hours: Number(hrs(m)),
          });
        }
      } else {
        // A day that does not parse is one row: its own clock, its own title.
        const e = p.entry;
        rows.push({
          date,
          start: e.started_at ? to24(clockOf(e.started_at)) : '',
          end: e.ended_at ? to24(clockOf(e.ended_at)) : '',
          job: '',
          place: '',
          title: clean(e.title ?? 'Work'),
          hours: Number(hrs(e.minutes ?? 0)),
        });
      }
      for (const c of p.uncounted) {
        rows.push({
          date,
          start: c.start,
          end: c.end,
          job: c.job ? JOB_NAME[c.job] : '',
          place: 'not counted',
          title: clean(c.title),
          hours: 0,
        });
      }
    }
  }

  const totalMinutes = days.reduce((n, d) => n + d.minutes, 0);
  const model: LogModel = {
    project: opts.project,
    from: opts.from,
    to: opts.to,
    staff: opts.staff,
    days,
    jobs: JOBS.filter((j) => seenJobs.has(j)),
    totalMinutes,
    rows,
  };

  // The sheet must agree with itself before anyone reads it.
  const rowSum = Math.round(rows.reduce((n, r) => n + r.hours * 60, 0));
  if (rowSum !== totalMinutes) {
    throw new Error(`work log rows sum to ${rowSum} minutes, the days to ${totalMinutes}`);
  }
  return model;
}

// --------------------------------------------------------------------- CSV -----

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per chunk. Staff copies carry a held column; a client's never does. */
export function toCsv(m: LogModel): string {
  const held = new Set(m.days.filter((d) => d.held).map((d) => d.date));
  const head = ['date', 'start', 'end', 'job', 'place', 'title', 'hours', ...(m.staff ? ['held'] : [])];
  const lines = [head.join(',')];
  for (const r of m.rows) {
    const vals: (string | number)[] = [r.date, r.start, r.end, r.job, r.place, r.title, r.hours];
    if (m.staff) vals.push(held.has(r.date) ? 'held' : '');
    lines.push(vals.map(cell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// --------------------------------------------------------------------- PDF -----

// The Window's own ink, set on white so it prints.
const INK = rgb(0x23 / 255, 0x25 / 255, 0x1e / 255);
const INK2 = rgb(0x5b / 255, 0x5c / 255, 0x51 / 255);
const INK3 = rgb(0x8e / 255, 0x8d / 255, 0x7f / 255);
const SAGE = rgb(0x5e / 255, 0x73 / 255, 0x55 / 255);
const CLAY = rgb(0x8c / 255, 0x5e / 255, 0x3e / 255);
const LINE = rgb(0.86, 0.85, 0.82);
const LINE2 = rgb(0.74, 0.73, 0.69);

const W = 612;
const H = 792;
const M = 60; // margin
const BOTTOM = 64;

type Fonts = { serif: PDFFont; sans: PDFFont; bold: PDFFont; italic: PDFFont };

class Pen {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  doc: PDFDocument;
  f: Fonts;
  constructor(doc: PDFDocument, f: Fonts) {
    this.doc = doc;
    this.f = f;
    this.add();
  }
  add() {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    this.y = H - M;
  }
  /** Room for h points, or a new page. */
  need(h: number) {
    if (this.y - h < BOTTOM) this.add();
  }
  text(s: string, x: number, size: number, font: PDFFont, color = INK, y = this.y) {
    this.page.drawText(s, { x, y, size, font, color });
  }
  right(s: string, xr: number, size: number, font: PDFFont, color = INK, y = this.y) {
    this.page.drawText(s, { x: xr - font.widthOfTextAtSize(s, size), y, size, font, color });
  }
  rule(x1: number, x2: number, color = LINE, t = 0.6, y = this.y) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: t, color });
  }
  wrap(s: string, width: number, size: number, font: PDFFont): string[] {
    const out: string[] = [];
    for (const para of s.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
        else {
          out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  }
  /** Wrapped paragraph from the current y downward; returns nothing, moves y. */
  para(s: string, x: number, width: number, size: number, font: PDFFont, color = INK, lead = 1.45) {
    for (const l of this.wrap(s, width, size, font)) {
      this.need(size * lead);
      this.y -= size * lead;
      this.text(l, x, size, font, color);
    }
  }
}

/** A reason, set small and spaced in sage with a hairline box, the Window's tag. */
function chip(p: Pen, s: string, x: number, y: number) {
  const size = 6.6;
  const t = s.toUpperCase();
  const tracking = 0.7;
  const w = p.f.bold.widthOfTextAtSize(t, size) + tracking * (t.length - 1);
  p.page.drawRectangle({ x, y: y - 3, width: w + 9, height: size + 6, borderColor: rgb(0.69, 0.75, 0.63), borderWidth: 0.6, color: rgb(0.96, 0.97, 0.95) });
  let cx = x + 4.5;
  for (const ch of t) {
    p.page.drawText(ch, { x: cx, y, size, font: p.f.bold, color: SAGE });
    cx += p.f.bold.widthOfTextAtSize(ch, size) + tracking;
  }
}

function placeLine(c: Chunk): string {
  const bits = [c.job ? JOB_NAME[c.job] : null, c.place, c.parallel ? 'in parallel' : null].filter(Boolean);
  return bits.join(', ');
}

export async function toPdf(m: LogModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const title = `Work log, ${periodTitle(m.from, m.to)}`;
  doc.setTitle(title);
  doc.setAuthor('Pentinian');
  doc.setSubject(m.project);
  doc.setCreator('Pentinian Window');
  doc.setProducer('Pentinian Window');

  const f: Fonts = {
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    sans: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const p = new Pen(doc, f);
  const R = W - M;
  const textW = R - M;

  // ------------------------------------------------------------- the cover
  p.y -= 8;
  let ex = M;
  for (const ch of 'PENTINIAN') {
    p.text(ch, ex, 7.5, f.bold, SAGE);
    ex += f.bold.widthOfTextAtSize(ch, 7.5) + 2.2;
  }
  p.y -= 34;
  p.text(clean(title), M, 25, f.serif, INK);
  p.y -= 20;
  p.text(clean(m.project), M, 10.5, f.sans, INK2);
  p.y -= 6;
  p.para(
    'Development work only, as recorded in the Window. It does not account for meetings or other tasks, unless noted.',
    M, textW, 9, f.sans, INK3,
  );
  if (m.staff && m.days.some((d) => d.held)) {
    p.para('Days marked held are not yet shown to the client. Their copy leaves them out.', M, textW, 9, f.sans, CLAY);
  }

  p.y -= 30;
  p.text('Hourly worksheet', M, 14, f.serif, INK);
  p.y -= 22;

  // Columns: Date, Day, Start, Finish, one per job, Total. Figures right aligned.
  const jobs = m.jobs;
  const cols: { label: string; x: number; align: 'l' | 'r' }[] = [
    { label: 'Date', x: M, align: 'l' },
    { label: 'Day', x: M + 62, align: 'l' },
    { label: 'Start', x: M + 112, align: 'l' },
    { label: 'Finish', x: M + 182, align: 'l' },
  ];
  const figL = M + 270;
  const figStep = (R - figL) / (jobs.length + 1);
  jobs.forEach((j, i) => cols.push({ label: JOB_COL[j], x: figL + figStep * (i + 1), align: 'r' }));
  cols.push({ label: 'Total', x: R, align: 'r' });

  const head = () => {
    for (const c of cols) {
      if (c.align === 'l') p.text(c.label, c.x, 8, f.bold, INK2);
      else p.right(c.label, c.x, 8, f.bold, INK2);
    }
    p.y -= 7;
    p.rule(M, R, LINE2, 0.8);
  };
  head();

  const rowH = 17;
  const short = (k: string) => {
    const [, mo, d] = parts(k);
    return `${MONTHS[mo - 1].slice(0, 3)} ${d}`;
  };
  if (!m.days.length) {
    p.y -= rowH;
    p.text('Nothing released in these days.', M, 9.5, f.sans, INK3);
  }
  for (const d of m.days) {
    if (p.y - rowH < BOTTOM + 60) {
      p.add();
      head();
    }
    p.y -= rowH - 5;
    const vals = [short(d.date), d.weekday.slice(0, 3), d.start ?? '', d.finish ?? ''];
    vals.forEach((v, i) => p.text(v, cols[i].x, 9.5, f.sans, INK));
    if (d.held) p.text('held', cols[0].x + f.sans.widthOfTextAtSize(vals[0], 9.5) + 5, 7.5, f.sans, CLAY);
    jobs.forEach((j, i) => p.right(d.jobs[j] ? hrs(d.jobs[j]!) : '0', cols[4 + i].x, 9.5, f.sans, INK));
    p.right(hrs(d.minutes), R, 9.5, f.sans, INK);
    p.y -= 5;
    p.rule(M, R, LINE, 0.5);
  }
  if (m.days.length) {
    p.y -= rowH - 5;
    const n = m.days.length;
    p.text(`${periodTitle(m.from, m.to)}, ${n} ${n === 1 ? 'day' : 'days'} worked`, M, 9, f.bold, INK);
    jobs.forEach((j, i) =>
      p.right(hrs(m.days.reduce((s, d) => s + (d.jobs[j] ?? 0), 0)), cols[4 + i].x, 9.5, f.bold, INK),
    );
    p.right(hrs(m.totalMinutes), R, 9.5, f.bold, INK);
    p.y -= 6;
    p.rule(M, R, LINE2, 0.8);
  }

  p.need(70);
  p.y -= 50;
  p.text('Approved', M, 9, f.sans, INK3);
  p.rule(M + 46, M + 250, LINE2, 0.6, p.y - 2);
  p.text('Date', M + 280, 9, f.sans, INK3);
  p.rule(M + 306, M + 400, LINE2, 0.6, p.y - 2);

  // ------------------------------------------------------------- the log
  if (m.days.length) {
    p.add();
    p.text('The log', M, 20, f.serif, INK);
    p.y -= 16;
    p.text('By day, as the Window holds it', M, 9.5, f.sans, INK3);
    p.y -= 18;
  }

  const timeW = 92; // the left column: when
  const bodyX = M + timeW;
  const bodyW = R - bodyX - 42; // room for the hours column
  for (const d of m.days) {
    // A day header never sits alone at a page foot.
    p.need(90);
    p.y -= 22;
    p.text(`${d.weekday}, ${MONTHS[parts(d.date)[1] - 1]} ${parts(d.date)[2]}`, M, 14, f.serif, INK);
    if (d.held) {
      const hx = M + f.serif.widthOfTextAtSize(`${d.weekday}, ${MONTHS[parts(d.date)[1] - 1]} ${parts(d.date)[2]}`, 14) + 8;
      p.text('held', hx, 8, f.sans, CLAY);
    }
    p.right(`${hrs(d.minutes)} h`, R, 10, f.bold, INK);
    p.y -= 7;
    p.rule(M, R, LINE2, 0.7);

    if (d.purpose) {
      p.y -= 4;
      const lines = p.wrap(clean(d.purpose), textW - 52, 9.5, f.sans);
      lines.forEach((l, i) => {
        p.need(14);
        p.y -= 14;
        if (i === 0) p.text('Purpose', M, 9.5, f.bold, INK);
        p.text(l, M + 52, 9.5, f.sans, INK2);
      });
    }

    for (const piece of d.pieces) {
      if (piece.spanLine) {
        p.para(clean(piece.spanLine), M, textW, 8.5, f.sans, INK3, 1.6);
      }
      if (!piece.counted.length) {
        // A body that does not parse is shown as written, under its own title.
        p.need(30);
        p.y -= 18;
        p.text(clean(piece.entry.title ?? 'Work'), M, 10.5, f.bold, INK);
        p.right(`${hrs(piece.entry.minutes ?? 0)} h`, R, 9.5, f.sans, INK2);
        for (const l of (piece.entry.eli5 ?? '').split('\n')) {
          if (!l.trim()) continue;
          p.para(clean(l.trim()), M, textW, 9, f.sans, INK2);
        }
        continue;
      }
      for (const { chunk: c, minutes: mins } of piece.counted) {
        const reason = c.reason ? clean(c.reason) : null;
        const titleLines = p.wrap(clean(c.title), bodyW, 10.5, f.bold);
        p.need(18 + (reason ? 14 : 0) + titleLines.length * 14 + 24);
        p.y -= 16;
        p.text(`${clock24(c.start)} to ${clock24(c.end)}`, M, 8.5, f.sans, INK2);
        p.right(`${hrs(mins)} h`, R, 9.5, f.sans, INK2);
        if (reason) {
          chip(p, reason, bodyX, p.y);
          p.y -= 15;
        }
        titleLines.forEach((l, i) => {
          if (i) p.y -= 13.5;
          p.text(l, bodyX, 10.5, f.bold, INK);
        });
        const where = placeLine(c);
        if (where) {
          p.y -= 12;
          p.text(clean(where), bodyX, 8.5, f.sans, INK3);
        }
        p.y -= 3;
        // The first sentence is why the work was needed, set apart in italic;
        // what was done follows in plain ink, then the list.
        let said = 0;
        let listed = false;
        for (const raw of c.lines) {
          const l = clean(raw.trim());
          if (!l) continue;
          const bullet = /^[\u2022*-]\s*/.test(l);
          const txt = l.replace(/^[\u2022*-]\s*/, '');
          if (bullet && !listed) {
            p.y -= 2;
            listed = true;
          }
          if (bullet) {
            const ls = p.wrap(txt, bodyW - 11, 9, f.sans);
            ls.forEach((x, i) => {
              p.need(12.5);
              p.y -= 12.5;
              if (!i) p.text('\u2022', bodyX + 1, 9, f.sans, INK3);
              p.text(x, bodyX + 11, 9, f.sans, INK);
            });
          } else {
            const first = said++ === 0;
            p.para(txt, bodyX, bodyW, 9, first ? f.italic : f.sans, first ? INK2 : INK, 1.42);
          }
        }
        p.y -= 4;
      }
      for (const c of piece.uncounted) {
        const who = c.job ? ` (${JOB_NAME[c.job]})` : '';
        p.para(
          clean(`${clock24(c.start)} to ${clock24(c.end)}, not counted: ${c.title}${who}`),
          M, textW, 8.5, f.italic, INK3, 1.6,
        );
      }
    }
    p.y -= 6;
  }

  // ----------------------------------------------------------- page feet
  const n = p.pages.length;
  p.pages.forEach((pg, i) => {
    const foot = `${clean(m.project)}, work log, ${periodTitle(m.from, m.to)}`;
    pg.drawText(foot, { x: M, y: 34, size: 7.5, font: f.sans, color: INK3 });
    const pn = `Page ${i + 1} of ${n}`;
    pg.drawText(pn, { x: R - f.sans.widthOfTextAtSize(pn, 7.5), y: 34, size: 7.5, font: f.sans, color: INK3 });
  });

  return doc.save();
}
