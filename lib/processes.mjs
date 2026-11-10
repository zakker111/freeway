// Long-running programs the model starts in Build: a dev server, a watcher,
// a preview. The manager owns the lifetime, a bounded output buffer and the
// port the program prints, so a chat never leaves an orphan behind.
//
// Safety comes from the command runner: allowlist, `shell: false`, filtered
// env and workspace containment are all checked before a child exists. This
// file only adds a cap on how many may run, a hard stop and log bounds.

import net from 'node:net';

const MAX_PROCESSES = 3;
const MAX_BUFFER_BYTES = 32 * 1024;
const MAX_LOG_BYTES = 12 * 1024;
const READY_TIMEOUT_MS = 10_000;
const READY_POLL_MS = 200;
const TTL_MS = 30 * 60 * 1000;
const STOP_GRACE_MS = 3_000;
const MAX_RECORDS = 8;

// Dev servers print a URL, "localhost:5173" or "port 8000". Anything vaguer
// (a duration, a PID) is not a port, so it is never offered as one.
const URL_PORT = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\[::\])(?::(\d{2,5}))?/gi;
const HOST_PORT = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/gi;
const PORT_WORD = /\b(?:port|listening(?:\s+on)?|serving(?:\s+on)?)\s*[:=]?\s*(\d{2,5})\b/gi;

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validPort(value, exclude) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (exclude.includes(port)) return null;
  return port;
}

/** The first port a program prints, or null. Pure, so it is cheap to test. */
export function detectPort(text, { exclude = [] } = {}) {
  const source = String(text ?? '').slice(-16 * 1024);
  for (const pattern of [URL_PORT, HOST_PORT, PORT_WORD]) {
    for (const match of source.matchAll(pattern)) {
      const port = validPort(match[1], exclude);
      if (port) return port;
    }
  }
  return null;
}

