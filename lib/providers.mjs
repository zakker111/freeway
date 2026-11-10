// One place that knows, for each provider: where requests go, which key it
// needs, and — the part that matters most here — how "free" is decided.
//
// OpenRouter can prove a model is free, because its catalog publishes pricing.
// Groq, Gemini, Mistral, Cohere and SambaNova cannot: they are free *by plan*,
// so the honest rule is an allowlist of models that plan covers, plus a deny
// list for anything billed separately. The UI labels the two cases differently
// on purpose.
//
// Every provider here has a real, recurring free plan with no card required. The
// rule for adding one is in AGENTS.md: a standing free plan, no card, and it must
// not expire into paid usage. `freePlan` records which kind of free that is.
//
// Deliberately absent, and why:
// - Cerebras, Nebius, Together: "free" is a card-gated promo credit.
// - Alibaba Model Studio (DashScope): one million tokens for 90 days, then billed
//   pay-as-you-go unless Free Quota Only is switched on. A trial, not a free plan.
// - ModelScope: free 2,000 calls/day, but signup needs phone verification.
// Cloudflare Workers AI is the one two-part credential here: the API token and
// the account id are separate, and the id is part of the base URL. Both are
// stored server-side and never sent to the browser.

const TAIL = 6; // how much of a key identifies the cache entry, never enough to use

