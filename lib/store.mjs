import { cleanImages } from './models.mjs';

// Saved chats: one small JSON file next to the config, written atomically.
// Everything that comes off disk or over HTTP goes through normalizeThread,
// so a corrupt or hand-edited file can never break the app.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const TITLE_LIMIT = 80;

// Synchronous pause without a timer: the write path is synchronous by design,
// so a retry cannot be a Promise.
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function cleanText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function isoOr(value, fallback) {
  if (typeof value === 'string') {
    const time = Date.parse(value);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return fallback;
}

// A dev-server address the user pinned to one chat. Only http(s) is kept: a
// "javascript:" or "data:" value here would end up in an iframe src.
function cleanPreview(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href.slice(0, 300);
  } catch {
    return '';
  }
}

// A half-finished answer kept after a dropped connection, so a refresh does not
// throw away what the model already said.
function normalizeDraft(value) {
  const content = typeof value?.content === 'string' ? value.content.trim() : '';
  if (!content) return null;
  return {
    content: content.slice(0, 60_000),
    model: typeof value?.model === 'string' ? value.model.slice(0, 120) : null,
    at: isoOr(value?.at, new Date().toISOString()),
  };
}

/** The sidebar title: the first thing the user said, on one line. */
export function makeTitle(messages, fallback = 'New chat') {
  const source = Array.isArray(messages) ? messages : [];
  const first = source.find(
    (m) => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim(),
  );
  if (!first) return fallback;
  const text = first.content.replace(/\s+/g, ' ').trim();
  return text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT - 1)}…` : text;
}

export function normalizeMessages(input, maxMessages) {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.length > 0,
    )
    .slice(-maxMessages)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 120_000),
      ...(m.role === 'user' && cleanImages(m.images).length ? { images: cleanImages(m.images) } : {}),
      model: typeof m.model === 'string' ? m.model : null,
      tools: Array.isArray(m.tools)
        ? m.tools
            .filter((t) => t && typeof t.name === 'string')
            .slice(0, 40)
            .map((t) => ({
              name: t.name.slice(0, 60),
              preview: typeof t.preview === 'string' ? t.preview.slice(0, 300) : '',
              ok: t.ok !== false,
            }))
        : null,
      log: Array.isArray(m.log)
        ? m.log
            .filter((line) => typeof line === 'string' && line.trim())
            .slice(0, 20)
            .map((line) => line.slice(0, 300))
        : null,
      // Kept so the footer's token total survives a restart instead of
      // resetting to zero when a saved chat is reopened.
      usage:
        m.usage && typeof m.usage === 'object'
          ? {
              prompt_tokens: Number(m.usage.prompt_tokens) || 0,
              completion_tokens: Number(m.usage.completion_tokens) || 0,
            }
          : null,
    }));
}

export function normalizeThread(input, { maxMessages = 200, id, createdAt, touch = false } = {}) {
  const messages = normalizeMessages(input?.messages, maxMessages);
  const now = new Date().toISOString();
  const wanted = id ?? (typeof input?.id === 'string' && ID_PATTERN.test(input.id) ? input.id : null);
  const requests = Number(input?.requests);
  return {
    id: wanted ?? randomUUID(),
    title: cleanText(input?.title, 120) || makeTitle(messages),
    createdAt: createdAt ?? isoOr(input?.createdAt, now),
    updatedAt: touch ? now : isoOr(input?.updatedAt, now),
    requests: Number.isFinite(requests) ? Math.min(Math.max(Math.round(requests), 0), 100000) : 0,
    rev: Number.isFinite(Number(input?.rev)) ? Math.max(0, Math.round(Number(input.rev))) : 0,
    draft: normalizeDraft(input?.draft),
    preview: cleanPreview(input?.preview),
    messages,
  };
}

export function openStore(file, options = {}) {
  const maxThreads = options.maxThreads ?? 200;
  const maxMessages = options.maxMessages ?? 200;
  let cache = null;

  function read() {
    if (cache) return cache;
    let threads = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const list = Array.isArray(parsed?.threads) ? parsed.threads : [];
      threads = list.map((raw) =>
        normalizeThread(raw, {
          maxMessages,
          id: typeof raw?.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : undefined,
          createdAt: isoOr(raw?.createdAt, new Date().toISOString()),
        }),
      );
    } catch {
      /* missing or unreadable: start empty rather than crash */
    }
    threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    cache = { version: 1, threads: threads.slice(0, maxThreads) };
    return cache;
  }

  function write(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);

    // On Windows an antivirus scanner, an open editor or a backup agent can hold
    // the target for a few milliseconds and rename then fails with EPERM/EBUSY.
    // Retrying briefly turns a lost save into a successful one; the cache is
    // only updated once the file is really on disk, so a failure is reported
    // instead of pretending the chat was saved.
    let failure = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.renameSync(temp, file);
        failure = null;
        break;
      } catch (error) {
        failure = error;
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) break;
        sleepSync(20 * (attempt + 1));
      }
    }
    if (failure) {
      try {
        fs.unlinkSync(temp);
      } catch {
        /* the temp file is gone already */
      }
      throw failure;
    }
    cache = data;
  }

  function list(query = '') {
    const needle = String(query ?? '').trim().toLowerCase();
    const threads = read().threads;
    const matched = needle
      ? threads.filter(
          (t) =>
            t.title.toLowerCase().includes(needle) ||
            t.messages.some(
              (m) => typeof m.content === 'string' && m.content.toLowerCase().includes(needle),
            ),
        )
      : threads;
    return matched.map((t) => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      messageCount: t.messages.length,
    }));
  }

  function get(id) {
    const thread = read().threads.find((t) => t.id === id);
    return thread ? structuredClone(thread) : null;
  }

  function all() {
    return read().threads.map((t) => structuredClone(t));
  }

  function put(id, body, { ifRev } = {}) {
    const data = read();
    const index = id ? data.threads.findIndex((t) => t.id === id) : -1;
    const existing = index >= 0 ? data.threads[index] : null;

    // Two tabs editing one chat: refuse a write that started from an older copy
    // instead of silently dropping whatever the other tab just saved.
    if (existing && Number.isInteger(ifRev) && (existing.rev ?? 0) !== ifRev) {
      throw Object.assign(new Error('This chat was changed in another tab.'), {
        status: 409,
        thread: structuredClone(existing),
      });
    }

    const thread = normalizeThread(body, {
      maxMessages,
      id: id ?? existing?.id,
      createdAt: existing?.createdAt,
      touch: true,
    });
    thread.rev = (existing?.rev ?? 0) + 1;

    if (index >= 0) data.threads[index] = thread;
    else data.threads.unshift(thread);

    data.threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    data.threads = data.threads.slice(0, maxThreads);
    write(data);
    return thread;
  }

  // Keep a partial answer without touching the message list or the sort order.
  function setDraft(id, draft) {
    const data = read();
    const thread = data.threads.find((t) => t.id === id);
    if (!thread) return null;
    const next = normalizeDraft(draft);
    if (!next) return null;
    thread.draft = next;
    write(data);
    return structuredClone(thread);
  }

  // Setting the preview must not bump rev or reorder the list: it is not an
  // edit of the conversation, so it cannot cause a stale-write conflict.
  function setPreview(id, value) {
    const data = read();
    const thread = data.threads.find((t) => t.id === id);
    if (!thread) return null;
    const next = cleanPreview(value);
    if (thread.preview === next) return structuredClone(thread);
    thread.preview = next;
    write(data);
    return structuredClone(thread);
  }

  function remove(id) {
    const data = read();
    const next = data.threads.filter((t) => t.id !== id);
    if (next.length === data.threads.length) return false;
    write({ version: 1, threads: next });
    return true;
  }

  function importAll(payload, mode = 'merge') {
    const incoming = Array.isArray(payload?.threads)
      ? payload.threads
      : Array.isArray(payload)
        ? payload
        : [];
    if (incoming.length === 0) {
      throw Object.assign(new Error('No chats found in that file.'), { status: 400 });
    }

    const threads = mode === 'replace' ? [] : [...read().threads];
    let imported = 0;
    for (const raw of incoming.slice(0, maxThreads)) {
      const thread = normalizeThread(raw, { maxMessages });
      const at = threads.findIndex((t) => t.id === thread.id);
      if (at >= 0) threads[at] = thread;
      else threads.push(thread);
      imported += 1;
    }

    threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const kept = threads.slice(0, maxThreads);
    write({ version: 1, threads: kept });
    return { imported, total: kept.length, replaced: mode === 'replace' };
  }

  return { file, list, get, all, put, remove, importAll, setDraft, setPreview };
}
