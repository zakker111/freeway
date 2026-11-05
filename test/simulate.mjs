// End-to-end simulation against a mock OpenRouter.
// Starts a fake upstream (models, key, chat with SSE) and the real app as a
// child process, then checks the behaviours that matter:
//   1. the page never contains the API key or the app token in plaintext config
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
let groqCalls = [];

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

    // This provider is completely out, so the turn has to move elsewhere.
    if (mode === 'cross-provider') {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'every OpenRouter model is rate limited' } }));
      return;
    }

    // A stream slow enough to hang up on: one delta, a pause, then the rest. The
    // closed-tab check needs the client to disappear while text already exists,
    // otherwise there is nothing for the server to rescue.
    if (mode === 'slow') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { role: 'assistant', content: '' } }] });
      sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { content: 'Partial ' } }] });
      await new Promise((resolve) => setTimeout(resolve, 700));
      sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { content: 'answer.' } }] });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 2, cost: 0 },
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (mode === 'patch' && Array.isArray(body.tools) && !body.messages.some((m) => m.role === 'tool')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [
          {
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_patch',
                  type: 'function',
                  function: {
                    name: 'apply_patch',
                    arguments: JSON.stringify({
                      path: 'patched.txt',
                      edits: [{ find: 'old line', replace: 'new line' }],
                    }),
                  },
                },
              ],
            },
          },
        ],
      });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 12, completion_tokens: 6, cost: 0 },
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (mode === 'patch') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { role: 'assistant', content: '' } }] });
      sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { content: 'Patched it.' } }] });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 24, completion_tokens: 3, cost: 0 },
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (mode === 'write' && Array.isArray(body.tools) && !body.messages.some((m) => m.role === 'tool')) {
      // Arguments arrive in two fragments on purpose, like a real stream.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [
          {
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_write',
                  type: 'function',
                  function: { name: 'write_file', arguments: '{"path":"written/by-model.txt",' },
                },
              ],
            },
          },
        ],
      });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '"content":"the model wrote this"}' } }] } },
        ],
      });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 9, completion_tokens: 4, cost: 0 },
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (mode === 'write') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { role: 'assistant', content: '' } }] });
      for (const piece of ['Done', ' writing.']) {
        sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { content: piece } }] });
      }
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 30, completion_tokens: 4, cost: 0 },
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (mode === 'tools-empty') {
      if (Array.isArray(body.tools) && !body.messages.some((m) => m.role === 'tool')) {
        // 1. The model asks for a tool.
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        sse(res, {
          id: 'x',
          model: 'mock/alpha-free',
          choices: [
            {
              delta: {
                role: 'assistant',
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'calculate', arguments: '{"expression":"6*7"}' } },
                ],
              },
            },
          ],
        });
        sse(res, {
          id: 'x',
          model: 'mock/alpha-free',
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 9, completion_tokens: 4, cost: 0 },
        });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (!Array.isArray(body.tools)) {
        // 3. The forced answer: no tools were offered, so it must write text.
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { role: 'assistant', content: '' } }] });
        for (const piece of ['It is ', '42.']) {
          sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { content: piece } }] });
        }
        sse(res, {
          id: 'x',
          model: 'mock/alpha-free',
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 40, completion_tokens: 4, cost: 0 },
        });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // 2. The tool result came back and the model says nothing at all.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { role: 'assistant', content: '' } }] });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 0, cost: 0 },
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (mode === 'tools' && Array.isArray(body.tools) && !body.messages.some((m) => m.role === 'tool')) {
      // Split the arguments across two chunks on purpose: the accumulator has
      // to stitch fragments back together before parsing them.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [
          {
            delta: {
              role: 'assistant',
              tool_calls: [
                { index: 0, id: 'call_1', type: 'function', function: { name: 'calculate', arguments: '{"expression":' } },
              ],
            },
          },
        ],
      });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"6*7"}' } }] } }],
      });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 9, completion_tokens: 4, cost: 0 },
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (mode === 'tools') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { role: 'assistant', content: '' } }] });
      for (const piece of ['The answer', ' is ', '42.']) {
        sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { content: piece } }] });
      }
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 30, completion_tokens: 6, cost: 0 },
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (mode === 'text-write' && Array.isArray(body.tools) && !body.messages.some((m) => m.role === 'tool')) {
      // Exactly what the free model did in the app: the call is prose, not protocol.
      const page = '<!doctype html>\n<html lang="en"><body><h1>Hello World</h1></body></html>';
      const text =
        'Writing that page now.\n<tool_call>\n<function=write_file>\n' +
        '<parameter=path>hello/index.html</parameter>\n' +
        `<parameter=content>${page}</parameter>\n` +
        '</function>\n</tool_call>';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let at = 0;
      for (const cut of [70, 150, text.length]) {
        sse(res, { id: 'x', model: 'mock/alpha-free', choices: [{ delta: { content: text.slice(at, cut) } }] });
        at = cut;
      }
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 30 },
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (mode === 'text-write') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [{ delta: { content: 'Done: hello/index.html is in the workspace.' } }],
      });
      sse(res, {
        id: 'x',
        model: 'mock/alpha-free',
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 8 },
      });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

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

  // A second provider, so cross-provider fallback can be exercised end to end.
  if (url.pathname === '/groq/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        data: [{ id: 'openai/gpt-oss-120b' }, { id: 'whisper-large-v3' }, { id: 'llama-3.3-70b-versatile' }],
      }),
    );
    return;
  }

  if (url.pathname === '/groq/v1/chat/completions') {
    const body = await readBody(req);
    groqCalls.push(body);
    // Every other scenario is OpenRouter-only, so this provider stays closed
    // unless the test asks for it.
    if (mode !== 'cross-provider') {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'groq is rate limited' } }));
      return;
    }
    // Answer as whichever free model was actually asked for, like a real API.
    const model = typeof body.model === 'string' ? body.model : 'openai/gpt-oss-120b';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    sse(res, { id: 'g', model, choices: [{ delta: { role: 'assistant', content: '' } }] });
    for (const piece of ['Hello', ' from', ' Groq', '!']) {
      sse(res, { id: 'g', model, choices: [{ delta: { content: piece } }] });
    }
    sse(res, {
      id: 'g',
      model,
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 4 },
    });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

