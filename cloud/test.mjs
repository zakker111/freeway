// Tests for the Worker's shared-key guard, without a real key or a deployment.
//
// The guard is the part a reader cannot check by using the site: it only fires
// when the owner has put OPENROUTER_API_KEY in Sites secrets. Here the Worker is
// imported directly (no HTTP server, no Wrangler) with a stub upstream and the
// same node:sqlite shim cloud/dev.mjs uses, so the fence, the budget and the
// token ceiling are all exercised locally.
import http from 'node:http';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import worker, { PROVIDERS as CLOUD_PROVIDERS } from './dist/worker.mjs';
import { PROVIDERS as DESKTOP_PROVIDERS, isAllowedModel, freePlanLabel, limitLines } from '../lib/providers.mjs';

const ORIGIN = 'https://chat.example';
const KEY = ['sk-or-v1-', 'k'.repeat(32)].join('');

const models = [
  {
    id: 'mock/free-one',
    name: 'Mock Free One',
    pricing: { prompt: '0', completion: '0' },
    context_length: 128000,
    supported_parameters: ['max_tokens'],
    architecture: { input_modalities: ['text'] },
  },
  {
    id: 'mock/free-two',
    name: 'Mock Free Two',
    pricing: { prompt: '0', completion: '0' },
    context_length: 64000,
    supported_parameters: ['max_tokens'],
    architecture: { input_modalities: ['text'] },
  },
  {
    id: 'mock/free-three',
    name: 'Mock Free Three',
    pricing: { prompt: '0', completion: '0' },
    context_length: 32000,
    supported_parameters: ['max_tokens'],
    architecture: { input_modalities: ['text'] },
  },
  {
    id: 'mock/free-vision',
    name: 'Mock Free Vision',
    pricing: { prompt: '0', completion: '0' },
    context_length: 16000,
    supported_parameters: ['max_tokens'],
    architecture: { input_modalities: ['text', 'image'] },
  },
];

