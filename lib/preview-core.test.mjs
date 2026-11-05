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
