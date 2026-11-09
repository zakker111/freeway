import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecrets } from './redact.mjs';

const fake = (prefix, character, count) => [prefix, character.repeat(count)].join('');
const openrouterKey = fake('sk-or-v1-', 'r', 32);

test('masks an OpenRouter key inside an error message', () => {
  const out = scrubSecrets(`Incorrect API key provided: ${openrouterKey}.`);
  assert.equal(out.includes(openrouterKey), false);
  assert.match(out, /sk-or-\[redacted\]/);
});

test('masks a bearer header', () => {
  const out = scrubSecrets(`sent Authorization: Bearer ${openrouterKey} upstream`);
  assert.equal(out.includes(openrouterKey), false);
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
  const jwt = `${fake('eyJ', 'h', 12)}.${fake('eyJ', 'p', 12)}.${fake('sig', 's', 12)}`;
  const secrets = [
    fake('gsk_', 'g', 24),
    fake('AIza', 'a', 24),
    fake('ghp_', 'h', 24),
    fake('github_pat_', 'g', 24),
    fake('glpat-', 'g', 24),
    fake('hf_', 'h', 24),
    fake('npm_', 'n', 24),
    fake('pypi-', 'p', 24),
    fake('xai-', 'x', 24),
    fake('AKIA', 'A', 16),
    fake('ASIA', 'A', 16),
    fake('sk-proj-', 'p', 24),
    jwt,
  ];
  const out = scrubSecrets(`sent ${secrets.join(' and ')} upstream`);
  for (const secret of secrets) assert.equal(out.includes(secret), false, 'a provider key was not masked');
  assert.match(out, /\[redacted\]/);
});

test('masks a PEM private key block', () => {
  // Assemble the marker at runtime; a literal block in the source archive is
  // indistinguishable to scanners from a committed private key.
  const begin = '-----BEGIN ' + 'PRIVATE KEY-----';
  const end = '-----END ' + 'PRIVATE KEY-----';
  const block = [begin, 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', end].join('\n');
  const out = scrubSecrets(`child error: ${block}`);
  assert.equal(out.includes('MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'), false);
  assert.match(out, /\[private key redacted\]/);
});
