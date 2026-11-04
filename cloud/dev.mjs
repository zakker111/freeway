// Local harness: runs worker.mjs behind Node's http server so the Worker logic
// can be exercised (routes, free-only check, error mapping) without Wrangler.
// Static files come from ./public, exactly like env.ASSETS in production.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './dist/worker.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');
const port = Number(process.env.PORT || 3100);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

// A D1-shaped shim over Node's built-in SQLite, so the history routes can be
// exercised locally: prepare().bind().all()/run() and batch(), nothing more.
let DB = null;
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  DB = {
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
} catch {
  DB = null;
}

const env = {
  DB,
  // Empty unless a real development client is supplied: with no client id the
  // Worker stays signed out, which is exactly what the local checks cover.
  FREEBUFF_CLIENT_ID: process.env.FREEBUFF_CLIENT_ID || '',
  FREEBUFF_ISSUER: process.env.FREEBUFF_ISSUER || '',
  APP_ORIGIN: process.env.APP_ORIGIN || '',
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  // Empty strings are fine: baseFor() falls back to the real host.
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || '',
  GROQ_BASE_URL: process.env.GROQ_BASE_URL || '',
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL || '',
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel.endsWith('/')) rel += 'index.html';
      const file = path.join(publicDir, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(publicDir)) return new Response('Not found', { status: 404 });
      try {
        const body = await fs.readFile(file);
        return new Response(body, {
          headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    },
  },
};

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const request = new Request('http://127.0.0.1:' + port + req.url, {
    method: req.method,
    headers: req.headers,
    body,
  });

  try {
    const response = await worker.fetch(request, env, {});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    // Pipe instead of buffering: an SSE reply has to reach the client as it is
    // produced, otherwise this harness lies about streaming latency.
    if (response.body) {
      for await (const chunk of response.body) {
        if (res.destroyed) break;
        res.write(Buffer.from(chunk));
      }
    }
    res.end();
  } catch (error) {
    console.error('harness error', error);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('harness error: ' + String(error?.message ?? error));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('cloud harness on http://127.0.0.1:' + port + (env.OPENROUTER_API_KEY ? ' (server key set)' : ' (no server key)'));
});
