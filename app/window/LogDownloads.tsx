'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import './downloads.css';

// The work log, to read or to keep: two buttons at the head of "The work".
//
// "Work log" opens the chosen week as a document in a new tab, to read without
// saving anything. "Download" opens a small menu of six files: the day, the week
// and the month around the day chosen on the calendar, each as a PDF and a CSV.
// A week is Thursday through Wednesday, the week the weekly log is written for.
//
// Every file is a plain link to /api/window-log, which reads through the
// reader's own session, so a client's file holds what their Window holds and
// nothing more. No JavaScript is needed to fetch a file; the menu is the only
// part that is interactive.

const STUDIO_TZ = 'America/Los_Angeles';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const todayKey = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: STUDIO_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const asDate = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const asKey = (d: Date) => d.toISOString().slice(0, 10);
const plus = (k: string, n: number) => asKey(new Date(asDate(k).getTime() + n * 86400000));

/** Thursday through Wednesday, around the day. */
function weekOf(k: string) {
  const back = (asDate(k).getUTCDay() - 4 + 7) % 7;
  const from = plus(k, -back);
  return { from, to: plus(from, 6) };
}
function monthOf(k: string) {
  const d = asDate(k);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from: `${k.slice(0, 7)}-01`, to: asKey(last) };
}

const short = (k: string) => {
  const d = asDate(k);
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
};
const dayLabel = (k: string) => `${DOW[asDate(k).getUTCDay()]}, ${short(k)}`;
const rangeLabel = (from: string, to: string) =>
  from.slice(0, 7) === to.slice(0, 7) ? `${short(from)} to ${asDate(to).getUTCDate()}` : `${short(from)} to ${short(to)}`;

/**
 * The day chosen on the calendar beside this control, read from the calendar
 * itself: the open square (`.wl-day.on`) under the month heading (`.wl-nav b`).
 * Held as the last day chosen, so closing a day does not move the period.
 * A `day` prop, when given, wins.
 */
function useChosenDay(anchor: React.RefObject<HTMLElement>, given?: string) {
  const [seen, setSeen] = useState<string | null>(null);
  useEffect(() => {
    if (given) return;
    const scope = anchor.current?.closest('.panel');
    if (!scope) return;
    const read = () => {
      const on = scope.querySelector('.wl-day.on');
      const head = scope.querySelector('.wl-nav b')?.textContent?.trim() ?? '';
      const m = head.match(/^([A-Za-z]+)\s+(\d{4})$/);
      const mi = m ? MONTHS.indexOf(m[1]) : -1;
      const d = Number(on?.textContent?.trim());
      if (on && mi >= 0 && d >= 1 && d <= 31) {
        setSeen(`${m![2]}-${String(mi + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(scope, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, [anchor, given]);
  return given ?? seen;
}

export default function LogDownloads({
  projectId,
  day,
  from,
  to,
}: {
  projectId: string;
  /** The day the periods are taken around. Read from the calendar when absent. */
  day?: string;
  /** An explicit range, offered first when given. */
  from?: string;
  to?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const chosen = useChosenDay(root, day);
  const [open, setOpen] = useState(false);
  const anchor = chosen ?? to ?? todayKey();

  const periods = useMemo(() => {
    const w = weekOf(anchor);
    const m = monthOf(anchor);
    const out: { key: string; name: string; when: string; from: string; to: string }[] = [];
    if (from && to) out.push({ key: 'range', name: 'These days', when: rangeLabel(from, to), from, to });
    out.push(
      { key: 'day', name: 'Day', when: dayLabel(anchor), from: anchor, to: anchor },
      { key: 'week', name: 'Week', when: rangeLabel(w.from, w.to), from: w.from, to: w.to },
      { key: 'month', name: 'Month', when: `${MONTHS[asDate(anchor).getUTCMonth()]} ${anchor.slice(0, 4)}`, from: m.from, to: m.to },
    );
    return out;
  }, [anchor, from, to]);

  const href = (p: { from: string; to: string }, format: 'pdf' | 'csv', inline = false) =>
    `/api/window-log?project=${encodeURIComponent(projectId)}&from=${p.from}&to=${p.to}&format=${format}` +
    (inline ? '&disposition=inline' : '');

  // Closed by a press anywhere else, or Escape, the way a menu is expected to.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const week = periods.find((p) => p.key === 'week')!;

  return (
    <div className="ld" ref={root}>
      <a
        className="mini-btn ld-btn"
        href={href(week, 'pdf', true)}
        target="_blank"
        rel="noopener"
        title={`Read the week of ${week.when}`}
      >
        Work log
      </a>
      <button
        type="button"
        className={'mini-btn ld-btn' + (open ? ' on' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Download <i aria-hidden="true">{open ? '\u25B4' : '\u25BE'}</i>
      </button>

      {open && (
        <div className="ld-menu" role="menu" aria-label="Download the work log">
          {periods.map((p) => (
            <div className="ld-row" key={p.key}>
              <span className="ld-name">
                <b>{p.name}</b>
                <span>{p.when}</span>
              </span>
              {(['pdf', 'csv'] as const).map((fmt) => (
                <a
                  key={fmt}
                  role="menuitem"
                  className="ld-file"
                  href={href(p, fmt)}
                  download={`work-log-${p.from}-to-${p.to}.${fmt}`}
                  onClick={() => setOpen(false)}
                  aria-label={`${p.name}, ${p.when}, ${fmt.toUpperCase()}`}
                >
                  {fmt.toUpperCase()}
                </a>
              ))}
            </div>
          ))}
          <p className="ld-note">A week runs Thursday to Wednesday.</p>
        </div>
      )}
    </div>
  );
}
