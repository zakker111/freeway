// A loopback-only file server for the desktop preview panel.
//
// The page cannot load ES modules, fetch relative data or follow absolute
// paths from srcdoc: srcdoc has no origin. This server gives the workspace a
// real origin. Security comes from four layers:
//   1. bind to 127.0.0.1 only;
//   2. exchange a per-run 256-bit token for an HttpOnly, SameSite=Lax cookie;
//   3. serve files only through workspace.readAsset (realpath containment);
//   4. refuse hidden paths, node_modules and common secret file names.
//
// The cookie matters because a token in the URL path would be lost the moment
// the page asks for "/app.js" or an ES module resolves "./x.js". A cookie is
// sent on every same-origin request, so absolute paths keep working.

import http from 'node:http';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'freeway_preview';
const TOKEN_PREFIX = '/__freeway_preview__/';
const PREVIEW_MAX_ASSET_BYTES = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const SECRET_FILE =
  /^(?:id_(?:rsa|ed25519|ecdsa)|secrets?\.(?:json|ya?ml|txt)|credentials?\.(?:json|ya?ml|txt)|.*\.(?:pem|key|p12|pfx|jks))$/i;

function secureEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function encodePath(value) {
  const raw = String(value);
  return (
    raw
      .split('/')
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join('/') + (raw.endsWith('/') ? '/' : '')
  );
}

function cookiesFor(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

/** Reject anything that is not a plain relative workspace path. */
function requestPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const parts = decoded.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) return null;
  return parts.join('/');
}

function blockedPath(relative) {
  const parts = relative.split('/').filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.some((part) => part.startsWith('.') || part === 'node_modules')) return true;
  return SECRET_FILE.test(parts[parts.length - 1]);
}

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function textHeaders(length, extra = {}) {
  return {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extra,
  };
}

