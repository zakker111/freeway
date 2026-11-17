import { cleanImages } from './models.mjs';
import { normalizePlan } from './plan.mjs';

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

// A chat owns its files. A string is an explicit folder, an empty string is
// the app-managed folder for this chat, and null means a pre-2.10 chat that
// still uses the one workspace from Settings. Keeping the three states
// distinct is what lets old chats keep their files while a new chat starts
// empty.
function cleanWorkspace(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, 500);
}

// The picker choice belongs to the chat, not to the window. It is only a
// preference: a model that disappears from the catalog is replaced on load.
function cleanThreadModel(value) {
  if (typeof value !== 'string') return null;
  const model = value.trim().slice(0, 120);
  return model || null;
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
  const workspace = cleanWorkspace(input?.workspace);
  return {
    // Absent on older threads; their files live in the old global workspace.
    ...(workspace !== undefined ? { workspace } : {}),
    id: wanted ?? randomUUID(),
    title: cleanText(input?.title, 120) || makeTitle(messages),
    createdAt: createdAt ?? isoOr(input?.createdAt, now),
    updatedAt: touch ? now : isoOr(input?.updatedAt, now),
    requests: Number.isFinite(requests) ? Math.min(Math.max(Math.round(requests), 0), 100000) : 0,
    rev: Number.isFinite(Number(input?.rev)) ? Math.max(0, Math.round(Number(input.rev))) : 0,
    draft: normalizeDraft(input?.draft),
    preview: cleanPreview(input?.preview),
    // New chats start in Plan. Older threads have no field and keep opening in
    // Build, which is the mode they were created in.
    mode: input?.mode === 'plan' ? 'plan' : 'build',
    model: cleanThreadModel(input?.model),
    plan: normalizePlan(input?.plan),
    messages,
  };
}

/**
 * A warning read back from disk: paths, a recovered flag, counts and a time.
 * Anything else in a hand-edited file is dropped.
 */
function cleanWarningEvent(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const at = isoOr(raw.at, '');
  if (!at) return undefined;
  const threads = Number(raw.threads);
  return {
    quarantined: typeof raw.quarantined === 'string' && raw.quarantined ? raw.quarantined : null,
    recovered: raw.recovered === true,
    threads: Number.isFinite(threads) ? Math.min(Math.max(Math.round(threads), 0), 100000) : 0,
    at,
  };
}

function normalizeWarning(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const next = {};
  const corrupt = cleanWarningEvent(raw.corrupt);
  if (corrupt) next.corrupt = corrupt;
  const archiveCorrupt = cleanWarningEvent(raw.archiveCorrupt);
  if (archiveCorrupt) next.archiveCorrupt = archiveCorrupt;
  const archived = Number(raw.archived);
  if (Number.isFinite(archived) && archived > 0) next.archived = Math.min(Math.round(archived), 100000);
  return Object.keys(next).length ? next : null;
}

