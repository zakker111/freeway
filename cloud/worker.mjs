// Cloud edition of Freeway — a single Cloudflare Worker module.
//
// What this keeps from the desktop app: free models only, the light toned
// page, one server-side proxy so the key never sits in the HTML, browser-local
// chats and files, and the browser-side GitHub rail. What it drops, because a
// Worker cannot do it: filesystem tools, the command runner, managed dev
// servers, and server-side GitHub tools. The GitHub rail calls api.github.com
// from the page with a session-only token.
//
// The cloud edition is guest-only: there is no account login, no server-side
// chat history, no account files and no portable preview shares.
//
// Routes
//   GET    /                         the page (served from ./public)
//   GET    /healthz                  200 "ok"
//   GET    /api/config               version, server keys and limits
//   GET    /api/models?provider=…    free models only, already priced and sorted
//   GET    /api/quota                OpenRouter free-request allowance
//   GET    /api/budget               this visitor's shared-key turns left today
//   POST   /api/chat                 { model, messages } -> SSE or JSON
//
// The key comes from env.OPENROUTER_API_KEY when the deployment has it, and
// otherwise from an `x-openrouter-key` header the page sends only for that
// request. Either way it is never stored, logged or echoed back.

import { compactMessages } from '../lib/memory.mjs';
import { cleanImages, recentImages, toUpstreamMessage } from '../lib/models.mjs';
import { withToolInstruction } from '../lib/tool-prompt.mjs';
import { scrubSecrets } from '../lib/redact.mjs';

const VERSION = '2.35.16-cloud';
const UPSTREAM = 'https://openrouter.ai/api/v1';
const MAX_BODY_BYTES = 1_500_000;
const MAX_MESSAGES = 60;
const MAX_TOTAL_CHARS = 56000;
const CATALOG_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 30;
// A deployment key is paid for by the owner and shared by everyone, so a turn
// that spends it is fenced to this site, budgeted per visitor, and capped in size.
const VISITOR_DAILY_LIMIT = 40;
const SHARED_TURN_TOKENS = 1024;

const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cache-control': 'no-store',
};

const PAGE_CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' https://api.github.com",
  "frame-src https:",
  "base-uri 'none'",
  // Guest-only cloud: nothing posts anywhere.
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// ---------------------------------------------------------------- catalog

let catalogCache = { at: 0, models: [], error: null };
// OpenRouter's per-key quota, shared by every visitor on a server key. Keep the
// exact key with the entry: a short suffix is not an identity, and two keys that
// happen to share one must never share cached quota data.
let quotaCache = { at: 0, key: '', data: null };
const hits = new Map();

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...BASE_HEADERS,
      ...extra,
    },
  });
}

/** Turn either Retry-After form (seconds or HTTP date) into a bounded delay. */
function retryAfterMsFrom(headers, fallbackMs = 60_000) {
  const raw = headers?.get?.('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(Math.round(seconds * 1000), 15 * 60_000);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) {
      const wait = date - Date.now();
      if (wait > 0) return Math.min(wait, 15 * 60_000);
    }
  }
  return Math.min(Math.max(Number(fallbackMs) || 60_000, 1_000), 15 * 60_000);
}

function retryHeader(ms) {
  return ms ? { 'retry-after': String(Math.max(1, Math.ceil(ms / 1000))) } : {};
}

function msUntilUtcMidnight() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}

/** OpenRouter writes prices as strings of dollars per token; free means "0". */
function isFree(model) {
  const pricing = model?.pricing ?? {};
  return String(pricing.prompt) === '0' && String(pricing.completion) === '0';
}

/**
 * Free *and* able to hold a conversation. Lyria and friends cost nothing per
 * text token because they bill for audio, so a price check alone would offer a
 * model that can never reply in this page. Require text output and no audio.
 */
function isFreeChatModel(model) {
  if (!isFree(model)) return false;
  const arch = model?.architecture ?? {};
  const outputs = Array.isArray(arch.output_modalities) ? arch.output_modalities : [];
  if (outputs.length) return outputs.includes('text') && !outputs.includes('audio');
  const modality = String(arch.modality ?? '');
  return modality ? modality.endsWith('->text') : true;
}

function isExpired(model, now = Date.now()) {
  if (!model?.expiration_date) return false;
  const at = Date.parse(model.expiration_date);
  return Number.isFinite(at) && at <= now;
}

function toPicker(model) {
  return {
    id: model.id,
    name: model.name ?? model.id,
    vendor: String(model.id).split('/')[0],
    context: model.context_length ?? 0,
    maxOutput: model?.top_provider?.max_completion_tokens ?? null,
    tools: Array.isArray(model?.supported_parameters) && model.supported_parameters.includes('tools'),
    vision:
      Array.isArray(model?.architecture?.input_modalities) &&
      model.architecture.input_modalities.includes('image'),
  };
}

async function loadCatalog(env, force = false) {
  const fresh = Date.now() - catalogCache.at < CATALOG_TTL_MS;
  if (!force && fresh && catalogCache.models.length) return catalogCache;
  // /api/config waits for this call, so it must never outlive the edge's own
  // patience: a slow catalog used to reach the ~5s limit and turn the first
  // visitor's page load into "Site unavailable" instead of a degraded page.
  let res;
  try {
    res = await fetch(`${baseFor(getProvider('openrouter'), env)}/models`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2_500),
    });
  } catch (error) {
    catalogCache = {
      at: Date.now() - CATALOG_TTL_MS + 30_000,
      models: catalogCache.models,
      error: scrubSecrets(`catalog fetch failed: ${String(error?.message ?? error).slice(0, 160)}`),
    };
    return catalogCache;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    catalogCache = {
      at: Date.now() - CATALOG_TTL_MS + 30_000, // retry in 30s, not 10min
      models: catalogCache.models,
      error: scrubSecrets(`catalog ${res.status}: ${text.slice(0, 200)}`),
    };
    return catalogCache;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    // A proxy or provider can answer 200 with an HTML error page or a truncated
    // body. Keep the last good catalog and retry soon instead of turning every
    // /api/models request into a generic 500.
    catalogCache = {
      at: Date.now() - CATALOG_TTL_MS + 30_000,
      models: catalogCache.models,
      error: 'catalog returned invalid JSON',
    };
    return catalogCache;
  }
  const models = Array.isArray(body?.data) ? body.data : [];
  catalogCache = { at: Date.now(), models, error: null };
  return catalogCache;
}

