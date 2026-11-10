import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS,
  getProvider,
  keyFor,
  accountFor,
  baseUrlFor,
  headersFor,
  isAllowedModel,
  publicView,
  configuredIds,
  fallbackOrder,
  firstFreeModel,
  modelsUrl,
  chatUrl,
  freePlanLabel,
  limitLines,
} from './providers.mjs';

test('every provider exists and declares how free is decided', () => {
  const ids = PROVIDERS.map((provider) => provider.id).sort();
  assert.deepEqual(ids, [
    'aionlabs',
    'cloudflare',
    'cohere',
    'freeai',
    'gemini',
    'groq',
    'mistral',
    'ollama',
    'openrouter',
    'ovh',
    'sambanova',
    'zai',
  ]);
  for (const provider of PROVIDERS) {
    assert.ok(provider.note.length > 10, `${provider.id} needs a human explanation`);
    // 'local' is a third policy: free because the model runs on this machine.
    assert.ok(['pricing', 'allowlist', 'local'].includes(provider.freePolicy));
  }
});

test('notes name the plan instead of saying "free tier"', () => {
  // The 1.50.0 sweep: a note is shown in the picker's tooltip and the key
  // dialog, so it must carry the same wording as the plan label.
  for (const provider of PROVIDERS) {
    assert.equal(/free tier/i.test(provider.note), false, `${provider.id} note still says "free tier"`);
  }
});

test('Free.ai uses its own chat path and refuses credit-spending models', () => {
  const freeai = getProvider('freeai');
  // /v1/chat/ is not the OpenAI /chat/completions path, so the provider declares it.
  assert.equal(modelsUrl(freeai), 'https://api.free.ai/v1/models');
  assert.equal(chatUrl(freeai), 'https://api.free.ai/v1/chat/');
  assert.equal(isAllowedModel(freeai, 'qwen7b'), true);
  for (const id of ['openai/gpt-4o', 'anthropic/claude-sonnet-4', 'premium/flux-pro/kontext']) {
    assert.equal(isAllowedModel(freeai, id), false, `${id} spends purchased credits`);
  }
  for (const id of freeai.fallbackModels) assert.equal(isAllowedModel(freeai, id), true);
});

test('every plan names the requests it allows', () => {
  assert.deepEqual(limitLines(getProvider('groq')), ['30 requests/min', '1,000 requests/day']);
  assert.deepEqual(limitLines(getProvider('cohere')), ['20 requests/min', '1,000 requests/month']);
  assert.deepEqual(limitLines(getProvider('sambanova')), ['20 requests/min', '20 requests/day per model']);
  assert.deepEqual(limitLines(getProvider('aionlabs')), ['15 requests/min', '20,000 tokens/day']);
  assert.deepEqual(limitLines(getProvider('ovh')), [
    '2 requests/min per model',
    'Public demo: no account and no card.',
  ]);
  assert.match(limitLines(getProvider('openrouter'))[0], /Reported by the key/);
  assert.match(limitLines(getProvider('ollama'))[0], /no request cap/);
  for (const provider of PROVIDERS) {
    const lines = limitLines(provider);
    assert.ok(lines.length > 0 && lines.length <= 3, `${provider.id} needs a short cap list`);
    assert.equal(lines.join(' ').includes('unlimited'), false, `${provider.id} must not imply unlimited`);
  }
});

test('every provider stands on a free plan, never a trial or credit', () => {
  // The rule from AGENTS.md: no card, and free-ness must not expire into paid
  // usage. A value like 'trial' or 'credit' would be the bug this guards.
  const plans = ['standing-tier', 'daily-quota', 'monthly-quota', 'anonymous', 'local'];
  for (const provider of PROVIDERS) {
    assert.ok(plans.includes(provider.freePlan), `${provider.id} has no standing free plan`);
  }
  assert.ok(plans.every((plan) => !/trial|credit/i.test(plan)));
});

test('each plan gets wording a visitor can act on', () => {
  assert.equal(freePlanLabel('standing-tier'), 'free · always');
  assert.equal(freePlanLabel('daily-quota'), 'free · daily quota');
  assert.equal(freePlanLabel('monthly-quota'), 'free · monthly quota');
  assert.equal(freePlanLabel('anonymous'), 'free · no key');
  assert.equal(freePlanLabel('local'), 'free · local');
  // Unknown values must not read as an unlimited promise.
  assert.equal(freePlanLabel('trial'), 'free plan');
  for (const provider of PROVIDERS) {
    assert.equal(publicView(provider, false).planLabel, freePlanLabel(provider.freePlan));
  }
});

