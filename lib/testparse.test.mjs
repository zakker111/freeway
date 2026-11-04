import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTestOutput } from './testparse.mjs';

test('parses node:test TAP failures with location', () => {
  const result = parseTestOutput(`TAP version 13\nnot ok 1 - adds numbers\n  location: 'lib/math.test.mjs:12:3'\n  error: 'expected 5, got 4'\n`, { exitCode: 1 });
  assert.equal(result.framework, 'node');
  assert.equal(result.passed, false);
  assert.equal(result.failures[0].test, 'adds numbers');
  assert.equal(result.failures[0].file, 'lib/math.test.mjs');
  assert.equal(result.failures[0].line, 12);
  assert.match(result.failures[0].message, /expected 5/);
});

test('parses pytest FAILED lines', () => {
  const result = parseTestOutput('FAILED tests/test_app.py::test_login - AssertionError: 401 != 200\n', { exitCode: 1 });
  assert.equal(result.framework, 'pytest');
  assert.equal(result.failures[0].test, 'test_login');
  assert.equal(result.failures[0].file, 'tests/test_app.py');
});

test('parses cargo test failures and panic location', () => {
  const result = parseTestOutput('test math::adds ... FAILED\nthread main panicked at src/math.rs:9:5\nexpected 5\n', { exitCode: 101 });
  assert.equal(result.framework, 'cargo');
  assert.equal(result.failures[0].file, 'src/math.rs');
  assert.equal(result.failures[0].line, 9);
});

test('parses go test failures with file and line', () => {
  const result = parseTestOutput('--- FAIL: TestLogin (0.00s)\n    app_test.go:42: got 401, want 200\n', { exitCode: 1 });
  assert.equal(result.framework, 'go');
  assert.equal(result.failures[0].test, 'TestLogin');
  assert.equal(result.failures[0].file, 'app_test.go');
  assert.equal(result.failures[0].line, 42);
});

test('a green run is a pass with no failures', () => {
  const result = parseTestOutput('# tests 12\n# pass 12\n', { exitCode: 0 });
  assert.equal(result.passed, true);
  assert.equal(result.failures.length, 0);
});