async function freeModels(env) {
  const { models } = await loadCatalog(env);
  return models
    .filter((m) => isFreeChatModel(m) && !isExpired(m))
    .map(toPicker)
    .sort((a, b) => (b.context - a.context) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- helpers

/** Browser requests carrying a shared key must come from this site. */
function isSameOriginRequest(request, expectedOrigin) {
  const origin = request.headers.get('origin');
  // A non-browser client has no Origin header; the per-visitor budget still applies.
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'local';
}

function overRate(ip) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

// ------------------------------------------------------------- providers
// Same policy as the desktop app: OpenRouter is verified by pricing; Groq and
// Gemini are free *by plan*, so an allowlist stands in for pricing and a deny
// list keeps billed models (Gemini Pro, Whisper, embeddings) out.
export const PROVIDERS = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    keyHint: 'sk-or-v1-…',
    base: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    keysUrl: 'https://openrouter.ai/settings/keys',
    policy: 'pricing',
    freePlan: 'standing-tier',
    // The key reports what is left; there is no fixed plan number to print.
    limits: { dynamic: true },
    note: 'Free models only — every id is checked against live pricing.',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    keyHint: 'gsk_…',
    base: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    keysUrl: 'https://console.groq.com/keys',
    policy: 'allowlist',
    freePlan: 'daily-quota',
    limits: { perMinute: 30, perDay: 1000 },
    allow: [/^openai\/gpt-oss-/i, /^qwen\//i, /^llama-3\.[13]/i, /^moonshotai\//i],
    deny: [/whisper/i, /tts/i, /guard/i, /embed/i],
    note: 'Free plan: about 30 requests/min, 1,000/day, no card. Groq (gsk_) is not xAI’s Grok.',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini (AI Studio)',
    keyHint: 'AIza…',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    nativeBase: 'https://generativelanguage.googleapis.com/v1beta',
    keyEnv: 'GEMINI_API_KEY',
    keysUrl: 'https://aistudio.google.com/apikey',
    policy: 'allowlist',
    freePlan: 'daily-quota',
    // Google sets these per model and moves them; no number is invented here.
    limits: { note: 'Per-model limits live in AI Studio; Google changes them per model.' },
    allow: [/flash/i, /gemma/i],
    deny: [/\bpro\b/i, /image/i, /imagen/i, /tts/i, /embed/i, /veo/i, /audio/i],
    note: 'Free plan. Pro and media models are excluded, so a billed key cannot spend here.',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral AI',
    keyHint: 'your Mistral key',
    base: 'https://api.mistral.ai/v1',
    keyEnv: 'MISTRAL_API_KEY',
    keysUrl: 'https://console.mistral.ai/api-keys',
    policy: 'allowlist',
    freePlan: 'daily-quota',
    limits: { note: 'Rate-limited per key; Mistral publishes no fixed number.' },
    allow: [/^mistral-small/i, /^ministral-/i, /^open-mistral/i, /^open-mixtral/i],
    deny: [/large/i, /medium/i, /embed/i, /moderation/i, /ocr/i, /audio/i, /voxtral/i],
    fallback: ['mistral-small-latest', 'ministral-8b-latest', 'open-mistral-nemo'],
    note: 'Free "Experiment" plan: no card, rate-limited per key. Small and ministral models only.',
  },
  cohere: {
    id: 'cohere',
    label: 'Cohere',
    keyHint: 'your Cohere trial key',
    base: 'https://api.cohere.ai/compatibility/v1',
    keyEnv: 'COHERE_API_KEY',
    keysUrl: 'https://dashboard.cohere.com/api-keys',
    policy: 'allowlist',
    freePlan: 'monthly-quota',
    limits: { perMinute: 20, perMonth: 1000 },
    allow: [/^command-/i, /^c4ai-aya/i, /^north-/i, /^tiny-aya/i],
    deny: [/embed/i, /rerank/i, /transcribe/i, /audio/i],
    fallback: ['command-a-03-2025', 'command-r7b-12-2024', 'command-r-plus-08-2024'],
    note: 'Trial key: 1,000 calls a month, 20 requests/min, no card.',
  },
  sambanova: {
    id: 'sambanova',
    label: 'SambaNova',
    keyHint: 'your SambaNova key',
    base: 'https://api.sambanova.ai/v1',
    keyEnv: 'SAMBANOVA_API_KEY',
    keysUrl: 'https://cloud.sambanova.ai/apis',
    policy: 'allowlist',
    freePlan: 'daily-quota',
    limits: { perMinute: 20, perDayPerModel: 20 },
    allow: [/llama/i, /deepseek/i, /gpt-oss/i, /gemma/i, /qwen/i],
    deny: [/embed/i, /whisper/i, /rerank/i, /guard/i],
    fallback: ['Meta-Llama-3.3-70B-Instruct', 'gpt-oss-120b'],
    note: 'Free plan without a payment method: 20 requests/min, 20/day per model.',
  },
  aionlabs: {
    id: 'aionlabs',
    label: 'Aion Labs',
    keyHint: 'your Aion Labs key',
    base: 'https://api.aionlabs.ai/v1',
    keyEnv: 'AION_API_KEY',
    keysUrl: 'https://www.aionlabs.ai/',
    policy: 'allowlist',
    freePlan: 'daily-quota',
    limits: { perMinute: 15, tokensPerDay: 20000 },
    allow: [/^aion-labs\//i],
    deny: [/image/i, /video/i, /embed/i, /tts/i, /audio/i],
    fallback: ['aion-labs/aion-3.5-mini', 'aion-labs/aion-2.0'],
    note: 'Free plan: 15 requests/min, 20,000 tokens a day, no card. Roleplay and storytelling models — small daily quota.',
  },
  zai: {
    id: 'zai',
    label: 'Z.AI',
    keyHint: 'your Z.AI key',
    base: 'https://api.z.ai/api/paas/v4',
    keyEnv: 'ZAI_API_KEY',
    keysUrl: 'https://z.ai/model-api',
    policy: 'allowlist',
    freePlan: 'standing-tier',
    limits: { note: 'GLM-4.7-Flash is free; the free Flash tier is concurrency-limited.' },
    allow: [/^glm-4\.7-flash$/i],
    deny: [/large/i, /max/i, /plus/i, /air/i, /flashx/i, /vision/i, /image/i, /video/i, /embed/i, /ocr/i, /audio/i],
    fallback: ['glm-4.7-flash'],
    note: 'GLM-4.7-Flash is free, with 200K context and 128K output. Only that Flash id is offered; paid GLM models are refused.',
  },
  freeai: {
    id: 'freeai',
    label: 'Free.ai',
    keyHint: 'sk-free-…',
    base: 'https://api.free.ai/v1',
    // Free.ai answers at /v1/chat/, not /v1/chat/completions.
    chatPath: '/chat/',
    keyEnv: 'FREEAI_API_KEY',
    keysUrl: 'https://free.ai/signup/?next=/account/?tab=api',
    policy: 'allowlist',
    freePlan: 'daily-quota',
    limits: { perMinute: 60, tokensPerDay: 30000, perMonth: 1000 },
    allow: [/^qwen[\w.-]*$/i],
    // External ids are namespaced with a slash and cost purchased credits.
    deny: [/\//, /premium/i, /image/i, /video/i, /tts/i, /whisper/i, /embed/i, /audio/i, /music/i, /ocr/i, /translat/i, /upscal/i],
    fallback: ['qwen7b'],
    note: 'Free plan: 30,000 tokens a day, 60 requests/min, no card. Only the self-hosted Qwen chat model is offered; external GPT, Claude and Gemini ids spend purchased credits.',
  },
  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    keyHint: 'your Cloudflare API token',
    base: 'https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1',
    keyEnv: 'CLOUDFLARE_API_TOKEN',
    accountEnv: 'CLOUDFLARE_ACCOUNT_ID',
    requiresAccount: true,
    accountHint: '32-character Account ID from the Cloudflare dashboard',
    keysUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    policy: 'allowlist',
    freePlan: 'daily-quota',
    limits: { note: '10,000 Neurons/day; the free allowance resets at 00:00 UTC.' },
    allow: [/^@cf\/(openai\/gpt-oss-|meta\/llama-3\.[123]|qwen\/qwen3|zai-org\/glm-4\.7-flash|google\/gemma-4|mistralai\/mistral-small)/i],
    deny: [/embed/i, /rerank/i, /whisper/i, /tts/i, /audio/i, /image/i, /video/i],
    fallback: ['@cf/openai/gpt-oss-120b', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/qwen/qwen3.8-27b'],
    note: 'Free Workers AI allocation: 10,000 Neurons/day, no card. Cloudflare needs both an API token and the account ID; both stay on this machine.',
  },
  ovh: {
    id: 'ovh',
    label: 'OVHcloud (no key)',
    keyHint: 'no key — OVHcloud’s public endpoint',
    base: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    keyEnv: '',
    keysUrl: 'https://endpoints.ai.cloud.ovh.net/',
    policy: 'allowlist',
    freePlan: 'anonymous',
    limits: { perMinutePerModel: 2, note: 'Public demo: no account and no card.' },
    anonymous: true,
    allow: [/^Meta-Llama-/i, /^Mistral-/i, /^Qwen\d/i, /^gpt-oss-/i],
    deny: [/embed/i, /guard/i, /bge/i, /whisper/i, /tts/i, /diffusion/i],
    fallback: ['Meta-Llama-3_3-70B-Instruct', 'gpt-oss-120b', 'Mistral-Small-3.2-24B-Instruct-2506'],
    note: 'No account, no key: a public demo endpoint, 2 requests a minute per model. Good for a quick test, not a long conversation.',
  },
};

const FREE_PLAN_LABELS = {
  'standing-tier': 'free · always',
  'daily-quota': 'free · daily quota',
  'monthly-quota': 'free · monthly quota',
  anonymous: 'free · no key',
  local: 'free · local',
};

function freePlanLabel(plan) {
  return FREE_PLAN_LABELS[plan] ?? 'free plan';
}

const withThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function limitLines(provider) {
  const limits = provider?.limits ?? {};
  if (provider?.local || limits.local) return ['Runs on this machine — no request cap.'];
  if (limits.dynamic) return ['Reported by the key; the header pill shows what is left.'];
  const lines = [];
  if (limits.perMinute) lines.push(`${withThousands(limits.perMinute)} requests/min`);
  if (limits.perMinutePerModel) {
    lines.push(`${withThousands(limits.perMinutePerModel)} requests/min per model`);
  }
  if (limits.perDay) lines.push(`${withThousands(limits.perDay)} requests/day`);
  if (limits.perDayPerModel) {
    lines.push(`${withThousands(limits.perDayPerModel)} requests/day per model`);
  }
  if (limits.perMonth) lines.push(`${withThousands(limits.perMonth)} requests/month`);
  if (limits.tokensPerDay) lines.push(`${withThousands(limits.tokensPerDay)} tokens/day`);
  if (limits.note) lines.push(limits.note);
  if (lines.length === 0) lines.push('No published request numbers; the provider sets the cap.');
  return lines;
}

function getProvider(id) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? PROVIDERS[id] : null;
}

function providerList() {
  return Object.values(PROVIDERS).map((provider) => ({
    id: provider.id,
    label: provider.label,
    keyHint: provider.keyHint,
    keysUrl: provider.keysUrl,
    requiresAccount: Boolean(provider.requiresAccount),
    accountHint: provider.accountHint ?? '',
    freePlan: provider.freePlan,
    planLabel: freePlanLabel(provider.freePlan),
    limitLines: limitLines(provider),
    anonymous: Boolean(provider.anonymous),
    tier: provider.policy === 'pricing' ? 'verified' : 'free-tier',
    note: provider.note,
  }));
}

function baseFor(provider, env, account = '') {
  const override = String(env?.[`${provider.id.toUpperCase()}_BASE_URL`] ?? '').trim();
  const raw = (override || provider.base).replace('{account}', account ? encodeURIComponent(account) : '');
  return raw.replace(/\/+$/, '');
}

function modelsUrlFor(provider, env, account = '') {
  return `${baseFor(provider, env, account)}/models`;
}

function chatUrlFor(provider, env, account = '') {
  return `${baseFor(provider, env, account)}${provider.chatPath ?? '/chat/completions'}`;
}

function isAllowed(provider, id) {
  if (provider.policy === 'pricing') return true;
  if (provider.deny?.some((pattern) => pattern.test(id))) return false;
  return Boolean(provider.allow?.length) && provider.allow.some((pattern) => pattern.test(id));
}

// A turn may try at most three models, all from the same provider. This is a
// small retry budget, not a provider fallback chain: the page's provider choice
// is a decision, and a model that cannot answer is the only thing we replace.
const RETRY_MODEL_LIMIT = 3;
const RETRY_CATALOG_TTL_MS = 5 * 60_000;
const retryCatalogCache = new Map();

function retryableStatus(status) {
  return status === 404 || status === 429 || status >= 500;
}

function keyTag(key) {
  return String(key ?? '').slice(-8);
}

/**
 * Extra model ids the selected provider can offer. OpenRouter's live free
 * catalog is authoritative. For allowlist providers, prefer the seeded list;
 * only ask /models when there is no seeded list, so a normal turn does not add
 * a second network request. The cache is keyed by a key suffix, never the key.
 */
async function fallbackIds(provider, key, env, account) {
  if (provider.fallback?.length) return provider.fallback;
  const cacheKey = `${provider.id}:${keyTag(key)}`;
  const cached = retryCatalogCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RETRY_CATALOG_TTL_MS) return cached.ids;
  try {
    const ids = (await remoteModels(provider, key, env, account)).map((model) => model.id);
    if (retryCatalogCache.size >= 100) retryCatalogCache.clear();
    retryCatalogCache.set(cacheKey, { at: Date.now(), ids });
    return ids;
  } catch {
    // A failed catalog request must not replace the actual chat error.
    return [];
  }
}

async function sameProviderChain(provider, wanted, env, key, account, enabled) {
  if (!enabled) return [wanted];
  const chain = [wanted];
  const add = (id) => {
    if (chain.length >= RETRY_MODEL_LIMIT) return;
    if (typeof id !== 'string' || !id || chain.includes(id)) return;
    if (!isAllowed(provider, id)) return;
    chain.push(id);
  };
  try {
    if (provider.id === 'openrouter') {
      for (const model of await freeModels(env)) add(model.id);
    } else {
      for (const id of await fallbackIds(provider, key, env, account)) add(id);
    }
  } catch {
    // The requested model is still a valid single attempt if a catalog fails.
  }
  return chain;
}

/** The second credential: server env first, then the per-request header. */
function accountForRequest(request, env, provider) {
  if (!provider.accountEnv) return '';
  const server = String(env?.[provider.accountEnv] ?? '').trim();
  if (server) return server;
  return String(request.headers.get('x-provider-account') ?? '').trim();
}

/** Server env key first (Sites secret), then the per-request header from the page. */
function resolveKey(request, env, provider) {
  // A public endpoint has no key on either side; say so, rather than reporting
  // the missing secret the deployment does not need.
  if (provider.anonymous) return { key: '', source: 'anonymous' };
  const server = String(env?.[provider.keyEnv] ?? '').trim();
  if (server) return { key: server, source: 'server' };
  const header = String(request.headers.get('x-provider-key') ?? '').trim();
  if (header) return { key: header, source: 'browser' };
  return { key: '', source: 'none' };
}

async function remoteModels(provider, key, env, account = '') {
  const response = await fetch(modelsUrlFor(provider, env, account), {
    headers: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  // A rejected key is not an absent /models route: do not answer it with the
  // fallback list, or a bad key looks like a working provider.
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error(`${provider.label} rejected the key.`), { code: 'key_rejected' });
  }
  let ids = [];
  if (response.ok) {
    const body = await response.json().catch(() => ({}));
    ids = (Array.isArray(body?.data) ? body.data : []).map((model) => model?.id).filter(Boolean);
  }
  // Gemini's OpenAI layer may not expose /models; its native endpoint does.
  if (ids.length === 0 && provider.nativeBase) {
    const native = await fetch(`${provider.nativeBase}/models?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (native.ok) {
      const body = await native.json().catch(() => ({}));
      ids = (Array.isArray(body?.models) ? body.models : [])
        .filter((model) => (model?.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((model) => String(model?.name ?? '').replace(/^models\//, ''))
        .filter(Boolean);
    }
  }
  // A compatibility layer that hides /models (Cohere's) still gets a picker.
  if (ids.length === 0 && Array.isArray(provider.fallback)) ids = provider.fallback;

  return ids
    .filter((id) => isAllowed(provider, id))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, name: id, context: 0, tools: true }));
}

function publicError(status, code, message, extra = {}) {
  // Upstream bodies sometimes quote the credential they rejected. No error
  // path — chat, catalog, auth or a catch-all — may pass that through.
  return json(
    { error: code, message: scrubSecrets(String(message)), ...extra },
    status,
    retryHeader(extra.retryAfterMs),
  );
}

function perVisitorLimit(env) {
  const configured = Number(env?.VISITOR_DAILY_LIMIT);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(Math.round(configured), 10_000)
    : VISITOR_DAILY_LIMIT;
}

const BUDGET_SCHEMA = `CREATE TABLE IF NOT EXISTS budget (
  day TEXT NOT NULL,
  ip TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ip)
)`;

// One row per visitor per UTC day. Only turns the deployment pays for are
// counted: a visitor chatting on their own pasted key spends their own quota.
// A missing IP or a broken database allows the turn rather than failing closed
// on something that is not the visitor's fault.
/** Today's row for one visitor. Reading it never changes it. */
async function budgetRow(env, ip) {
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(BUDGET_SCHEMA).run();
  const counted = await env.DB.prepare('SELECT used FROM budget WHERE day = ? AND ip = ?')
    .bind(day, ip)
    .all();
  return { day, used: Number(counted?.results?.[0]?.used) || 0 };
}

/**
 * What is left of this visitor's shared-key turns today, for the Status panel.
 * It reports, it does not spend: the page calls this before and after a turn.
 */
async function budgetStatus(env, request) {
  const limit = perVisitorLimit(env);
  const active = resolveKey(request, env, getProvider('openrouter')).source === 'server';
  const day = new Date().toISOString().slice(0, 10);
  const idle = { active, limit, used: 0, remaining: limit, day };
  if (!active || !env?.DB) return idle;
  const ip = clientIp(request);
  if (!ip) return idle;
  try {
    const { used } = await budgetRow(env, ip);
    return { active, limit, used, remaining: Math.max(0, limit - used), day };
  } catch {
    // A broken database must not turn into a 500 in the Status panel.
    return idle;
  }
}

async function takeBudget(env, request) {
  if (!env?.DB) return { ok: true, skipped: 'no-db' };
  const ip = clientIp(request);
  if (!ip) return { ok: true, skipped: 'no-ip' };
  const limit = perVisitorLimit(env);
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(BUDGET_SCHEMA).run();
  // One statement, not read-then-write: two requests arriving together must
  // not both observe the last remaining turn. The WHERE applies only to the
  // upsert, so a new row still inserts normally.
  const result = await env.DB.prepare(
    'INSERT INTO budget (day, ip, used) VALUES (?, ?, 1) ' +
      'ON CONFLICT(day, ip) DO UPDATE SET used = used + 1 WHERE budget.used < ?',
  )
    .bind(day, ip, limit)
    .run();
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 1);
  if (!Number.isFinite(changes) || changes <= 0) {
    const { used } = await budgetRow(env, ip);
    return { ok: false, used, limit };
  }
  return { ok: true, limit };
}

function normaliseMessages(input) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > MAX_MESSAGES) return { error: 'too_many_messages' };
  let chars = 0;
  const out = [];
  for (const raw of list) {
    const role = raw?.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
      return { error: 'bad_role' };
    }
    const content = typeof raw?.content === 'string' ? raw.content : '';
    if (!content.trim() && role !== 'assistant') return { error: 'empty_message' };
    const images = role === 'user' ? cleanImages(raw?.images) : [];
    chars += content.length;
    out.push({ role, content, ...(images.length ? { images } : {}) });
  }
  if (chars > MAX_TOTAL_CHARS) return { error: 'too_long' };
  if (!out.length) return { error: 'empty_conversation' };
  return { messages: out, hasImages: out.some((message) => message.images?.length) };
}

// ---------------------------------------------------------------- routes

const encoder = new TextEncoder();

function sseFrame(data) {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Relay the provider's delta stream as compact SSE frames. Failures after the
 * first byte cannot change the status any more, so they travel as an `error`
 * frame the page can render in place.
 */
function streamAnswer(upstream, { model, started, source, provider, fallbackFrom, retriedFrom, memory }) {
  let modelSeen = model;
  let usage = null;
  return new Response(
    new ReadableStream({
      async start(controller) {
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const raw = trimmed.slice(5).trim();
              if (!raw || raw === '[DONE]') continue;
              let event;
              try {
                event = JSON.parse(raw);
              } catch {
                continue;
              }
              const delta = event?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta) controller.enqueue(sseFrame({ delta }));
              if (event?.model) modelSeen = event.model;
              if (event?.usage) usage = event.usage;
            }
          }
          controller.enqueue(
            sseFrame({
              done: true,
              model: modelSeen,
              usage,
              ms: Date.now() - started,
              keySource: source,
              provider,
              fallbackFrom,
              retriedFrom,
            }),
          );
        } catch {
          controller.enqueue(
            sseFrame({ error: 'stream_failed', message: 'The stream stopped early. Try again.' }),
          );
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed by the client going away.
          }
        }
      },
      cancel() {
        upstream.body.cancel?.().catch(() => {});
      },
    }),
    {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        // The page picks a provider; a fallback answer says who actually replied.
        'x-answer-provider': provider ?? '',
        ...(fallbackFrom ? { 'x-fallback-from': fallbackFrom } : {}),
        ...(retriedFrom ? { 'x-retried-from': retriedFrom } : {}),
        ...(memory?.compacted
          ? {
              'x-memory-compacted': String(memory.compacted),
              'x-memory-before': String(memory.beforeTokens),
              'x-memory-after': String(memory.afterTokens),
            }
          : {}),
      },
    },
  );
}

async function handleChat(request, env) {
  if (overRate(clientIp(request))) {
    return publicError(429, 'rate_limited', 'Too many requests from this address. Wait a minute.', {
      retryAfterMs: 60_000,
    });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return publicError(413, 'body_too_large', 'Message too large.');
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return publicError(400, 'bad_json', 'Request body was not JSON.');
  }

  const requestedProvider =
    typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : 'openrouter';
  const provider = getProvider(requestedProvider);
  if (!provider) return publicError(400, 'bad_provider', `Unknown provider "${requestedProvider}".`);
  const wanted = typeof body.model === 'string' ? body.model.trim() : '';
  if (!wanted) return publicError(400, 'missing_model', 'Pick a model first.');

  // Free-only gate. OpenRouter: the id must be free in the live catalog.
  // Groq/Gemini: it must match the provider's allowlist and no deny rule.
  if (provider.id === 'openrouter') {
    const free = await freeModels(env);
    if (!free.some((model) => model.id === wanted)) {
      return publicError(400, 'not_free', `${wanted} is not a free model in the live catalog.`);
    }
  } else if (!isAllowed(provider, wanted)) {
    return publicError(400, 'not_free', `${wanted} is not on the ${provider.label} free-tier list.`);
  }

  const parsed = normaliseMessages(body.messages);
  if (parsed.error) {
    const messages = {
      too_many_messages: 'This conversation is too long for the cloud edition.',
      too_long: 'This conversation is too long. Start a new chat.',
      empty_message: 'A message was empty.',
      bad_role: 'A message had an unknown role.',
      empty_conversation: 'There is nothing to send yet.',
    };
    return publicError(400, parsed.error, messages[parsed.error] ?? 'Bad request.');
  }
  if (parsed.hasImages && provider.id !== 'openrouter') {
    return publicError(
      400,
      'vision_provider',
      'Image attachments only work through an OpenRouter free vision model. Switch provider or remove the image.',
    );
  }
  if (parsed.hasImages) {
    const catalog = await freeModels(env);
    const picked = catalog.find((model) => model.id === wanted);
    if (!picked?.vision) {
      return publicError(
        400,
        'vision_required',
        `${wanted} cannot read images. Pick a free model marked vision and send it again.`,
        { model: wanted },
      );
    }
  }

  // Fold older turns into one note before the request leaves the Worker. The
  // browser and D1 keep every message; this only shapes the upstream payload.
  const memory = compactMessages(parsed.messages);

  // Key last, so the free-only rule answers even on a keyless deployment.
  const { key, source } = resolveKey(request, env, provider);
  if (!key && !provider.anonymous) {
    return publicError(
      401,
      'missing_key',
      `No ${provider.label} key on this deployment. Add ${provider.keyEnv} in Sites > Secrets, or paste your own key in the page settings.`,
    );
  }
  const account = accountForRequest(request, env, provider);
  if (provider.requiresAccount && !account) {
    return publicError(
      401,
      'missing_account',
      `${provider.label} also needs its Account ID. Add it in the page settings or set ${provider.accountEnv}.`,
    );
  }

  // A shared key is the owner's money, so a turn that spends it must come from
  // this site and stay inside a per-visitor daily budget. A visitor's own key is
  // theirs to spend and is deliberately left unfenced.
  if (source === 'server') {
    if (String(env?.APP_ORIGIN ?? '').trim() && !isSameOriginRequest(request, env.APP_ORIGIN)) {
      return publicError(403, 'foreign_origin', 'That request came from another site.');
    }
    const budget = await takeBudget(env, request).catch(() => ({ ok: true, skipped: 'db-error' }));
    if (!budget.ok) {
      const wait = msUntilUtcMidnight();
      return publicError(
        429,
        'visitor_budget',
        `This visitor has used today's ${budget.limit} shared-key requests. Paste your own key in the page settings to keep chatting, or come back tomorrow.`,
        { retryAfterMs: wait, resetAt: new Date(Date.now() + wait).toISOString() },
      );
    }
  }

  const streamRequested = body.stream !== false;
  const started = Date.now();
  // Tools are only usable on the single-JSON path. Compute the exact list once
  // so the prompt instruction and the request body cannot disagree.
  const offeredTools =
    !streamRequested && Array.isArray(body.tools) && body.tools.length > 0
      ? body.tools.slice(0, 8)
      : [];
  const upstreamMessages = withToolInstruction(
    recentImages(memory.messages, 2).map(toUpstreamMessage),
    offeredTools,
  );
  // Images and tool calls depend on the selected model's capabilities, so a
  // model retry is only safe for a plain text turn.
  const canRetryModel = !parsed.hasImages && offeredTools.length === 0;
  const modelIds = await sameProviderChain(provider, wanted, env, key, account, canRetryModel);
  // The selected provider is the whole provider decision. Retry models inside
  // it, but never send the conversation to another service; only the user can
  // change provider.
  const attempts = modelIds.map((model) => ({ provider, key, account, source, model }));

  let upstream = null;
  let used = attempts[0];
  let failure = null;
  for (const [index, attempt] of attempts.entries()) {
    used = attempt;
    try {
      const headers = { 'content-type': 'application/json' };
      // Anonymous providers take no credential; sending an empty bearer token
      // would be a malformed request rather than a keyless one.
      if (attempt.key) headers.authorization = `Bearer ${attempt.key}`;
      // Attribution headers are an OpenRouter feature; other providers ignore or
      // reject them, so they only go where they belong.
      if (attempt.provider.id === 'openrouter') {
        headers['http-referer'] = 'https://freebuff.page';
        headers['x-title'] = `Freeway ${VERSION}`;
      }
      upstream = await fetch(chatUrlFor(attempt.provider, env, attempt.account), {
        method: 'POST',
        headers,
        // Bounded like the desktop app: a provider that stops talking must not
        // hold the Worker open until the platform kills the request.
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: attempt.model,
          // Recent images only: older pictures stay visible in the chat but are
          // not re-uploaded on every turn. Fallbacks are disabled for images.
          messages: upstreamMessages,
          stream: streamRequested,
          max_tokens: Math.min(
            Number.isFinite(body.max_tokens) ? Math.min(Math.max(Number(body.max_tokens), 64), 4096) : 2048,
            // The page may ask for more, but a shared key never spends it.
            used.source === 'server' ? SHARED_TURN_TOKENS : 4096,
          ),
          ...(Number.isFinite(body.temperature)
            ? { temperature: Math.min(Math.max(Number(body.temperature), 0), 2) }
            : {}),
          // Tools only make sense on the single-JSON path; the stream has no place
          // to report a tool call back to this page.
          ...(offeredTools.length > 0 ? { tools: offeredTools, tool_choice: 'auto' } : {}),
          ...(streamRequested && attempt.provider.id === 'openrouter'
            ? { stream_options: { include_usage: true } }
            : {}),
          // Ask for the cost of this request so the page can say "free" or "$x"
          // per answer; without this OpenRouter reports tokens only.
          ...(attempt.provider.id === 'openrouter' ? { usage: { include: true } } : {}),
        }),
      });
    } catch (error) {
      failure = publicError(
        502,
        'upstream_unreachable',
        `Could not reach ${attempt.provider.label}: ${String(error?.message ?? error).slice(0, 160)}`,
      );
      upstream = null;
      if (index < attempts.length - 1) continue;
      break;
    }
    if (upstream.ok) break;

    const text = await upstream.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    const detail = scrubSecrets(String(payload?.error?.message ?? text ?? '')).slice(0, 300);
    const map = {
      401: ['key_rejected', `${attempt.provider.label} rejected the key. Check it and try again.`],
      402: ['no_free_plan', `${attempt.provider.label} wants a paid plan for this key. This app only uses free plans.`],
      403: ['forbidden', `${attempt.provider.label} refused this model for this key.`],
      429: ['upstream_rate', `${attempt.provider.label} is rate limiting this model. Try again in a moment.`],
      404: ['unknown_model', `${attempt.provider.label} does not know this model any more. Pick another.`],
    };
    const [code, message] = map[upstream.status] ?? ['upstream_error', `${attempt.provider.label} returned ${upstream.status}.`];
    // 429 and 5xx are transient. Keep the provider's own delay (seconds or an
    // HTTP date); if it did not send one, use the same bounded fallback the page
    // would otherwise invent. Other statuses must not start a cooldown.
    const retryAfterMs =
      upstream.status === 429 || upstream.status >= 500
        ? retryAfterMsFrom(upstream.headers, upstream.status === 429 ? 60_000 : 30_000)
        : null;
    const errorBody = {
      error: code,
      message,
      detail,
      status: upstream.status,
      keySource: attempt.source,
      model: attempt.model,
      ...(retryAfterMs ? { retryAfterMs } : {}),
    };
    failure = json(errorBody, upstream.status >= 500 ? 502 : upstream.status, retryHeader(retryAfterMs));
    const canRetry = retryableStatus(upstream.status) && index < attempts.length - 1;
    upstream = null;
    if (!canRetry) break;
  }

  if (!upstream) return failure ?? publicError(502, 'upstream_unreachable', 'No free provider answered.');
  const fallbackFrom = used.provider.id === provider.id ? null : provider.id;
  const retriedFrom = used.model === wanted ? null : wanted;

  if (streamRequested) {
    return streamAnswer(upstream, {
      model: used.model,
      started,
      source: used.source,
      provider: used.provider.id,
      fallbackFrom,
      retriedFrom,
      memory,
    });
  }

  const text = await upstream.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  const choice = payload?.choices?.[0];
  const answer = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  const toolCalls = Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : [];
  // A model that only calls a tool has no text yet; that is not an empty answer.
  if (!answer.trim() && !toolCalls.length) {
    const reason = choice?.finish_reason ? ` (finish reason: ${choice.finish_reason})` : '';
    return publicError(
      502,
      'empty_answer',
      `${used.provider.label} returned no text${reason}. Try another free model.`,
    );
  }

  return json({
    text: answer,
    model: payload?.model ?? used.model,
    provider: used.provider.id,
    fallbackFrom,
    retriedFrom,
    usage: payload?.usage ?? null,
    ms: Date.now() - started,
    keySource: used.source,
    toolCalls,
    finishReason: choice?.finish_reason ?? null,
    memory: memory.compacted
      ? {
          compacted: memory.compacted,
          beforeTokens: memory.beforeTokens,
          afterTokens: memory.afterTokens,
        }
      : null,
  });
}