test('OVHcloud is keyless: no credential is ever invented for it', () => {
  const ovh = getProvider('ovh');
  assert.equal(ovh.freePlan, 'anonymous');
  assert.equal(ovh.anonymous, true);
  assert.equal(keyFor(ovh, {}, {}), '');
  // No Authorization header, not even an empty Bearer token.
  assert.equal(headersFor(ovh, '').authorization, undefined);
  assert.equal(headersFor(ovh, 'ignored').authorization, undefined);
  assert.equal(headersFor(ovh, '')['content-type'], 'application/json');
  // Anthropic-style attribution headers stay OpenRouter-only.
  assert.equal(headersFor(ovh, '')['x-title'], undefined);
  // It is offered to pick, never as a silent fallback.
  assert.equal(configuredIds({ apiKey: 'sk-or-x' }, {}).includes('ovh'), false);
  assert.equal(publicView(ovh, false).anonymous, true);
  for (const id of [
    'Meta-Llama-3_3-70B-Instruct',
    'Mistral-Nemo-Instruct-2407',
    'Mistral-Small-3.2-24B-Instruct-2506',
    'Qwen3.5-397B-A17B',
    'Qwen3.8-27B',
    'gpt-oss-120b',
    'gpt-oss-20b',
  ]) {
    assert.equal(isAllowedModel(ovh, id), true, id);
  }
  for (const id of [
    'whisper-large-v3',
    'nvr-tts-en-us',
    'stable-diffusion-xl-base-v10',
    'Qwen3-Embedding-8B',
    'Qwen3Guard-Gen-8B',
    'bge-m3',
    'openai/gpt-4o',
  ]) {
    assert.equal(isAllowedModel(ovh, id), false, id);
  }
});

test('Aion Labs is an allowlist provider on its standing free tier', () => {
  const aion = getProvider('aionlabs');
  assert.equal(aion.freePlan, 'daily-quota');
  assert.equal(aion.freePolicy, 'allowlist');
  assert.equal(isAllowedModel(aion, 'aion-labs/aion-3.5-mini'), true);
  assert.equal(isAllowedModel(aion, 'aion-labs/aion-2.0'), true);
  assert.equal(isAllowedModel(aion, 'openai/gpt-4o'), false);
  assert.equal(isAllowedModel(aion, 'aion-labs/aion-image'), false);
  for (const id of aion.fallbackModels) assert.equal(isAllowedModel(aion, id), true);
  assert.equal(chatUrl(aion, {}), 'https://api.aionlabs.ai/v1/chat/completions');
});

test('Z.AI offers only the free GLM-4.7-Flash model', () => {
  const zai = getProvider('zai');
  assert.equal(zai.freePlan, 'standing-tier');
  assert.equal(isAllowedModel(zai, 'glm-4.7-flash'), true);
  for (const id of ['glm-4.7', 'glm-4.7-flashx', 'glm-5.3', 'glm-4.6v-flash', 'glm-4.5-flash']) {
    assert.equal(isAllowedModel(zai, id), false, id);
  }
  assert.deepEqual(zai.fallbackModels, ['glm-4.7-flash']);
  assert.equal(chatUrl(zai, {}), 'https://api.z.ai/api/paas/v4/chat/completions');
});

test('Cloudflare requires an account id and only admits free Workers AI chat models', () => {
  const cloudflare = getProvider('cloudflare');
  assert.equal(cloudflare.requiresAccount, true);
  assert.equal(cloudflare.freePlan, 'daily-quota');
  assert.equal(accountFor(cloudflare, {}, {}), '');
  const config = { providerAccounts: { cloudflare: 'a'.repeat(32) } };
  assert.equal(accountFor(cloudflare, config, {}), 'a'.repeat(32));
  assert.equal(
    baseUrlFor(cloudflare, {}, config),
    `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/v1`,
  );
  assert.equal(
    chatUrl(cloudflare, {}, config),
    `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/v1/chat/completions`,
  );
  for (const id of [
    '@cf/openai/gpt-oss-20b',
    '@cf/openai/gpt-oss-120b',
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/qwen/qwen3.8-27b',
    '@cf/zai-org/glm-4.7-flash',
  ]) {
    assert.equal(isAllowedModel(cloudflare, id), true, id);
  }
  for (const id of [
    '@cf/zai-org/glm-5.3',
    '@cf/moonshotai/kimi-k2.6',
    '@cf/deepseek-ai/deepseek-v4-pro-0813',
    '@cf/baai/bge-large-en-v1.5',
    'openai/gpt-4o',
  ]) {
    assert.equal(isAllowedModel(cloudflare, id), false, id);
  }
  for (const id of cloudflare.fallbackModels) assert.equal(isAllowedModel(cloudflare, id), true);
  assert.deepEqual(configuredIds({ providerKeys: { cloudflare: 'token' } }, {}), []);
  assert.deepEqual(
    configuredIds({ providerKeys: { cloudflare: 'token' }, providerAccounts: config.providerAccounts }, {}),
    ['cloudflare'],
  );
});

