// Named secrets in one 0600 file next to the config. The browser only ever
// sees a name and a four-character hint; values stay in this process.

import fs from 'node:fs';
import path from 'node:path';

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_VALUE = 8192;
const MAX_SECRETS = 100;

// Not named fail(): tools.mjs already has a top-level fail(), and the single
// file build concatenates every module into one scope.
function badSecret(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function normalizeName(name) {
  const value = String(name ?? '').trim();
  if (!NAME_PATTERN.test(value)) {
    throw badSecret('A secret name is letters, numbers and _ — starting with a letter.');
  }
  return value;
}

/** Enough to recognise a key, not enough to use one. */
export function hint(value) {
  const text = String(value ?? '');
  return text.length <= 4 ? '••••' : `••••${text.slice(-4)}`;
}

function readAll(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (NAME_PATTERN.test(name) && typeof value === 'string' && value) out[name] = value;
    }
    return out;
  } catch {
    // Missing or hand-edited: start clean rather than crash.
    return {};
  }
}

function writeAll(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows ignores POSIX modes; the file is still user-owned */
  }
}

export function openSecrets(file) {
  function all() {
    return readAll(file);
  }

  function list() {
    return Object.entries(all())
      .map(([name, value]) => ({ name, hint: hint(value), length: value.length }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function set(name, value) {
    const key = normalizeName(name);
    const next = typeof value === 'string' ? value : '';
    if (!next.trim()) throw badSecret('A secret cannot be empty.');
    if (next.length > MAX_VALUE) throw badSecret('That secret is too long (8 KB limit).');

    const data = all();
    if (!(key in data) && Object.keys(data).length >= MAX_SECRETS) {
      throw badSecret(`Too many secrets (limit ${MAX_SECRETS}).`);
    }
    data[key] = next;
    writeAll(file, data);
    return { name: key, hint: hint(next), length: next.length };
  }

  function remove(name) {
    const key = String(name ?? '');
    const data = all();
    if (!(key in data)) return false;
    delete data[key];
    writeAll(file, data);
    return true;
  }

  /** Server-side only: used by tools that need the real value. */
  function get(name) {
    return all()[String(name ?? '')] ?? null;
  }

  return { file, list, set, remove, get };
}

export const secretLimits = { MAX_VALUE, MAX_SECRETS };
