#!/usr/bin/env node
// Live smoke check for the Freeway GitHub Pages site.
//
// It verifies that docs/ is what Pages is actually serving, that unknown paths
// reach the custom 404 page, and that every link and asset on both public pages
// resolves. No dependencies; run it with Node 20 or newer:
//
//   node scripts/check-pages.mjs
//
// PAGES_URL overrides the site (for a custom domain) and PAGES_WAIT_SECONDS
// waits for a Pages rollout before failing a byte mismatch.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const FILES = [
  { name: 'index.html', expectedType: 'text/html' },
  { name: '404.html', expectedType: 'text/html' },
  { name: 'icon.svg', expectedType: 'image/svg+xml' },
  { name: 'og.png', expectedType: 'image/png' },
];

const site = new URL(process.env.PAGES_URL || 'https://zakker111.github.io/freeway/');
if (!site.pathname.endsWith('/')) site.pathname += '/';
site.search = '';
site.hash = '';
const BASE = site.href;
const WAIT_MS = Math.max(0, Number(process.env.PAGES_WAIT_SECONDS || 0) || 0) * 1000;
const RUN_ID = Date.now().toString(36);
const TIMEOUT_MS = 20_000;

const passed = [];
const warnings = [];
const failures = [];

const pass = (message) => {
  passed.push(message);
  console.log('PASS ' + message);
};
const fail = (message) => {
  failures.push(message);
  console.log('FAIL ' + message);
};
const warn = (message) => {
  warnings.push(message);
  console.log('WARN ' + message);
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function request(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'freeway-pages-smoke/1.0 (+https://github.com/zakker111/freeway)',
        accept: '*/*',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function get(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await request(url);
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await sleep(750 * attempt);
        continue;
      }
      return response;
    } catch (cause) {
      lastError = cause;
      if (attempt < 3) await sleep(750 * attempt);
    }
  }
  throw lastError ?? new Error('request failed');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function localPath(url) {
  const parsed = new URL(url);
  if (parsed.origin !== site.origin || !parsed.pathname.startsWith(site.pathname)) return null;
  return decodeURIComponent(parsed.pathname.slice(site.pathname.length)) || 'index.html';
}

function checkSelfContained(name, html) {
  if (/<script\b/i.test(html)) fail(`${name} contains a script`);
  else pass(`${name} has no scripts`);

  if (/<iframe\b/i.test(html)) fail(`${name} contains an iframe`);
  else pass(`${name} has no iframes`);

  const remote = [...html.matchAll(/\bsrc="((?:https?:)?\/\/[^"]+)"/gi)].map((match) => match[1]);
  if (remote.length) fail(`${name} loads remote assets: ${remote.join(', ')}`);
  else pass(`${name} loads only local assets`);
}

