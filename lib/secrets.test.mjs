import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hint, openSecrets } from './secrets.mjs';

function tempSecrets() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openrouter-secrets-'));
  const file = path.join(dir, 'secrets.json');
  return { dir, file, secrets: openSecrets(file) };
}

test('stores a secret and lists only a masked hint', () => {
  const { secrets } = tempSecrets();
  secrets.set('GITHUB_TOKEN', 'ghp_abcdefghijklmnop1234');

  const list = secrets.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'GITHUB_TOKEN');
  assert.equal(list[0].hint, '••••1234');
  assert.ok(!JSON.stringify(list).includes('ghp_abcdefg'), 'the value must never be listed');
  assert.equal(secrets.get('GITHUB_TOKEN'), 'ghp_abcdefghijklmnop1234', 'the server can read it');
});

test('the file is private and survives a reopen', () => {
  const { file, secrets } = tempSecrets();
  secrets.set('OPENAI_KEY', 'sk-test-value-9999');

  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);

  const reopened = openSecrets(file);
  assert.equal(reopened.get('OPENAI_KEY'), 'sk-test-value-9999');
  assert.equal(reopened.list()[0].hint, '••••9999');
});

test('replaces an existing value and can delete it', () => {
  const { secrets } = tempSecrets();
  secrets.set('KEY', 'first-value-1111');
  secrets.set('KEY', 'second-value-2222');
  assert.equal(secrets.list().length, 1);
  assert.equal(secrets.get('KEY'), 'second-value-2222');

  assert.equal(secrets.remove('KEY'), true);
  assert.equal(secrets.remove('KEY'), false);
  assert.equal(secrets.list().length, 0);
});

test('rejects bad names, empty values and oversized values', () => {
  const { secrets } = tempSecrets();
  assert.throws(() => secrets.set('1BAD', 'x'), /letters, numbers/);
  assert.throws(() => secrets.set('has space', 'x'), /letters, numbers/);
  assert.throws(() => secrets.set('', 'x'), /letters, numbers/);
  assert.throws(() => secrets.set('OK', '   '), /cannot be empty/);
  assert.throws(() => secrets.set('OK', 'x'.repeat(9000)), /too long/);
  assert.deepEqual(secrets.list(), []);
});

test('survives a corrupt file instead of crashing', () => {
  const { file, secrets } = tempSecrets();
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(secrets.list(), []);
  secrets.set('AFTER_CORRUPTION', 'fine-value-0000');
  assert.equal(secrets.get('AFTER_CORRUPTION'), 'fine-value-0000');
});

test('hints never reveal short values', () => {
  assert.equal(hint(''), '••••');
  assert.equal(hint('abc'), '••••');
  assert.equal(hint('abcd'), '••••');
  assert.equal(hint('abcde'), '••••bcde');
});
