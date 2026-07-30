'use client';

import { useEffect, useRef, useState } from 'react';

// What a day with nothing released has to say for itself.
//
// A blank panel reads as absence, and absence reads as nothing happened. Usually
// something did happen and it is simply not written up yet, because the write-up is
// the slow part: the work takes an afternoon and saying what it means in plain words
// takes a while longer. This says that, in the first person, where the work would be.
//
// It types itself, erases, and types the next line. The reason for the motion is not
// decoration: a still card saying "nothing here" reads as a dead end, and a line being
// written reads as someone at a desk mid-sentence, which is the honest state of a day
// whose summary is not finished. It obeys the studio rule that motion has to mean
// something, and it stops entirely for anyone who has asked their system for less of it.

const LINES = [
  'I am probably still writing this one up.',
  'The work is the afternoon. Saying what it means takes longer.',
  'Summaries land here as they are finished, usually the same day.',
  'Nothing appears until I have read it back and passed it.',
];

// Slower than a terminal effect on purpose. This is a person writing, not a machine
// printing, and the difference is entirely in the milliseconds.
const TYPE = 42;
const ERASE = 22;
const HOLD = 2100;
const GAP = 420;

export default function QuietDay({ date }: { date: Date }) {
  const [shown, setShown] = useState('');
  const [still, setStill] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Anyone who has asked their system to reduce motion gets the first line, whole,
    // and nothing moves. The card still says what it needs to say.
    const quiet = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (quiet?.matches) { setShown(LINES[0]); setStill(true); return; }

    let line = 0;
    let i = 0;
    let erasing = false;
    let alive = true;

    const tick = () => {
      if (!alive) return;
      const text = LINES[line];

      if (!erasing) {
        i += 1;
        setShown(text.slice(0, i));
        if (i >= text.length) {
          erasing = true;
          timer.current = setTimeout(tick, HOLD);
          return;
        }
        timer.current = setTimeout(tick, TYPE);
      } else {
        i -= 1;
        setShown(text.slice(0, i));
        if (i <= 0) {
          erasing = false;
          line = (line + 1) % LINES.length;
          timer.current = setTimeout(tick, GAP);
          return;
        }
        timer.current = setTimeout(tick, ERASE);
      }
    };

    timer.current = setTimeout(tick, GAP);
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, []);

  const when = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const future = date > new Date();

  return (
    <div className="qd-wrap">
      <div className="qd">
        <span className="qd-tag">{future ? 'Not yet' : 'Nothing released'}</span>

        <p className="qd-line" aria-live="polite">
          {future
            ? 'This day has not happened yet.'
            : <>{shown}<i className={'qd-caret' + (still ? ' still' : '')} aria-hidden="true" /></>}
        </p>

        <p className="qd-sub">
          {future
            ? `Whatever lands on ${when} will show up here once it is written and passed.`
            : `No work has been released for ${when}. That does not always mean the day was
               empty, only that nothing from it has been written up and passed yet.`}
        </p>

        <span className="qd-rule" aria-hidden="true" />
        <p className="qd-foot">
          Every piece here is written in plain words before it reaches you, and nothing
          appears until I have read it back. Most days that happens as I go.
        </p>
      </div>
    </div>
  );
}
