#!/usr/bin/env node
// Refreshes Requesty's free-model allowlist from its public catalog.
//
// Requesty rotates which models are free, and the app only ever sends ids that
// were verified at $0 in and out. This script re-reads the catalog, rebuilds
// the anchored allowlist in both editions, and drops fallback models that have
// started billing. It refuses to write anything when the catalog fails or lists
// no free chat models, so a bad response cannot quietly empty the provider.
//
// Usage:
//   node scripts/refresh-requesty.mjs
//
// Review the printed added/removed ids and commit the diff with a version bump.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = 'https://router.requesty.ai/v1/models';
const DESKTOP = join(ROOT, 'lib/providers.mjs');
const CLOUD = join(ROOT, 'cloud/worker.mjs');

// Mirrors the deny list on the provider entries: a free reranker is still not
// something the chat picker can use.
const DENY = [/embed/i, /rerank/i, /image/i, /audio/i, /tts/i];

function fail(message) {
  console.error(`refresh-requesty: ${message}`);
  process.exit(1);
}

const response = await fetch(CATALOG, {
  headers: { accept: 'application/json' },
  signal: AbortSignal.timeout(30_000),
}).catch((error) => fail(`catalog request failed: ${error.message}`));
if (!response.ok) fail(`catalog answered ${response.status}`);
const body = await response.json().catch(() => ({}));
const models = Array.isArray(body?.data) ? body.data : [];
if (models.length === 0) fail('catalog returned no models; nothing written');

const free = models
  .filter((model) => typeof model?.id === 'string' && model.id)
  .filter((model) => model.api === undefined || model.api === 'chat')
  .filter((model) => Number(model.input_price) === 0 && Number(model.output_price) === 0)
  .filter((model) => !DENY.some((pattern) => pattern.test(model.id)))
  .map((model) => model.id);
const ids = [...new Set(free)].sort();
if (ids.length === 0) fail('no zero-priced chat ids right now; nothing written');

const escape = (id) => id.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const pattern = `/^(?:${ids.map(escape).join('|')})$/i`;

function readEntry(file) {
  const src = readFileSync(file, 'utf8');
  const at = src.indexOf("id: 'requesty',");
  if (at < 0) fail(`${file}: no requesty entry`);
  return { src, at };
}

function writeAllowlist(file, pattern) {
  const { src, at } = readEntry(file);
  const open = src.indexOf('allow: [\n', at);
  if (open < 0) fail(`${file}: no allow list after the requesty entry`);
  const lineStart = open + 'allow: [\n'.length;
  const lineEnd = src.indexOf('\n', lineStart);
  const old = src.slice(lineStart, lineEnd).trim();
  const match = /^(\/\^(?:[\s\S]*?)\$\/i)(,?)$/.exec(old);
  if (!match) fail(`${file}: unexpected allow line`);
  const next = src.slice(0, lineStart) + `      ${pattern}${match[2]}` + src.slice(lineEnd);
  if (next !== src) writeFileSync(file, next);
  return next !== src;
}

function updateFallbacks(file) {
  const { src, at } = readEntry(file);
  const match = /(fallback(?:Models)?: \[)([^\]]*)(\])/.exec(src.slice(at));
  if (!match) fail(`${file}: no fallback list after the requesty entry`);
  const current = [...match[2].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  const kept = current.filter((id) => ids.includes(id));
  const removed = current.filter((id) => !ids.includes(id));
  const next = [...kept, ...ids.filter((id) => !kept.includes(id))].slice(0, 3);
  const line = next.map((id) => `'${id}'`).join(', ');
  if (`${match[1]}${line}${match[3]}` === match[0]) return { removed, kept };
  const updated = src.slice(0, at) + src.slice(at).replace(match[0], `${match[1]}${line}${match[3]}`);
  writeFileSync(file, updated);
  return { removed, kept };
}

function stampDate(file) {
  const src = readFileSync(file, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const next = src.replace(
    /(Zero-priced chat ids in Requesty's public \/v1\/models on )\d{4}-\d{2}-\d{2}(\.)/,
    `$1${today}$2`,
  );
  if (next !== src) writeFileSync(file, next);
}

for (const file of [DESKTOP, CLOUD]) writeAllowlist(file, pattern);
const { removed } = updateFallbacks(DESKTOP);
updateFallbacks(CLOUD);
for (const file of [DESKTOP, CLOUD]) stampDate(file);

console.log(`Requesty catalog: ${models.length} models, ${ids.length} free chat ids`);
for (const id of ids) console.log(`  ${id}`);
if (removed.length > 0) {
  console.log(`Fallback removed (no longer $0): ${removed.join(', ')}`);
}
console.log(`Allowlist written to ${DESKTOP.replace(ROOT + '/', '')} and ${CLOUD.replace(ROOT + '/', '')}.`);
