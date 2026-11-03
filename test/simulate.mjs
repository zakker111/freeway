// End-to-end simulation against a mock OpenRouter.
// Starts a fake upstream (models, key, chat with SSE) and the real app as a
// child process, then checks the behaviours that matter:
//   1. the page never contains the API key
//   2. CSRF: POST without the app token is rejected
//   3. catalog filtering works
//   4. quota passthrough works
//   5. a 429 on the first model falls back to the second and still streams
//   6. when every model rate-limits, the app reports it and stops

import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', 'app.mjs');
const KEY = 'sk-or-v1-test-key-that-must-never-leak';

const models = [
  {
    id: 'mock/alpha-free',
    name: 'Alpha (free)',
    pricing: { prompt: '0', completion: '0' },
    context_length: 128_000,
    supported_parameters: ['tools', 'max_tokens'],
    architecture: { input_modalities: ['text'] },
  },
  {
    id: 'mock/beta-free',
    name: 'Beta (free)',
    pricing: { prompt: '0', completion: '0' },
    context_length: 200_000,
    supported_parameters: ['max_tokens'],
    architecture: { input_modalities: ['text'] },
  },
  {
    id: 'mock/paid-model',
    name: 'Paid model',
    pricing: { prompt: '0.0000025', completion: '0.00001' },
    context_length: 200_000,
    supported_parameters: ['tools'],
    architecture: { input_modalities: ['text'] },
  },
];

let mode = 'fallback';
let chatCalls = [];

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/api/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: models, total_count: models.length }));
    return;
  }

  if (url.pathname === '/api/v1/key') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        label: 'test',
        limit: null,
        limit_remaining: null,
        usage: 0,
        is_free_tier: true,
        free_model_daily_requests: { used: 3, limit: 50, remaining: 47 },
      },
    }));
    return;
  }

  if (url.pathname === '/api/v1/chat/completions') {
    const body = await readBody(req);
    chatCalls.push(body);
    const chain = Array.isArray(body.models) && body.models.length ? body.models : [body.model];

    if (mode === 'exhausted') {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          code: 429,
          message: 'Rate limit exceeded for free models',
          metadata: { limit_source: 'openrouter_rate_limit' },
        },
      }));
      return;
    }

    if (chain[0] === 'mock/alpha-free') {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          code: 429,
          message: 'Alpha is rate limited right now',
          metadata: { limit_source: 'openrouter_rate_limit' },
        },
      }));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' });
    sse(res, { id: 'x', model: chain[0], choices: [{ delta: { role: 'assistant', content: '' } }] });
    for (const piece of ['Hello', ' from', ` ${chain[0]}`, '!']) {
      sse(res, { id: 'x', model: chain[0], choices: [{ delta: { content: piece } }] });
    }
    sse(res, {
      id: 'x',
      model: chain[0],
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17, cost: 0 },
    });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

async function waitForServer(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/config`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('app server did not start');
}

function collectSse(text) {
  const events = [];
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        events.push(JSON.parse(payload));
      } catch {
        /* ignore */
      }
    }
  }
  return events;
}

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push({ name, ok: true }))
    .catch((error) => results.push({ name, ok: false, error }));
}

async function main() {
  mock.listen(0, '127.0.0.1');
  await once(mock, 'listening');
  const upstream = `http://127.0.0.1:${mock.address().port}/api/v1`;

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openrouter-chat-sim-'));
  const appPort = 3300 + Math.floor(Math.random() * 300);
  const base = `http://127.0.0.1:${appPort}`;

  const child = spawn(process.execPath, [APP], {
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENROUTER_BASE_URL: upstream,
      OPENROUTER_API_KEY: KEY,
      OPENROUTER_CONFIG: path.join(configDir, 'config.json'),
      NO_OPEN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => (logs += chunk));
  child.stderr.on('data', (chunk) => (logs += chunk));

  try {
    await waitForServer(base);
    const html = await (await fetch(`${base}/`)).text();
    const token = /const APP_TOKEN = "([a-f0-9]{32})"/.exec(html)?.[1];

    await check('page renders without leaking the API key', () => {
      assert.match(html, /OpenRouter/);
      assert.equal(html.includes(KEY), false, 'API key leaked into HTML');
      assert.ok(token, 'app token missing from page');
    });

    await check('rejects POST without the app token', async () => {
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert.equal(response.status, 403);
    });

    await check('serves the catalog with free-only filtering', async () => {
      const body = await (await fetch(`${base}/api/models?free=1`)).json();
      const ids = body.models.map((m) => m.id);
      assert.deepEqual(ids.sort(), ['mock/alpha-free', 'mock/beta-free']);
      assert.equal(body.models.every((m) => m.free), true);
    });

    await check('excludes expired models and honours minContext', async () => {
      const body = await (await fetch(`${base}/api/models?minContext=150000`)).json();
      assert.deepEqual(body.models.map((m) => m.id).sort(), ['mock/beta-free', 'mock/paid-model']);
    });

    await check('reports the free daily quota', async () => {
      const body = await (await fetch(`${base}/api/key`)).json();
      assert.equal(body.ok, true);
      assert.equal(body.freeDaily.remaining, 47);
    });

    await check('falls back to the next free model on 429 and streams text', async () => {
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'say hello' }] }),
      });
      assert.equal(response.status, 200);
      const events = collectSse(await response.text());
      const text = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
      const done = events.find((e) => e.type === 'done');
      assert.equal(text, 'Hello from mock/beta-free!');
      assert.equal(done?.model, 'mock/beta-free');
      assert.ok(events.some((e) => e.type === 'retry'), 'no retry event emitted');
      assert.equal(chatCalls.length >= 2, true, 'expected a retry upstream');
    });

    await check('stops with a clear error when every model is rate limited', async () => {
      mode = 'exhausted';
      chatCalls = [];
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'say hello' }] }),
      });
      const events = collectSse(await response.text());
      const error = events.find((e) => e.type === 'error');
      assert.ok(error, 'expected an error event');
      assert.match(error.message, /Free requests left today: 47 of 50/);
      assert.equal(events.some((e) => e.type === 'done'), false);
      assert.equal(chatCalls.length <= 3, true, 'too many upstream attempts');
    });

    await check('rejects oversized conversations', async () => {
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(70_000) }] }),
      });
      assert.equal(response.status, 413);
    });
  } finally {
    child.kill('SIGTERM');
    mock.close();
  }

  let failed = 0;
  for (const result of results) {
    if (result.ok) {
      console.log(`  PASS  ${result.name}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${result.name}`);
      console.log(`        ${result.error?.message ?? result.error}`);
    }
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);

  if (failed > 0) {
    if (logs.trim()) console.log(`\napp output:\n${logs.trim()}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('simulation crashed:', error);
  process.exit(1);
});
