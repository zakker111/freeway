// Masks anything that looks like a key before it reaches a log line or an
// error message shown in the browser. Cheap, and it runs on every error.

const PATTERNS = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[private key redacted]'],
  [/\bsk-or-[A-Za-z0-9_-]{8,}/g, 'sk-or-[redacted]'],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, 'sk-[redacted]'],
  [/\bgsk_[A-Za-z0-9]{16,}/g, 'gsk_[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'gh*_[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_[redacted]'],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, 'glpat-[redacted]'],
  [/\bhf_[A-Za-z0-9]{20,}/g, 'hf_[redacted]'],
  [/\bnpm_[A-Za-z0-9]{20,}/g, 'npm_[redacted]'],
  [/\bpypi-[A-Za-z0-9_-]{20,}/g, 'pypi-[redacted]'],
  [/\bxai-[A-Za-z0-9]{16,}/g, 'xai-[redacted]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, 'AWS[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, 'JWT [redacted]'],
];

export function scrubSecrets(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}