export const PROVIDERS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    keyName: 'OPENROUTER_API_KEY',
    keyPrefix: 'sk-or-',
    keyHint: 'sk-or-v1-…',
    keysUrl: 'https://openrouter.ai/settings/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    freePolicy: 'pricing',
    freePlan: 'standing-tier',
    // The key reports what is left; there is no fixed plan number to print.
    limits: { dynamic: true },
    note: 'Free models only — every id is checked against live pricing before it is sent.',
  },
  {
    id: 'groq',
    label: 'Groq',
    keyName: 'GROQ_API_KEY',
    keyPrefix: 'gsk_',
    keyHint: 'gsk_…',
    keysUrl: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1',
    freePolicy: 'allowlist',
    freePlan: 'daily-quota',
    limits: { perMinute: 30, perDay: 1000 },
    allow: [/^openai\/gpt-oss-/i, /^qwen\//i, /^llama-3\.[13]/i, /^moonshotai\//i],
    deny: [/whisper/i, /tts/i, /guard/i, /embed/i, /vision-preview/i],
    note: 'Free plan: about 30 requests/min and 1,000/day, no card. Groq (gsk_) is not xAI’s Grok.',
  },
  {
    id: 'gemini',
    label: 'Gemini (AI Studio)',
    keyName: 'GEMINI_API_KEY',
    keyPrefix: 'AIza',
    keyHint: 'AIza…',
    keysUrl: 'https://aistudio.google.com/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    nativeBase: 'https://generativelanguage.googleapis.com/v1beta',
    freePolicy: 'allowlist',
    freePlan: 'daily-quota',
    // Google sets these per model and moves them; no number is invented here.
    limits: { note: 'Per-model limits live in AI Studio; Google changes them per model.' },
    allow: [/flash/i, /gemma/i],
    deny: [/\bpro\b/i, /image/i, /imagen/i, /tts/i, /embed/i, /veo/i, /audio/i],
    note: 'Free plan via AI Studio. Pro and media models are excluded, so a billed key cannot spend here.',
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    keyName: 'MISTRAL_API_KEY',
    keyHint: 'your Mistral key',
    keysUrl: 'https://console.mistral.ai/api-keys',
    baseUrl: 'https://api.mistral.ai/v1',
    freePolicy: 'allowlist',
    freePlan: 'daily-quota',
    limits: { note: 'Rate-limited per key; Mistral publishes no fixed number.' },
    allow: [/^mistral-small/i, /^ministral-/i, /^open-mistral/i, /^open-mixtral/i],
    deny: [/large/i, /medium/i, /embed/i, /moderation/i, /ocr/i, /audio/i, /voxtral/i],
    // Mistral's /v1/models is live, but a known-good list keeps the picker
    // useful if a key's plan hides it.
    fallbackModels: ['mistral-small-latest', 'ministral-8b-latest', 'open-mistral-nemo'],
    note: 'Free "Experiment" plan: no card, rate-limited per key. Only the small and ministral families are offered, so a billed key cannot spend here.',
  },
  {
    id: 'cohere',
    label: 'Cohere',
    keyName: 'COHERE_API_KEY',
    keyHint: 'your Cohere trial key',
    keysUrl: 'https://dashboard.cohere.com/api-keys',
    // The OpenAI-compatible layer; the native API lives at /v2.
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    freePolicy: 'allowlist',
    freePlan: 'monthly-quota',
    limits: { perMinute: 20, perMonth: 1000 },
    allow: [/^command-/i, /^c4ai-aya/i, /^north-/i, /^tiny-aya/i],
    deny: [/embed/i, /rerank/i, /transcribe/i, /audio/i],
    // The compatibility layer does not always expose /models, so the picker
    // falls back to the chat models a trial key can actually use.
    fallbackModels: ['command-a-03-2025', 'command-r7b-12-2024', 'command-r-plus-08-2024'],
    note: 'Trial key: 1,000 API calls a month, 20 requests/min on chat models, no card. Embed and rerank models are excluded.',
  },
  {
    id: 'sambanova',
    label: 'SambaNova',
    keyName: 'SAMBANOVA_API_KEY',
    keyHint: 'your SambaNova key',
    keysUrl: 'https://cloud.sambanova.ai/apis',
    baseUrl: 'https://api.sambanova.ai/v1',
    freePolicy: 'allowlist',
    freePlan: 'daily-quota',
    limits: { perMinute: 20, perDayPerModel: 20 },
    allow: [/llama/i, /deepseek/i, /gpt-oss/i, /gemma/i, /qwen/i],
    deny: [/embed/i, /whisper/i, /rerank/i, /guard/i],
    fallbackModels: ['Meta-Llama-3.3-70B-Instruct', 'gpt-oss-120b'],
    note: 'Free plan without a payment method: 20 requests/min and 20/day per model — enough to test, not to work all day.',
  },
  {
    id: 'aionlabs',
    label: 'Aion Labs',
    keyName: 'AION_API_KEY',
    keyHint: 'your Aion Labs key',
    keysUrl: 'https://www.aionlabs.ai/',
    baseUrl: 'https://api.aionlabs.ai/v1',
    freePolicy: 'allowlist',
    freePlan: 'daily-quota',
    limits: { perMinute: 15, tokensPerDay: 20000 },
    allow: [/^aion-labs\//i],
    deny: [/image/i, /video/i, /embed/i, /tts/i, /audio/i],
    fallbackModels: ['aion-labs/aion-3.5-mini', 'aion-labs/aion-2.0'],
    note: 'Free plan: 15 requests/min, 20,000 tokens a day, no card. Roleplay and storytelling models — small daily quota.',
  },
  {
    id: 'zai',
    label: 'Z.AI',
    keyName: 'ZAI_API_KEY',
    keyHint: 'your Z.AI key',
    keysUrl: 'https://z.ai/model-api',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    freePolicy: 'allowlist',
    freePlan: 'standing-tier',
    limits: { note: 'GLM-4.7-Flash is free; the free Flash tier is concurrency-limited.' },
    allow: [/^glm-4\.7-flash$/i],
    deny: [/large/i, /max/i, /plus/i, /air/i, /flashx/i, /vision/i, /image/i, /video/i, /embed/i, /ocr/i, /audio/i],
    fallbackModels: ['glm-4.7-flash'],
    note: 'GLM-4.7-Flash is free, with 200K context and 128K output. Only that Flash id is offered; paid GLM models are refused.',
  },
  {
    // Its chat route is /v1/chat/ (trailing slash), not /v1/chat/completions,
    // and the completion path is declared instead of assembled in the route.
    // The daily pool covers only the self-hosted chat model: every external id
    // is namespaced with a slash and spends purchased credits, so it is denied
    // before the allowlist is consulted.
    id: 'freeai',
    label: 'Free.ai',
    keyName: 'FREEAI_API_KEY',
    keyPrefix: 'sk-free-',
    keyHint: 'sk-free-…',
    keysUrl: 'https://free.ai/signup/?next=/account/?tab=api',
    baseUrl: 'https://api.free.ai/v1',
    chatPath: '/chat/',
    freePolicy: 'allowlist',
    freePlan: 'daily-quota',
    limits: { perMinute: 60, tokensPerDay: 30000, perMonth: 1000 },
    allow: [/^qwen[\w.-]*$/i],
    deny: [
      /\//,
      /premium/i,
      /image/i,
      /video/i,
      /tts/i,
      /whisper/i,
      /embed/i,
      /audio/i,
      /music/i,
      /ocr/i,
      /translat/i,
      /upscal/i,
    ],
    fallbackModels: ['qwen7b'],
    note: 'Free plan: 30,000 tokens a day and 60 requests/min, no card. Only the self-hosted Qwen chat model is offered; external GPT, Claude and Gemini ids spend purchased credits, so they are refused.',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    keyName: 'CLOUDFLARE_API_TOKEN',
    keyHint: 'your Cloudflare API token',
    keysUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1',
    requiresAccount: true,
    accountEnv: 'CLOUDFLARE_ACCOUNT_ID',
    accountHint: '32-character Account ID from the Cloudflare dashboard',
    freePolicy: 'allowlist',
    freePlan: 'daily-quota',
    limits: { note: '10,000 Neurons/day; the free allowance resets at 00:00 UTC.' },
    allow: [/^@cf\/(openai\/gpt-oss-|meta\/llama-3\.[123]|qwen\/qwen3|zai-org\/glm-4\.7-flash|google\/gemma-4|mistralai\/mistral-small)/i],
    deny: [/embed/i, /rerank/i, /whisper/i, /tts/i, /audio/i, /image/i, /video/i],
    fallbackModels: [
      '@cf/openai/gpt-oss-120b',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/qwen/qwen3.8-27b',
    ],
    note: 'Free Workers AI allocation: 10,000 Neurons/day, no card. Cloudflare needs both an API token and the account ID; both stay on this machine.',
  },
  {
    // A public demo endpoint: no account, no key, no card. Two requests a minute
    // per model is the whole budget, so it is offered to try, not to work in.
    // Media, guard and embedding ids are denied, so the picker only shows chat.
    id: 'ovh',
    label: 'OVHcloud (no key)',
    keyName: '',
    keyHint: 'no key — OVHcloud’s public endpoint',
    keysUrl: 'https://endpoints.ai.cloud.ovh.net/',
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    freePolicy: 'allowlist',
    freePlan: 'anonymous',
    limits: { perMinutePerModel: 2, note: 'Public demo: no account and no card.' },
    anonymous: true,
    allow: [/^Meta-Llama-/i, /^Mistral-/i, /^Qwen\d/i, /^gpt-oss-/i],
    deny: [/embed/i, /guard/i, /bge/i, /whisper/i, /tts/i, /diffusion/i],
    fallbackModels: ['Meta-Llama-3_3-70B-Instruct', 'gpt-oss-120b', 'Mistral-Small-3.2-24B-Instruct-2506'],
    note: 'No account, no key: a public demo endpoint, 2 requests a minute per model. Good for a quick test, not a long conversation.',
  },
  {
    // Local, free by definition, and never leaves this machine. There is no
    // key to paste and no account; either the daemon is running or it is not.
    // The cloud edition cannot offer this: a Worker cannot reach 127.0.0.1.
    id: 'ollama',
    label: 'Ollama (local)',
    keyName: 'OLLAMA_API_KEY',
    keyHint: 'no key — Ollama runs on this machine',
    keysUrl: 'https://ollama.com/download',
    baseUrl: 'http://127.0.0.1:11434/v1',
    freePolicy: 'local',
    freePlan: 'local',
    limits: { local: true },
    local: true,
    note: 'Runs on this computer. Start it with `ollama serve`, pull a model, and it appears here. Nothing is sent to any company.',
  },
];

// Human wording for the machine field above, so a visitor can tell a daily
// allowance from a monthly one without reading the note.
const FREE_PLAN_LABELS = {
  'standing-tier': 'free · always',
  'daily-quota': 'free · daily quota',
  'monthly-quota': 'free · monthly quota',
  anonymous: 'free · no key',
  local: 'free · local',
};

export function freePlanLabel(plan) {
  return FREE_PLAN_LABELS[plan] ?? 'free plan';
}

const withThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * What the free plan actually allows, in the provider's own words where it
 * publishes a number. A provider that publishes nothing says so instead of
 * borrowing another provider's cap.
 */
export function limitLines(provider) {
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

export function getProvider(id) {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export function publicView(provider, hasKey, hasAccount = false) {
  return {
    id: provider.id,
    label: provider.label,
    hasKey: Boolean(hasKey),
    requiresAccount: Boolean(provider.requiresAccount),
    hasAccount: Boolean(provider.requiresAccount && hasAccount),
    accountHint: provider.accountHint ?? '',
    freePolicy: provider.freePolicy,
    freePlan: provider.freePlan,
    planLabel: freePlanLabel(provider.freePlan),
    limitLines: limitLines(provider),
    local: Boolean(provider.local),
    anonymous: Boolean(provider.anonymous),
    tier: provider.local ? 'local' : provider.freePolicy === 'pricing' ? 'verified' : 'free-tier',
    note: provider.note,
    keyHint: provider.keyHint,
    keysUrl: provider.keysUrl,
  };
}

/**
 * The key for a provider: environment first (so CI can inject one), then the
 * config file. OpenRouter keeps its historical `apiKey` field so existing
 * installs do not need to migrate; everyone else lives in `providerKeys`.
 */
export function keyFor(provider, config = {}, env = process.env) {
  const fromEnv = String(env?.[provider.keyName] ?? '').trim();
  if (fromEnv) return fromEnv;
  if (provider.id === 'openrouter') return String(config.apiKey ?? '').trim();
  return String(config.providerKeys?.[provider.id] ?? '').trim();
}

export function keyTail(key) {
  return String(key ?? '').slice(-TAIL);
}

/**
 * The second credential some providers need. Cloudflare's account id is part of
 * the URL, not a secret, but it still belongs beside the key in config rather
 * than in a browser request.
 */
export function accountFor(provider, config = {}, env = process.env) {
  if (!provider?.accountEnv) return '';
  const fromEnv = String(env?.[provider.accountEnv] ?? '').trim();
  if (fromEnv) return fromEnv;
  return String(config.providerAccounts?.[provider.id] ?? '').trim();
}

/** Tests point a provider at a local mock through <ID>_BASE_URL. */
export function baseUrlFor(provider, env = process.env, config = {}) {
  const override = String(env?.[`${provider.id.toUpperCase()}_BASE_URL`] ?? '').trim();
  const account = accountFor(provider, config, env);
  const raw = (override || provider.baseUrl).replace('{account}', account ? encodeURIComponent(account) : '');
  return raw.replace(/\/+$/, '');
}

export function modelsUrl(provider, env = process.env, config = {}) {
  return `${baseUrlFor(provider, env, config)}/models`;
}

export function chatUrl(provider, env = process.env, config = {}) {
  // Most providers follow the OpenAI path; the ones that do not declare theirs
  // (Free.ai answers at /v1/chat/) so no route has to special-case a URL.
  return `${baseUrlFor(provider, env, config)}${provider.chatPath ?? '/chat/completions'}`;
}

export function headersFor(provider, key) {
  const headers = { 'content-type': 'application/json' };
  // An anonymous provider has no credential: a literal "Bearer " is worse than
  // no header at all, and some gateways reject the malformed form outright.
  if (!provider.anonymous && key) headers.authorization = `Bearer ${key}`;
  // Attribution headers are an OpenRouter feature; sending them elsewhere is
  // noise at best.
  if (provider.id === 'openrouter') {
    headers['http-referer'] = 'http://127.0.0.1';
    headers['x-title'] = 'Freeway';
  }
  return headers;
}

/**
 * The free-only gate for providers whose catalog carries no pricing. A model is
 * usable only when it matches an allow pattern and no deny pattern. With no
 * allow list the answer is "no", never "sure".
 */
export function isAllowedModel(provider, id) {
  if (!provider || typeof id !== 'string' || !id.trim()) return false;
  // OpenRouter is decided by live pricing in its catalog (lib/models.mjs), so
  // this pattern gate must never wave an id through. Fail closed.
  if (provider.freePolicy === 'pricing') return false;
  // A local model is free because it runs here; there is no bill to run up.
  if (provider.freePolicy === 'local') return true;
  const deny = provider.deny ?? [];
  if (deny.some((pattern) => pattern.test(id))) return false;
  const allow = provider.allow ?? [];
  return allow.length > 0 && allow.some((pattern) => pattern.test(id));
}

/** Picker row for a provider that only tells us ids. */
export function toModelRow(provider, id, name) {
  return {
    id,
    name: name || id,
    vendor: String(id).split('/')[0] ?? provider.id,
    context: 0,
    maxOutput: null,
    inPrice: 0,
    outPrice: 0,
    free: true,
    tools: true,
    vision: false,
    tier: provider.local ? 'local' : provider.freePolicy === 'pricing' ? 'verified' : 'free-tier',
  };
}

/** Providers that can be used right now, with a key present. */
export function configuredIds(config = {}, env = process.env) {
  // Local and anonymous providers are not part of the fallback chain: a dead
  // daemon is not someone else's turn, and the public OVHcloud endpoint allows
  // two requests a minute — a silent fallback would spend that budget unseen.
  return PROVIDERS.filter(
    (provider) =>
      !provider.local &&
      !provider.anonymous &&
      keyFor(provider, config, env) &&
      (!provider.requiresAccount || accountFor(provider, config, env)),
  ).map(
    (provider) => provider.id,
  );
}

/**
 * The selected provider is the only provider one turn is sent to. Model retries
 * happen inside it; changing provider is a user decision, not a fallback.
 * Keeping the guard here makes that invariant explicit.
 */
export function fallbackOrder(primaryId) {
  const primary = getProvider(primaryId) ?? getProvider('openrouter');
  return [primary.id];
}

/**
 * The model another provider should answer with when it takes over a turn it did
 * not start. The requested model belongs to a different service, so it is only
 * reused when that provider also offers exactly that id; otherwise the first
 * model its free rule accepts wins. `models` is expected to be that provider's
 * own free list, already filtered for OpenRouter by live pricing.
 */
export function firstFreeModel(provider, models = [], requested = null) {
  if (!provider) return null;
  const ids = (Array.isArray(models) ? models : [])
    .map((model) => (typeof model === 'string' ? model : model?.id))
    .filter((id) => typeof id === 'string' && id.trim());
  if (provider.freePolicy === 'pricing') {
    // Membership in the free catalog is the whole check for OpenRouter.
    if (requested && ids.includes(requested)) return requested;
    return ids[0] ?? null;
  }
  if (requested && isAllowedModel(provider, requested)) return requested;
  return ids.find((id) => isAllowedModel(provider, id)) ?? null;
}
