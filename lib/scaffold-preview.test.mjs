import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildScaffold, scaffoldLayout } from './scaffold.mjs';
import { checkPreview } from './preview-check.mjs';
import { createWorkspace } from './workspace.mjs';
import { runTool } from './tools.mjs';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-scaffold-'));
  return { dir, ws: createWorkspace(dir) };
}

test('scaffold_project creates a complete site and preview_check accepts it', async () => {
  const { dir, ws } = fixture();
  try {
    const created = await runTool(
      'scaffold_project',
      { title: 'Northstar <Studio>', tagline: 'A small site for big ideas.', theme: 'paper' },
      { workspace: ws },
    );
    assert.equal(created.ok, true, created.content);
    assert.equal(created.path, 'index.html');
    for (const file of ['index.html', 'styles.css', 'app.js']) {
      assert.equal(fs.existsSync(path.join(dir, file)), true, `${file} was not written`);
    }
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /&lt;Studio&gt;/, 'the title was not HTML-escaped');
    assert.doesNotMatch(html, /Northstar <Studio>/, 'raw markup reached the page title');

    const checked = await runTool('preview_check', {}, { workspace: ws });
    assert.equal(checked.ok, true, checked.content);
    assert.match(checked.content, /Preview check passed: \/index.html/);
    assert.match(checked.content, /Checked 2 local assets/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('preview_check reports a missing asset and passes after the repair', async () => {
  const { dir, ws } = fixture();
  try {
    await runTool('scaffold_project', { title: 'Repair me', theme: 'sunset' }, { workspace: ws });
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!doctype html><html><head><title>Broken</title><link rel="stylesheet" href="./missing.css"></head><body>Hi</body></html>',
    );

    const broken = await runTool('preview_check', {}, { workspace: ws });
    assert.equal(broken.ok, false, broken.content);
    assert.match(broken.content, /Preview check FAILED/);
    assert.match(broken.content, /missing\.css/);
    assert.match(broken.content, /referenced by \/index\.html/);

    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!doctype html><html><head><title>Fixed</title><link rel="stylesheet" href="./styles.css"></head><body>Hi</body></html>',
    );
    const fixed = await runTool('preview_check', {}, { workspace: ws });
    assert.equal(fixed.ok, true, fixed.content);
    assert.match(fixed.content, /All local HTML and CSS references resolve/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('preview_check follows a stylesheet to find a missing image', () => {
  const { dir, ws } = fixture();
  try {
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="./site/style.css"></head><body></body></html>',
    );
    fs.mkdirSync(path.join(dir, 'site'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'site', 'style.css'), 'body { background: url("./hero.png"); }');
    const result = checkPreview(ws, {});
    assert.equal(result.ok, false);
    assert.match(result.content, /site\/hero\.png/);
    assert.match(result.content, /referenced by \/site\/style\.css/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scaffold refuses to overwrite files and rejects path traversal', async () => {
  const { dir, ws } = fixture();
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), 'keep me');
    const collision = await runTool('scaffold_project', { title: 'Collision' }, { workspace: ws });
    assert.equal(collision.ok, false);
    assert.match(collision.content, /Will not overwrite/);
    assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), 'keep me');

    const traversal = await runTool(
      'scaffold_project',
      { title: 'Escape', folder: '../outside' },
      { workspace: ws },
    );
    assert.equal(traversal.ok, false);
    assert.match(traversal.content, /plain folder/);

    assert.throws(() => scaffoldLayout({ folder: 'a/../b' }), /plain folder/);
    assert.throws(() => scaffoldLayout({ folder: '.hidden' }), /plain folder/);
    const layout = scaffoldLayout({ folder: 'site' });
    assert.deepEqual(layout.paths, ['site/index.html', 'site/styles.css', 'site/app.js']);
    const scaffold = buildScaffold({ title: 'Site', folder: 'site' });
    assert.equal(scaffold.files.length, 3);
    assert.match(scaffold.files[0].content, /href="\.\/styles\.css"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('preview_check refuses an outside entry and reports a missing page', async () => {
  const { dir, ws } = fixture();
  try {
    const outside = await runTool('preview_check', { entry: '../secret.html' }, { workspace: ws });
    assert.equal(outside.ok, false);
    assert.match(outside.content, /inside the workspace/);

    const missing = await runTool('preview_check', {}, { workspace: ws });
    assert.equal(missing.ok, false);
    assert.match(missing.content, /cannot read \/index\.html/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