test('unknown provider ids are refused, not defaulted', () => {
  assert.equal(getProvider('copilot'), null);
  assert.equal(getProvider(''), null);
  assert.equal(getProvider(undefined), null);
});

test('keys come from the environment first, then the config file', () => {
  const groq = getProvider('groq');
  assert.equal(keyFor(groq, { providerKeys: { groq: 'gsk_fromfile' } }, {}), 'gsk_fromfile');
  assert.equal(
    keyFor(groq, { providerKeys: { groq: 'gsk_fromfile' } }, { GROQ_API_KEY: 'gsk_fromenv' }),
    'gsk_fromenv',
  );
  // OpenRouter keeps its historical field.
  assert.equal(keyFor(getProvider('openrouter'), { apiKey: 'sk-or-legacy' }, {}), 'sk-or-legacy');
});

test('a provider with no key reports as unconfigured', () => {
  assert.deepEqual(configuredIds({ apiKey: 'sk-or-x' }, {}), ['openrouter']);
  assert.deepEqual(configuredIds({}, {}), []);
});

test('the provider order is always exactly the selected provider', () => {
  const config = { apiKey: 'sk-or-x', providerKeys: { groq: 'gsk_y' } };
  // Other keys exist, but this turn must not be handed to another provider.
  assert.deepEqual(fallbackOrder('openrouter', config, {}), ['openrouter']);
  assert.deepEqual(fallbackOrder('gemini', config, {}), ['gemini']);
  // An unknown id is treated as OpenRouter rather than inventing a provider.
  assert.deepEqual(fallbackOrder('copilot', { apiKey: 'sk-or-x' }, {}), ['openrouter']);
});

test('the keyless provider is also never left for another provider', () => {
  // OVHcloud's public demo allows two requests a minute. If it is rate limited,
  // the page must report that instead of silently changing provider.
  assert.deepEqual(fallbackOrder('ovh', { apiKey: 'sk-or-x' }, {}), ['ovh']);
});

test('a provider free-model picker never returns a foreign id', () => {
  const groq = getProvider('groq');
  const listed = [{ id: 'openai/gpt-oss-120b' }, { id: 'whisper-large-v3' }];
  // The model the page chose belongs to another service, so it is ignored.
  assert.equal(firstFreeModel(groq, listed, 'mock/alpha-free'), 'openai/gpt-oss-120b');
  assert.equal(firstFreeModel(groq, listed, null), 'openai/gpt-oss-120b');
  assert.equal(firstFreeModel(groq, [{ id: 'whisper-large-v3' }], null), null);
  assert.equal(firstFreeModel(groq, [], null), null);
  // OpenRouter is decided by its already-filtered free catalog.
  const openrouter = getProvider('openrouter');
  assert.equal(firstFreeModel(openrouter, ['mock/alpha-free'], 'mock/other'), 'mock/alpha-free');
  assert.equal(firstFreeModel(openrouter, [], null), null);
  assert.equal(firstFreeModel(null, listed, null), null);
});

