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
  const MARKDOWN_RE = /\.(md|markdown)$/i;
  const BUILD_EXT_RE = /\.(ts|tsx|jsx|scss|sass|less|vue|svelte|astro)$/i;
  const BUILD_STYLE_RE = /\.(scss|sass|less)$/i;
  const BUILD_SCRIPT_RE = /\.(ts|tsx|jsx)$/i;
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
    '.markdown': 'Markdown',
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

  async function inlineCss(css, cssPath, readFile, state, stack, packageJson) {
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
      if (BUILD_STYLE_RE.test(resolved)) {
        fail(
          'BUILD_REQUIRED',
          `${resolved} is ${languageFor(resolved)} and must be compiled before it can be inlined.`,
          {
            file: resolved,
            language: languageFor(resolved),
            actions: buildActions(resolved, languageFor(resolved), packageJson, false),
          },
        );
      }
      const child = await readText(readFile, resolved, state);
      const inlined = await inlineCss(child, resolved, readFile, state, trail.concat(cssPath), packageJson);
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

  /* ---------------------------------------------------------------- Markdown */

  /** Only http(s), mailto and same-document/relative links leave this function. */
  function markdownUrl(raw, image) {
    let value = String(raw ?? '').trim();
    if (!value) return null;
    if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1).trim();
    const probe = value.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
    if (!probe) return null;
    if (probe.startsWith('data:')) {
      return image && /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(probe)
        ? value
        : null;
    }
    if (probe.startsWith('javascript:') || probe.startsWith('vbscript:')) return null;
    if (/^[a-z][a-z0-9+.-]*:/.test(probe)) {
      if (/^https?:/.test(probe)) return value;
      if (!image && /^mailto:/.test(probe)) return value;
      return null;
    }
    if (probe.startsWith('//')) return null;
    return value;
  }

  /** Inline Markdown. Raw HTML is escaped before any generated tags are added. */
  function markdownInline(value) {
    const held = [];
    function hold(html) {
      const token = '\u0000' + held.length + '\u0000';
      held.push(html);
      return token;
    }

    let text = escapeHtml(value);

    // Code spans first, so their contents are never treated as links or emphasis.
    text = text.replace(/(`+)([^`\n]*?)\1/g, function (full, ticks, code) {
      return hold('<code>' + code.replace(/^ /, '').replace(/ $/, '') + '</code>');
    });

    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (full, alt, url) {
      const safe = markdownUrl(url, true);
      if (!safe) return alt;
      return hold(
        '<img src="' + escapeAttr(safe) + '" alt="' + escapeAttr(alt) + '" loading="lazy">',
      );
    });

    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (full, label, url) {
      const safe = markdownUrl(url, false);
      if (!safe) return label;
      return hold(
        '<a href="' +
          escapeAttr(safe) +
          '" target="_blank" rel="noreferrer noopener">' +
          label +
          '</a>',
      );
    });

    text = text.replace(/&lt;((?:https?:\/\/|mailto:)[^&\s]+)&gt;/g, function (full, url) {
      return hold(
        '<a href="' +
          escapeAttr(url) +
          '" target="_blank" rel="noreferrer noopener">' +
          url +
          '</a>',
      );
    });

    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    text = text.replace(/(^|[^\w])\*([^*\n]+)\*(?=[^\w]|$)/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');

    // Held values can contain earlier held values (an image inside a link), so
    // restore the newest first.
    for (let index = held.length - 1; index >= 0; index -= 1) {
      text = text.split('\u0000' + index + '\u0000').join(held[index]);
    }
    return text;
  }

  function markdownBlockStart(line) {
    return (
      /^ {0,3}(?:#{1,6}\s|`{3,}|~{3,}|>\s?|[-*+]\s|\d+[.)]\s)/.test(line) ||
      /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)
    );
  }

  function tableCells(line) {
    let value = line.trim();
    if (value.startsWith('|')) value = value.slice(1);
    if (value.endsWith('|')) value = value.slice(0, -1);
    return value.split('|').map(function (cell) {
      return cell.trim();
    });
  }

  function tableRule(line) {
    if (!line.includes('|')) return false;
    const cells = tableCells(line);
    return cells.length > 0 && cells.every(function (cell) {
      return /^:?-{3,}:?$/.test(cell);
    });
  }

  function markdownToHtml(source) {
    const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      const fence = /^ {0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+.-]*)\s*$/.exec(line);
      if (fence) {
        const marker = fence[1][0];
        const size = fence[1].length;
        const language = fence[2];
        const close = new RegExp('^ {0,3}' + marker + '{' + size + ',}\\s*$');
        index += 1;
        const code = [];
        while (index < lines.length && !close.test(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        out.push(
          '<pre><code' +
            (language ? ' class="language-' + escapeAttr(language) + '"' : '') +
            '>' +
            escapeHtml(code.join('\n')) +
            '</code></pre>',
        );
        continue;
      }

      const heading = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        out.push('<h' + level + '>' + markdownInline(heading[2]) + '</h' + level + '>');
        index += 1;
        continue;
      }

      if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        out.push('<hr>');
        index += 1;
        continue;
      }

      if (/^ {0,3}>/.test(line)) {
        const quote = [];
        while (index < lines.length && /^ {0,3}>/.test(lines[index])) {
          quote.push(lines[index].replace(/^ {0,3}>\s?/, ''));
          index += 1;
        }
        out.push('<blockquote>\n' + markdownToHtml(quote.join('\n')) + '\n</blockquote>');
        continue;
      }

      if (line.includes('|') && index + 1 < lines.length && tableRule(lines[index + 1])) {
        const header = tableCells(line);
        const align = tableCells(lines[index + 1]).map(function (cell) {
          if (/^:.*:$/.test(cell)) return 'center';
          if (/:$/.test(cell)) return 'right';
          return 'left';
        });
        index += 2;
        const rows = [];
        while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
          const cells = tableCells(lines[index]);
          rows.push(
            '<tr>' +
              header
                .map(function (unused, column) {
                  return (
                    '<td style="text-align:' +
                    (align[column] || 'left') +
                    '">' +
                    markdownInline(cells[column] || '') +
                    '</td>'
                  );
                })
                .join('') +
              '</tr>',
          );
          index += 1;
        }
        out.push(
          '<table><thead><tr>' +
            header
              .map(function (cell, column) {
                return (
                  '<th style="text-align:' +
                  (align[column] || 'left') +
                  '">' +
                  markdownInline(cell) +
                  '</th>'
                );
              })
              .join('') +
            '</tr></thead><tbody>' +
            rows.join('') +
            '</tbody></table>',
        );
        continue;
      }

      const item = /^ {0,3}([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (item) {
        const ordered = /^\d/.test(item[1]);
        const items = [];
        while (index < lines.length) {
          const next = /^ {0,3}([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index]);
          if (!next || /^\d/.test(next[1]) !== ordered) break;
          let body = next[2];
          index += 1;
          while (
            index < lines.length &&
            lines[index].trim() &&
            /^\s{2,}/.test(lines[index]) &&
            !/^ {0,3}([-*+]|\d+[.)])\s+/.test(lines[index])
          ) {
            body += ' ' + lines[index].trim();
            index += 1;
          }
          items.push('<li>' + markdownInline(body) + '</li>');
        }
        out.push('<' + (ordered ? 'ol' : 'ul') + '>' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
        continue;
      }

      const paragraph = [line.trim()];
      index += 1;
      while (
        index < lines.length &&
        lines[index].trim() &&
        !markdownBlockStart(lines[index]) &&
        !(index + 1 < lines.length && lines[index].includes('|') && tableRule(lines[index + 1]))
      ) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      out.push('<p>' + markdownInline(paragraph.join(' ')) + '</p>');
    }
    return out.join('\n');
  }

  /** A complete, script-free document for the sandboxed preview frame. */
  function renderMarkdown(source, options) {
    const title = String((options && options.title) || 'Markdown preview');
    const body = markdownToHtml(source);
    const css = [
      ':root{color-scheme:light dark}',
      '*{box-sizing:border-box}',
      'body{margin:0;background:#fff;color:#1d232b;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}',
      'main{max-width:820px;margin:0 auto;padding:44px clamp(18px,5vw,64px) 80px}',
      'h1,h2,h3,h4,h5,h6{line-height:1.2;margin:1.5em 0 .55em}',
      'h1{font-size:2.1em;border-bottom:1px solid #d8dee4;padding-bottom:.3em}',
      'h2{font-size:1.5em;border-bottom:1px solid #eaeef2;padding-bottom:.25em}',
      'p,ul,ol,blockquote,pre,table{margin:0 0 1em}',
      'a{color:#0969da}',
      'code{font:85% ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#f0f3f6;border-radius:5px;padding:.15em .35em}',
      'pre{overflow:auto;background:#f6f8fa;border:1px solid #d8dee4;border-radius:8px;padding:14px 16px}',
      'pre code{background:none;padding:0;font-size:13px;line-height:1.55}',
      'blockquote{margin-left:0;padding:0 0 0 16px;border-left:4px solid #d0d7de;color:#57606a}',
      'table{border-collapse:collapse;width:100%;display:block;overflow:auto}',
      'th,td{border:1px solid #d0d7de;padding:7px 10px}',
      'th{background:#f6f8fa}',
      'img{max-width:100%;height:auto;border-radius:6px}',
      'hr{border:0;border-top:1px solid #d0d7de;margin:1.8em 0}',
      '@media(prefers-color-scheme:dark){body{background:#101215;color:#edf0f3}h1{border-color:#343c47}h2{border-color:#2a313a}a{color:#8cc8ff}code{background:#222830}pre{background:#191d22;border-color:#343c47}blockquote{border-color:#4b5663;color:#aab3bf}th,td{border-color:#343c47}th{background:#191d22}hr{border-color:#343c47}}',
    ].join('\n');
    return (
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="color-scheme" content="light dark"><title>' +
      escapeHtml(title) +
      '</title><style>' +
      css +
      '</style></head><body data-preview-markdown><main>' +
      body +
      '</main></body></html>'
    );
  }

  /* ------------------------------------------------------------- Build hints */

  function packageObject(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value && typeof value === 'object' ? value : null;
  }

  /** Explain the project's own toolchain instead of pretending to compile it. */
  function buildPlan(file, packageJson) {
    const language = languageFor(file);
    const pkg = packageObject(packageJson);
    const dependencies = Object.assign(
      {},
      pkg && pkg.dependencies,
      pkg && pkg.devDependencies,
    );
    const scripts = (pkg && pkg.scripts) || {};
    const has = function (name) {
      return Object.prototype.hasOwnProperty.call(dependencies, name);
    };
    const script = function (name) {
      return typeof scripts[name] === 'string' ? scripts[name].trim() : '';
    };

    let framework = '';
    let dev = '';
    let build = '';
    let output = '';

    if (has('next')) {
      framework = 'Next.js';
      dev = script('dev') ? 'npm run dev' : 'npx next dev';
      build = script('build') ? 'npm run build' : 'npx next build';
      output = '.next (use the dev server, or npm run start)';
    } else if (has('nuxt')) {
      framework = 'Nuxt';
      dev = script('dev') ? 'npm run dev' : 'npx nuxt dev';
      build = script('build') ? 'npm run build' : 'npx nuxt build';
      output = '.output/public';
    } else if (has('@sveltejs/kit')) {
      framework = 'SvelteKit';
      dev = script('dev') ? 'npm run dev' : 'npx vite dev';
      build = script('build') ? 'npm run build' : 'npx vite build';
      output = 'build';
    } else if (has('astro')) {
      framework = 'Astro';
      dev = script('dev') ? 'npm run dev' : 'npx astro dev';
      build = script('build') ? 'npm run build' : 'npx astro build';
      output = 'dist';
    } else if (has('vite')) {
      framework = 'Vite';
      dev = script('dev') ? 'npm run dev' : 'npx vite';
      build = script('build') ? 'npm run build' : 'npx vite build';
      output = 'dist';
    } else if (has('parcel')) {
      framework = 'Parcel';
      dev = script('dev') ? 'npm run dev' : 'npx parcel';
      build = script('build') ? 'npm run build' : 'npx parcel build';
      output = 'dist';
    }

    if (!framework) {
      if (language === 'TypeScript' || language === 'TypeScript React') {
        framework = 'TypeScript';
        build = 'npx tsc';
        output = 'the outDir in tsconfig.json';
      } else if (language === 'JavaScript React') {
        framework = 'JSX';
        build = 'a JSX transform (Vite, Babel or esbuild)';
        output = 'the transformed JavaScript';
      } else if (language === 'SCSS' || language === 'Sass') {
        framework = language;
        build = 'npx sass ' + file + ' ' + file.replace(/\.(scss|sass)$/i, '.css');
        output = 'the emitted CSS file';
      } else if (language === 'Less') {
        framework = 'Less';
        build = 'npx lessc ' + file + ' ' + file.replace(/\.less$/i, '.css');
        output = 'the emitted CSS file';
      } else if (language === 'Vue' || language === 'Svelte' || language === 'Astro') {
        framework = language;
        build = 'a ' + language + ' framework build (for example Vite)';
        output = 'the emitted HTML, CSS and JavaScript';
      }
    }

    return { file, language, framework, dev, build, output };
  }

  function buildActions(file, language, packageJson, cloud) {
    const plan = buildPlan(file, packageJson);
    const actions = [];
    if (plan.framework) {
      actions.push(
        'Detected ' + plan.framework + (plan.output ? ' (output: ' + plan.output + ').' : '.'),
      );
    }
    if (cloud) {
      actions.push(
        plan.build
          ? 'Build locally with `' + plan.build + '`; this browser edition cannot run it.'
          : 'Build this ' + language + ' locally; this browser edition cannot run npm, tsc or sass.',
      );
      actions.push('Upload the emitted HTML/CSS/JS, or use the desktop app for a dev server.');
    } else {
      if (plan.dev) {
        actions.push('Start it with `' + plan.dev + '`, then paste the dev-server URL in Preview.');
      } else if (plan.build) {
        actions.push('Build it with `' + plan.build + '`.');
      }
      actions.push('This app serves files; it does not compile ' + language + ' itself.');
      actions.push('Preview the HTML that loads the compiled output.');
    }
    return actions;
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
      const styleLang = (attr(attrs, 'lang') || '').trim();
      if (/^(?:s[ac]ss|less)$/i.test(styleLang)) {
        fail(
          'BUILD_REQUIRED',
          `Inline ${styleLang.toUpperCase()} must be compiled before it can be previewed.`,
          {
            file: entry,
            language: styleLang.toUpperCase(),
            actions: buildActions(entry, styleLang.toUpperCase(), options.packageJson, false),
          },
        );
      }
      const inlined = await inlineCss(css, entry, readFile, state, [entry], options.packageJson);
      return '<style' + attrs + '>' + safeStyle(inlined) + '</style>';
    });

    html = await replaceAsync(html, /<link\b[^>]*>/gi, async function (tag) {
      const attrs = tag.slice(5, -1);
      const rel = attr(attrs, 'rel') || '';
      if (!/\bstylesheet\b/i.test(rel)) return tag;
      const href = attr(attrs, 'href');
      const resolved = href ? resolveReference(entry, href) : null;
      if (!resolved) return tag;
      if (BUILD_STYLE_RE.test(resolved)) {
        fail(
          'BUILD_REQUIRED',
          `${resolved} is ${languageFor(resolved)} and must be compiled before it can be previewed.`,
          {
            file: resolved,
            language: languageFor(resolved),
            actions: buildActions(resolved, languageFor(resolved), options.packageJson, false),
          },
        );
      }
      const css = await readText(readFile, resolved, state);
      const inlined = await inlineCss(css, resolved, readFile, state, [entry], options.packageJson);
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
        if (BUILD_SCRIPT_RE.test(resolved)) {
          fail(
            'BUILD_REQUIRED',
            `${resolved} is ${languageFor(resolved)} and must be compiled before it can be previewed.`,
            {
              file: resolved,
              language: languageFor(resolved),
              actions: buildActions(resolved, languageFor(resolved), options.packageJson, false),
            },
          );
        }
        js = await readText(readFile, resolved, state);
        from = resolved;
      }
      if (/^(?:text\/typescript|text\/tsx|text\/jsx|text\/babel)$/i.test(type.trim())) {
        fail(
          'BUILD_REQUIRED',
          `Inline ${type.trim()} must be compiled before it can be previewed.`,
          {
            file: from,
            language: 'TypeScript',
            actions: buildActions(from, 'TypeScript', options.packageJson, false),
          },
        );
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
                  'A console-only program has no visual preview; its output belongs in the terminal.',
                ],
          },
        ),
      };
    }
    if (MARKDOWN_RE.test(file)) {
      return { kind: 'markdown', entry: file, language };
    }
    if (BUILD_EXT_RE.test(file)) {
      const plan = buildPlan(file, input && input.packageJson);
      return {
        kind: 'error',
        error: new PreviewError(
          'BUILD_REQUIRED',
          `${language} needs a build step before it can be previewed.`,
          {
            file,
            language,
            plan,
            actions: buildActions(file, language, input && input.packageJson, cloud),
          },
        ),
      };
    }
    if (language === 'CSS' || language === 'JavaScript') {
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
    renderMarkdown,
    markdownToHtml,
    buildPlan,
    languageFor,
    normalizePath,
    resolveReference,
  };

  if (root) root.FreewayPreview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
