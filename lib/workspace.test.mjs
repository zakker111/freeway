import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace, unifiedDiff } from './workspace.mjs';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openrouter-ws-'));
  const root = path.join(dir, 'root');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes.txt'), 'hello world');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'console.log(1)');
  return { dir, root, ws: createWorkspace(root) };
}

const statusOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.status ?? 500;
  }
  return 200;
};

test('lists the root with folders first and skips noise', () => {
  const { ws } = fixture();
  const listing = ws.list('.');
  const names = listing.entries.map((entry) => entry.name);

  assert.equal(listing.path, '');
  assert.deepEqual(names, ['src', 'notes.txt']);
  assert.equal(listing.entries[0].type, 'dir');
  assert.equal(listing.entries[1].size, 11);
  assert.ok(!names.includes('node_modules'), 'node_modules should be skipped');
});

test('lists a subfolder and normalises the path', () => {
  const { ws } = fixture();
  const listing = ws.list('src/');
  assert.equal(listing.path, 'src');
  assert.deepEqual(
    listing.entries.map((entry) => entry.name),
    ['app.js'],
  );
});

test('reads a text file', () => {
  const { ws } = fixture();
  const file = ws.read('./notes.txt');
  assert.equal(file.content, 'hello world');
  assert.equal(file.path, 'notes.txt');
  assert.equal(file.size, 11);
});

test('writes a new file and creates parent folders', () => {
  const { ws, root } = fixture();
  const saved = ws.write('deep/nested/out.txt', 'written');
  assert.equal(saved.path, 'deep/nested/out.txt');
  assert.equal(saved.size, 7);
  assert.equal(fs.readFileSync(path.join(root, 'deep', 'nested', 'out.txt'), 'utf8'), 'written');
  assert.equal(ws.read('deep/nested/out.txt').content, 'written');
});

test('refuses to walk out of the workspace', () => {
  const { ws } = fixture();
  assert.equal(statusOf(() => ws.list('..')), 400);
  assert.equal(statusOf(() => ws.read('../outside.txt')), 400);
  assert.equal(statusOf(() => ws.write('../../escape.txt', 'nope')), 400);
});

test('refuses absolute paths outside the workspace', () => {
  const { ws } = fixture();
  assert.equal(statusOf(() => ws.read('/etc/passwd')), 400);
  assert.equal(statusOf(() => ws.write('/tmp/openrouter-should-not-exist.txt', 'x')), 400);
  assert.ok(!fs.existsSync('/tmp/openrouter-should-not-exist.txt'));
});

test('refuses a symlink that points outside', () => {
  const { ws, root } = fixture();
  fs.symlinkSync('/etc', path.join(root, 'escape'), 'dir');
  assert.equal(statusOf(() => ws.list('escape')), 400);
  assert.equal(statusOf(() => ws.read('escape/hostname')), 400);
  assert.equal(statusOf(() => ws.write('escape/pwned.txt', 'x')), 400);
});

test('refuses binary files and oversized files', () => {
  const { ws, root } = fixture();
  fs.writeFileSync(path.join(root, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x47]));
  fs.writeFileSync(path.join(root, 'big.txt'), 'a'.repeat(300 * 1024));

  assert.equal(statusOf(() => ws.read('image.bin')), 400);
  assert.equal(statusOf(() => ws.read('big.txt')), 400);
  assert.equal(statusOf(() => ws.write('huge.txt', 'x'.repeat(1024 * 1024 + 1))), 400);
});

test('refuses to overwrite a folder with a file', () => {
  const { ws } = fixture();
  assert.equal(statusOf(() => ws.write('src', 'nope')), 400);
});

test('a missing path is a 404, not a crash', () => {
  const { ws } = fixture();
  assert.equal(statusOf(() => ws.read('nope.txt')), 404);
  assert.equal(statusOf(() => ws.list('nope')), 404);
});

test('search finds text, reports line numbers and skips generated folders', () => {
  const { ws, root } = fixture();
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist', 'bundle.js'), 'secret generated text');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'console.log(1)\n// TODO: fix this\n');

  const found = ws.search('.', 'todo');
  assert.equal(found.matches.length, 1);
  assert.equal(found.matches[0].path, 'src/app.js');
  assert.equal(found.matches[0].line, 2);
  assert.match(found.matches[0].text, /TODO/);
  assert.equal(found.scanned, 2, 'dist should not be searched');
  assert.equal(ws.search('.', 'generated').matches.length, 0);
});