async function handlePage(request, env) {
  const asset = await env.ASSETS.fetch(request);
  const headers = new Headers(asset.headers);
  headers.set('content-security-policy', PAGE_CSP);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  // The page is versioned by this Worker, not by the asset host. A revalidated
  // HIT is how a fix looks missing after a deploy: always hand it over fresh.
  headers.set('cache-control', 'no-store, max-age=0');
  headers.delete('etag');
  headers.delete('last-modified');
  return new Response(asset.body, { status: asset.status, headers });
}

async function handle(request, env, ctx) {
  {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === '/healthz') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return publicError(405, 'method', 'Use GET.');
        }
        return new Response(request.method === 'HEAD' ? null : 'ok', {
          headers: { 'content-type': 'text/plain', ...BASE_HEADERS },
        });
      }

      if (pathname === '/api/config' && request.method === 'GET') {
        // The page shell must answer on a cold isolate. The catalog is only
        // needed for the free-model count here (the page loads the real list
        // from /api/models), so waiting on a slow upstream used to push the
        // first visit past the edge's patience and serve "Site unavailable".
        // Answer from whatever is cached and warm the catalog after the fact.
        const catalog = catalogCache;
        if (!catalog.models.length && typeof ctx?.waitUntil === 'function') {
          ctx.waitUntil(loadCatalog(env).catch(() => {}));
        }
        const free = catalog.models.filter((m) => isFreeChatModel(m) && !isExpired(m));
        const { source } = resolveKey(request, env, getProvider('openrouter'));
        // Which providers already have a deployment key: the page must not ask
        // for a pasted key that the Worker can supply itself.
        const serverKeys = Object.values(PROVIDERS)
          .filter(
            (provider) =>
              String(env?.[provider.keyEnv] ?? '').trim() &&
              (!provider.accountEnv || String(env?.[provider.accountEnv] ?? '').trim()),
          )
          .map((provider) => provider.id);
        return json({
          version: VERSION,
          edition: 'cloud',
          freeModels: free.length,
          hasKey: source === 'server',
          acceptsBrowserKey: source !== 'server',
          serverKeys,
          // What the deployment does to protect a shared key: the Status panel
          // says so instead of leaving visitors to discover it at the limit.
          guard: {
            deploymentKey: source === 'server',
            perVisitorPerDay: perVisitorLimit(env),
            turnTokens: SHARED_TURN_TOKENS,
            originFence: Boolean(String(env?.APP_ORIGIN ?? '').trim()),
          },
          catalogError: catalog.error ?? null,
          defaultProvider: 'openrouter',
          providers: providerList(),
          // A desktop download link must be stable; a tunnel or a chat preview
          // host expires and leaves the cloud page pointing at nothing.
          desktopDownloadUrl: 'https://github.com/zakker111/freeway/releases/latest',
        });
      }

      if (pathname === '/api/models' && request.method === 'GET') {
        const provider = getProvider(url.searchParams.get('provider') || 'openrouter');
        if (!provider) {
          return publicError(400, 'bad_provider', `Unknown provider "${url.searchParams.get('provider')}".`);
        }

        if (provider.id === 'openrouter') {
          const models = await freeModels(env);
          if (!models.length) {
            return publicError(503, 'no_models', 'The OpenRouter catalog came back empty. Try again shortly.');
          }
          return json({ provider: provider.id, tier: 'verified', models });
        }

        const { key } = resolveKey(request, env, provider);
        if (!key && !provider.anonymous) {
          return publicError(401, 'missing_key', `A ${provider.label} key is needed to list its models.`);
        }
        const account = accountForRequest(request, env, provider);
        if (provider.requiresAccount && !account) {
          return publicError(401, 'missing_account', `A ${provider.label} Account ID is also needed.`);
        }
        let models;
        try {
          models = await remoteModels(provider, key, env, account);
        } catch (error) {
          if (error.code === 'key_rejected') {
            return publicError(401, 'key_rejected', error.message);
          }
          throw error;
        }
        return json({ provider: provider.id, tier: 'free-tier', models });
      }

      if (pathname === '/api/quota') {
        const quotaProvider = getProvider('openrouter');
        const { key: quotaKey, source: quotaSource } = resolveKey(request, env, quotaProvider);
        if (!quotaKey) {
          return json({ ok: false, reason: 'no-key', source: 'none' }, 200, { 'cache-control': 'private, no-store' });
        }
        if (quotaCache.data && quotaCache.key === quotaKey && Date.now() - quotaCache.at < 60_000) {
          return json({ ...quotaCache.data, cached: true }, 200, { 'cache-control': 'private, no-store' });
        }
        try {
          const upstream = await fetch(`${UPSTREAM}/key`, {
            headers: { authorization: `Bearer ${quotaKey}`, accept: 'application/json' },
            signal: AbortSignal.timeout(15_000),
          });
          if (!upstream.ok) {
            return json(
              { ok: false, reason: upstream.status === 401 ? 'key_rejected' : 'upstream', status: upstream.status },
              200,
              { 'cache-control': 'private, no-store' },
            );
          }
          const body = await upstream.json();
          const data = body?.data ?? {};
          const quota = {
            ok: true,
            // Numbers only: never echo the key, its label or an account id.
            freeDaily: data.free_model_daily_requests ?? null,
            usage: Number(data.usage) || 0,
            limitRemaining: data.limit_remaining ?? null,
            isFreeTier: Boolean(data.is_free_tier),
            source: quotaSource,
          };
          quotaCache = { at: Date.now(), key: quotaKey, data: quota };
          return json(quota, 200, { 'cache-control': 'private, no-store' });
        } catch {
          return json({ ok: false, reason: 'network' }, 200, { 'cache-control': 'private, no-store' });
        }
      }

      // What is left of this visitor's shared-key turns today. Never spends one.
      if (pathname === '/api/budget' && request.method === 'GET') {
        return json(await budgetStatus(env, request), 200, { 'cache-control': 'private, no-store' });
      }

      if (pathname === '/api/chat') {
        if (request.method !== 'POST') return publicError(405, 'method', 'Use POST.');
        return handleChat(request, env);
      }

      if (pathname.startsWith('/api/')) return publicError(404, 'not_found', 'No such route.');

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return publicError(405, 'method', 'Only GET is allowed here.');
      }

      return handlePage(request, env);
    } catch (error) {
      console.error('worker error', scrubSecrets(String(error?.stack ?? error)));
      return publicError(500, 'internal', 'Something broke on the server. Try again.');
    }
  }
}

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
};
