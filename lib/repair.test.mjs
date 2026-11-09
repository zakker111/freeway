import test from 'node:test';
import assert from 'node:assert/strict';
import { REPAIR_MAX_ATTEMPTS, createRepairTracker, isRepairCheck } from './repair.mjs';

test('only verification tools start a repair cycle', () => {
  assert.equal(isRepairCheck('preview_check'), true);
  assert.equal(isRepairCheck('run_tests'), true);
  assert.equal(isRepairCheck('run_check'), true);
  assert.equal(isRepairCheck('write_file'), false);
  assert.equal(createRepairTracker().observe('write_file', { ok: false }), null);
});

test('two repairs are allowed after the first failure, then the host stops', () => {
  const tracker = createRepairTracker();
  const first = tracker.observe('preview_check', { ok: false, content: 'missing styles.css' });
  assert.equal(first.state, 'failed');
  assert.equal(first.attempt, 1);
  assert.equal(first.maxAttempts, REPAIR_MAX_ATTEMPTS);
  assert.match(tracker.instruction(first), /Repair attempt 1 of 2/);

  const second = tracker.observe('preview_check', { ok: false, content: 'still missing' });
  assert.equal(second.state, 'retry');
  assert.equal(second.attempt, 2);

  const third = tracker.observe('preview_check', { ok: false, content: 'still missing' });
  assert.equal(third.state, 'exhausted');
  assert.equal(third.attempts, 2);
  assert.match(tracker.instruction(third), /Repair limit reached/);
  assert.equal(tracker.status().active, true);
});

test('a successful check closes the repair loop and resets the budget', () => {
  const tracker = createRepairTracker();
  tracker.observe('run_check', { ok: false, content: 'test failed' });
  assert.equal(tracker.noteMutation('write_file', { ok: true }), true);
  const passed = tracker.observe('run_check', { ok: true, content: 'tests passed' });
  assert.equal(passed.state, 'passed');
  assert.equal(tracker.status().active, false);
  assert.equal(tracker.status().failures, 0);
});

test('a successful first check is not reported as a repair', () => {
  const tracker = createRepairTracker();
  assert.deepEqual(tracker.observe('preview_check', { ok: true }), { state: 'pass' });
  assert.equal(tracker.status().active, false);
});

test('the repair tracker records whether a fix was attempted', () => {
  const tracker = createRepairTracker();
  tracker.observe('run_tests', { ok: false, content: 'one test failed' });
  assert.equal(tracker.status().written, false);
  assert.equal(tracker.noteMutation('apply_patch', { ok: false }), false);
  assert.equal(tracker.noteMutation('apply_patch', { ok: true }), true);
  assert.equal(tracker.status().written, true);
});