test('base URLs are overridable for tests and never double-slashed', () => {
  assert.equal(baseUrlFor(getProvider('groq'), {}), 'https://api.groq.com/openai/v1');
  assert.equal(
    baseUrlFor(getProvider('groq'), { GROQ_BASE_URL: 'http://127.0.0.1:9999/v1//' }),
    'http://127.0.0.1:9999/v1',
  );
  assert.equal(modelsUrl(getProvider('groq'), {}), 'https://api.groq.com/openai/v1/models');
  assert.equal(chatUrl(getProvider('gemini'), {}), 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
});

test('only OpenRouter gets attribution headers', () => {
  const openrouter = headersFor(getProvider('openrouter'), 'sk-or-x');
  assert.equal(openrouter['x-title'], 'Freeway');
  const groq = headersFor(getProvider('groq'), 'gsk_x');
  assert.equal(groq['x-title'], undefined);
  assert.equal(groq.authorization, 'Bearer gsk_x');
});

test('Groq admits free-tier chat models and refuses media/guard models', () => {
  const groq = getProvider('groq');
  assert.equal(isAllowedModel(groq, 'openai/gpt-oss-120b'), true);
  assert.equal(isAllowedModel(groq, 'qwen/qwen3.8-27b'), true);
  assert.equal(isAllowedModel(groq, 'whisper-large-v3'), false);
  assert.equal(isAllowedModel(groq, 'llama-prompt-guard-2-86m'), false);
  assert.equal(isAllowedModel(groq, 'some/unknown-model'), false);
});

test('Gemini admits flash and gemma, refuses pro and media models', () => {
  const gemini = getProvider('gemini');
  assert.equal(isAllowedModel(gemini, 'gemini-3.8-flash'), true);
  assert.equal(isAllowedModel(gemini, 'gemma-4-31b-it'), true);
  assert.equal(isAllowedModel(gemini, 'gemini-3.1-pro-preview'), false);
  assert.equal(isAllowedModel(gemini, 'imagen-4'), false);
  assert.equal(isAllowedModel(gemini, 'text-embedding-005'), false);
});

test('Mistral offers the free small family and refuses large/paid ids', () => {
  const mistral = getProvider('mistral');
  assert.equal(isAllowedModel(mistral, 'mistral-small-latest'), true);
  assert.equal(isAllowedModel(mistral, 'ministral-8b-latest'), true);
  assert.equal(isAllowedModel(mistral, 'mistral-large-2610'), false);
  assert.equal(isAllowedModel(mistral, 'mistral-embed'), false);
  for (const id of mistral.fallbackModels) assert.equal(isAllowedModel(mistral, id), true);
  assert.equal(modelsUrl(mistral, {}), 'https://api.mistral.ai/v1/models');
});

test('Cohere offers command/aya chat models and refuses embed/rerank', () => {
  const cohere = getProvider('cohere');
  assert.equal(isAllowedModel(cohere, 'command-a-03-2025'), true);
  assert.equal(isAllowedModel(cohere, 'command-r7b-12-2024'), true);
  assert.equal(isAllowedModel(cohere, 'embed-english-v3.0'), false);
  assert.equal(isAllowedModel(cohere, 'rerank-v3.5'), false);
  for (const id of cohere.fallbackModels) assert.equal(isAllowedModel(cohere, id), true);
  assert.equal(chatUrl(cohere, {}), 'https://api.cohere.ai/compatibility/v1/chat/completions');
});

test('SambaNova offers open chat models and refuses media/embedding ids', () => {
  const sambanova = getProvider('sambanova');
  assert.equal(isAllowedModel(sambanova, 'Meta-Llama-3.3-70B-Instruct'), true);
  assert.equal(isAllowedModel(sambanova, 'gpt-oss-120b'), true);
  assert.equal(isAllowedModel(sambanova, 'Whisper-Large-v3'), false);
  assert.equal(isAllowedModel(sambanova, 'E5-Mistral-7B-Instruct'), false);
  for (const id of sambanova.fallbackModels) assert.equal(isAllowedModel(sambanova, id), true);
});

test('an empty id is never allowed', () => {
  for (const provider of PROVIDERS) {
    assert.equal(isAllowedModel(provider, ''), false);
    assert.equal(isAllowedModel(provider, null), false);
  }
});

test('the public view never contains a key', () => {
  const view = publicView(getProvider('groq'), true);
  const text = JSON.stringify(view);
  assert.equal(text.includes('gsk_'), true, 'the hint is expected');
  assert.equal(Object.keys(view).sort().join(','), [
    'accountHint',
    'anonymous',
    'freePlan',
    'freePolicy',
    'hasAccount',
    'hasKey',
    'id',
    'keyHint',
    'keysUrl',
    'label',
    'limitLines',
    'local',
    'note',
    'planLabel',
    'requiresAccount',
    'tier',
  ].join(','));
  assert.equal(view.tier, 'free-tier');
  assert.equal(publicView(getProvider('openrouter'), true).tier, 'verified');
  assert.equal(publicView(getProvider('cloudflare'), true, false).hasAccount, false);
  assert.equal(publicView(getProvider('cloudflare'), true, true).hasAccount, true);
});

test('the pricing policy never waves an id through by pattern', () => {
  // OpenRouter's free-only rule lives in the priced catalog (lib/models.mjs).
  // This gate must fail closed so it can never be mistaken for a safety net.
  const openrouter = getProvider('openrouter');
  assert.equal(isAllowedModel(openrouter, 'openai/gpt-4o'), false);
  assert.equal(isAllowedModel(openrouter, 'meta-llama/llama-3.3-70b-instruct:free'), false);
  assert.equal(isAllowedModel(openrouter, 'anything-at-all'), false);
});

test('ollama is local, keyless and outside the pricing gate', () => {
  // A local daemon has no account and no bill; the pattern gate must not
  // treat its ids like a hosted provider's.
  const ollama = getProvider('ollama');
  assert.ok(ollama?.local, 'ollama should be marked local');
  assert.equal(publicView(ollama, true).tier, 'local');
  assert.equal(publicView(ollama, true).local, true);
  assert.equal(isAllowedModel(ollama, 'llama3.2:latest'), true);
  assert.equal(isAllowedModel(ollama, 'qwen2.5-coder:7b'), true);
});