function probeHost(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** A printed URL is only claimed once something actually accepts there. */
export async function portIsOpen(port, timeoutMs = 500) {
  if (!Number.isInteger(port)) return false;
  // Vite and friends may bind ::1 only, while others bind 127.0.0.1 only.
  const results = await Promise.all([
    probeHost('127.0.0.1', port, timeoutMs),
    probeHost('::1', port, timeoutMs),
  ]);
  return results.some(Boolean);
}

export function createProcessManager({
  getRunner,
  maxProcesses = MAX_PROCESSES,
  maxBufferBytes = MAX_BUFFER_BYTES,
  maxLogBytes = MAX_LOG_BYTES,
  readyTimeoutMs = READY_TIMEOUT_MS,
  ttlMs = TTL_MS,
  excludePorts = [],
  now = () => Date.now(),
} = {}) {
  const records = [];
  let sequence = 0;

  const view = (record) => ({
    id: record.id,
    program: record.program,
    args: record.args.slice(),
    cwd: record.cwd,
    status: record.status,
    pid: record.pid,
    port: record.port,
    url: record.url,
    ready: record.ready,
    startedAt: new Date(record.startedAt).toISOString(),
    ms: record.endedAt ? record.endedAt - record.startedAt : now() - record.startedAt,
    exitCode: record.exitCode,
    signal: record.signal ?? null,
    error: record.error ?? null,
  });

  const running = () => records.filter((record) => record.status === 'running');

  function prune() {
    // Finished records are kept for their last output, but not without bound.
    while (records.length > MAX_RECORDS) {
      const index = records.findIndex((record) => record.status !== 'running');
      if (index === -1) break;
      records.splice(index, 1);
    }
  }

  function append(record, text) {
    if (!text) return;
    record.bytes += Buffer.byteLength(text);
    record.chunks.push({ text });
    // Keep the tail, not the whole stream: a watcher can print forever.
    let total = record.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
    while (total > maxBufferBytes && record.chunks.length > 1) {
      total -= record.chunks.shift().text.length;
      record.dropped = true;
    }

    // A URL can be split across writes ("http://localhost:" then "5173").
    // Scan a bounded tail of the accumulated output, not just this chunk.
    record.scan = `${record.scan}${text}`.slice(-16 * 1024);
    const found = detectPort(record.scan, { exclude: excludePorts });
    if (found && found !== record.port) {
      record.port = found;
      record.ready = false;
      record.url = `http://127.0.0.1:${found}`;
    }
  }

  function find(id) {
    if (id) return records.find((record) => record.id === String(id)) ?? null;
    const active = running();
    return active[active.length - 1] ?? records[records.length - 1] ?? null;
  }

  async function waitForExit(record, ms) {
    const deadline = now() + ms;
    while (record.status === 'running' && now() < deadline) await sleepMs(50);
  }

  /**
   * Start one program and wait briefly for its port. Throws before spawning
   * when the allowlist, workspace or cap refuses it.
   */
  async function start(input = {}, { root = '' } = {}) {
    const runner = getRunner?.(root) ?? null;
    if (!runner) {
      throw new Error('Managed processes are available in the desktop app only.');
    }
    if (!runner.isReady) {
      throw new Error(
        'Running programs is off. Ask the user to enable it and add the program in Settings.',
      );
    }
    if (running().length >= maxProcesses) {
      throw new Error(
        `Already running ${maxProcesses} managed processes. Stop one with stop_process before starting another.`,
      );
    }

    const started = runner.start(input);
    sequence += 1;
    const record = {
      id: `dev-${sequence}`,
      program: started.program,
      args: started.args,
      cwd: started.cwd,
      pid: started.pid,
      status: 'running',
      startedAt: now(),
      endedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      port: null,
      url: '',
      ready: false,
      chunks: [],
      bytes: 0,
      scan: '',
      dropped: false,
      stopRequested: false,
      kill: started.stop,
      timers: [],
    };
    records.push(record);
    prune();

    const { child } = started;
    const finish = (code, signal, error) => {
      if (record.status !== 'running') return;
      record.status = record.stopRequested ? 'stopped' : 'exited';
      record.exitCode = typeof code === 'number' ? code : null;
      record.signal = signal ?? null;
      if (error) record.error = String(error?.message ?? error);
      record.endedAt = now();
      for (const timer of record.timers) clearTimeout(timer);
      record.timers.length = 0;
    };

    child.stdout?.on('data', (chunk) => append(record, String(chunk)));
    child.stderr?.on('data', (chunk) => append(record, String(chunk)));
    child.on?.('error', (error) => {
      record.error =
        error?.code === 'ENOENT'
          ? `${started.program} is not on PATH on this computer.`
          : String(error?.message ?? error);
      finish(null, null, error);
    });
    child.on?.('close', (code, signal) => finish(code, signal, null));

    // A managed server must not outlive its usefulness if nobody stops it.
    const ttl = setTimeout(() => {
      if (record.status !== 'running') return;
      record.stopRequested = true;
      record.error = `Stopped after ${Math.round(ttlMs / 60000)} minutes.`;
      try {
        record.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      record.timers.push(
        setTimeout(() => {
          try {
            record.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }, STOP_GRACE_MS),
      );
    }, ttlMs);
    ttl.unref?.();
    record.timers.push(ttl);

    const deadline = now() + readyTimeoutMs;
    while (record.status === 'running' && now() < deadline) {
      if (record.port && (await portIsOpen(record.port))) {
        record.ready = true;
        break;
      }
      await sleepMs(READY_POLL_MS);
    }
    return record;
  }

  /** Output since the buffer began, clipped to the newest `bytes`. */
  function logs(id, { bytes = 6000 } = {}) {
    const record = find(id);
    if (!record) return null;
    const limit = Math.min(Math.max(Number(bytes) || 6000, 500), maxLogBytes);
    let text = record.chunks.map((chunk) => chunk.text).join('');
    let clipped = record.dropped;
    if (text.length > limit) {
      text = text.slice(-limit);
      clipped = true;
    }
    return { process: view(record), text, clipped, bytes: record.bytes };
  }

  /** Stop one id, or everything still running when id is omitted. */
  async function stop(id) {
    const targets = id
      ? records.filter((record) => record.id === String(id))
      : running();
    if (id && targets.length === 0) return null;
    for (const record of targets) {
      if (record.status !== 'running') continue;
      record.stopRequested = true;
      try {
        record.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      await waitForExit(record, STOP_GRACE_MS);
      if (record.status === 'running') {
        try {
          record.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        await waitForExit(record, 1000);
      }
      if (record.status === 'running') {
        record.status = 'stopped';
        record.endedAt = now();
      }
    }
    return targets.map(view);
  }

  /** Best effort on quit: no waiting, no port left listening. */
  function stopAllSync() {
    for (const record of records) {
      if (record.status !== 'running') continue;
      record.stopRequested = true;
      try {
        record.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }

  async function stopAll() {
    await stop();
    stopAllSync();
  }

  return {
    start,
    logs,
    stop,
    stopAll,
    stopAllSync,
    list: () => records.map(view),
    running,
  };
}

export const processLimits = {
  MAX_PROCESSES,
  MAX_BUFFER_BYTES,
  MAX_LOG_BYTES,
  READY_TIMEOUT_MS,
  TTL_MS,
};
