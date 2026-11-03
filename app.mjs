#!/usr/bin/env node
// Local chat app for OpenRouter free models.
// Binds to 127.0.0.1 only: the API key never leaves this process.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { filterModels, buildChain, estimateTokens } from './lib/models.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3002);
const BASE_URL = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const APP_TOKEN = randomBytes(16).toString('hex');
const VERSION = '1.0.0';
const MAX_BODY_BYTES = 1_000_000;
const MAX_INPUT_CHARS = 60_000;
const MAX_OUTPUT_TOKENS = Math.min(Number(process.env.MAX_OUTPUT_TOKENS || 1200), 4000);
const MAX_ATTEMPTS = 3;
const CATALOG_TTL_MS = 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 120_000;

let catalog = { models: [], fetchedAt: 0 };
let htmlCache = null;

/* ---------------------------------------------------------------- config */

export function configPath() {
  if (process.env.OPENROUTER_CONFIG) return process.env.OPENROUTER_CONFIG;
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'OpenRouterChat', 'config.json');
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const target = configPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const next = { ...loadConfig(), ...patch };
  fs.writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

function apiKey() {
  return process.env.OPENROUTER_API_KEY || loadConfig().apiKey || '';
}

/* ------------------------------------------------------------ http utils */

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function pageHtml() {
  if (htmlCache) return htmlCache;
  try {
    const sea = await import('node:sea');
    if (typeof sea.isSea === 'function' && sea.isSea()) {
      htmlCache = sea.getAsset('public/index.html', 'utf8');
      return htmlCache;
    }
  } catch {
    /* not a single-executable build */
  }
  htmlCache = fs.readFileSync(path.join(import.meta.dirname, 'public', 'index.html'), 'utf8');
  return htmlCache;
}

/* ---------------------------------------------------------- openrouter */

