import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecrets } from './redact.mjs';

test('masks an OpenRouter key inside an error message', () => {
  const out = scrubSecrets('Incorrect API key provided: sk-or-v1-abcdef1234567890.');
  assert.equal(out.includes('abcdef1234567890'), false);
  assert.match(out, /sk-or-\[redacted\]/);
});

test('masks a bearer header', () => {
  const out = scrubSecrets('sent Authorization: Bearer sk-or-v1-1234567890abcdef upstream');
  assert.equal(out.includes('1234567890abcdef'), false);
  assert.equal(out.includes('Bearer [redacted]'), true);
});

test('leaves ordinary text alone', () => {
  const text = 'HTTP 429: rate limited by nvidia/nemotron';
  assert.equal(scrubSecrets(text), text);
});

test('passes non-strings straight through', () => {
  assert.equal(scrubSecrets(undefined), undefined);
  assert.equal(scrubSecrets(null), null);
  assert.equal(scrubSecrets(42), 42);
});

test('masks the other provider key shapes Freeway can receive', () => {
  const secrets = [
    'gsk_abcdefghijklmnopqrstuvwx',
    'AIzaabcdefghijklmnopqrstuvwxyz',
    'ghp_abcdefghijklmnopqrstuvwx',
    'xai-abcdefghijklmnopqrstuvwx',
    'AKIAABCDEFGHIJKLMNOP',
    'sk-proj-abcdefghijklmnopqrstuvwx',
  ];
  const out = scrubSecrets(`sent ${secrets.join(' and ')} upstream`);
  for (const secret of secrets) assert.equal(out.includes(secret), false, secret);
  assert.match(out, /\[redacted\]/);
});
