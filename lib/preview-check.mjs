// Static preview verification. It does not execute JavaScript or fetch the
// network: it reads the page and the local files it references, which catches
// the common "I wrote index.html but forgot styles.css" failure without a
// browser or a second process.

import path from 'node:path';

const MAX_ASSETS = 60;
const MAX_HTML_CHARS = 256 * 1024;
const MAX_CSS_CHARS = 256 * 1024;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const TAG_ATTRS = {
  script: ['src'],
  link: ['href'],
  img: ['src', 'srcset'],
  source: ['src', 'srcset'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
};

function decodeAttribute(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanRef(value) {
  const raw = decodeAttribute(value).trim().replace(/\\/g, '/');
  if (!raw || raw.startsWith('#')) return null;
  if (EXTERNAL.test(raw)) return { external: true, raw };
  return { external: false, raw: raw.split('#')[0].split('?')[0] };
}

function normaliseEntry(value) {
  const raw = String(value ?? 'index.html').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const entry = path.posix.normalize(raw || 'index.html');
  if (!entry || entry === '.' || entry === '..' || entry.startsWith('../')) {
    throw new Error('The entry must be a file inside the workspace.');
  }
  return entry;
}

function resolveRef(raw, entry, baseDir) {
  if (raw.startsWith('/')) return path.posix.normalize(raw.slice(1));
  return path.posix.normalize(path.posix.join(baseDir, raw));
}

function srcsetUrls(value) {
  return String(value)
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function cssRefs(css) {
  const refs = [];
  for (const match of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) refs.push(match[2]);
  for (const match of css.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'"\s;)]+)\1/gi)) {
    refs.push(match[2]);
  }
  return refs;
}

function safeError(error) {
  return String(error?.message ?? error).replace(/\s+/g, ' ').trim();
}

/**
 * Check one HTML entry and every local asset it references.
 * `sandbox` is the workspace object: read/readAsset enforce containment.
 */
export function checkPreview(sandbox, { entry: entryInput } = {}) {
  if (!sandbox?.isReady) {
    return {
      ok: false,
      content: 'Preview check FAILED: no workspace folder is set. Ask the user to choose one in Settings.',
    };
  }

  let entry;
  try {
    entry = normaliseEntry(entryInput);
  } catch (error) {
    return { ok: false, content: `Preview check FAILED: ${safeError(error)}` };
  }

  let page;
  try {
    page = sandbox.read(entry);
  } catch (error) {
    return {
      ok: false,
      content:
        `Preview check FAILED: cannot read /${entry}.\n` +
        `${safeError(error)}\n\n` +
        'Write the entry file first, or pass its relative path as entry.',
    };
  }
  if (page.content.length > MAX_HTML_CHARS) {
    return { ok: false, content: `Preview check FAILED: /${entry} is too large to inspect.` };
  }

  const html = page.content;
  const baseMatch = /<base\b[^>]*href\s*=\s*["']([^"']+)["']/i.exec(html);
  const entryDir = path.posix.dirname(entry) === '.' ? '' : path.posix.dirname(entry);
  let baseDir = entryDir;
  if (baseMatch) {
    const base = cleanRef(baseMatch[1]);
    if (base && !base.external) {
      const resolved = resolveRef(base.raw, entry, entryDir);
      baseDir = path.posix.dirname(resolved) === '.' ? '' : path.posix.dirname(resolved);
    }
  }

  const sources = [];
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const names = TAG_ATTRS[tag];
    if (!names) continue;
    for (const name of names) {
      const attr = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attrs);
      if (!attr) continue;
      const values = name === 'srcset' ? srcsetUrls(attr[2]) : [attr[2]];
      for (const value of values) {
        const ref = cleanRef(value);
        if (!ref || ref.external) {
          if (ref?.external) sources.push({ external: true, from: entry, raw: ref.raw });
          continue;
        }
        const resolved = resolveRef(ref.raw, entry, baseDir);
        if (resolved === '..' || resolved.startsWith('../')) {
          sources.push({ external: false, from: entry, raw: ref.raw, outside: true });
        } else {
          sources.push({ external: false, from: entry, raw: ref.raw, path: resolved });
        }
      }
    }
  }

  const checked = [];
  const missing = [];
  const external = [];
  const seen = new Set();
  const queued = new Set();
  const queue = [];

  const inspect = (item) => {
    if (item.external) {
      external.push(item);
      return;
    }
    const key = item.outside ? `outside:${item.path ?? item.raw}` : item.path;
    if (seen.has(key) || checked.length + missing.length >= MAX_ASSETS) return;
    seen.add(key);
    if (item.outside) {
      missing.push({ path: item.raw, from: item.from, error: 'outside the workspace' });
      return;
    }
    try {
      const asset = sandbox.readAsset(item.path);
      checked.push({ path: asset.path, size: asset.size });
      if (/\.css$/i.test(asset.path) && !queued.has(asset.path)) {
        queued.add(asset.path);
        queue.push(asset.path);
      }
    } catch (error) {
      missing.push({ path: item.path, from: item.from, error: safeError(error) });
    }
  };

  sources.forEach(inspect);

  // Follow stylesheets one level so a missing image behind a valid CSS file is
  // caught too. The queue is bounded by MAX_ASSETS and duplicates are skipped.
  while (queue.length > 0 && checked.length + missing.length < MAX_ASSETS) {
    const cssPath = queue.shift();
    let css;
    try {
      const file = sandbox.read(cssPath);
      if (file.content.length > MAX_CSS_CHARS) continue;
      css = file.content;
    } catch {
      continue;
    }
    const cssDir = path.posix.dirname(cssPath) === '.' ? '' : path.posix.dirname(cssPath);
    for (const raw of cssRefs(css)) {
      const ref = cleanRef(raw);
      if (!ref || ref.external) {
        if (ref?.external) external.push({ raw: ref.raw, from: cssPath, external: true });
        continue;
      }
      const resolved = resolveRef(ref.raw, cssPath, cssDir);
      if (resolved === '..' || resolved.startsWith('../')) {
        inspect({ outside: true, path: resolved, raw: ref.raw, from: cssPath });
      } else {
        inspect({ path: resolved, from: cssPath });
      }
    }
  }

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  const total = checked.length + missing.length;
  const lines = [
    `Preview check ${missing.length ? 'FAILED' : 'passed'}: /${entry}`,
    `HTML ${page.size} bytes · title ${title ? JSON.stringify(title) : '(missing)'}`,
    `Checked ${total} local asset${total === 1 ? '' : 's'} · ${missing.length} missing · ${external.length} external skipped`,
  ];

  if (missing.length > 0) {
    lines.push('', 'Missing assets:');
    for (const item of missing) {
      lines.push(`- /${item.path} — ${item.error} (referenced by /${item.from})`);
    }
    lines.push('', 'Fix the missing path or remove the reference, then run preview_check again.');
  } else {
    lines.push('All local HTML and CSS references resolve.');
  }

  if (external.length > 0) {
    lines.push('', 'External URLs were not fetched; they may still fail in the browser.');
  }
  lines.push('', 'JavaScript was not executed. This is a static file and reference check, not a browser test.');

  return {
    ok: missing.length === 0,
    content: lines.join('\n'),
    entry,
  };
}
