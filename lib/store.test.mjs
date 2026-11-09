import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTitle, normalizeMessages, openStore } from './store.mjs';

function tempStore(options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openrouter-store-'));
  return { dir, file: path.join(dir, 'threads.json'), store: openStore(path.join(dir, 'threads.json'), options) };
}

const user = (content, extra = {}) => ({ role: 'user', content, ...extra });
const answer = (content, extra = {}) => ({ role: 'assistant', content, ...extra });

test('a title is the first user message, on one line, truncated', () => {
  assert.equal(makeTitle([user('  Hello\n\n   there  ')]), 'Hello there');
  assert.equal(makeTitle([answer('hi'), user('second')]), 'second');
  assert.equal(makeTitle([]), 'New chat');
  assert.equal(makeTitle([user('x'.repeat(200))]).length, 80);
  assert.ok(makeTitle([user('x'.repeat(200))]).endsWith('…'));
});

test('normalizeMessages drops junk and keeps tool chips', () => {
  const cleaned = normalizeMessages(
    [
      { role: 'system', content: 'ignore me' },
      user(''),
      user('keep', { tools: [{ name: 'calculate', preview: '1+1', ok: false }] }),
      null,
    ],
    40,
  );
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].content, 'keep');
  assert.deepEqual(cleaned[0].tools, [{ name: 'calculate', preview: '1+1', ok: false }]);
});

test('token usage survives a save and reload', () => {
  const { file, store } = tempStore();
  const created = store.put(null, {
    messages: [
      user('hi'),
      answer('hello', { usage: { prompt_tokens: 7, completion_tokens: 3 } }),
    ],
  });
  assert.deepEqual(store.get(created.id).messages[1].usage, {
    prompt_tokens: 7,
    completion_tokens: 3,
  });

  // A fresh store reads the same file: the totals must not reset on restart.
  const reopened = openStore(file);
  assert.deepEqual(reopened.get(created.id).messages[1].usage, {
    prompt_tokens: 7,
    completion_tokens: 3,
  });
  // A hand-edited value cannot inject anything but numbers.
  const cleaned = normalizeMessages([answer('x', { usage: { prompt_tokens: '3', completion_tokens: null } })], 4);
  assert.deepEqual(cleaned[0].usage, { prompt_tokens: 3, completion_tokens: 0 });
});

test('creates, lists and reads a chat', () => {
  const { store } = tempStore();
  const created = store.put(null, { messages: [user('first chat')] });

  assert.equal(created.title, 'first chat');
  assert.ok(created.id.length >= 6);
  assert.equal(created.messages.length, 1);

  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].messageCount, 1);
  assert.equal(list[0].title, 'first chat');

  const read = store.get(created.id);
  assert.equal(read.messages[0].content, 'first chat');

  // A draft can own files before its first message. It must still be a real
  // saved chat, or a restart loses the id that namespaces those files.
  const fileOnly = store.put(null, { title: 'New chat', messages: [], workspace: '' });
  assert.equal(fileOnly.messages.length, 0);
  assert.equal(store.get(fileOnly.id).messages.length, 0);
  assert.equal(store.list().find((thread) => thread.id === fileOnly.id).messageCount, 0);
});