async function getCatalog(force = false) {
  const fresh = catalog.models.length > 0 && Date.now() - catalog.fetchedAt < CATALOG_TTL_MS;
  if (!force && fresh) return catalog.models;

  const key = apiKey();
  const response = await fetch(`${BASE_URL}/models?output_modalities=text&sort=most-popular`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Model catalog unavailable (HTTP ${response.status})`), { status: 502 });
  }
  const body = await response.json();
  const models = Array.isArray(body?.data) ? body.data : [];
  if (models.length === 0) {
    throw Object.assign(new Error('Model catalog came back empty'), { status: 502 });
  }
  catalog = { models, fetchedAt: Date.now() };
  return models;
}

async function getKeyInfo() {
  const key = apiKey();
  if (!key) return { ok: false, reason: 'missing-key' };
  try {
    const response = await fetch(`${BASE_URL}/key`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: body?.error?.message ?? `HTTP ${response.status}`,
      };
    }
    const data = body?.data ?? {};
    return {
      ok: true,
      isFreeTier: Boolean(data.is_free_tier),
      usage: data.usage ?? 0,
      limitRemaining: data.limit_remaining ?? null,
      freeDaily: data.free_model_daily_requests ?? null,
    };
  } catch (error) {
    return { ok: false, reason: 'network', message: String(error?.message ?? error) };
  }
}

/* ---------------------------------------------------------------- chat */

function sanitizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw Object.assign(new Error('A non-empty messages array is required'), { status: 400 });
  }
  let total = 0;
  const messages = [];
  for (const raw of input.slice(-40)) {
    const role = raw?.role;
    const content = typeof raw?.content === 'string' ? raw.content : '';
    if (!['system', 'user', 'assistant'].includes(role) || content.length === 0) continue;
    total += content.length;
    messages.push({ role, content });
  }
  if (messages.length === 0) {
    throw Object.assign(new Error('No usable messages were provided'), { status: 400 });
  }
  if (total > MAX_INPUT_CHARS) {
    throw Object.assign(new Error(`Conversation is too long (${total} chars, limit ${MAX_INPUT_CHARS})`), {
      status: 413,
    });
  }
  return messages;
}

function sseSend(res, payload) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function classifyFailure(status, body) {
  const metadata = body?.error?.metadata ?? {};
  const limitSource = metadata.limit_source ?? null;
  const message = body?.error?.message ?? `HTTP ${status}`;
  if (status === 402) {
    return { retry: limitSource === 'openrouter_in_flight_budget', reason: 'credit', message, limitSource };
  }
  if (status === 429) {
    return { retry: true, reason: 'rate-limit', message, limitSource };
  }
  if (status >= 500) {
    return { retry: true, reason: 'upstream', message, limitSource };
  }
  return { retry: false, reason: 'request', message, limitSource };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function forwardStream(upstream, res, state) {
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (event?.error) {
          state.error = event.error;
          continue;
        }
        if (typeof event?.model === 'string' && event.model !== state.model) {
          state.model = event.model;
          sseSend(res, { type: 'model', model: state.model });
        }
        const text = event?.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text.length > 0) {
          state.text += text;
          sseSend(res, { type: 'delta', text });
        }
        if (event?.usage) state.usage = event.usage;
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

async function handleChat(req, res) {
  const key = apiKey();
  if (!key) {
    return sendJson(res, 400, { error: 'No API key configured yet.' });
  }

  const body = await readJson(req);
  const messages = sanitizeMessages(body.messages);
  const requested = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null;
  const estimate = estimateTokens(messages);

  let models = [];
  try {
    models = await getCatalog();
  } catch {
    models = [];
  }

  let chain = models.length
    ? buildChain(models, { primary: requested, minContext: estimate + 256, limit: 4 })
    : requested
      ? [requested]
      : [];

  if (chain.length === 0) {
    return sendJson(res, 400, { error: 'No suitable free model is available for this conversation.' });
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const state = { text: '', model: null, usage: null, error: null };
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  sseSend(res, { type: 'meta', chain, attempt: 0 });

  let lastFailure = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const slice = chain.slice(attempt);
    if (slice.length === 0) break;

    const payload = {
      model: slice[0],
      messages,
      stream: true,
      max_tokens: MAX_OUTPUT_TOKENS,
      usage: { include: true },
    };
    if (slice.length > 1) payload.models = slice;

    let upstream;
    try {
      upstream = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          'http-referer': 'http://127.0.0.1',
          'x-title': 'OpenRouter Chat',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      });
    } catch (error) {
      if (controller.signal.aborted) break;
      lastFailure = { retry: true, reason: 'network', message: String(error?.message ?? error) };
      await sleep(350 * (attempt + 1));
      sseSend(res, { type: 'retry', attempt: attempt + 1, reason: lastFailure.reason });
      continue;
    }

    if (upstream.ok) {
      try {
        await forwardStream(upstream, res, state);
      } catch (error) {
        if (!controller.signal.aborted) {
          lastFailure = { retry: false, reason: 'stream', message: String(error?.message ?? error) };
        }
      }
      break;
    }

    const raw = await upstream.text().catch(() => '');
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { error: { message: raw.slice(0, 300) || `HTTP ${upstream.status}` } };
    }
    const failure = classifyFailure(upstream.status, parsed);
    lastFailure = failure;

    if (!failure.retry || state.text.length > 0) break;
    sseSend(res, { type: 'retry', attempt: attempt + 1, reason: failure.reason, message: failure.message });
    await sleep(400 * (attempt + 1) + Math.floor(Math.random() * 250));
  }

  if (state.error && state.text.length === 0) {
    lastFailure = {
      reason: 'upstream',
      message: state.error?.message ?? 'Upstream error',
      limitSource: state.error?.metadata?.limit_source ?? null,
    };
  }

  if (state.text.length > 0) {
    sseSend(res, {
      type: 'done',
      model: state.model ?? chain[0],
      usage: state.usage,
      stopped: controller.signal.aborted,
    });
  } else if (controller.signal.aborted) {
    sseSend(res, { type: 'done', model: state.model ?? chain[0], stopped: true });
  } else {
    let hint = lastFailure?.message ?? 'No model answered.';
    if (lastFailure?.reason === 'rate-limit') {
      const info = await getKeyInfo();
      const free = info?.ok ? info.freeDaily : null;
      if (free && typeof free.remaining === 'number') {
        hint += ` Free requests left today: ${free.remaining} of ${free.limit}.`;
      } else {
        hint += ' Free-model limits reset at 00:00 UTC.';
      }
    }
    if (lastFailure?.reason === 'credit') {
      hint += ' Add credits at https://openrouter.ai/settings/credits, or use free models only.';
    }
    sseSend(res, { type: 'error', reason: lastFailure?.reason ?? 'unknown', message: hint });
  }

  res.end();
}

/* -------------------------------------------------------------- routing */

function requireToken(req, res) {
  if (req.headers['x-app-token'] !== APP_TOKEN) {
    sendJson(res, 403, { error: 'Missing or invalid app token.' });
    return false;
  }
  return true;
}

async function route(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const { pathname } = url;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const html = (await pageHtml()).replace('__APP_TOKEN__', APP_TOKEN);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(html),
    });
    return res.end(html);
  }

  if (req.method === 'GET' && pathname === '/api/config') {
    const config = loadConfig();
    return sendJson(res, 200, {
      hasKey: Boolean(apiKey()),
      model: config.model ?? null,
      freeOnly: config.freeOnly !== false,
      version: VERSION,
      platform: process.platform,
    });
  }

  if (req.method === 'POST' && pathname === '/api/config') {
    if (!requireToken(req, res)) return;
    const body = await readJson(req);
    const patch = {};
    if (typeof body.apiKey === 'string') {
      const key = body.apiKey.trim();
      if (!key.startsWith('sk-or-')) {
        return sendJson(res, 400, { error: 'That does not look like an OpenRouter key (expected sk-or-...).' });
      }
      patch.apiKey = key;
    }
    if (typeof body.model === 'string') patch.model = body.model;
    if (typeof body.freeOnly === 'boolean') patch.freeOnly = body.freeOnly;
    saveConfig(patch);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/models') {
    try {
      const models = await getCatalog();
      const rows = filterModels(models, {
        q: url.searchParams.get('q') ?? '',
        freeOnly: url.searchParams.get('free') === '1',
        needTools: url.searchParams.get('tools') === '1',
        needVision: url.searchParams.get('vision') === '1',
        minContext: Number(url.searchParams.get('minContext') ?? 0) || 0,
      });
      return sendJson(res, 200, { total: models.length, models: rows });
    } catch (error) {
      return sendJson(res, error.status ?? 502, { error: error.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/key') {
    const info = await getKeyInfo();
    return sendJson(res, info.ok ? 200 : 502, info);
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    if (!requireToken(req, res)) return;
    return handleChat(req, res);
  }

  if (req.method === 'POST' && pathname === '/api/quit') {
    if (!requireToken(req, res)) return;
    sendJson(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 120);
    return;
  }

  return sendJson(res, 404, { error: 'Not found' });
}

/* -------------------------------------------------------------- startup */

function openBrowser(target) {
  if (process.env.NO_OPEN === '1') return;
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', 'msedge', `--app=${target}`], {
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', () => spawn('cmd', ['/c', 'start', '', target], { stdio: 'ignore', windowsHide: true }));
    } else if (process.platform === 'darwin') {
      spawn('open', [target], { stdio: 'ignore' });
    } else {
      spawn('xdg-open', [target], { stdio: 'ignore' });
    }
  } catch {
    /* the URL is printed below either way */
  }
}

export function createServer() {
  return http.createServer((req, res) => {
    route(req, res).catch((error) => {
      const status = error?.status ?? 500;
      if (!res.headersSent) sendJson(res, status, { error: error?.message ?? 'Unexpected error' });
      else res.end();
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isMain) {
  const server = createServer();
  const url = `http://${HOST}:${PORT}`;

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`Already running at ${url} — opening it.`);
      openBrowser(url);
      setTimeout(() => process.exit(0), 400);
      return;
    }
    console.error('Failed to start:', error.message);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`OpenRouter Chat ${VERSION}`);
    console.log(`Running at ${url}`);
    console.log(`Config: ${configPath()}`);
    console.log('Close this window to stop the app.');
    openBrowser(url);
  });
}
