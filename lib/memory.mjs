import { cleanImages } from './models.mjs';

// Long-conversation memory, without another model call.
//
// A 40-turn coding session can exceed what a free model accepts, and trimming
// the oldest messages silently loses the original goal. Instead, older turns
// are folded into one compact system note (first request + recent old turns),
// while the newest messages stay verbatim. The full history is never deleted:
// this runs on a copy just before the upstream request, so reopening the chat
// still shows every message.

const DEFAULT_TRIGGER_TOKENS = 6000;
const DEFAULT_KEEP_MESSAGES = 10;
const DEFAULT_SUMMARY_CHARS = 1800;
const DEFAULT_LINE_CHARS = 180;

export const MEMORY_DEFAULTS = {
  triggerTokens: DEFAULT_TRIGGER_TOKENS,
  keepMessages: DEFAULT_KEEP_MESSAGES,
  summaryChars: DEFAULT_SUMMARY_CHARS,
  lineChars: DEFAULT_LINE_CHARS,
};

const ROLES = new Set(['system', 'user', 'assistant']);

/** Same cheap estimate the model picker uses: 4 characters per token. */
export function estimateMessageTokens(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let chars = 0;
  for (const message of list) {
    chars += String(message?.content ?? '').length;
    if (cleanImages(message?.images).length) chars += 3600;
  }
  return Math.ceil(chars / 4) + list.length * 4;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function oneLine(message, limit) {
  const text = String(message.content ?? '').replace(/\s+/g, ' ').trim();
  const label = message.role === 'user' ? 'User' : 'Assistant';
  const body = text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
  return `${label}: ${body}`;
}

/**
 * Compact `messages` when they exceed the trigger. Returns the original array
 * unchanged when no compaction is needed, so callers can compare `compacted`.
 */
export function compactMessages(input, options = {}) {
  const all = Array.isArray(input)
    ? input
        .filter(
          (message) =>
            message &&
            ROLES.has(message.role) &&
            typeof message.content === 'string' &&
            message.content.length > 0,
        )
        // Keep the image only when the turn survives verbatim.
        .map((message) => {
          const images = cleanImages(message.images);
          return {
            role: message.role,
            content: message.content,
            ...(images.length ? { images } : {}),
          };
        })
    : [];

  const triggerTokens = positive(options.triggerTokens, DEFAULT_TRIGGER_TOKENS);
  const keepMessages = Math.max(4, positive(options.keepMessages, DEFAULT_KEEP_MESSAGES));
  const summaryChars = Math.max(400, positive(options.summaryChars, DEFAULT_SUMMARY_CHARS));
  const lineChars = Math.max(40, positive(options.lineChars, DEFAULT_LINE_CHARS));

  const beforeTokens = estimateMessageTokens(all);
  if (beforeTokens <= triggerTokens || all.length <= keepMessages + 2) {
    return {
      messages: all,
      compacted: 0,
      omitted: 0,
      beforeTokens,
      afterTokens: beforeTokens,
      summary: '',
    };
  }

  const system = all.filter((message) => message.role === 'system');
  const body = all.filter((message) => message.role !== 'system');
  if (body.length <= keepMessages + 1) {
    return {
      messages: all,
      compacted: 0,
      omitted: 0,
      beforeTokens,
      afterTokens: beforeTokens,
      summary: '',
    };
  }

  let cut = body.length - keepMessages;
  // Start the verbatim window at a user turn when possible, so the model never
  // sees an assistant answer whose question was summarised away.
  while (cut < body.length && body[cut].role !== 'user') cut += 1;
  if (cut >= body.length) cut = body.length - keepMessages;

  const old = body.slice(0, cut);
  const recent = body.slice(cut);
  if (old.length === 0) {
    return {
      messages: all,
      compacted: 0,
      omitted: 0,
      beforeTokens,
      afterTokens: beforeTokens,
      summary: '',
    };
  }

  // The first user request is the anchor: keep it even if the rest of the
  // summary has to make room. Everything else is taken newest-first up to the
  // character budget, then put back in order.
  const firstUser = old.find((message) => message.role === 'user') ?? old[0];
  const firstLine = oneLine(firstUser, lineChars);
  const lines = [];
  let used = firstLine.length + 1;

  for (let index = old.length - 1; index >= 0; index -= 1) {
    const message = old[index];
    if (message === firstUser) continue;
    const line = oneLine(message, lineChars);
    if (used + line.length + 1 > summaryChars) break;
    lines.unshift(line);
    used += line.length + 1;
  }

  const included = lines.length + 1;
  const omitted = Math.max(0, old.length - included);
  const summary = [
    "Earlier in this conversation (compacted automatically to fit the model's context):",
    firstLine,
    ...lines,
    omitted > 0 ? `(${omitted} older message${omitted === 1 ? '' : 's'} omitted from this note.)` : '',
    'Continue from this summary. The messages after it are shown verbatim.',
  ]
    .filter(Boolean)
    .join('\n');

  const messages = [...system, { role: 'system', content: summary }, ...recent];
  return {
    messages,
    compacted: old.length,
    omitted,
    beforeTokens,
    afterTokens: estimateMessageTokens(messages),
    summary,
  };
}
