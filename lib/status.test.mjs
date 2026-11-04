import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatusLog, statusLimits } from './status.mjs';

function fixedClock(start = 1_700_000_000_000) {
  let value = start;
  return {
    now: () => value,
    tick: (ms) => {
      value += ms;
      return value;
    },
  };
}

test('an attempt is recorded with a normalised shape', () => {
  const clock = fixedClock();
  const log = createStatusLog({ now: clock.now });

  const entry = log.record({ model: '  mock/alpha:free  ', status: 'ok', ms: 412.6, attempt: 2 });

  assert.equal(entry.model, 'mock/alpha:free', 'model ids are trimmed');
  assert.equal(entry.status, 'ok');
  assert.equal(entry.ms, 413, 'latency is rounded to whole milliseconds');
  assert.equal(entry.attempt, 2);
  assert.equal(entry.at, new Date(1_700_000_000_000).toISOString());
});

test('an unknown status or a missing model cannot break the page', () => {
  const log = createStatusLog();
  const entry = log.record({ status: 'exploded', model: 42, attempt: -3, ms: Number.NaN });

  assert.equal(entry.status, 'request');
  assert.equal(entry.model, null);
  assert.equal(entry.attempt, 1);
  assert.equal(entry.ms, null);
});

test('the summary averages only attempts that reported a latency', () => {
  const log = createStatusLog();
  log.record({ model: 'a', status: 'ok', ms: 100 });
  log.record({ model: 'b', status: 'rate-limit', ms: 300 });
  log.record({ model: 'c', status: 'network', ms: null });

  const summary = log.summary();
  assert.equal(summary.requests, 3);
  assert.equal(summary.ok, 1);
  assert.equal(summary.failed, 2);
  assert.equal(summary.successRate, 33);
  assert.equal(summary.avgMs, 200, 'the untimed attempt must not drag the average');
  assert.equal(summary.slowestMs, 300);
});

test('an empty log reports no rate instead of zero', () => {
  const summary = createStatusLog().summary();
  assert.equal(summary.requests, 0);
  assert.equal(summary.successRate, null);
  assert.equal(summary.avgMs, null);
  assert.equal(summary.slowestMs, null);
});

test('the buffer keeps the newest entries and drops the oldest', () => {
  const log = createStatusLog({ limit: 3 });
  for (let i = 1; i <= 5; i += 1) log.record({ model: `m${i}`, status: 'ok', ms: i });

  assert.deepEqual(
    log.list().map((entry) => entry.model),
    ['m3', 'm4', 'm5'],
  );
  assert.equal(log.list().length, 3);
  assert.ok(statusLimits.MAX_ENTRIES >= 50);
});

test('reset clears the entries but keeps the session start time', () => {
  const log = createStatusLog();
  log.record({ model: 'a', status: 'ok', ms: 10 });
  const since = log.summary().since;

  log.reset();

  assert.deepEqual(log.list(), []);
  assert.equal(log.summary().since, since);
  assert.equal(log.summary().requests, 0);
});
