// Tests for lib/worklog/parse.ts. Run: node --no-warnings lib/worklog/parse.test.mjs
// The fixtures are synthetic but keep the real grammar line for line (p33-days.mjs).
// The run over every real body lives outside the repo, in the r718 proof folder
// (parse-test.mjs), because those bodies are the client's record.
import assert from 'node:assert/strict';
import { parseDay, hoursFor, jobsOf, switchovers, to24, clock12 } from './parse.ts';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

const DAY = `Purpose: Sample purpose sentence.
8:30 AM to 10 PM. Artinian Gems 4 h, Caveman Gems 9.5 h. Office 7 h, remote 6.5 h.
8:30 AM to 12 PM: First piece [DATA INTEGRITY] (Artinian Gems, in parallel, office)
  Why it was needed.
  What was done.
  • Item one
  • Item two
8:30 AM to 3:30 PM: Second piece [AT YOUR REQUEST] (Caveman Gems, in parallel, office)
  Why.
  • Item
3:30 PM to 4:15 PM: Third piece [OPERATIONS] (Artinian Gems, in parallel, remote)
  • Item
3:30 PM to 10 PM: Fourth piece [AT YOUR REQUEST] (Caveman Gems, in parallel, remote)
  • Item
8:30 PM to 10 PM: Fifth piece [OPERATIONS] (Artinian Gems, in parallel, remote)
  • Item
10:05 PM to 11:58 PM, not counted: Late piece [OPERATIONS] (Artinian Gems, outside 5 AM to 10 PM)
  • Item`;

t('clock conversions', () => {
  assert.equal(to24('8:30 AM'), '08:30');
  assert.equal(to24('12 PM'), '12:00');
  assert.equal(to24('12 AM'), '00:00');
  assert.equal(to24('10:05 PM'), '22:05');
  assert.equal(clock12('13:00'), '1 PM');
  assert.equal(clock12('08:30'), '8:30 AM');
});

t('a body that does not parse falls back with its raw text', () => {
  for (const b of ['', 'Plain prose about the work.', '8 AM to 9 AM: A (Artinian Gems, office)\nstray line', '  • orphan\n8 AM to 9 AM: A (Artinian Gems, office)']) {
    const d = parseDay(b);
    assert.equal(d.chunks.length, 0);
    assert.equal(d.raw, b);
  }
  assert.equal(parseDay(null).chunks.length, 0);
});

t('the day: header, chunks, fields', () => {
  const d = parseDay(DAY);
  assert.deepEqual(d.ran, { start: '08:30', end: '22:00' });
  assert.equal(d.purpose, 'Sample purpose sentence.');
  assert.equal(d.chunks.length, 6);
  const c = d.chunks[0];
  assert.equal(c.start, '08:30'); assert.equal(c.end, '12:00');
  assert.equal(c.title, 'First piece'); assert.equal(c.reason, 'Data integrity');
  assert.equal(c.job, 'artinian'); assert.equal(c.place, 'office'); assert.equal(c.parallel, true);
  assert.deepEqual(c.lines, ['Why it was needed.', 'What was done.', 'Item one', 'Item two']);
  assert.deepEqual(c.items, ['Item one', 'Item two']);
  const late = d.chunks[5];
  assert.equal(late.counted, false); assert.equal(late.hours, null); assert.equal(late.place, null);
});

t('hours: builder block rule, totals agree with the day sentence', () => {
  const d = parseDay(DAY);
  assert.deepEqual(d.chunks.map((c) => c.hours), [2.25, 4.75, 0.5, 4.75, 1.25, null]);
  assert.equal(d.hoursAgree, true);
  assert.equal(hoursFor(d, null), 13.5); // 8:30 AM to 3:30 PM is 7 h, 3:30 PM to 10 PM is 6.5 h
  assert.equal(hoursFor(d, 'artinian'), 4);
  assert.equal(hoursFor(d, 'caveman'), 9.5);
  assert.deepEqual(jobsOf(d).map((j) => j.job), ['artinian', 'caveman']);
});

t('office and remote match the sentence; switchover at 3:30 PM', () => {
  const d = parseDay(DAY);
  const off = d.chunks.reduce((a, c) => a + (c.office ?? 0), 0);
  const rem = d.chunks.reduce((a, c) => a + (c.remote ?? 0), 0);
  assert.equal(off, 7);
  assert.equal(rem, 6.5);
  assert.deepEqual(switchovers(d), [{ at: '15:30', to: 'remote' }]);
});

t('a disagreeing sentence withholds per chunk hours rather than show them wrong', () => {
  const d = parseDay(DAY.replace('Artinian Gems 4 h', 'Artinian Gems 9 h'));
  assert.equal(d.hoursAgree, false);
  assert.ok(d.chunks.every((c) => c.hours === null));
  assert.equal(hoursFor(d, 'artinian'), 9);
});

t('office, then remote: one chunk crossing at 4 PM', () => {
  const d = parseDay('8 AM to 6 PM: Long piece (Caveman Gems, office, then remote)\n  • Item');
  const c = d.chunks[0];
  assert.equal(c.place, null); assert.equal(c.placeLabel, 'Office, then remote'); assert.equal(c.switchAt, '16:00');
  assert.equal(c.office, 8); assert.equal(c.remote, 2);
  assert.deepEqual(switchovers(d), [{ at: '16:00', to: 'remote' }]);
});

t('quarter hours round half to even, as the builder does', () => {
  // 11 AM to 6 PM block is 7 h; spans 7 and 1 give 7 * 7 / 8 = 6.125 -> 6, last takes 1.
  const d = parseDay('11 AM to 6 PM: A (Artinian Gems, in parallel, remote)\n11:45 AM to 12:45 PM: B (Caveman Gems, in parallel, remote)');
  assert.deepEqual(d.chunks.map((c) => c.hours), [6, 1]);
});

console.log(`${n} tests passed`);
