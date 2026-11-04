// Masks anything that looks like a key before it reaches a log line or an
// error message shown in the browser. Cheap, and it runs on every error.

const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const OPENROUTER_KEY = /\bsk-or-[A-Za-z0-9_-]{8,}/g;

export function scrubSecrets(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return value.replace(BEARER, 'Bearer [redacted]').replace(OPENROUTER_KEY, 'sk-or-[redacted]');
}
