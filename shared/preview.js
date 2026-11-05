/* Freeway preview core — one implementation for desktop and cloud.
 *
 * It has no DOM or Node dependency: the page supplies readFile(path), and the
 * core resolves relative assets, inlines linked CSS/JS/SVG and returns one
 * self-contained HTML document for the sandboxed iframe.
 *
 * Loaded as a classic script so both pages can call it synchronously. Tests load
 * it in a vm context and use the same global.
 */
(function (root) {
  'use strict';

  const MAX_FILES = 200;
  const MAX_BYTES = 2 * 1024 * 1024;
  const HTML_RE = /\.(html?|svg)$/i;
  const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

  class PreviewError extends Error {
    constructor(code, message, extra) {
      super(message);
      this.name = 'PreviewError';
      this.code = code;
      if (extra) Object.assign(this, extra);
    }
  }

  function fail(code, message, extra) {
    throw new PreviewError(code, message, extra);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  /** POSIX-style path with no leading slash and no empty segments. */
  function normalizePath(value) {
    let raw = String(value ?? '').replace(/\\/g, '/').trim();
    if (!raw) return '';
    raw = raw.replace(/^\/+/, '');
    const parts = [];
    for (const part of raw.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (parts.length === 0) {
          fail('PATH_OUTSIDE', 'That file is outside the preview folder.', { file: value });
        }
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    return parts.join('/');
  }

  function splitReference(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (EXTERNAL_RE.test(raw)) return null;
    const clean = raw.split('#')[0].split('?')[0];
    if (!clean) return null;
    let decoded = clean;
    try {
      decoded = decodeURIComponent(clean);
    } catch {
      /* keep the literal path when the escape is malformed */
    }
    return decoded;
  }

  function resolveReference(baseFile, reference) {
    const clean = splitReference(reference);
    if (clean === null) return null;
    const base = normalizePath(baseFile);
    const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : '';
    const joined = clean.startsWith('/') ? clean.slice(1) : `${dir}/${clean}`;
    return normalizePath(joined);
  }

  function extensionOf(file) {
    const name = String(file ?? '').split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot).toLowerCase() : '';
  }

  const LANGUAGE = {
    '.html': 'HTML',
    '.htm': 'HTML',
    '.svg': 'SVG',
    '.css': 'CSS',
    '.scss': 'SCSS',
    '.sass': 'Sass',
    '.less': 'Less',
    '.js': 'JavaScript',
    '.mjs': 'JavaScript',
    '.cjs': 'JavaScript',
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript React',
    '.jsx': 'JavaScript React',
    '.md': 'Markdown',
    '.py': 'Python',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
    '.cs': 'C#',
    '.c': 'C',
    '.h': 'C',
    '.cpp': 'C++',
    '.cc': 'C++',
    '.sh': 'Shell',
    '.ps1': 'PowerShell',
    '.sql': 'SQL',
    '.json': 'JSON',
    '.yml': 'YAML',
    '.yaml': 'YAML',
    '.toml': 'TOML',
    '.xml': 'XML',
    '.vue': 'Vue',
    '.svelte': 'Svelte',
    '.astro': 'Astro',
  };

  const SERVER_LANGUAGES = new Set([
    'Python',
    'Ruby',
    'PHP',
    'Go',
    'Rust',
    'Java',
    'C#',
    'C',
    'C++',
    'Shell',
    'PowerShell',
    'SQL',
  ]);

  function languageFor(file) {
    return LANGUAGE[extensionOf(file)] || 'this file';
  }

  function isExternal(value) {
    return value == null || EXTERNAL_RE.test(String(value).trim());
  }

  function attr(attributes, name) {
    const match = new RegExp(
      `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
      'i',
    ).exec(attributes || '');
    return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
  }

  function replaceAsync(input, pattern, replacer) {
    const jobs = [];
    input.replace(pattern, function () {
      const args = Array.prototype.slice.call(arguments);
      jobs.push(Promise.resolve(replacer.apply(null, args)));
      return args[0];
    });
    return Promise.all(jobs).then(function (values) {
      let index = 0;
      return input.replace(pattern, function () {
        return values[index++];
      });
    });
  }

  function safeStyle(css) {
    return String(css).replace(/<\/style/gi, '<\\/style');
  }

  function safeScript(js) {
    return String(js).replace(/<\/script/gi, '<' + '\\/script');
  }

  function dataSvg(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function unique(list) {
    return Array.from(new Set(list.filter(Boolean)));
  }

  /** Read one file through the host adapter and enforce the same limits. */
  async function readText(readFile, path, state) {
    let value;
    try {
      value = await readFile(path);
    } catch (error) {
      if (error instanceof PreviewError) throw error;
      fail('LINKED_ASSET_MISSING', `Could not read ${path}.`, { file: path });
    }
    if (value && typeof value === 'object' && 'content' in value) value = value.content;
    if (typeof value !== 'string') {
      fail('LINKED_ASSET_MISSING', `${path} is missing from this preview.`, { file: path });
    }
    state.files += 1;
    state.bytes += value.length;
    if (state.files > MAX_FILES) {
      fail('TOO_LARGE', `The preview needs more than ${MAX_FILES} files.`, { file: path });
    }
    if (state.bytes > MAX_BYTES) {
      fail('TOO_LARGE', 'The preview would be larger than 2 MB.', { file: path });
    }
    return value;
  }

  async function inlineCss(css, cssPath, readFile, state, stack) {
    const trail = stack || [];
    if (trail.includes(cssPath)) return '/* preview: import cycle at ' + cssPath + ' */';
    if (trail.length >= 12) {
      fail('TOO_LARGE', 'CSS imports are nested too deeply.', { file: cssPath });
    }
    let out = String(css);
    const imports = Array.from(
      out.matchAll(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?\s*([^;]*);/gi),
    );
    for (const match of imports) {
      const resolved = resolveReference(cssPath, match[2]);
      if (!resolved) continue;
      const child = await readText(readFile, resolved, state);
      const inlined = await inlineCss(child, resolved, readFile, state, trail.concat(cssPath));
      out = out.replace(match[0], inlined);
    }
    out = await replaceAsync(out, /url\(\s*(["']?)([^"')]+)\1\s*\)/gi, async function (full, quote, ref) {
      const resolved = resolveReference(cssPath, ref);
      if (!resolved) return full;
      if (!/\.svg$/i.test(resolved)) {
        state.warnings.push(`${resolved} is not inlined (only SVG assets are supported).`);
        return full;
      }
      try {
        const svg = await readText(readFile, resolved, state);
        return 'url("' + dataSvg(svg) + '")';
      } catch (error) {
        if (error instanceof PreviewError && error.code === 'TOO_LARGE') throw error;
        state.warnings.push(`${resolved} could not be inlined.`);
        return full;
      }
    });
    return out;
  }

  async function bundleStatic(options) {
    const entry = normalizePath(options && options.entry);
    if (!entry) {
      fail('NO_ENTRY', 'Choose an HTML file to preview.');
    }
    if (!HTML_RE.test(entry)) {
      fail('NO_ENTRY', 'Preview starts from an .html, .htm or .svg file.', {
        file: entry,
        language: languageFor(entry),
      });
    }
    const readFile = options.readFile;
    if (typeof readFile !== 'function') {
      fail('NO_ENTRY', 'This preview host cannot read files.');
    }
    const state = { files: 0, bytes: 0, warnings: [] };
    let html =
      typeof options.entryContent === 'string'
        ? options.entryContent
        : await readText(readFile, entry, state);

    if (/\.svg$/i.test(entry)) {
      return { html, entry, bytes: state.bytes, files: state.files, warnings: [] };
    }

    // Inline CSS already written inside the HTML first, then linked stylesheets.
    html = await replaceAsync(html, /<style\b([^>]*)>([\s\S]*?)<\/style>/gi, async function (full, attrs, css) {
      const inlined = await inlineCss(css, entry, readFile, state, [entry]);
      return '<style' + attrs + '>' + safeStyle(inlined) + '</style>';
    });

    html = await replaceAsync(html, /<link\b[^>]*>/gi, async function (tag) {
      const attrs = tag.slice(5, -1);
      const rel = attr(attrs, 'rel') || '';
      if (!/\bstylesheet\b/i.test(rel)) return tag;
      const href = attr(attrs, 'href');
      const resolved = href ? resolveReference(entry, href) : null;
      if (!resolved) return tag;
      const css = await readText(readFile, resolved, state);
      const inlined = await inlineCss(css, resolved, readFile, state, [entry]);
      return (
        '<style data-preview-from="' +
        escapeAttr(resolved) +
        '">' +
        safeStyle(inlined) +
        '</style>'
      );
    });

    html = await replaceAsync(html, /<script\b([^>]*)>([\s\S]*?)<\/script>/gi, async function (full, attrs, body) {
      const src = attr(attrs, 'src');
      const type = attr(attrs, 'type') || '';
      const isModule = /(^|\s)module(\s|$)/i.test(type);
      let js = body;
      let from = entry;
      if (src) {
        const resolved = resolveReference(entry, src);
        if (!resolved) return full;
        js = await readText(readFile, resolved, state);
        from = resolved;
      }
      if (isModule && /(^|\n)\s*(?:import|export)\s/.test(js)) {
        fail(
          'MODULE_GRAPH_UNSUPPORTED',
          `${from} uses relative module imports, which need a local server.`,
          { file: from, language: 'JavaScript' },
        );
      }
      const typeAttr = type ? ' type="' + escapeAttr(type) + '"' : '';
      return (
        '<script' +
        typeAttr +
        ' data-preview-from="' +
        escapeAttr(from) +
        '">' +
        safeScript(js) +
        '<\/script>'
      );
    });

    // SVG is the only image format the text file stores can inline. Raster
    // images and fonts are left as URLs and reported instead of breaking the page.
    for (const name of ['src', 'poster']) {
      const pattern = new RegExp(
        '(<(?:img|source|video|audio)\\b[^>]*?\\b' + name + '\\s*=\\s*)(["\\\'])([^"\\\']+)\\2',
        'gi',
      );
      html = await replaceAsync(html, pattern, async function (full, prefix, quote, ref) {
        const resolved = resolveReference(entry, ref);
        if (!resolved) return full;
        if (!/\.svg$/i.test(resolved)) {
          state.warnings.push(`${resolved} is not inlined (only SVG assets are supported).`);
          return full;
        }
        try {
          const svg = await readText(readFile, resolved, state);
          return prefix + '"' + dataSvg(svg) + '"';
        } catch (error) {
          if (error instanceof PreviewError && error.code === 'TOO_LARGE') throw error;
          state.warnings.push(`${resolved} could not be inlined.`);
          return full;
        }
      });
    }

    return {
      html,
      entry,
      bytes: state.bytes,
      files: state.files,
      warnings: unique(state.warnings),
    };
  }

  /**
   * Decide what a file can do on this host. The error objects are stable so the
   * page and tests can agree on them.
   */
  function classify(input) {
    const file = normalizePath(input && input.entry);
    const language = languageFor(file);
    const cloud = Boolean(input && input.host && input.host.cloud);
    if (HTML_RE.test(file)) {
      return { kind: 'html', entry: file, language: /\.svg$/i.test(file) ? 'SVG' : 'HTML' };
    }
    if (SERVER_LANGUAGES.has(language)) {
      return {
        kind: 'error',
        error: new PreviewError(
          cloud ? 'CLOUD_CANNOT_RUN' : 'SERVER_REQUIRED',
          cloud
            ? `${language} cannot run in the cloud preview.`
            : `${language} needs a running server to produce a page.`,
          {
            file,
            language,
            actions: cloud
              ? [
                  'Deploy it and preview the deployment URL.',
                  'Download the project and open it in the desktop app.',
                  'Use a public URL that already runs this app.',
                ]
              : [
                  'Start the app’s server, then paste its http://127.0.0.1 address in Preview.',
                  'Phase 2 adds a Run & preview button for this case.',
                  'A console-only program has no visual preview; its output belongs in the terminal.',
                ],
          },
        ),
      };
    }
    if (language === 'Markdown') {
      return {
        kind: 'error',
        error: new PreviewError('UNSUPPORTED_LANGUAGE', 'Markdown is not previewed yet.', {
          file,
          language,
          actions: [
            'Convert it to HTML first (pandoc, marked, or the model).',
            'Markdown preview is planned for Phase 3.',
          ],
        }),
      };
    }
    if (language === 'CSS' || language === 'JavaScript' || language === 'TypeScript' || language === 'JavaScript React' || language === 'TypeScript React') {
      return {
        kind: 'error',
        error: new PreviewError(
          'NO_ENTRY',
          `${language} has no page to render by itself.`,
          {
            file,
            language,
            actions: [
              'Open or create an HTML file that includes it.',
              'Linked CSS and classic scripts are inlined automatically.',
              'TypeScript and JSX need a compile step or a dev server.',
            ],
          },
        ),
      };
    }
    return {
      kind: 'error',
      error: new PreviewError(
        'UNSUPPORTED_LANGUAGE',
        `${language} does not have a browser preview.`,
        {
          file,
          language,
          actions: [
            'Preview an HTML result produced by this file or its toolchain.',
            'Use the desktop app to run a server or command and preview its URL.',
          ],
        },
      ),
    };
  }

  function renderError(input) {
    const error =
      input instanceof PreviewError
        ? input
        : input && input.error instanceof PreviewError
          ? input.error
          : new PreviewError('UNSUPPORTED_LANGUAGE', String((input && input.message) || input || 'Preview unavailable.'));
    const title = error.language ? error.language + ' preview' : 'Preview unavailable';
    const actions = Array.isArray(error.actions) ? error.actions : [];
    const items = actions
      .map(function (action) {
        return '<li style="margin:4px 0">' + escapeHtml(action) + '</li>';
      })
      .join('');
    return (
      '<div class="preview-failure" data-code="' +
      escapeAttr(error.code) +
      '" style="border:1px solid var(--line-2,#3a424e);border-radius:10px;padding:16px 18px;background:var(--bg-2,#191d22);color:var(--fg,#edf0f3);line-height:1.5">' +
      '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#9aa4b2);margin-bottom:6px">' +
      escapeHtml(error.code) +
      '</div>' +
      '<strong style="display:block;font-size:16px;margin-bottom:6px">' +
      escapeHtml(title) +
      '</strong>' +
      '<p style="margin:0 0 8px">' +
      escapeHtml(error.message) +
      '</p>' +
      (error.file
        ? '<p style="margin:0 0 8px;font-family:ui-monospace,monospace;font-size:12px;color:var(--muted,#9aa4b2)">' +
          escapeHtml(error.file) +
          '</p>'
        : '') +
      (items ? '<ul style="margin:8px 0 0;padding-left:20px">' + items + '</ul>' : '') +
      '</div>'
    );
  }

  const api = {
    MAX_FILES,
    MAX_BYTES,
    PreviewError,
    bundleStatic,
    classify,
    renderError,
    languageFor,
    normalizePath,
    resolveReference,
  };

  if (root) root.FreewayPreview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