test('search supports regex, case sensitivity and a result cap', () => {
  const { ws } = fixture();
  assert.equal(ws.search('.', 'HELLO').matches.length, 1);
  assert.equal(ws.search('.', 'HELLO', { caseSensitive: true }).matches.length, 0);
  assert.equal(ws.search('.', 'hello|console', { regex: true }).matches.length, 2);
  assert.equal(ws.search('.', 'o').matches.length, 2);
  assert.equal(ws.search('.', 'o', { maxResults: 1 }).matches.length, 1);
  assert.equal(statusOf(() => ws.search('.', '(' , { regex: true })), 400);
  assert.equal(statusOf(() => ws.search('..', 'x')), 400);
});

test('read_many reads a batch and reports per-file errors', () => {
  const { ws } = fixture();
  const batch = ws.readMany(['notes.txt', 'src/app.js', 'missing.txt', '../outside.txt']);
  assert.equal(batch.files.length, 4);
  assert.equal(batch.files[0].content, 'hello world');
  assert.equal(batch.files[1].content, 'console.log(1)');
  assert.match(batch.files[2].error, /No such file/);
  assert.match(batch.files[3].error, /outside the workspace/);
  assert.equal(batch.total, 11 + 14);
  assert.equal(statusOf(() => ws.readMany([])), 400);
  assert.equal(statusOf(() => ws.readMany(Array(9).fill('notes.txt'))), 400);
});

test('preview_patch shows a diff without writing, then apply_patch writes it', () => {
  const { ws } = fixture();
  const preview = ws.previewPatch({
    path: 'notes.txt',
    edits: [{ find: 'world', replace: 'there' }],
  });
  assert.equal(ws.read('notes.txt').content, 'hello world', 'preview wrote the file');
  assert.match(preview.diff, /^--- a\/notes\.txt$/m);
  assert.match(preview.diff, /^-hello world$/m);
  assert.match(preview.diff, /^\+hello there$/m);

  const saved = ws.applyPatch({
    path: 'notes.txt',
    edits: [{ find: 'world', replace: 'there' }],
  });
  assert.equal(saved.edits, 1);
  assert.equal(ws.read('notes.txt').content, 'hello there');
});

test('patch refuses ambiguous, absent and escaping edits', () => {
  const { ws } = fixture();
  ws.write('dup.txt', 'same same');
  assert.throws(
    () => ws.previewPatch({ path: 'dup.txt', edits: [{ find: 'same', replace: 'x' }] }),
    /occurs 2 times/,
  );
  assert.throws(
    () => ws.previewPatch({ path: 'notes.txt', edits: [{ find: 'nope', replace: 'x' }] }),
    /does not occur/,
  );
  assert.equal(statusOf(() => ws.previewPatch({ path: '../outside.txt', edits: [{ find: 'a', replace: 'b' }] })), 400);
  assert.equal(statusOf(() => ws.applyPatch({ path: 'notes.txt', edits: [] })), 400);
});

test('unifiedDiff keeps context and marks both sides', () => {
  const diff = unifiedDiff('one\ntwo\nthree\n', 'one\nTWO\nthree\n', 'x.txt');
  assert.match(diff, /^--- a\/x\.txt$/m);
  assert.match(diff, /^\+\+\+ b\/x\.txt$/m);
  assert.match(diff, /^-two$/m);
  assert.match(diff, /^\+TWO$/m);
});

test('no workspace means nothing is reachable', () => {
  const ws = createWorkspace('');
  assert.equal(ws.isReady, false);
  assert.equal(statusOf(() => ws.list('.')), 400);
  assert.equal(statusOf(() => ws.read('notes.txt')), 400);
});

test('a workspace folder that does not exist is refused', () => {
  const ws = createWorkspace(path.join(os.tmpdir(), 'openrouter-definitely-missing'));
  assert.equal(ws.isReady, true, 'configured, but broken on disk');
  assert.equal(statusOf(() => ws.list('.')), 400);
});
