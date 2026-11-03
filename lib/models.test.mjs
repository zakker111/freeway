import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFreeModel,
  pricePerMillion,
  isExpired,
  supportsParam,
  supportsVision,
  estimateTokens,
  toPickerModel,
  filterModels,
  buildChain,
  defaultModel,
} from './models.mjs';

const free = (id, extra = {}) => ({
  id,
  name: id,
  pricing: { prompt: '0', completion: '0' },
  context_length: 128_000,
  supported_parameters: ['tools', 'max_tokens'],
  architecture: { input_modalities: ['text'] },
  ...extra,
});

const paid = (id) => ({
  id,
  name: id,
  pricing: { prompt: '0.0000025', completion: '0.00001' },
  context_length: 200_000,
  supported_parameters: ['tools'],
  architecture: { input_modalities: ['text'] },
});

test('isFreeModel only accepts zero prompt and completion price', () => {
  assert.equal(isFreeModel(free('a/b')), true);
  assert.equal(isFreeModel(paid('a/b')), false);
  assert.equal(isFreeModel({ pricing: { prompt: '0', completion: '0.0001' } }), false);
  assert.equal(isFreeModel(null), false);
});

test('pricePerMillion converts per-token strings', () => {
  assert.equal(pricePerMillion('0.0000025'), 2.5);
  assert.equal(pricePerMillion('0'), 0);
  assert.equal(pricePerMillion('nonsense'), 0);
});

test('isExpired respects the timestamp', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  assert.equal(isExpired({ expiration_date: '2026-05-01T00:00:00Z' }, now), true);
  assert.equal(isExpired({ expiration_date: '2026-07-01T00:00:00Z' }, now), false);
  assert.equal(isExpired({ expiration_date: null }, now), false);
});

test('capability helpers read the right fields', () => {
  assert.equal(supportsParam(free('a/b'), 'tools'), true);
  assert.equal(supportsParam(free('a/b'), 'vision'), false);
  assert.equal(supportsVision(free('a/b', { architecture: { input_modalities: ['text', 'image'] } })), true);
});

test('estimateTokens grows with content', () => {
  assert.ok(estimateTokens([{ role: 'user', content: 'a'.repeat(400) }]) > 100);
  assert.ok(
    estimateTokens([{ role: 'user', content: 'hello' }]) <
      estimateTokens([{ role: 'user', content: 'hello'.repeat(50) }]),
  );
});

test('toPickerModel exposes display fields', () => {
  const row = toPickerModel(paid('openai/x'));
  assert.equal(row.vendor, 'openai');
  assert.equal(row.inPrice, 2.5);
  assert.equal(row.outPrice, 10);
  assert.equal(row.free, false);
});

test('filterModels applies every filter together', () => {
  const models = [free('a/free'), paid('b/paid'), free('c/vision', { architecture: { input_modalities: ['text', 'image'] } })];
  assert.equal(filterModels(models, { freeOnly: true }).length, 2);
  assert.equal(filterModels(models, { q: 'vision' }).length, 1);
  assert.equal(filterModels(models, { needVision: true }).length, 1);
  assert.equal(filterModels(models, { minContext: 150_000 }).length, 1);
});

test('filterModels hides expired models unless asked', () => {
  const models = [free('a/old', { expiration_date: '2020-01-01T00:00:00Z' }), free('b/new')];
  assert.deepEqual(filterModels(models, {}).map((m) => m.id), ['b/new']);
  assert.equal(filterModels(models, { includeExpired: true }).length, 2);
});

test('buildChain is free-only, capability-aware and ordered', () => {
  const models = [
    free('small/text', { context_length: 8_000, supported_parameters: ['max_tokens'] }),
    free('big/tools', { context_length: 200_000 }),
    paid('paid/tools'),
  ];
  const chain = buildChain(models, { needTools: true, minContext: 100_000 });
  assert.deepEqual(chain, ['big/tools']);

  const bigOnly = buildChain(models, { minContext: 150_000 });
  assert.deepEqual(bigOnly, ['big/tools']);
});

test('buildChain puts the requested model first and dedupes', () => {
  const models = [free('a/one'), free('b/two'), free('c/three')];
  const chain = buildChain(models, { primary: 'c/three', limit: 3 });
  assert.equal(chain[0], 'c/three');
  assert.equal(new Set(chain).size, chain.length);
  assert.equal(chain.length, 3);
});

test('buildChain honours limit, excludes and primary absence', () => {
  const models = [free('a/one'), free('b/two'), free('c/three')];
  assert.equal(buildChain(models, { limit: 2 }).length, 2);
  assert.deepEqual(buildChain(models, { exclude: ['a/one', 'b/two', 'c/three'] }), []);
  assert.equal(buildChain(models, { primary: 'gone/model', limit: 2 })[0], 'a/one');
});

test('buildChain skips non-free models unless includePaid is set', () => {
  const models = [paid('paid/only'), free('free/only')];
  assert.deepEqual(buildChain(models, { limit: 3 }), ['free/only']);
  assert.deepEqual(buildChain(models, { limit: 3, includePaid: true }), ['free/only', 'paid/only']);
});

test('defaultModel returns the first chain entry', () => {
  assert.equal(defaultModel([paid('p/x'), free('f/x')]), 'f/x');
  assert.equal(defaultModel([]), null);
});