test('a preview address is http(s) only, kept per chat, and never bumps rev', () => {
  const { store } = tempStore();
  const created = store.put(null, { messages: [user('preview me')] });

  const saved = store.setPreview(created.id, 'http://localhost:5173/app');
  assert.equal(saved.preview, 'http://localhost:5173/app');
  assert.equal(saved.rev, created.rev, 'setting the preview must not bump rev');
  assert.equal(store.get(created.id).preview, 'http://localhost:5173/app');

  // A value that would become an iframe src must never survive: javascript: and
  // file: are the two that would actually be dangerous there.
  assert.equal(store.setPreview(created.id, 'javascript:alert(1)').preview, '');
  assert.equal(store.setPreview(created.id, 'file:///etc/passwd').preview, '');
  assert.equal(store.setPreview(created.id, '   ').preview, '');
  assert.equal(store.setPreview('no-such-chat-1', 'https://dev.local'), null);

  // It also survives a normal save, so a later message does not wipe it. Values
  // are stored as the URL parser sees them, so a bare host gains its slash.
  store.setPreview(created.id, 'https://dev.local:3000');
  const kept = store.put(created.id, {
    messages: [user('preview me'), answer('ok')],
    preview: 'https://dev.local:3000',
  });
  assert.equal(kept.preview, 'https://dev.local:3000/');
  assert.equal(store.setPreview(created.id, '  https://dev.local:3000  ').preview, 'https://dev.local:3000/');
});

test('creating a second chat with an existing id is refused', () => {
  const { store } = tempStore();
  const created = store.put(null, { messages: [user('one')] });

  assert.throws(
    () => store.put(null, { id: created.id, messages: [user('clobber')] }),
    (error) => error.status === 409 && error.thread.id === created.id,
    'a duplicate id must not silently replace or duplicate the chat',
  );
  assert.equal(store.list().length, 1);
  assert.equal(store.get(created.id).messages[0].content, 'one');
});

test('updating a chat keeps its id and creation time', () => {
  const { store } = tempStore();
  const created = store.put(null, { messages: [user('one')] });
  const updated = store.put(created.id, { messages: [user('one'), answer('two')] });

  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.messages.length, 2);
  assert.equal(store.list().length, 1);
});

test('search looks at titles and message text', () => {
  const { store } = tempStore();
  store.put(null, { messages: [user('alpha question'), answer('about bicycles')] });
  store.put(null, { messages: [user('beta question')] });

  assert.equal(store.list('alpha').length, 1);
  assert.equal(store.list('bicycles').length, 1, 'search should reach message bodies');
  assert.equal(store.list('question').length, 2);
  assert.equal(store.list('nothing here').length, 0);
});

test('deleting removes only that chat', () => {
  const { store } = tempStore();
  const a = store.put(null, { messages: [user('a')] });
  const b = store.put(null, { messages: [user('b')] });

  assert.equal(store.remove(a.id), true);
  assert.equal(store.remove(a.id), false);
  assert.equal(store.get(a.id), null);
  assert.ok(store.get(b.id));
});

test('survives a restart by reading the file back', () => {
  const { file, store } = tempStore();
  const created = store.put(null, { messages: [user('durable'), answer('yes')] });

  const reopened = openStore(file);
  const list = reopened.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);
  assert.equal(reopened.get(created.id).messages[1].content, 'yes');
});

test('a corrupt file is ignored instead of crashing', () => {
  const { file, dir } = tempStore();
  fs.writeFileSync(file, '{ not json');
  const store = openStore(file);
  assert.deepEqual(store.list(), []);
  const created = store.put(null, { messages: [user('still works')] });
  assert.equal(store.all().length, 1);
  assert.ok(fs.existsSync(path.join(dir, 'threads.json')));
});

test('keeps the newest chats when over the limit', async () => {
  const { store } = tempStore({ maxThreads: 3 });
  for (const name of ['one', 'two', 'three', 'four', 'five']) {
    store.put(null, { messages: [user(name)] });
    await new Promise((resolve) => setTimeout(resolve, 3));
  }

  const titles = store.list().map((t) => t.title);
  assert.equal(titles.length, 3);
  assert.deepEqual(titles, ['five', 'four', 'three']);
});

test('search matches chat titles and message text, not just titles', async () => {
  const { store } = tempStore();
  store.put(null, { title: 'Unrelated title', messages: [user('the body mentions Kubernetes here')] });
  await new Promise((resolve) => setTimeout(resolve, 3));
  store.put(null, { title: 'Kubernetes notes', messages: [user('nothing relevant')] });

  const byBody = store.list('kubernetes');
  assert.equal(byBody.length, 2, 'both the title match and the body match should be found');
  assert.deepEqual(
    byBody.map((t) => t.title).sort(),
    ['Kubernetes notes', 'Unrelated title'],
  );
  assert.equal(store.list('KUBERNETES').length, 2, 'search is case-insensitive');
  assert.equal(store.list('no-such-word').length, 0);
});