export function createPreviewServer({ getWorkspace, appPort = 3002 } = {}) {
  if (typeof getWorkspace !== 'function') throw new Error('preview server needs getWorkspace()');

  const token = randomBytes(32).toString('hex');
  const tokenPrefix = TOKEN_PREFIX + token;
  let entry = '';
  let host = '127.0.0.1';
  let port = 0;
  let server = null;
  let starting = null;

  const frameAncestors = `frame-ancestors http://127.0.0.1:${appPort} http://localhost:${appPort}`;

  function sendText(res, status, message, extra = {}) {
    const body = Buffer.from(`${message}\n`, 'utf8');
    res.writeHead(status, textHeaders(body.length, extra));
    res.end(res.req?.method === 'HEAD' ? undefined : body);
  }

  function redirect(res, status, location, extra = {}) {
    res.writeHead(status, {
      location,
      'cache-control': 'no-store',
      'content-length': 0,
      ...extra,
    });
    res.end();
  }

  function cookieHeader() {
    // Lax is deliberate: the app frames this origin from the same local site,
    // while an unrelated remote page cannot read the workspace by embedding
    // the server. The cookie is never readable from JavaScript.
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`;
  }

  function authorized(req) {
    return secureEqual(cookiesFor(req.headers.cookie)[COOKIE], token);
  }

  function entryUrl() {
    return `http://${host}:${port}${tokenPrefix}/${encodePath(entry)}`;
  }

  function start() {
    if (server) return Promise.resolve({ url: entryUrl(), entry, port });
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      const candidate = http.createServer((req, res) => {
        handle(req, res).catch(() => {
          if (!res.headersSent) sendText(res, 500, 'Preview server error.');
          else res.end();
        });
      });
      candidate.headersTimeout = 15_000;
      candidate.requestTimeout = 30_000;
      candidate.on('clientError', (_error, socket) => {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      });
      const onStartError = (error) => {
        candidate.close();
        reject(error);
      };
      candidate.once('error', onStartError);
      candidate.listen(0, '127.0.0.1', () => {
        candidate.off('error', onStartError);
        // Keep a listener so a late socket error cannot take down the app.
        candidate.on('error', () => candidate.close());
        server = candidate;
        port = candidate.address().port;
        resolve({ url: entryUrl(), entry, port });
      });
    }).catch((error) => {
      starting = null;
      throw error;
    });
    return starting;
  }

  async function open(entryPath, options = {}) {
    const next = String(entryPath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!next || next.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw Object.assign(new Error('Choose an HTML file inside the workspace.'), { status: 400 });
    }
    entry = next;
    host = options.host === 'localhost' ? 'localhost' : '127.0.0.1';
    return start();
  }

  /** Inject a base for SPA fallbacks so relative assets still resolve. */
  function withBase(file, directory) {
    if (!directory || directory === '.' || !/\.html?$/i.test(file.path)) return file;
    const text = file.buffer.toString('utf8');
    if (/<base\b/i.test(text)) return file;
    const tag = `<base href="/${encodePath(directory)}/">`;
    const next = /<head(?:\s[^>]*)?>/i.test(text)
      ? text.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${tag}`)
      : tag + text;
    const buffer = Buffer.from(next, 'utf8');
    return { ...file, buffer, size: buffer.length };
  }

  async function read(relative, wantsHtml, hadSlash) {
    const sandbox = getWorkspace();
    if (!sandbox?.isReady) {
      throw Object.assign(new Error('No workspace folder is set.'), { status: 400 });
    }
    // Check the resolved path as well as the requested one: a symlink named
    // something harmless must not expose a hidden file inside the workspace.
    const safeAsset = (wanted) => {
      const file = sandbox.readAsset(wanted);
      if (blockedPath(file.path)) throw Object.assign(new Error('Not found.'), { status: 404 });
      return file;
    };
    try {
      return { file: safeAsset(relative), html: wantsHtml };
    } catch (error) {
      if (error?.status === 413) throw error;
      // A directory without its trailing slash is redirected so relative URLs
      // in its index.html resolve from the directory, not from the parent.
      if (!path.extname(relative)) {
        try {
          const index = safeAsset(`${relative.replace(/\/+$/, '')}/index.html`);
          return {
            file: index,
            html: wantsHtml,
            redirect: hadSlash ? null : `${relative.replace(/\/+$/, '')}/`,
          };
        } catch {
          /* fall through */
        }
        // A client-side route has no extension. Serve the HTML entry so the
        // router can see the path; a base keeps relative assets working.
        if (wantsHtml && /\.html?$/i.test(entry)) {
          try {
            const fallback = safeAsset(entry);
            return { file: withBase(fallback, path.posix.dirname(entry)), html: true };
          } catch {
            /* fall through to the original error */
          }
        }
      }
      throw error;
    }
  }

  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, 'Preview only serves GET and HEAD.', { allow: 'GET, HEAD' });
    }

    const url = new URL(req.url, 'http://preview.local');
    const { pathname } = url;

    // The tokenised entry URL is a one-time handoff: set the cookie and send
    // the browser to the clean path. Never keep the token in the address bar.
    if (pathname.startsWith(TOKEN_PREFIX)) {
      const rest = pathname.slice(TOKEN_PREFIX.length);
      const slash = rest.indexOf('/');
      const supplied = slash === -1 ? rest : rest.slice(0, slash);
      if (!secureEqual(supplied, token)) return sendText(res, 404, 'Not found.');
      let target = slash === -1 ? '/' : rest.slice(slash);
      if (!target.startsWith('/') || target.startsWith('//')) target = '/';
      if (target === '/' && entry) target = `/${encodePath(entry)}`;
      return redirect(res, 302, target + url.search, { 'set-cookie': cookieHeader() });
    }

    if (!authorized(req)) return sendText(res, 404, 'Not found.');
    if (!entry) return sendText(res, 404, 'No preview file is selected.');

    const relative = requestPath(pathname);
    if (relative === null || blockedPath(relative)) return sendText(res, 404, 'Not found.');
    if (!relative) {
      return redirect(res, 302, `/${encodePath(entry)}${url.search}`);
    }

    const wantsHtml = /\btext\/html\b/i.test(String(req.headers.accept ?? ''));
    let result;
    try {
      result = await read(relative, wantsHtml, pathname.endsWith('/'));
    } catch (error) {
      const status = error?.status === 413 ? 413 : 404;
      return sendText(res, status, status === 413 ? 'That asset is larger than 8 MB.' : 'Not found.');
    }

    if (result.redirect) {
      return redirect(res, 301, `/${encodePath(result.redirect)}${url.search}`);
    }

    const file = result.file;
    const headers = {
      'content-type': contentType(file.path),
      'content-length': file.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': frameAncestors,
    };
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : file.buffer);
  }

  function close() {
    if (!server) return Promise.resolve();
    const closing = server;
    server = null;
    port = 0;
    starting = null;
    return new Promise((resolve) => {
      closing.close(() => resolve());
      // Requests use keep-alive; without this the test runner and app shutdown
      // would wait for idle sockets to time out.
      closing.closeAllConnections?.();
    });
  }

  return {
    open,
    close,
    get entry() {
      return entry;
    },
    get port() {
      return port;
    },
  };
}

export const previewServerLimits = { PREVIEW_MAX_ASSET_BYTES, COOKIE, TOKEN_PREFIX };