function get(url, options = {}) {
  return fetch(url, options);
}

async function waitForServer(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await get(`${url}/api/config`);
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

// Read an SSE stream while it is still open. A turn that is waiting for
// approval never ends, so reading the whole body first would deadlock.
async function readUntil(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        events.push(event);
        if (onEvent) await onEvent(event);
      }
      boundary = buffer.indexOf('\n\n');
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

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-sim-'));
  const appPort = 3300 + Math.floor(Math.random() * 300);
  const base = `http://127.0.0.1:${appPort}`;

  const child = spawn(process.execPath, [process.env.APP_PATH ? path.resolve(process.env.APP_PATH) : APP], {
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENROUTER_BASE_URL: upstream,
      OPENROUTER_API_KEY: KEY,
      // A second keyed provider exists, but the app must never answer for the
      // provider the user actually selected.
      GROQ_BASE_URL: `${upstream.replace(/\/api\/v1$/, '')}/groq/v1`,
      GROQ_API_KEY: 'gsk_simulation_key',
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
    const html = await (await get(`${base}/`)).text();
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
      const body = await (await get(`${base}/api/models?free=1`)).json();
      const ids = body.models.map((m) => m.id);
      assert.deepEqual(ids.sort(), ['mock/alpha-free', 'mock/beta-free']);
      assert.equal(body.models.every((m) => m.free), true);
    });

    await check('excludes expired models and honours minContext', async () => {
      const body = await (await get(`${base}/api/models?minContext=150000`)).json();
      assert.deepEqual(body.models.map((m) => m.id).sort(), ['mock/beta-free', 'mock/paid-model']);
    });

    await check('reports the free daily quota', async () => {
      const body = await (await get(`${base}/api/key`)).json();
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

    await check('never sends more than three models in one request', () => {
      assert.ok(chatCalls.length > 0, 'no upstream calls were recorded');
      for (const call of chatCalls) {
        if (Array.isArray(call.models)) {
          assert.ok(call.models.length <= 3, `sent ${call.models.length} models, the limit is 3`);
          assert.equal(call.models[0], call.model, 'the fallback array must start with the requested model');
        }
      }
    });

    await check('remembers a rate-limited model for the session', async () => {
      const again = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'say hello again' }] }),
      });
      const meta = collectSse(await again.text()).find((e) => e.type === 'meta');
      assert.equal(
        meta.chain.includes('mock/alpha-free'),
        false,
        'the model that returned 429 was tried again on the next turn',
      );
      assert.ok(meta.skipped.includes('mock/alpha-free'), 'meta.skipped did not explain the skip');

      const reset = await fetch(`${base}/api/session/reset`, {
        method: 'POST',
        headers: { 'x-app-token': token },
      });
      assert.equal(reset.status, 200);

      const config = await (await get(`${base}/api/config`)).json();
      assert.deepEqual(config.skipped, [], 'New Chat did not clear the failure memory');
    });

    await check('keeps the chosen provider when it cannot answer', async () => {
      mode = 'cross-provider';
      chatCalls = [];
      groqCalls = [];
      try {
        const response = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-app-token': token },
          body: JSON.stringify({ provider: 'openrouter', messages: [{ role: 'user', content: 'say hello' }] }),
        });
        const events = collectSse(await response.text());
        const error = events.find((e) => e.type === 'error');
        assert.ok(error, 'a failed turn must report an error');
        assert.equal(events.some((e) => e.type === 'delta'), false, 'a different provider answered the turn');

        const meta = events.find((e) => e.type === 'meta');
        assert.deepEqual(meta.fallbacks, [], 'the page was told another provider could take over');
        assert.equal(events.some((e) => e.type === 'retry' && e.reason === 'fallback'), false);
        assert.equal(groqCalls.length, 0, 'the selected provider was silently replaced');
      } finally {
        mode = 'fallback';
      }
    });

    await check('reports the failure when no provider can answer', async () => {
      mode = 'exhausted';
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'say hello' }] }),
      });
      const events = collectSse(await response.text());
      const error = events.find((e) => e.type === 'error');
      assert.ok(error, 'a fully failed turn must report an error');
      assert.equal(error.reason, 'rate-limit');
      mode = 'fallback';
    });

    await check('runs a tool call and answers with its result', async () => {
      mode = 'tools';
      chatCalls = [];
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'what is 6*7?' }] }),
      });
      const events = collectSse(await response.text());
      const tool = events.find((e) => e.type === 'tool');
      assert.equal(tool?.name, 'calculate');
      assert.match(tool.preview, /42/);
      const text = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
      assert.match(text, /42/);

      const opening = chatCalls[0];
      const guidance = opening.messages.find(
        (message) => message.role === 'system' && /Tool use is enabled in Settings/.test(message.content),
      );
      assert.ok(guidance, 'the tool request had no instruction to use the tools');
      assert.match(guidance.content, /Available tools: .*calculate/, 'the prompt did not name the offered tools');

      const followUp = chatCalls[1];
      assert.ok(followUp, 'the app never sent the tool result back');
      const toolMessage = followUp.messages.find((m) => m.role === 'tool');
      assert.ok(toolMessage, 'no tool message in the follow-up request');
      assert.equal(toolMessage.tool_call_id, 'call_1');
      assert.equal(
        followUp.messages.some((m) => m.role === 'assistant' && m.tool_calls),
        true,
        'assistant tool_calls were not echoed back',
      );
    });

    await check('an empty answer after a tool call gets one forced reply', async () => {
      // This is the shape seen in a real session: read the workspace, then go
      // quiet. The turn used to end with "No model answered."
      mode = 'tools-empty';
      chatCalls = [];
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'what is 6*7?' }] }),
      });
      const events = collectSse(await response.text());

      const text = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
      assert.match(text, /42/, 'the forced answer never reached the page');
      assert.equal(
        events.some((e) => e.type === 'error'),
        false,
        'the turn must not fall back to the generic error',
      );

      assert.equal(chatCalls.length, 3, 'expected: tool call, tool result, then one forced answer');
      const nudged = chatCalls[2];
      assert.equal(Array.isArray(nudged.tools), false, 'the follow-up must not offer tools again');
      assert.equal(
        nudged.messages.some((m) => m.role === 'tool'),
        true,
        'the tool result has to be in the forced request',
      );
    });

    await check('saves settings and clamps values the browser should not send', async () => {
      const save = await fetch(`${base}/api/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({
          settings: { systemPrompt: 'be brief', temperature: 5, maxTokens: 99999, tools: false },
        }),
      });
      assert.equal(save.status, 200);

      const read = await (await fetch(`${base}/api/config`, { headers: { 'x-app-token': token } })).json();
      assert.equal(read.settings.temperature, 2, 'temperature must clamp to 2');
      assert.equal(read.settings.maxTokens, 4000, 'maxTokens must clamp to 4000');
      assert.equal(read.settings.tools, false);
      assert.equal(read.settings.systemPrompt, 'be brief');

      // With the toggle off the request must carry neither tools nor a prompt
      // claiming they are available.
      mode = 'fallback';
      chatCalls = [];
      const off = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'use a tool' }] }),
      });
      await off.text();
      assert.ok(chatCalls.length > 0, 'the disabled-tools turn never reached a model');
      assert.equal(chatCalls[0].tools, undefined, 'tools were sent while the setting was off');
      assert.equal(
        chatCalls[0].messages.some((message) => /Tool use is enabled in Settings/.test(message.content)),
        false,
        'the model was told tools were on while the setting was off',
      );

      const reset = await fetch(`${base}/api/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ settings: { systemPrompt: '', temperature: null, maxTokens: 1200, tools: true } }),
      });
      assert.equal(reset.status, 200);
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
    await check('asks before writing a file, then writes only after approval', async () => {
      mode = 'write';
      const workspace = path.join(configDir, 'ws');
      fs.mkdirSync(workspace, { recursive: true });
      const save = await fetch(`${base}/api/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ workspace }),
      });
      assert.equal(save.status, 200, 'the workspace could not be set');

      const target = path.join(workspace, 'written', 'by-model.txt');
      chatCalls = [];
      let asked = 0;
      let existedWhenAsked = true;

      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'write a file please' }] }),
      });
      const events = await readUntil(response, async (event) => {
        if (event.type !== 'confirm') return;
        asked += 1;
        existedWhenAsked = fs.existsSync(target);
        assert.equal(event.name, 'write_file');

        const confirm = await fetch(`${base}/api/chat/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-app-token': token },
          body: JSON.stringify({ id: event.id, allow: true }),
        });
        assert.equal(confirm.status, 200, 'the confirmation was not accepted');
      });

      assert.equal(asked, 1, 'expected exactly one approval request');
      assert.equal(existedWhenAsked, false, 'the file existed before the user approved it');
      assert.equal(fs.readFileSync(target, 'utf8'), 'the model wrote this');

      const toolEvent = events.find((event) => event.type === 'tool');
      assert.equal(toolEvent?.name, 'write_file');
      assert.equal(toolEvent?.ok, true);

      const followUp = chatCalls[1];
      assert.ok(followUp, 'the app never sent the write result back to the model');
      const toolMessage = followUp.messages.find((m) => m.role === 'tool');
      assert.match(toolMessage.content, /Wrote \/written\/by-model\.txt/);
      mode = 'fallback';
    });

    await check('a denied write leaves the file untouched', async () => {
      mode = 'write';
      const workspace = path.join(configDir, 'ws');
      const target = path.join(workspace, 'written', 'by-model.txt');
      fs.rmSync(target, { force: true });

      chatCalls = [];
      let asked = 0;
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'write a file please' }] }),
      });
      await readUntil(response, async (event) => {
        if (event.type !== 'confirm') return;
        asked += 1;
        const confirm = await fetch(`${base}/api/chat/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-app-token': token },
          body: JSON.stringify({ id: event.id, allow: false }),
        });
        assert.equal(confirm.status, 200);
      });

      assert.equal(asked, 1, 'expected one approval request');
      assert.equal(fs.existsSync(target), false, 'a denied write still touched the disk');

      const followUp = chatCalls[1];
      const toolMessage = followUp?.messages.find((m) => m.role === 'tool');
      assert.match(toolMessage?.content ?? '', /declined/);
      mode = 'fallback';
    });

    await check('shows a real diff before a patch, and writes only after approval', async () => {
      mode = 'patch';
      const workspace = path.join(configDir, 'ws');
      fs.mkdirSync(workspace, { recursive: true });
      const target = path.join(workspace, 'patched.txt');
      fs.writeFileSync(target, 'alpha\nold line\nomega\n');

      chatCalls = [];
      let asked = 0;
      let diff = '';
      let contentWhenAsked = '';
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'change the middle line' }] }),
      });

      const events = await readUntil(response, async (event) => {
        if (event.type !== 'confirm') return;
        asked += 1;
        assert.equal(event.name, 'apply_patch', 'the patch approval had the wrong name');
        diff = String(event.diff ?? '');
        contentWhenAsked = fs.readFileSync(target, 'utf8');
        const confirm = await fetch(`${base}/api/chat/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-app-token': token },
          body: JSON.stringify({ id: event.id, allow: true }),
        });
        assert.equal(confirm.status, 200, 'the patch confirmation was not accepted');
      });

      assert.equal(asked, 1, 'expected exactly one patch approval');
      assert.match(diff, /^--- a\/patched\.txt$/m, 'the card did not contain a unified diff header');
      assert.match(diff, /^-old line$/m, 'the removed line was missing from the diff');
      assert.match(diff, /^\+new line$/m, 'the added line was missing from the diff');
      assert.equal(contentWhenAsked, 'alpha\nold line\nomega\n', 'the file changed before approval');
      assert.equal(fs.readFileSync(target, 'utf8'), 'alpha\nnew line\nomega\n');

      const toolEvent = events.find((event) => event.type === 'tool');
      assert.equal(toolEvent?.name, 'apply_patch');
      assert.equal(toolEvent?.ok, true);
      mode = 'fallback';
    });

    await check('recovers a tool call the model wrote as text and writes the file', async () => {
      mode = 'text-write';
      const workspace = path.join(configDir, 'ws');
      const target = path.join(workspace, 'hello', 'index.html');
      fs.rmSync(path.join(workspace, 'hello'), { recursive: true, force: true });

      const save = await fetch(`${base}/api/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ workspace }),
      });
      assert.equal(save.status, 200, 'the workspace could not be set');

      chatCalls = [];
      let asked = 0;
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'make me a hello world page' }] }),
      });

      const events = await readUntil(response, async (event) => {
        if (event.type !== 'confirm') return;
        asked += 1;
        assert.equal(event.name, 'write_file', 'the recovered call had the wrong name');
        const confirm = await fetch(`${base}/api/chat/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-app-token': token },
          body: JSON.stringify({ id: event.id, allow: true }),
        });
        assert.equal(confirm.status, 200, 'the confirmation was not accepted');
      });

      assert.equal(asked, 1, 'a text-form tool call never became an approval request');
      assert.equal(fs.existsSync(target), true, 'no file was written from the text-form call');
      assert.match(fs.readFileSync(target, 'utf8'), /Hello World/);

      const toolEvent = events.find((event) => event.type === 'tool');
      assert.equal(toolEvent?.name, 'write_file');
      assert.equal(toolEvent?.ok, true);

      const followUp = chatCalls[1];
      assert.ok(followUp, 'the app never sent the write result back to the model');
      const echoed = followUp.messages.find(
        (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
      );
      assert.ok(echoed, 'the recovered call was not echoed back as a real tool call');
      assert.equal(echoed.tool_calls[0].function.name, 'write_file');
      mode = 'fallback';
    });
    await check('folds older turns into a memory note before the request', async () => {
      mode = 'fallback';
      const messages = [];
      for (let i = 0; i < 24; i += 1) {
        messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `turn ${i} ` + 'y'.repeat(1200),
        });
      }
      messages.push({ role: 'user', content: 'the latest question must stay verbatim' });
      chatCalls = [];

      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': token },
        body: JSON.stringify({ messages }),
      });
      const events = await readUntil(response, () => {});
      const sent = chatCalls[0]?.messages ?? [];
      const note = sent.find(
        (m) => m.role === 'system' && m.content.includes('Earlier in this conversation'),
      );
      assert.ok(note, 'the upstream request had no memory note');
      assert.ok(note.content.includes('the latest question must stay verbatim') === false);
      assert.equal(sent.at(-1).content, 'the latest question must stay verbatim');
      assert.ok(sent.length < messages.length, 'the request was not compacted at all');

      const meta = events.find((event) => event.type === 'meta');
      assert.ok(meta?.memory?.compacted > 0, 'the page was not told about the compaction');
      assert.ok(meta.memory.afterTokens < meta.memory.beforeTokens);
      mode = 'fallback';
    });

    // The tab closed before its first save: the page creates a chat with its own
    // write, so without a server-side rescue the whole first exchange is lost.
    await check('a closed tab keeps the first answer', async () => {
      mode = 'slow';
      const threadId = 'rescue-simulation-1';
      await new Promise((resolve) => {
        const request = http.request(
          `${base}/api/chat`,
          { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-token': token } },
          (response) => {
            response.on('data', (chunk) => {
              if (!chunk.toString().includes('"delta"')) return;
              request.destroy();
              response.destroy();
              resolve();
            });
            response.on('error', resolve);
          },
        );
        request.on('error', resolve);
        request.end(
          JSON.stringify({
            model: 'mock/alpha-free',
            threadId,
            messages: [{ role: 'user', content: 'the tab will close' }],
          }),
        );
      });
      // The rescue runs in the stream's teardown, after the socket is gone.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const response = await fetch(`${base}/api/threads/${threadId}`, { headers: { 'x-app-token': token } });
      assert.equal(response.status, 200, 'the chat was lost with the tab');
      const { thread } = await response.json();
      assert.equal(thread.id, threadId);
      assert.equal(thread.messages.length, 2, 'expected the question and the answer');
      assert.equal(thread.messages[0].role, 'user');
      const answer = thread.messages[1];
      assert.equal(answer.role, 'assistant');
      assert.ok(answer.content.trim().length > 0, 'the partial answer was not kept');
      mode = 'fallback';
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