test('import merges by default and can replace', () => {
  const { store } = tempStore();
  const existing = store.put(null, { messages: [user('existing')] });
  const backup = {
    threads: [
      { id: 'imported-1', title: 'Imported', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-02T00:00:00.000Z', messages: [user('imported')] },
    ],
  };

  const merged = store.importAll(backup, 'merge');
  assert.equal(merged.imported, 1);
  assert.equal(merged.total, 2);
  assert.ok(store.get(existing.id));

  const replaced = store.importAll(backup, 'replace');
  assert.equal(replaced.total, 1);
  assert.equal(store.get(existing.id), null);
  assert.equal(store.get('imported-1').title, 'Imported');
});

// The cloud edition exports this exact shape (Settings -> Export chats (.json)),
// so importing the same file twice must update the chats, not duplicate them.
test('imports a cloud export and stays stable on a second import', () => {
  const { store } = tempStore();
  const cloudExport = {
    app: 'freeway',
    source: 'cloud',
    exportedAt: '2024-02-01T10:00:00.000Z',
    threads: [
      {
        id: 'cloud-chat-1',
        title: 'Started on the website',
        createdAt: '2024-02-01T09:00:00.000Z',
        updatedAt: '2024-02-01T09:30:00.000Z',
        provider: 'groq',
        model: 'llama-3.3-70b',
        messages: [user('hello from the cloud'), { role: 'assistant', content: 'hi' }],
      },
    ],
  };

  const first = store.importAll(cloudExport, 'merge');
  assert.equal(first.imported, 1);
  assert.equal(first.total, 1);
  assert.equal(store.get('cloud-chat-1').title, 'Started on the website');
  assert.equal(store.get('cloud-chat-1').messages.length, 2);

  const second = store.importAll(cloudExport, 'merge');
  assert.equal(second.total, 1, 're-importing the same export must not duplicate the chat');
});

test('import rejects a file with no chats', () => {
  const { store } = tempStore();
  assert.throws(() => store.importAll({ threads: [] }, 'merge'), /No chats/);
  assert.throws(() => store.importAll({}, 'merge'), /No chats/);
});

test('keeps the fallback log and the request count', () => {
  const { store } = tempStore();
  const thread = store.put(null, {
    requests: 3,
    messages: [
      {
        role: 'assistant',
        content: 'hi',
        log: ['Switched to mock/beta-free after mock/alpha-free returned 429.', 42, 'x'.repeat(400)],
      },
    ],
  });

  assert.equal(thread.requests, 3);
  assert.equal(thread.messages[0].log.length, 2, 'non-strings should be dropped');
  assert.equal(thread.messages[0].log[1].length, 300, 'log lines should be capped');

  const reread = store.get(thread.id);
  assert.equal(reread.requests, 3);
  assert.equal(
    reread.messages[0].log[0],
    'Switched to mock/beta-free after mock/alpha-free returned 429.',
  );
});

test('a chat remembers its own workspace policy', () => {
  const { file, store } = tempStore();
  const managed = store.put(null, { messages: [user('new chat')], workspace: '' });
  assert.equal(managed.workspace, '', 'a new chat must stay on its managed folder');

  const legacy = store.put(null, { messages: [user('old chat')] });
  assert.equal('workspace' in legacy, false, 'an old chat must stay on the legacy folder');

  const explicit = store.put(null, {
    messages: [user('project chat')],
    workspace: '/tmp/example-project',
  });
  assert.equal(explicit.workspace, '/tmp/example-project');

  // A rename or a preview save is a partial body; it must not move the chat.
  const renamed = store.put(managed.id, { messages: managed.messages, title: 'Renamed' });
  assert.equal(renamed.workspace, '', 'a partial save dropped the workspace policy');

  const reopened = openStore(file);
  assert.equal(reopened.get(managed.id).workspace, '');
  assert.equal('workspace' in reopened.get(legacy.id), false);
  assert.equal(reopened.get(explicit.id).workspace, '/tmp/example-project');
});

test('a chat remembers the model it was using', () => {
  const { file, store } = tempStore();
  const thread = store.put(null, {
    messages: [user('use this model')],
    model: '  mock/alpha-free  ',
  });
  assert.equal(thread.model, 'mock/alpha-free', 'the model was not trimmed and saved');

  // A rename or a later save from another path must not erase the preference.
  const renamed = store.put(thread.id, { title: 'Renamed', messages: thread.messages });
  assert.equal(renamed.model, 'mock/alpha-free', 'a partial save dropped the chat model');

  const reopened = openStore(file);
  assert.equal(reopened.get(thread.id).model, 'mock/alpha-free');
  assert.equal(store.put(null, { model: 42, messages: [user('junk model')] }).model, null);
});

test('a negative or junk request count becomes zero', () => {
  const { store } = tempStore();
  assert.equal(store.put(null, { requests: -5, messages: [user('a')] }).requests, 0);
  assert.equal(store.put(null, { requests: 'lots', messages: [user('b')] }).requests, 0);
});

test('export contains everything needed to restore', () => {
  const { store } = tempStore();
  store.put(null, { messages: [user('keep me')] });
  const dump = store.all();
  assert.equal(dump.length, 1);
  assert.equal(dump[0].messages[0].content, 'keep me');
});

test('a write from a stale copy is refused and carries the newer chat', () => {
  const { store } = tempStore();
  const created = store.put(null, { messages: [user('first')] });
  assert.equal(created.rev, 1);

  const fresh = store.put(created.id, { messages: [user('first'), answer('second')] });
  assert.equal(fresh.rev, 2, 'each save should bump the revision');

  assert.throws(
    () => store.put(created.id, { messages: [user('clobber')] }, { ifRev: created.rev }),
    (error) => error.status === 409 && error.thread.messages.length === 2,
    'a stale rev should be refused with the newer thread attached',
  );

  const ok = store.put(created.id, { messages: [user('third')] }, { ifRev: fresh.rev });
  assert.equal(ok.rev, 3, 'the current revision should still write');
});

test('an interrupted answer is kept as a draft until the chat is saved', () => {
  const { store } = tempStore();
  const created = store.put(null, { messages: [user('tell me a story')] });

  store.setDraft(created.id, { content: '  Once upon a time   ', model: 'mock/free' });
  const read = store.get(created.id);
  assert.equal(read.draft.content, 'Once upon a time', 'surrounding space should be trimmed');
  assert.equal(read.draft.model, 'mock/free');
  assert.equal(read.messages.length, 1, 'a draft must not add a message');

  store.put(created.id, { messages: [user('tell me a story'), answer('Once upon a time.')] });
  assert.equal(store.get(created.id).draft, null, 'saving the chat should clear the draft');

  assert.equal(store.setDraft('missing-123456', { content: 'x' }), null);
  assert.equal(store.setDraft(created.id, { content: '   ' }), null);
});

test('threads.json is written private', () => {
  const { file, store } = tempStore();
  store.put(null, { messages: [user('private on disk')] });
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});

test('normalizeMessages keeps one validated image per user turn', () => {
  const image = 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const messages = normalizeMessages(
    [user('look', { images: [image] }), answer('seen'), user('again', { images: ['https://x/y.png'] })],
    10,
  );
  assert.deepEqual(messages[0].images, [image]);
  assert.equal(messages[1].images, undefined);
  assert.equal(messages[2].images, undefined, 'a remote URL was stored as an attachment');
});