export function openStore(file, options = {}) {
  const maxThreads = options.maxThreads ?? 200;
  const maxMessages = options.maxMessages ?? 200;
  const maxArchived = options.maxArchived ?? 1000;
  const base = file.replace(/\.json$/i, '');
  const archivePath = `${base}-archive.json`;
  const archiveBackupPath = `${archivePath}.bak`;
  const backupPath = `${file}.bak`;
  // The warning lives on disk too: a relaunch must still explain a chat list
  // that came back empty or shorter than the one the user left.
  const warningPath = `${base}-warning.json`;
  let cache = null;
  let archivedCache = null;
  let warningLoaded = false;
  // Set when this store had to protect the user's data: a damaged file was
  // quarantined, a good backup was used instead, or chats were moved to the
  // archive instead of being deleted. The page shows it; clearing it never
  // deletes anything.
  let warning = null;

  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

  function parseThreads(text) {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed?.threads) ? parsed.threads : [];
    return list.map((raw) =>
      normalizeThread(raw, {
        maxMessages,
        id: typeof raw?.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : undefined,
        createdAt: isoOr(raw?.createdAt, new Date().toISOString()),
      }),
    );
  }

  /**
   * Leave the last good file next to the store. A damaged write, a half-written
   * file from a crash or a bad hand edit can then be recovered from instead of
   * starting the user from nothing.
   */
  function backupCurrent() {
    try {
      if (!fs.existsSync(file)) return;
      fs.copyFileSync(file, backupPath);
    } catch {
      /* a backup is a safety net, never a reason to fail the save */
    }
  }

  /** The archive gets the same safety net, so a damaged one is recoverable. */
  function backupArchive() {
    try {
      if (!fs.existsSync(archivePath)) return;
      fs.copyFileSync(archivePath, archiveBackupPath);
    } catch {
      /* a backup is a safety net, never a reason to fail the save */
    }
  }

  /** Read the warning the last run left behind, once. */
  function loadWarning() {
    if (warningLoaded) return;
    warningLoaded = true;
    try {
      warning = normalizeWarning(JSON.parse(fs.readFileSync(warningPath, 'utf8'))?.warning);
    } catch {
      warning = null;
    }
  }

  function saveWarning() {
    try {
      if (!warning) {
        fs.rmSync(warningPath, { force: true });
        return;
      }
      writeAtomic(warningPath, { version: 1, warning });
    } catch {
      /* the page still hears about it this run; a lost warning must not fail a read */
    }
  }

  /** Record what the user has to know, and keep it after a restart. */
  function noteWarning(patch) {
    loadWarning();
    warning = { ...(warning || {}), ...patch };
    saveWarning();
  }

  /** Atomic replace: temp file, rename, and a short retry for a held file. */
  function writeAtomic(target, data) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });

    // On Windows an antivirus scanner, an open editor or a backup agent can hold
    // the target for a few milliseconds and rename then fails with EPERM/EBUSY.
    // Retrying briefly turns a lost save into a successful one; the cache is
    // only updated once the file is really on disk, so a failure is reported
    // instead of pretending the chat was saved.
    let failure = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.renameSync(temp, target);
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
    // `mode` only applies when the file is created. An older threads.json may
    // already be 0644; tighten it here without failing on Windows.
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      /* Windows and restricted filesystems may ignore the mode */
    }
  }

  function write(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    backupCurrent();
    writeAtomic(file, data);
    cache = data;
  }

  /** Every archive write keeps the previous copy next to it. */
  function writeArchive(threads) {
    backupArchive();
    writeAtomic(archivePath, { version: 1, threads });
    archivedCache = threads;
  }

  function readArchived() {
    if (archivedCache) return archivedCache;
    loadWarning();
    let threads = [];
    let damaged = false;
    try {
      if (fs.statSync(archivePath).isFile()) {
        const text = fs.readFileSync(archivePath, 'utf8');
        if (text.trim()) {
          try {
            threads = parseThreads(text);
          } catch {
            damaged = true;
          }
        }
      }
    } catch {
      /* no archive yet: nothing has been moved away */
    }

    if (damaged) {
      const quarantined = quarantine(archivePath);
      let recovered = false;
      try {
        threads = parseThreads(fs.readFileSync(archiveBackupPath, 'utf8'));
        recovered = true;
      } catch {
        threads = [];
      }
      noteWarning({
        archiveCorrupt: {
          quarantined,
          recovered,
          threads: threads.length,
          at: new Date().toISOString(),
        },
      });
    }

    threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    archivedCache = threads.slice(0, maxArchived);
    // A recovered archive has to be on disk again, or the next launch reads a
    // missing file and the backup is the only copy left.
    if (damaged && archivedCache.length) writeArchive(archivedCache);
    return archivedCache;
  }

  /** Newest first, one entry per id, never past the archive cap. */
  function mergeArchive(base, extra) {
    const byId = new Map(base.map((thread) => [thread.id, thread]));
    for (const thread of extra) if (!byId.has(thread.id)) byId.set(thread.id, thread);
    return [...byId.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, maxArchived);
  }

  /**
   * Chats that no longer fit in the active store. They are kept in their own
   * file (restorable, and included in an export) instead of being dropped. The
   * active list is capped; the archive is capped too, so an import loop cannot
   * grow it without end.
   */
  function archiveThreads(list) {
    if (!list.length) return;
    writeArchive(mergeArchive(readArchived(), list));
  }

  function cap(threads) {
    const sorted = [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (sorted.length <= maxThreads) return { kept: sorted, overflow: [] };
    return { kept: sorted.slice(0, maxThreads), overflow: sorted.slice(maxThreads) };
  }

  /** Move a damaged file aside instead of overwriting it on the next save. */
  function quarantine(victim = file) {
    const target = `${victim}.corrupt-${stamp()}`;
    try {
      fs.renameSync(victim, target);
      return target;
    } catch {
      try {
        fs.copyFileSync(victim, target);
        fs.unlinkSync(victim);
        return target;
      } catch {
        return null;
      }
    }
  }

  function read() {
    if (cache) return cache;
    loadWarning();
    let threads = [];
    let damaged = false;
    try {
      if (fs.statSync(file).isFile()) {
        const text = fs.readFileSync(file, 'utf8');
        if (text.trim()) {
          try {
            threads = parseThreads(text);
          } catch {
            damaged = true;
          }
        }
      }
    } catch {
      /* missing file: a normal first run */
    }

    if (damaged) {
      const quarantined = quarantine();
      let recovered = false;
      try {
        threads = parseThreads(fs.readFileSync(backupPath, 'utf8'));
        recovered = true;
      } catch {
        threads = [];
      }
      noteWarning({
        corrupt: { quarantined, recovered, threads: threads.length, at: new Date().toISOString() },
      });
    }

    const { kept, overflow } = cap(threads);
    cache = { version: 1, threads: kept };
    if (overflow.length) {
      // A file written by an older build (or hand-edited) can hold more chats
      // than the active limit. Archive the extra ones instead of letting the
      // next save drop them, and say so.
      archiveThreads(overflow);
      write(cache);
      noteWarning({ archived: (warning?.archived || 0) + overflow.length });
    } else if (damaged && kept.length) {
      // The recovered chats must be on disk again: otherwise the next launch
      // reads a missing file and only the backup is left.
      write(cache);
    }
    return cache;
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
    // Work on a shallow copy. The cache must stay on the old version until
    // write() has renamed the temp file into place; mutating it first makes a
    // failed save look successful in memory.
    const current = read();
    const data = { ...current, threads: [...current.threads] };
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

    // A partial save (a rename, a preview change or the server's crash rescue)
    // must not quietly move an existing chat back to the legacy workspace.
    const bodyWithWorkspace =
      body?.workspace === undefined && existing?.workspace !== undefined
        ? { ...body, workspace: existing.workspace }
        : body;
    // A rename or a preview save must not forget the model this chat was using.
    const bodyWithModel =
      bodyWithWorkspace?.model === undefined && existing?.model !== undefined
        ? { ...bodyWithWorkspace, model: existing.model }
        : bodyWithWorkspace;
    const thread = normalizeThread(bodyWithModel, {
      maxMessages,
      id: id ?? existing?.id,
      createdAt: existing?.createdAt,
      touch: true,
    });
    if (index < 0) {
      const clash = data.threads.findIndex((t) => t.id === thread.id);
      if (clash >= 0) {
        throw Object.assign(new Error('A chat with that id already exists.'), {
          status: 409,
          thread: structuredClone(data.threads[clash]),
        });
      }
    }
    thread.rev = (existing?.rev ?? 0) + 1;

    if (index >= 0) data.threads[index] = thread;
    else data.threads.unshift(thread);

    const { kept, overflow } = cap(data.threads);
    if (overflow.length) archiveThreads(overflow);
    data.threads = kept;
    write(data);
    return thread;
  }

  // Keep a partial answer without touching the message list or the sort order.
  function setDraft(id, draft) {
    const current = read();
    const index = current.threads.findIndex((t) => t.id === id);
    if (index < 0) return null;
    const next = normalizeDraft(draft);
    if (!next) return null;
    const thread = { ...current.threads[index], draft: next };
    const threads = [...current.threads];
    threads[index] = thread;
    write({ ...current, threads });
    return structuredClone(thread);
  }

  // Setting the preview must not bump rev or reorder the list: it is not an
  // edit of the conversation, so it cannot cause a stale-write conflict.
  function setPreview(id, value) {
    const current = read();
    const index = current.threads.findIndex((t) => t.id === id);
    if (index < 0) return null;
    const next = cleanPreview(value);
    const currentThread = current.threads[index];
    if (currentThread.preview === next) return structuredClone(currentThread);
    const thread = { ...currentThread, preview: next };
    const threads = [...current.threads];
    threads[index] = thread;
    write({ ...current, threads });
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
    for (const raw of incoming) {
      const thread = normalizeThread(raw, { maxMessages });
      const at = threads.findIndex((t) => t.id === thread.id);
      if (at >= 0) threads[at] = thread;
      else threads.push(thread);
      imported += 1;
    }

    // An export may also carry the chats that were archived at the cap; keep
    // them so a backup and restore is lossless.
    const archivedIncoming = Array.isArray(payload?.archived)
      ? payload.archived.map((raw) => normalizeThread(raw, { maxMessages }))
      : [];
    if (archivedIncoming.length) archiveThreads(archivedIncoming);

    const { kept, overflow } = cap(threads);
    if (overflow.length) archiveThreads(overflow);
    write({ version: 1, threads: kept });
    return {
      imported,
      total: kept.length + readArchived().length,
      replaced: mode === 'replace',
      archived: readArchived().length,
    };
  }

  function archived() {
    return readArchived().map((t) => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      messageCount: t.messages.length,
    }));
  }

  function archivedAll() {
    return readArchived().map((t) => structuredClone(t));
  }

  function archiveCount() {
    return readArchived().length;
  }

  /**
   * Bring one archived chat back. With no id the newest archived chat returns,
   * and when the active list is full the chat it displaces goes to the archive,
   * so restoring never deletes anything.
   */
  function restoreArchived(id) {
    const threads = [...readArchived()];
    const index = id ? threads.findIndex((t) => t.id === id) : 0;
    // An empty archive is not an error, it is just nothing to restore.
    if (index < 0 || !threads[index]) return null;
    const [thread] = threads.splice(index, 1);
    const restored = normalizeThread(thread, {
      maxMessages,
      id: thread.id,
      createdAt: thread.createdAt,
    });

    // The restored chat gets one slot and whatever it displaces is archived,
    // so restoring never deletes a chat.
    const current = read();
    const others = current.threads
      .filter((t) => t.id !== restored.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const room = Math.max(maxThreads - 1, 0);
    const kept = [restored, ...others.slice(0, room)].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    // Removing the restored chat and adding what it displaced is one write, so
    // the copy kept as the archive's backup is a real one.
    writeArchive(mergeArchive(threads, others.slice(room)));
    write({ ...current, threads: kept });
    return structuredClone(restored);
  }

  /** What the page should tell the user, if anything. Reading sets it. */
  function warningInfo() {
    read();
    // A damaged archive is only noticed when the archive is read, and the page
    // must hear about it on the same request, not on some later one.
    readArchived();
    return warning;
  }

  function clearWarning() {
    warning = null;
    warningLoaded = true;
    saveWarning();
    return true;
  }

  return {
    file,
    archivePath,
    list,
    get,
    all,
    put,
    remove,
    importAll,
    setDraft,
    setPreview,
    archived,
    archivedAll,
    archiveCount,
    restoreArchived,
    warning: warningInfo,
    clearWarning,
  };
}