let lastChatBody = null;
let lastChatHeaders = null;
let chatMode = 'ok';
const chatCalls = [];
const chatFailures = new Map();
const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/groq/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b', pricing: { prompt: '0', completion: '0' } }] }));
    return;
  }
  if (url.pathname === '/groq/v1/chat/completions') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'g',
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { role: 'assistant', content: 'hello from Groq' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 4 },
      }),
    );
    return;
  }
  if (url.pathname.endsWith('/slow/models')) {
    // Used by the cold-start check: a catalog that outlives the edge's budget.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: models }));
    return;
  }
  if (url.pathname.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: models }));
    return;
  }
  if (url.pathname.endsWith('/key')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: { limit: null, usage: 0, limit_remaining: null, is_free_tier: true } }));
    return;
  }
  if (url.pathname.includes('/ovh-fail/')) {
    // The keyless endpoint accepts the model list but rate limits the turn.
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3' });
    res.end(JSON.stringify({ error: { message: 'OVHcloud demo limit' } }));
    return;
  }
  if (url.pathname.endsWith('/chat/completions')) {
    lastChatHeaders = req.headers;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    lastChatBody = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    chatCalls.push(lastChatBody);
    const failed = chatFailures.get(lastChatBody.model);
    if (failed) {
      res.writeHead(failed.status, {
        'content-type': 'application/json',
        ...(failed.retryAfter ? { 'retry-after': failed.retryAfter } : {}),
      });
      res.end(JSON.stringify({ error: { message: `mock failure ${failed.status}` } }));
      return;
    }
    if (chatMode === 'echo-key') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}` } }));
      return;
    }
    if (chatMode === 'rate') {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' });
      res.end(JSON.stringify({ error: { message: 'free-model burst limit' } }));
      return;
    }
    if (lastChatBody.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const delta of ['hello ', 'from the stream']) {
        res.write(`data: ${JSON.stringify({ model: lastChatBody.model, choices: [{ delta: { content: delta } }] })}\n\n`);
      }
      res.write(
        `data: ${JSON.stringify({
          model: lastChatBody.model,
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 4 },
        })}\n\n`,
      );
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'x',
        model: lastChatBody.model,
        choices: [{ message: { role: 'assistant', content: 'hello from the mock' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 4 },
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end('{}');
});

function makeDb() {
  // Same shape the Worker relies on: prepare().bind().all()/run() and batch().
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(':memory:');
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      let args = [];
      const api = {
        bind(...values) {
          args = values;
          return api;
        },
        async all() {
          return { results: statement.all(...args) };
        },
        async run() {
          statement.run(...args);
          return { success: true };
        },
      };
      return api;
    },
    async batch(list) {
      const out = [];
      for (const item of list) out.push(await item.run());
      return out;
    },
  };
}

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push({ name, ok: true }))
    .catch((error) => results.push({ name, ok: false, error }));
}

function makeBucket() {
  const objects = new Map();
  return {
    async put(key, value) {
      objects.set(key, value);
    },
    async get(key) {
      const value = objects.get(key);
      return value === undefined ? null : { body: value };
    },
    async delete(key) {
      objects.delete(key);
    },
    objects,
  };
}

function envWith(overrides = {}) {
  return {
    DB: makeDb(),
    FILES: makeBucket(),
    OPENROUTER_API_KEY: KEY,
    OPENROUTER_BASE_URL: upstream,
    APP_ORIGIN: ORIGIN,
    ...overrides,
  };
}

function request(env, { path = '/api/chat', method = 'POST', origin = ORIGIN, ip = '203.0.113.7', body, headers: extra = {} } = {}) {
  const headers = { 'content-type': 'application/json', ...extra };
  if (origin) headers.origin = origin;
  if (ip) headers['cf-connecting-ip'] = ip;
  return worker.fetch(
    new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    {},
  );
}

const chatBody = {
  model: 'mock/free-one',
  stream: false,
  max_tokens: 4096,
  messages: [{ role: 'user', content: 'hi' }],
};

let upstream = '';
let exitCode = 0;

async function main() {
  mock.listen(0, '127.0.0.1');
  await once(mock, 'listening');
  upstream = `http://127.0.0.1:${mock.address().port}/api/v1`;

  await check('config answers before a slow catalog does', async () => {
    const started = Date.now();
    const response = await request(envWith({ OPENROUTER_BASE_URL: `${upstream}/slow` }), {
      path: '/api/config',
      method: 'GET',
      origin: null,
      ip: null,
    });
    const elapsed = Date.now() - started;
    assert.equal(response.status, 200);
    // The empty module cache means the old code waited for the 2.5s timeout.
    assert.ok(elapsed < 1000, `config waited ${elapsed}ms for the catalog`);
  });

  await check('config reports the guard a shared key is under', async () => {
    const response = await request(envWith(), { path: '/api/config', method: 'GET', origin: null, ip: null });
    assert.equal(response.status, 200);
    const config = await response.json();
    assert.equal(config.hasKey, true);
    assert.equal(config.guard.deploymentKey, true);
    assert.equal(config.guard.turnTokens, 1024);
    assert.ok(config.guard.perVisitorPerDay >= 1);
    assert.equal(config.guard.originFence, true);
    assert.equal(config.previewShares, undefined, 'guest-only config still advertises preview shares');
    assert.equal(config.accountFiles, undefined, 'guest-only config still advertises account files');
    assert.equal(
      config.desktopDownloadUrl,
      'https://github.com/zakker111/freeway/releases/latest',
      'the cloud desktop link is not a stable release URL',
    );
    assert.equal(JSON.stringify(config).includes(KEY), false, 'the key leaked into /api/config');
  });

  await check('healthz is a read-only check', async () => {
    const get = await request(envWith(), { path: '/healthz', method: 'GET', origin: null, ip: null });
    assert.equal(get.status, 200);
    assert.equal(await get.text(), 'ok');
    const post = await request(envWith(), { path: '/healthz', method: 'POST', origin: null, ip: null });
    assert.equal(post.status, 405);
  });

  await check('a shared-key turn from another origin is refused', async () => {
    const response = await request(envWith(), { origin: 'https://evil.example', body: chatBody });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'foreign_origin');
  });

  await check('a shared-key turn from this site answers, capped in size', async () => {
    lastChatBody = null;
    const response = await request(envWith(), { body: chatBody });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.text, 'hello from the mock');
    assert.equal(lastChatBody.max_tokens, 1024, 'the shared key was allowed to spend 4096 tokens');
    assert.equal(JSON.stringify(body).includes(KEY), false, 'the key leaked into the answer');
  });

  await check('a rate-limited free model is retried inside the same provider', async () => {
    chatFailures.set('mock/free-one', { status: 429, retryAfter: '2' });
    chatCalls.length = 0;
    try {
      const response = await request(envWith(), { body: chatBody });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.text, 'hello from the mock');
      assert.equal(body.model, 'mock/free-two');
      assert.equal(body.retriedFrom, 'mock/free-one');
      assert.deepEqual(
        chatCalls.map((call) => call.model),
        ['mock/free-one', 'mock/free-two'],
        'the retry left the chosen provider or guessed the wrong order',
      );
    } finally {
      chatFailures.clear();
    }
  });

  await check('a streaming turn retries before the first byte', async () => {
    chatFailures.set('mock/free-one', { status: 429, retryAfter: '2' });
    chatCalls.length = 0;
    try {
      const response = await request(envWith(), { body: { ...chatBody, stream: true } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-answer-provider'), 'openrouter');
      assert.equal(response.headers.get('x-retried-from'), 'mock/free-one');
      const text = await response.text();
      assert.match(text, /hello /);
      assert.match(text, /from the stream/);
      assert.match(text, /"retriedFrom":"mock\/free-one"/);
      assert.deepEqual(
        chatCalls.map((call) => call.model),
        ['mock/free-one', 'mock/free-two'],
        'the stream retry changed provider or model order',
      );
    } finally {
      chatFailures.clear();
    }
  });

  await check('an upstream key echo is scrubbed from the chat error', async () => {
    chatMode = 'echo-key';
    chatCalls.length = 0;
    try {
      const response = await request(envWith(), { body: chatBody });
      assert.equal(response.status, 401);
      const body = await response.json();
      assert.equal(JSON.stringify(body).includes(KEY), false, 'the upstream key reached the browser');
      assert.match(body.detail, /sk-or-\[redacted\]/);
    } finally {
      chatMode = 'ok';
    }
  });

  await check('the cloud page is nosniff and framed by nobody', async () => {
    const env = envWith({
      ASSETS: {
        async fetch() {
          return new Response('<!doctype html><title>Freeway</title>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        },
      },
    });
    const response = await request(env, { path: '/', method: 'GET', origin: null, ip: null });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  });

  await check('a key error is not retried', async () => {
    chatFailures.set('mock/free-one', { status: 401 });
    chatCalls.length = 0;
    try {
      const response = await request(envWith(), { body: chatBody });
      assert.equal(response.status, 401);
      const body = await response.json();
      assert.equal(body.error, 'key_rejected');
      assert.equal(body.model, 'mock/free-one');
      assert.equal(chatCalls.length, 1, 'a rejected key was retried against more models');
    } finally {
      chatFailures.clear();
    }
  });

  await check('all provider models failing returns the last retry delay', async () => {
    for (const model of ['mock/free-one', 'mock/free-two', 'mock/free-three']) {
      chatFailures.set(model, { status: 429, retryAfter: '7' });
    }
    chatCalls.length = 0;
    try {
      const response = await request(envWith(), { body: chatBody });
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '7');
      const body = await response.json();
      assert.equal(body.error, 'upstream_rate');
      assert.equal(body.retryAfterMs, 7000);
      assert.equal(body.model, 'mock/free-three');
      assert.deepEqual(
        chatCalls.map((call) => call.model),
        ['mock/free-one', 'mock/free-two', 'mock/free-three'],
        'the retry budget was not exactly three models',
      );
    } finally {
      chatFailures.clear();
    }
  });

  await check('an image turn does not retry onto a text model', async () => {
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    chatFailures.set('mock/free-vision', { status: 429, retryAfter: '2' });
    chatCalls.length = 0;
    try {
      const response = await request(envWith(), {
        body: {
          ...chatBody,
          model: 'mock/free-vision',
          messages: [{ role: 'user', content: 'what is this?', images: [image] }],
        },
      });
      assert.equal(response.status, 429);
      assert.equal(chatCalls.length, 1, 'an image turn was retried onto another model');
      assert.equal(chatCalls[0].model, 'mock/free-vision');
    } finally {
      chatFailures.clear();
    }
  });

  await check('a free vision model receives the image as OpenAI content parts', async () => {
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    lastChatBody = null;
    const response = await request(envWith(), {
      body: {
        ...chatBody,
        model: 'mock/free-vision',
        messages: [{ role: 'user', content: 'what is this?', images: [image] }],
      },
    });
    assert.equal(response.status, 200);
    assert.equal(Array.isArray(lastChatBody.messages[0].content), true);
    assert.deepEqual(lastChatBody.messages[0].content[1], {
      type: 'image_url',
      image_url: { url: image },
    });
    assert.equal(lastChatBody.model, 'mock/free-vision', 'an image turn silently changed models');
  });

  await check('a text-only free model refuses an image instead of guessing', async () => {
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    lastChatBody = null;
    const response = await request(envWith(), {
      body: {
        ...chatBody,
        messages: [{ role: 'user', content: 'what is this?', images: [image] }],
      },
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'vision_required');
    assert.equal(lastChatBody, null, 'a text-only model was called with an image');
  });

  await check('a visitor is budgeted per day, then told how to continue', async () => {
    const env = envWith({ VISITOR_DAILY_LIMIT: '2' });
    for (let i = 0; i < 2; i += 1) {
      const ok = await request(env, { body: chatBody });
      assert.equal(ok.status, 200, `request ${i + 1} of the budget was refused`);
    }
    const third = await request(env, { body: chatBody });
    assert.equal(third.status, 429);
    const body = await third.json();
    assert.equal(body.error, 'visitor_budget');
    assert.match(body.message, /own key/i);
    // Another visitor is unaffected, or one busy address would close the site.
    const neighbour = await request(env, { ip: '198.51.100.9', body: chatBody });
    assert.equal(neighbour.status, 200);
  });

  await check('a visitor on their own key is not fenced or budgeted', async () => {
    const env = envWith({ OPENROUTER_API_KEY: '', VISITOR_DAILY_LIMIT: '1' });
    for (let i = 0; i < 3; i += 1) {
      const response = await worker.fetch(
        new Request(ORIGIN + '/api/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-provider-key': ['sk-or-v1-', 'k'.repeat(32)].join(''),
            origin: 'https://their-own-site.example',
          },
          body: JSON.stringify(chatBody),
        }),
        env,
        {},
      );
      // Their key, their quota: no origin fence, no shared budget, full size.
      assert.equal(response.status, 200, `visitor turn ${i + 1} was refused`);
    }
    assert.equal(lastChatBody.max_tokens, 4096);
  });

  await check('the budget route says what is left, without spending a turn', async () => {
    const env = envWith({ VISITOR_DAILY_LIMIT: '3' });
    const first = await (await request(env, { path: '/api/budget', method: 'GET' })).json();
    assert.deepEqual(
      { active: first.active, limit: first.limit, used: first.used, remaining: first.remaining },
      { active: true, limit: 3, used: 0, remaining: 3 },
    );
    await request(env, { body: chatBody });
    const after = await (await request(env, { path: '/api/budget', method: 'GET' })).json();
    assert.equal(after.used, 1);
    assert.equal(after.remaining, 2);
    const again = await (await request(env, { path: '/api/budget', method: 'GET' })).json();
    assert.equal(again.used, 1, 'reading the budget spent a turn');
    assert.equal(JSON.stringify(again).includes(KEY), false, 'the key leaked into /api/budget');
  });

  await check('a keyless deployment has no shared budget to report', async () => {
    const env = envWith({ OPENROUTER_API_KEY: '' });
    const body = await (await request(env, { path: '/api/budget', method: 'GET' })).json();
    assert.equal(body.active, false);
    assert.equal(body.used, 0);
    assert.equal(body.remaining, body.limit);
  });

  await check('OVHcloud answers with no key and no authorization header', async () => {
    lastChatHeaders = null;
    const env = envWith({ OPENROUTER_API_KEY: '', OVH_BASE_URL: upstream });
    const response = await request(env, {
      // Another origin on purpose: with no shared secret there is nothing to fence.
      origin: 'https://elsewhere.example',
      body: { provider: 'ovh', model: 'gpt-oss-120b', stream: false, messages: [{ role: 'user', content: 'hi' }] },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).text, 'hello from the mock');
    assert.equal(lastChatBody.model, 'gpt-oss-120b');
    assert.equal(lastChatHeaders.authorization, undefined, 'a keyless provider was sent a bearer token');
  });

  await check('a tool turn tells the model to use the offered tools', async () => {
    lastChatBody = null;
    const tools = [
      {
        type: 'function',
        function: {
          name: 'list_files',
          description: 'List browser workspace files.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    const response = await request(envWith(), { body: { ...chatBody, tools } });
    assert.equal(response.status, 200);
    assert.deepEqual(lastChatBody.tools.map((tool) => tool.function.name), ['list_files']);
    const system = lastChatBody.messages.find((message) => message.role === 'system');
    assert.ok(system, 'the tool turn had no system instruction');
    assert.match(system.content, /Tool use is enabled in Settings/);
    assert.match(system.content, /Available tools: list_files/);
  });

  await check('a plain turn does not claim tools are enabled', async () => {
    lastChatBody = null;
    const response = await request(envWith(), { body: chatBody });
    assert.equal(response.status, 200);
    assert.equal(lastChatBody.tools, undefined);
    assert.equal(
      lastChatBody.messages.some((message) => /Tool use is enabled in Settings/.test(message.content)),
      false,
    );
  });

  await check('OVHcloud is not used as a silent fallback', async () => {
    // OpenRouter fails; the chain must skip the 2-requests-a-minute demo endpoint
    // even though it needs no key at all.
    const env = envWith({ OPENROUTER_BASE_URL: 'http://127.0.0.1:1/api/v1', OVH_BASE_URL: upstream });
    const response = await request(env, { body: chatBody });
    assert.equal(response.status >= 400, true);
    assert.notEqual(response.headers.get('x-answer-provider'), 'ovh');
  });

  await check('a selected provider never moves to another keyed provider', async () => {
    // OpenRouter is rate limited and Groq has a valid server key. The turn must
    // fail on OpenRouter; the user's provider choice is not a suggestion.
    chatMode = 'rate';
    try {
      const env = envWith({
        GROQ_API_KEY: 'gsk_test',
        GROQ_BASE_URL: `${upstream}/groq/v1`,
      });
      const response = await request(env, { body: chatBody });
      assert.equal(response.status >= 400, true, 'the turn was answered by another provider');
      assert.notEqual(response.headers.get('x-answer-provider'), 'groq');
    } finally {
      chatMode = 'ok';
    }
  });

  await check('a keyless primary does not silently move to a keyed provider', async () => {
    // OVHcloud is the chosen provider and its demo is rate limited. The Worker
    // has an OpenRouter key, but must not answer the turn from it: the page is
    // still labelled OVHcloud, and the user asked for the keyless demo.
    const env = envWith({ OVH_BASE_URL: `${upstream}/ovh-fail` });
    const response = await request(env, {
      body: {
        provider: 'ovh',
        model: 'gpt-oss-120b',
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    assert.equal(response.status >= 400, true, 'the keyless turn was answered by another provider');
    assert.notEqual(response.headers.get('x-answer-provider'), 'openrouter');
  });

  await check('both editions ship the same providers, each on a free plan', async () => {
    const cloud = Object.values(CLOUD_PROVIDERS).map((provider) => provider.id).sort();
    // Hosted providers only: Ollama is desktop-only because a Worker cannot reach
    // 127.0.0.1, and that is the one difference the two tables are allowed.
    const desktop = DESKTOP_PROVIDERS.filter((provider) => !provider.local)
      .map((provider) => provider.id)
      .sort();
    assert.deepEqual(cloud, desktop, 'the two provider tables drifted apart');
    assert.ok(desktop.includes('aionlabs'));
    const plans = ['standing-tier', 'daily-quota', 'monthly-quota', 'anonymous', 'local'];
    for (const provider of Object.values(CLOUD_PROVIDERS)) {
      assert.ok(plans.includes(provider.freePlan), `${provider.id} has no free plan`);
      const twin = DESKTOP_PROVIDERS.find((each) => each.id === provider.id);
      assert.equal(provider.freePlan, twin.freePlan, `${provider.id} disagrees on its free plan`);
    }
    // The wording lives on the public list, not the raw table: check what a
    // visitor actually receives against the desktop label for the same plan.
    const config = await (await request(envWith(), { path: '/api/config', method: 'GET', origin: null, ip: null })).json();
    for (const entry of config.providers) {
      const twin = DESKTOP_PROVIDERS.find((each) => each.id === entry.id);
      assert.equal(entry.planLabel, freePlanLabel(twin.freePlan), `${entry.id} disagrees on its wording`);
      assert.equal(/free tier/i.test(entry.note), false, `${entry.id} note still says "free tier"`);
      assert.deepEqual(entry.limitLines, limitLines(twin), `${entry.id} disagrees on its limits`);
    }
  });

  await check('Cloudflare needs both a token and an account id', async () => {
    const env = envWith({
      OPENROUTER_API_KEY: '',
      CLOUDFLARE_API_TOKEN: '',
      CLOUDFLARE_ACCOUNT_ID: '',
      CLOUDFLARE_BASE_URL: upstream,
    });
    const noKey = await request(env, { path: '/api/models?provider=cloudflare', method: 'GET', origin: null, ip: null });
    assert.equal(noKey.status, 401);
    assert.equal((await noKey.json()).error, 'missing_key');

    const noAccount = await request(env, {
      path: '/api/models?provider=cloudflare',
      method: 'GET',
      origin: null,
      ip: null,
      headers: { 'x-provider-key': 'cf-visitor-token' },
    });
    assert.equal(noAccount.status, 401);
    assert.equal((await noAccount.json()).error, 'missing_account');

    const complete = await request(env, {
      path: '/api/models?provider=cloudflare',
      method: 'GET',
      origin: null,
      ip: null,
      headers: { 'x-provider-key': 'cf-visitor-token', 'x-provider-account': 'a'.repeat(32) },
    });
    assert.equal(complete.status, 200);
    assert.equal((await complete.json()).provider, 'cloudflare');
  });

  await check('Aion Labs admits only its own chat models', async () => {
    const aion = DESKTOP_PROVIDERS.find((provider) => provider.id === 'aionlabs');
    assert.equal(isAllowedModel(aion, 'aion-labs/aion-3.5-mini'), true);
    assert.equal(isAllowedModel(aion, 'aion-labs/aion-2.0'), true);
    assert.equal(isAllowedModel(aion, 'openai/gpt-4o'), false);
    assert.equal(isAllowedModel(aion, 'aion-labs/aion-image'), false);
  });

  await check('removed account routes are gone', async () => {
    const env = envWith();
    for (const path of ['/api/me', '/api/files', '/api/previews', '/api/threads']) {
      const response = await request(env, { path, method: 'GET', origin: null, ip: null });
      assert.equal(response.status, 404, `${path} is still routed`);
    }
    const assets = envWith({
      ASSETS: { async fetch() { return new Response('not found', { status: 404 }); } },
    });
    for (const path of ['/auth/freebuff/signin', '/auth/freebuff/signout']) {
      const response = await request(assets, { path, method: 'GET', origin: null, ip: null });
      assert.equal(response.status, 404, `${path} is still routed`);
    }
  });

  mock.close();
  let failed = 0;
  for (const result of results) {
    if (result.ok) console.log(`  PASS  ${result.name}`);
    else {
      failed += 1;
      console.log(`  FAIL  ${result.name}`);
      console.log(`        ${result.error?.message ?? result.error}`);
    }
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) exitCode = 1;
}

main()
  .catch((error) => {
    console.error('cloud test crashed:', error);
    exitCode = 1;
  })
  .finally(() => process.exit(exitCode));
