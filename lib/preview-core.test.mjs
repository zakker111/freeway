import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadCore() {
  const code = fs.readFileSync(new URL('../shared/preview.js', import.meta.url), 'utf8');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  assert.ok(sandbox.FreewayPreview, 'core did not expose FreewayPreview');
  return sandbox.FreewayPreview;
}

const core = loadCore();

function reader(files) {
  return (path) => {
    if (Object.prototype.hasOwnProperty.call(files, path)) return files[path];
    const error = new Error(`no such file: ${path}`);
    error.code = 'ENOENT';
    throw error;
  };
}

test('static preview inlines linked CSS, nested imports, JS and SVG', async () => {
  const files = {
    'index.html':
      '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>' +
      '<body><h1>Hi</h1><img src="art.svg"><script src="app.js"></script></body></html>',
    'style.css':
      '@import "theme.css";\nbody { background: url("art.svg"); color: red; }\n',
    'theme.css': 'h1 { font-weight: 700; }\n',
    'app.js': 'document.body.dataset.ready = "1";\n',
    'art.svg': '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
  };
  const result = await core.bundleStatic({ entry: 'index.html', readFile: reader(files) });
  assert.match(result.html, /h1 \{ font-weight: 700; \}/, 'nested @import was not inlined');
  assert.match(result.html, /data-preview-from="style.css"/, 'stylesheet source was not kept');
  assert.match(result.html, /document\.body\.dataset\.ready/, 'script was not inlined');
  assert.match(result.html, /data:image\/svg\+xml/, 'SVG was not inlined');
  assert.equal(result.warnings.length, 0);
  assert.equal(result.files, 6);
});

test('missing linked files are reported, not silently dropped', async () => {
  const files = {
    'index.html': '<link rel="stylesheet" href="missing.css"><h1>Hi</h1>',
  };
  await assert.rejects(
    () => core.bundleStatic({ entry: 'index.html', readFile: reader(files) }),
    (error) => error.code === 'LINKED_ASSET_MISSING' && /missing\.css/.test(error.message),
  );
});

test('preview paths cannot escape the project folder', async () => {
  assert.throws(
    () => core.resolveReference('index.html', '../secret.txt'),
    (error) => error.code === 'PATH_OUTSIDE',
  );
  const files = { 'index.html': '<script src="../secret.js"></script>' };
  await assert.rejects(
    () => core.bundleStatic({ entry: 'index.html', readFile: reader(files) }),
    (error) => error.code === 'PATH_OUTSIDE',
  );
});

test('relative ES module graphs ask for a server instead of breaking the page', async () => {
  const files = {
    'index.html': '<script type="module" src="app.js"></script>',
    'app.js': 'import { x } from "./x.js";\nconsole.log(x);\n',
    'x.js': 'export const x = 1;\n',
  };
  await assert.rejects(
    () => core.bundleStatic({ entry: 'index.html', readFile: reader(files) }),
    (error) => error.code === 'MODULE_GRAPH_UNSUPPORTED',
  );
});

test('unsupported languages get different errors on desktop and cloud', () => {
  const cloud = core.classify({ entry: 'app.py', host: { cloud: true } });
  assert.equal(cloud.kind, 'error');
  assert.equal(cloud.error.code, 'CLOUD_CANNOT_RUN');
  assert.equal(cloud.error.language, 'Python');

  const desktop = core.classify({ entry: 'app.py', host: { cloud: false } });
  assert.equal(desktop.error.code, 'SERVER_REQUIRED');
  assert.match(core.renderError(desktop.error), /Python preview/);

  const css = core.classify({ entry: 'style.css' });
  assert.equal(css.error.code, 'NO_ENTRY');
  assert.match(css.error.message, /no page to render/);
});

test('an HTML entry is classified for both hosts', () => {
  const plan = core.classify({ entry: 'site/index.html', host: { cloud: true } });
  assert.equal(plan.kind, 'html');
  assert.equal(plan.entry, 'site/index.html');
  assert.equal(plan.language, 'HTML');
});

test('Markdown renders headings, lists, fences and tables safely', () => {
  const html = core.renderMarkdown(
    '# Notes\n\n**bold** and [docs](https://example.com).\n\n- one\n- two\n\n' +
      '```js\nconst x = 1;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n',
    { title: 'notes.md' },
  );
  assert.match(html, /data-preview-markdown/);
  assert.match(html, /<h1>Notes<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.com"/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /class="language-js"/);
  assert.match(html, /<table>/);

  const unsafe = core.renderMarkdown(
    '[bad](javascript:alert(1)) <script>alert(1)</script> ![x](data:text/html,boom)',
  );
  assert.doesNotMatch(unsafe, /href="javascript:/);
  assert.doesNotMatch(unsafe, /<img[^>]+data:text\/html/);
  assert.match(unsafe, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('Markdown is a preview kind, not an unsupported language', () => {
  const plan = core.classify({ entry: 'README.md', host: { cloud: true } });
  assert.equal(plan.kind, 'markdown');
  assert.equal(plan.entry, 'README.md');
  assert.equal(plan.language, 'Markdown');
});

test('TypeScript and SCSS are classified as build-required with a framework plan', () => {
  const ts = core.classify({
    entry: 'src/main.tsx',
    host: { cloud: false },
    packageJson: { devDependencies: { vite: '^5' }, scripts: { dev: 'vite' } },
  });
  assert.equal(ts.error.code, 'BUILD_REQUIRED');
  assert.equal(ts.error.plan.framework, 'Vite');
  assert.equal(ts.error.plan.dev, 'npm run dev');
  assert.match(ts.error.actions.join(' '), /npm run dev/);

  const scss = core.classify({ entry: 'styles/app.scss', host: { cloud: true } });
  assert.equal(scss.error.code, 'BUILD_REQUIRED');
  assert.equal(scss.error.plan.framework, 'SCSS');
  assert.match(scss.error.actions.join(' '), /npx sass styles\/app\.scss styles\/app\.css/);
});

test('HTML cannot silently inline TypeScript or SCSS source', async () => {
  const scss = {
    'index.html': '<link rel="stylesheet" href="style.scss"><h1>Hi</h1>',
    'style.scss': '$color: red; h1 { color: $color; }',
  };
  await assert.rejects(
    () => core.bundleStatic({ entry: 'index.html', readFile: reader(scss) }),
    (error) => error.code === 'BUILD_REQUIRED' && error.language === 'SCSS',
  );

  const tsx = {
    'index.html': '<script type="module" src="main.tsx"></script>',
    'main.tsx': 'export const app = <main>Hi</main>;',
  };
  await assert.rejects(
    () => core.bundleStatic({ entry: 'index.html', readFile: reader(tsx) }),
    (error) => error.code === 'BUILD_REQUIRED' && error.language === 'TypeScript React',
  );
});

test('the preview bridge is appended once and invalid source is ignored', () => {
  const source = 'window.bridge = true;';
  const wrapped = core.withPreviewBridge('<html><body><h1>Hello</h1></body></html>', source);
  assert.match(wrapped, /<script data-freeway-preview-bridge>window\.bridge = true;<\/script>/);
  assert.match(wrapped, /<h1>Hello<\/h1>/);
  assert.equal(core.withPreviewBridge(wrapped, 'window.other = true;'), wrapped);
  assert.match(core.withPreviewBridge('<svg></svg>', source), /data-freeway-preview-bridge/);
  assert.equal(core.withPreviewBridge('<p>x</p>', 'bad </script>'), '<p>x</p>');
});
