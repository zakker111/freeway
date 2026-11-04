// Session telemetry: which model answered, which fell over and how long each
// attempt took. Deliberately in memory only — nothing is written to disk, so a
// restart starts clean and no usage history outlives the process.

const STATUS_MAX_ENTRIES = 60;

// Anything the chat loop can decide about one attempt. Unknown values are
// recorded as "request" so a typo can never create an unrenderable row.
const KNOWN = new Set(['ok', 'rate-limit', 'upstream', 'request', 'network', 'stream', 'credit']);

function cleanModel(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null;
}

export function createStatusLog({ limit = STATUS_MAX_ENTRIES, now = Date.now } = {}) {
  const startedAt = now();
  const entries = [];

  function record(input = {}) {
    const entry = {
      at: new Date(now()).toISOString(),
      model: cleanModel(input.model),
      attempt: Number.isInteger(input.attempt) && input.attempt > 0 ? input.attempt : 1,
      status: KNOWN.has(input.status) ? input.status : 'request',
      ms: Number.isFinite(input.ms) ? Math.max(0, Math.round(input.ms)) : null,
    };
    entries.push(entry);
    // A bounded buffer: the page never needs the whole session, and growing an
    // array for hours of use is pointless.
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    return entry;
  }

  function list() {
    // Newest last, matching the order the chat loop produced them.
    return entries.slice();
  }

  function summary() {
    const total = entries.length;
    const ok = entries.filter((entry) => entry.status === 'ok').length;
    const timed = entries.filter((entry) => Number.isFinite(entry.ms));
    const avgMs = timed.length
      ? Math.round(timed.reduce((sum, entry) => sum + entry.ms, 0) / timed.length)
      : null;
    return {
      since: new Date(startedAt).toISOString(),
      requests: total,
      ok,
      failed: total - ok,
      // null rather than 0 when nothing has happened: "no data" is not "0%".
      successRate: total ? Math.round((ok / total) * 100) : null,
      avgMs,
      slowestMs: timed.length ? Math.max(...timed.map((entry) => entry.ms)) : null,
    };
  }

  function reset() {
    entries.length = 0;
  }

  return { record, list, summary, reset, startedAt };
}

export const statusLimits = { MAX_ENTRIES: STATUS_MAX_ENTRIES };