function collectLinks(home, notFound) {
  const external = new Set();
  const pages = [
    { name: 'index.html', url: BASE, html: home },
    { name: '404.html', url: BASE + '404.html', html: notFound },
  ];

  for (const page of pages) {
    const ids = new Set([...page.html.matchAll(/\bid="([^"]*)"/g)].map((match) => match[1]));

    for (const href of [...page.html.matchAll(/\bhref="([^"]+)"/g)].map((match) => match[1])) {
      if (href.startsWith('#')) {
        const target = href.slice(1);
        if (!target || ids.has(target)) pass(`${page.name} anchor ${href}`);
        else fail(`${page.name} anchor ${href} has no target`);
        continue;
      }
      if (/^(?:mailto:|tel:|data:|javascript:)/i.test(href)) continue;

      const url = new URL(href, page.url).href;
      const local = localPath(url);
      if (local === null) {
        external.add(url);
        continue;
      }
      if (existsSync(join(DOCS, local))) pass(`${page.name} link ${href}`);
      else fail(`${page.name} link ${href} is not a file in docs/`);
    }

    for (const src of [...page.html.matchAll(/\bsrc="([^"]+)"/g)].map((match) => match[1])) {
      if (/^(?:data:|javascript:)/i.test(src)) continue;
      const url = new URL(src, page.url).href;
      const local = localPath(url);
      if (local === null) {
        fail(`${page.name} loads a remote asset: ${src}`);
        continue;
      }
      if (existsSync(join(DOCS, local))) pass(`${page.name} asset ${src}`);
      else fail(`${page.name} asset ${src} is missing from docs/`);
    }
  }

  return [...external].sort();
}

async function probe(file) {
  const localBytes = readFileSync(join(DOCS, file.name));
  const result = {
    ...file,
    url: `${BASE}${file.name}?smoke=${RUN_ID}`,
    localHash: sha256(localBytes),
    localBytes: localBytes.length,
  };
  try {
    const response = await get(result.url);
    result.status = response.status;
    result.type = response.headers.get('content-type') || '';
    if (response.status === 200) {
      const bytes = Buffer.from(await response.arrayBuffer());
      result.hash = sha256(bytes);
      result.bytes = bytes.length;
    }
  } catch (cause) {
    result.status = 0;
    result.error = cause.message;
  }
  return result;
}

async function checkFiles() {
  let probes = [];
  const deadline = Date.now() + WAIT_MS;

  for (;;) {
    probes = await Promise.all(FILES.map(probe));
    const lagging = probes.filter((entry) => entry.hash !== entry.localHash);
    const allServed = probes.every((entry) => entry.status === 200);
    if (!lagging.length || !allServed || Date.now() >= deadline) break;
    console.log(`Waiting for Pages: ${lagging.map((entry) => entry.name).join(', ')} still differ; retrying in 10s`);
    await sleep(10_000);
  }

  for (const entry of probes) {
    if (entry.status !== 200) {
      fail(`${entry.name} -> ${entry.error || `HTTP ${entry.status}`}`);
      continue;
    }
    if (entry.hash !== entry.localHash) {
      fail(`${entry.name} differs from docs/ (live ${entry.hash.slice(0, 12)}…, repo ${entry.localHash.slice(0, 12)}…)`);
      continue;
    }
    pass(`${entry.name} matches docs/ (${entry.bytes} bytes)`);
    if (entry.type && !entry.type.toLowerCase().includes(entry.expectedType)) {
      warn(`${entry.name} is served as ${entry.type}`);
    }
  }
}

async function check404() {
  const url = `${BASE}__pages-smoke-${RUN_ID}`;
  try {
    const response = await get(url);
    const body = await response.text();
    if (response.status === 404) pass('unknown paths return HTTP 404');
    else fail(`unknown paths return HTTP ${response.status}`);

    if (body.includes('This page took a wrong turn.') && body.includes('static page on GitHub Pages')) {
      pass('custom 404 page is served');
    } else {
      fail('custom 404 page was not served');
    }
  } catch (cause) {
    fail(`404 check failed: ${cause.message}`);
  }
}

async function checkExternal(urls) {
  for (const url of urls) {
    let response;
    try {
      response = await get(url);
    } catch (cause) {
      warn(`external link unreachable: ${url} (${cause.message})`);
      continue;
    }

    if (response.status >= 200 && response.status < 400) {
      if (new URL(url).hostname.endsWith('freebuff.page')) {
        const body = await response.text();
        if (body.includes('Freeway')) pass(`cloud app ${url} -> ${response.status}`);
        else fail(`cloud app ${url} returned a page without the Freeway shell`);
      } else {
        pass(`link ${url} -> ${response.status}`);
        if (new URL(url).pathname.endsWith('/releases/latest')) {
          const body = await response.text();
          if (/\/releases\/download\/[^"']+\.zip/.test(body)) pass('latest release exposes a ZIP download');
          else fail('latest release has no ZIP download');
        }
      }
    } else if (response.status === 404 || response.status === 410) {
      fail(`broken link ${url} -> HTTP ${response.status}`);
    } else {
      warn(`link ${url} -> HTTP ${response.status}`);
    }
  }
}

function summarize() {
  console.log(`\n${passed.length} passed, ${warnings.length} warning(s), ${failures.length} failure(s)`);
  if (warnings.length) {
    console.log('Warnings:');
    for (const message of warnings) console.log('  WARN ' + message);
  }
  if (failures.length) {
    console.log('Failures:');
    for (const message of failures) console.log('  FAIL ' + message);
    console.log('Pages smoke failed.');
    process.exitCode = 1;
    return;
  }
  console.log('Pages smoke passed.');
}

async function main() {
  console.log(`Pages smoke: ${BASE}`);

  if (existsSync(join(DOCS, '.nojekyll'))) pass('.nojekyll is present');
  else fail('.nojekyll is missing from docs/');

  const home = readFileSync(join(DOCS, 'index.html'), 'utf8');
  const notFound = readFileSync(join(DOCS, '404.html'), 'utf8');
  checkSelfContained('index.html', home);
  checkSelfContained('404.html', notFound);
  const external = collectLinks(home, notFound);

  await checkFiles();
  await check404();
  await checkExternal(external);
  summarize();
}

try {
  await main();
} catch (cause) {
  console.error('Pages smoke crashed:', cause);
  process.exitCode = 1;
}
