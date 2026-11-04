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
import worker, { PROVIDERS as CLOUD_PROVIDERS, handleFiles } from './dist/worker.mjs';
import { PROVIDERS as DESKTOP_PROVIDERS, isAllowedModel, freePlanLabel, limitLines } from '../lib/providers.mjs';

const ORIGIN = 'https://chat.example';
const KEY = 'sk-or-v1-shared-key-that-must-never-be-echoed';

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
    id: 'mock/free-vision',
    name: 'Mock Free Vision',
    pricing: { prompt: '0', completion: '0' },
    context_length: 128000,
    supported_parameters: ['max_tokens'],
    architecture: { input_modalities: ['text', 'image'] },
  },
];

let lastChatBody = null;
let lastChatHeaders = null;
let chatMode = 'ok';
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
    if (chatMode === 'rate') {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' });
      res.end(JSON.stringify({ error: { message: 'free-model burst limit' } }));
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

  await check('config reports the guard a shared key is under', async () => {
    const response = await request(envWith(), { path: '/api/config', method: 'GET', origin: null, ip: null });
    assert.equal(response.status, 200);
    const config = await response.json();
    assert.equal(config.hasKey, true);
    assert.equal(config.guard.deploymentKey, true);
    assert.equal(config.guard.turnTokens, 1024);
    assert.ok(config.guard.perVisitorPerDay >= 1);
    assert.equal(config.guard.originFence, true);
    assert.equal(JSON.stringify(config).includes(KEY), false, 'the key leaked into /api/config');
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

  await check('an upstream 429 forwards its exact Retry-After delay', async () => {
    chatMode = 'rate';
    try {
      const response = await request(envWith(), { body: chatBody });
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '7');
      const body = await response.json();
      assert.equal(body.error, 'upstream_rate');
      assert.equal(body.retryAfterMs, 7000);
      assert.equal(body.model, 'mock/free-one');
    } finally {
      chatMode = 'ok';
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
            'x-provider-key': 'sk-or-v1-visitor-key',
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

  await check('account files need a signed-in user', async () => {
    const response = await handleFiles(new Request(ORIGIN + '/api/files'), envWith(), null);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'sign_in_required');
  });

  await check('account files round-trip and stay inside one subject', async () => {
    const env = envWith();
    const user = { sub: 'user-a' };
    const html = '<!doctype html><h1>hello</h1>';
    const put = await handleFiles(
      new Request(ORIGIN + '/api/files/page.html', {
        method: 'PUT',
        headers: { origin: ORIGIN, 'content-type': 'text/html' },
        body: html,
      }),
      env,
      user,
    );
    assert.equal(put.status, 201);
    assert.equal((await put.json()).file.name, 'page.html');

    const list = await (await handleFiles(new Request(ORIGIN + '/api/files'), env, user)).json();
    assert.equal(list.files.length, 1);
    assert.equal(list.files[0].size, html.length);
    assert.equal(list.usage.count, 1);
    assert.equal(list.usage.maxFileBytes, 1_000_000);

    const got = await handleFiles(new Request(ORIGIN + '/api/files/page.html'), env, user);
    assert.equal(got.status, 200);
    assert.equal(await got.text(), html);
    assert.match(got.headers.get('content-type'), /text\/plain/);
    assert.match(got.headers.get('content-disposition'), /attachment/);

    // A different signed-in account sees nothing, even with the same name.
    const other = await (await handleFiles(new Request(ORIGIN + '/api/files'), env, { sub: 'user-b' })).json();
    assert.equal(other.files.length, 0, 'another account saw the file');
    const otherGet = await handleFiles(new Request(ORIGIN + '/api/files/page.html'), env, { sub: 'user-b' });
    assert.equal(otherGet.status, 404);

    const removed = await handleFiles(
      new Request(ORIGIN + '/api/files/page.html', { method: 'DELETE', headers: { origin: ORIGIN } }),
      env,
      user,
    );
    assert.equal(removed.status, 200);
    const empty = await (await handleFiles(new Request(ORIGIN + '/api/files'), env, user)).json();
    assert.equal(empty.files.length, 0);
  });

  await check('account file writes are fenced and validated', async () => {
    const env = envWith();
    const user = { sub: 'user-c' };
    const foreign = await handleFiles(
      new Request(ORIGIN + '/api/files/a.txt', {
        method: 'PUT',
        headers: { origin: 'https://evil.example', 'content-type': 'text/plain' },
        body: 'x',
      }),
      env,
      user,
    );
    assert.equal(foreign.status, 403);

    const traversal = await handleFiles(
      new Request(ORIGIN + '/api/files/' + encodeURIComponent('../secret.txt'), {
        method: 'PUT',
        headers: { origin: ORIGIN, 'content-type': 'text/plain' },
        body: 'x',
      }),
      env,
      user,
    );
    assert.equal(traversal.status, 400);

    const binary = await handleFiles(
      new Request(ORIGIN + '/api/files/a.bin', {
        method: 'PUT',
        headers: { origin: ORIGIN, 'content-type': 'application/octet-stream' },
        body: new Uint8Array([1, 0, 2]),
      }),
      env,
      user,
    );
    assert.equal(binary.status, 415);

    const tooBig = await handleFiles(
      new Request(ORIGIN + '/api/files/big.txt', {
        method: 'PUT',
        headers: { origin: ORIGIN, 'content-type': 'text/plain' },
        body: 'x'.repeat(1_000_001),
      }),
      env,
      user,
    );
    assert.equal(tooBig.status, 413);

    const noBucket = await handleFiles(new Request(ORIGIN + '/api/files'), envWith({ FILES: undefined }), user);
    assert.equal(noBucket.status, 503);
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
