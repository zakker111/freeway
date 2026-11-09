import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHECKPOINT_LIMITS, checkpointPaths, createCheckpointStore } from './checkpoints.mjs';
import { createWorkspace } from './workspace.mjs';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-checkpoints-'));
  return { dir, ws: createWorkspace(dir) };
}

test('only confirmed file tools produce checkpoint paths', () => {
  assert.deepEqual(checkpointPaths('write_file', { path: 'src/app.js' }), ['src/app.js']);
  assert.deepEqual(checkpointPaths('read_file', { path: 'src/app.js' }), []);
  assert.deepEqual(
    checkpointPaths('apply_patch', { path: 'ignored.js' }, { preview: { path: 'src/app.js' } }),
    ['src/app.js'],
  );
  assert.deepEqual(
    checkpointPaths('scaffold_project', {}, { layout: { paths: ['index.html', 'app.js'] } }),
    ['index.html', 'app.js'],
  );
  assert.deepEqual(checkpointPaths('write_file', { path: '  ' }), []);
});

test('a checkpoint captures before bytes and undo restores them', () => {
  const { dir, ws } = fixture();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'old\n');
  const store = createCheckpointStore({ now: () => 123, id: () => 'checkpoint-1' });

  const prepared = store.prepare(ws, ['src/app.js'], { owner: 'chat-a', tool: 'write_file' });
  assert.equal(prepared.files[0].buffer.toString('utf8'), 'old\n');
  const view = store.commit(prepared);
  assert.equal(view.id, 'checkpoint-1');
  assert.equal(view.files[0].existed, true);
  assert.equal('buffer' in view.files[0], false, 'before bytes must not reach the page');

  ws.write('src/app.js', 'new\n');
  assert.equal(store.latest('chat-a', ws).id, 'checkpoint-1');
  const undone = store.undo('chat-a', ws, 'checkpoint-1');
  assert.equal(undone.id, 'checkpoint-1');
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'app.js'), 'utf8'), 'old\n');
  assert.equal(store.latest('chat-a', ws), null);
});

test('undo removes a new file and its empty folders', () => {
  const { dir, ws } = fixture();
  const store = createCheckpointStore({ id: () => 'new-file' });
  const prepared = store.prepare(ws, ['nested/deep/new.txt'], { owner: 'chat-a', tool: 'write_file' });
  assert.equal(prepared.files[0].existed, false);
  store.commit(prepared);
  ws.write('nested/deep/new.txt', 'created');
  assert.equal(fs.existsSync(path.join(dir, 'nested', 'deep', 'new.txt')), true);

  store.undo('chat-a', ws, 'new-file');
  assert.equal(fs.existsSync(path.join(dir, 'nested', 'deep', 'new.txt')), false);
  assert.equal(fs.existsSync(path.join(dir, 'nested', 'deep')), false, 'empty folders were left behind');
});

test('a checkpoint is scoped to its chat and workspace', () => {
  const { dir, ws } = fixture();
  fs.writeFileSync(path.join(dir, 'note.txt'), 'one');
  const store = createCheckpointStore({ id: () => 'shared-id' });
  store.commit(store.prepare(ws, ['note.txt'], { owner: 'chat-a' }));

  assert.ok(store.latest('chat-a', ws));
  assert.equal(store.latest('chat-b', ws), null);
  assert.throws(() => store.undo('chat-b', ws, 'shared-id'), (error) => error.status === 404);
});

test('undo refuses an older checkpoint instead of discarding a newer edit', () => {
  const { dir, ws } = fixture();
  fs.writeFileSync(path.join(dir, 'note.txt'), 'one');
  let n = 0;
  const store = createCheckpointStore({ id: () => `checkpoint-${++n}` });
  store.commit(store.prepare(ws, ['note.txt'], { owner: 'chat-a' }));
  ws.write('note.txt', 'two');
  store.commit(store.prepare(ws, ['note.txt'], { owner: 'chat-a' }));

  assert.throws(() => store.undo('chat-a', ws, 'checkpoint-1'), (error) => error.status === 409);
  assert.equal(fs.readFileSync(path.join(dir, 'note.txt'), 'utf8'), 'two');
});

test('the checkpoint stack is bounded per chat', () => {
  const { dir, ws } = fixture();
  fs.writeFileSync(path.join(dir, 'note.txt'), 'one');
  let n = 0;
  const store = createCheckpointStore({
    maxCheckpoints: 2,
    id: () => `checkpoint-${++n}`,
  });
  for (let i = 0; i < 3; i += 1) {
    store.commit(store.prepare(ws, ['note.txt'], { owner: 'chat-a' }));
  }
  assert.equal(store.latest('chat-a', ws).id, 'checkpoint-3');
  store.undo('chat-a', ws, 'checkpoint-3');
  assert.equal(store.latest('chat-a', ws).id, 'checkpoint-2');
  store.undo('chat-a', ws, 'checkpoint-2');
  assert.throws(() => store.undo('chat-a', ws), (error) => error.status === 404);
});

test('checkpoint preparation fails rather than creating an un-undoable write', () => {
  const store = createCheckpointStore();
  assert.throws(() => store.prepare(null, ['a.txt']), (error) => error.status === 400);
  const { ws } = fixture();
  assert.throws(() => store.prepare(ws, []), (error) => error.status === 400);
  assert.equal(CHECKPOINT_LIMITS.maxCheckpoints > 0, true);
});
