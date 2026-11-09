import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildChartHtml, normalizeChart } from './chart.mjs';
import { createZip, crc32 } from './zip.mjs';
import { createWorkspaceArchive } from './archive.mjs';
import { createWorkspace } from './workspace.mjs';
import { parseMarkdownBlocks } from './markdown.mjs';
import { buildDocx } from './docx.mjs';
import { buildPdf } from './pdf.mjs';

test('charts are self-contained, escaped SVG', () => {
  const html = buildChartHtml({
    title: 'Sales & <forecast>',
    type: 'bar',
    data: [{ label: 'Jan <x>', value: 4 }, { label: 'Feb', value: 9 }],
  });
  assert.match(html, /<svg/);
  assert.match(html, /Sales &amp; &lt;forecast&gt;/);
  assert.match(html, /Jan &lt;x&gt;/);
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('http'), false);
  assert.equal(normalizeChart({ type: 'pie', data: [{ label: 'A', value: 1 }] }).type, 'pie');
  assert.throws(() => buildChartHtml({ type: 'bar', data: [] }), /at least one/);
  assert.throws(() => buildChartHtml({ type: 'pie', data: [{ label: 'A', value: 0 }] }), /positive/);
  assert.throws(() => buildChartHtml({ type: 'line', data: [{ label: 'A', value: 'x' }] }), /finite/);
});

test('zip archives have a normal local header and central directory', () => {
  const buffer = createZip([
    { path: 'README.md', data: '# Hello\n' },
    { path: 'src/app.js', data: 'console.log(1);\n' },
  ]);
  assert.equal(buffer.subarray(0, 4).toString('binary'), 'PK\x03\x04');
  assert.match(buffer.toString('latin1'), /README\.md/);
  assert.match(buffer.toString('latin1'), /src\/app\.js/);
  assert.match(buffer.toString('latin1'), /PK\x05\x06/);
  assert.equal(crc32(Buffer.from('hello')), 0x3610a686);
  assert.throws(() => createZip([{ path: '../escape', data: 'x' }]), /simple relative/);
});

test('workspace ZIP excludes secrets and stays inside the workspace', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.md'), '# Project\n');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const ok = true;\n');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  fs.writeFileSync(path.join(root, 'secrets.json'), '{"x":1}\n');
  const archive = createWorkspaceArchive(createWorkspace(root));
  const text = archive.buffer.toString('latin1');
  assert.equal(archive.files, 2);
  assert.match(text, /index\.md/);
  assert.match(text, /src\/app\.js/);
  assert.equal(text.includes('.env'), false);
  assert.equal(text.includes('secrets.json'), false);
});

test('markdown becomes valid DOCX and text PDF downloads', () => {
  const markdown = '# Report\n\nA short **summary**.\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconsole.log(1)\n```\n';
  const blocks = parseMarkdownBlocks(markdown);
  assert.ok(blocks.some((block) => block.type === 'h1'));
  assert.ok(blocks.some((block) => block.type === 'table'));
  const docx = buildDocx(markdown, { title: 'Report' });
  assert.equal(docx.subarray(0, 2).toString('latin1'), 'PK');
  assert.match(docx.toString('latin1'), /word\/document\.xml/);
  const pdf = buildPdf(markdown, { title: 'Report' });
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.match(pdf.toString('latin1'), /Report/);
  assert.match(pdf.toString('latin1'), /%%EOF/);
  assert.throws(() => buildPdf('   '), /no Markdown/);
});
