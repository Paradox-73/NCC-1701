import test from 'node:test';
import assert from 'node:assert/strict';
import { Ring } from '../src/lib/ring.js';

const row = (seq, a = seq * 10) => [seq, 1_000 + seq * 100, a];

test('push appends in seq order, refuses a seq it already holds, and overwrites the oldest rows past its capacity', () => {
  const r = new Ring(['a'], 4);
  assert.equal(r.push(row(1)), true);
  assert.equal(r.push(row(1)), false);
  assert.equal(r.push(row(0)), false);
  for (const s of [2, 3, 4, 5, 6]) r.push(row(s));
  assert.deepEqual(r.rows().map((x) => x[0]), [3, 4, 5, 6]);
  assert.equal(r.last('a'), 60);
});

test('merge fills a gap older than lastSeq, each seq once and in order', () => {
  const r = new Ring(['a'], 16);
  [1, 2, 6, 7].forEach((s) => r.push(row(s))); // live frames landed after a reconnect, past the gap 3 to 5
  const added = r.merge([3, 4, 5, 6].map((s) => row(s))); // history reply; 6 is already held
  assert.equal(added, 3);
  assert.deepEqual(r.rows().map((x) => x[0]), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(r.lastSeq, 7);
});

test('rows(after) returns only newer rows, which is how backfill keeps live rows that arrived during the history fetch', () => {
  const r = new Ring(['a'], 16);
  [1, 2, 3, 4].forEach((s) => r.push(row(s)));
  assert.deepEqual(r.rows(2).map((x) => x[0]), [3, 4]);
});

test('window returns seconds on x and the columns for the newest span only', () => {
  const r = new Ring(['a'], 16);
  [1, 2, 3, 4, 5].forEach((s) => r.push(row(s)));
  const [xs, a] = r.window(250, ['a']); // ts step is 100 ms: the last three rows
  assert.deepEqual(a, [30, 40, 50]);
  assert.deepEqual(xs, [1.3, 1.4, 1.5]);
  assert.equal(new Ring(['a']).window(1000, ['a']), null);
});
