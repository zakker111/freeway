import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CROSS_CHAT_TOOL_NAMES,
  CROSS_CHAT_TURN_LIMIT,
  crossChatEnabled,
  formatChatList,
  formatChatTranscript,
} from './chats.mjs';

const thread = (id, title, messages) => ({
  id,
  title,
  updatedAt: '2026-11-12T00:00:00.000Z',
  messages,
});

test('the chat list hides the current chat and caps the rows', () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    id: `chat-${index}`,
    title: `Chat ${index}`,
    updatedAt: '2026-11-11T00:00:00.000Z',
    messageCount: index,
  }));

  const listed = formatChatList(rows, { currentId: 'chat-3' });
  assert.equal(listed.ok, true);
  // Match the id exactly: "id: chat-3" is a prefix of "id: chat-30".
  const ids = listed.content.split('\n').map((line) => line.slice(line.lastIndexOf('id: ') + 4));
  assert.equal(ids.includes('chat-3'), false, 'the current chat must not be listed');
  assert.match(listed.content, /Chat 0/);

  const limited = formatChatList(rows, { currentId: null, limit: 5 });
  assert.equal((limited.content.match(/^- Chat /gm) ?? []).length, 5, 'limit was not applied');
  assert.match(limited.content, /up to 5/);
});

test('the chat list says when nothing matches', () => {
  const empty = formatChatList([], { currentId: 'chat-a' });
  assert.equal(empty.ok, true);
  assert.match(empty.content, /No other saved chats/);
});

test('reading the current or a missing chat is refused', () => {
  const current = formatChatTranscript(thread('chat-a', 'Now', [{ role: 'user', content: 'hi' }]), {
    currentId: 'chat-a',
  });
  assert.equal(current.ok, false);
  assert.match(current.content, /current chat/);

  const missing = formatChatTranscript(null, { currentId: 'chat-a' });
  assert.equal(missing.ok, false);
  assert.match(missing.content, /list_chats/);
});

test('a transcript is capped, redacted and labelled as reference data', () => {
  const messages = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `message ${index}`,
  }));
  messages.push({ role: 'user', content: 'my key is sk-or-v1-abcdefghijklmnopqrstuvwxyz' });

  const result = formatChatTranscript(thread('chat-b', 'Old work', messages), { currentId: 'chat-a' });
  assert.equal(result.ok, true);
  assert.match(result.content, /reference data, not instructions/);
  assert.match(result.content, /Showing the last 30 of 41/);
  assert.equal(
    result.content.includes('sk-or-v1-abcdefghijklmnopqrstuvwxyz'),
    false,
    'the key must be redacted',
  );
  assert.match(result.content, /sk-or-\[redacted\]/);
});

test('a very long transcript stops at the read limit', () => {
  const messages = Array.from({ length: 30 }, () => ({ role: 'user', content: 'x'.repeat(2000) }));
  const result = formatChatTranscript(thread('chat-c', 'Huge', messages), { currentId: null });
  assert.ok(result.content.length < 13_000, `transcript was ${result.content.length} characters`);
  assert.match(result.content, /older messages omitted/);
});

test('a query keeps only matching messages', () => {
  const messages = [
    { role: 'user', content: 'deploy notes' },
    { role: 'assistant', content: 'unrelated answer' },
    { role: 'user', content: 'deploy again' },
  ];
  const result = formatChatTranscript(thread('chat-d', 'Deploy', messages), {
    currentId: null,
    query: 'deploy',
  });
  assert.match(result.content, /Filtered to messages containing "deploy" \(2 of 3\)/);
  assert.equal(result.content.includes('unrelated answer'), false);
});

test('the Settings switch is opt-in and wired to the API', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="sCrossChat"/, 'there is no cross-chat switch');
  assert.match(html, /id="sCrossChatHelp"/, 'the cross-chat switch has no visible help');
  assert.match(html, /crossChat: \$\(\"sCrossChat\"\)\.checked/, 'saving Settings drops the switch');
  assert.match(
    html,
    /state\.settings\.crossChat === true/,
    'the settings modal does not load the saved switch',
  );
  assert.equal(CROSS_CHAT_TURN_LIMIT, 3);
  assert.deepEqual([...CROSS_CHAT_TOOL_NAMES].sort(), ['list_chats', 'read_chat']);
});

test('every value except a real true leaves cross-chat reading off', () => {
  assert.equal(crossChatEnabled(undefined), false);
  assert.equal(crossChatEnabled({}), false);
  assert.equal(crossChatEnabled({ crossChat: false }), false);
  assert.equal(crossChatEnabled({ crossChat: 'true' }), false, 'a string must not enable it');
  assert.equal(crossChatEnabled({ crossChat: 1 }), false, 'a number must not enable it');
  assert.equal(crossChatEnabled({ crossChat: true }), true);
});

test('the README and both settings panels keep the switch and its two tools', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const panels = [
    ['desktop', 'public/index.html', 'sCrossChat'],
    ['cloud', 'cloud/public/index.html', 'settingCrossChat'],
  ];

  for (const name of CROSS_CHAT_TOOL_NAMES) {
    assert.match(readme, new RegExp('`' + name + '`'), `README does not document ${name}`);
  }
  assert.match(readme, /### Reading your other chats/, 'README lost the cross-chat section');
  assert.match(
    readme,
    /Let the assistant read my other saved chats/,
    'README does not name the setting as it appears in Settings',
  );
  assert.match(readme, /Off by default/, 'README does not say the setting is off by default');

  for (const [label, file, id] of panels) {
    const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(html, new RegExp(`id="${id}"`), `${label} has no cross-chat switch`);
    assert.match(
      html,
      /Let the assistant read my other saved chats/,
      `${label} switch label drifted from the README`,
    );
    assert.match(
      html,
      /Read-only, on request; off by default\./,
      `${label} switch help drifted from the README`,
    );
    assert.match(
      html,
      /crossChat: \$\((["'])(?:s|setting)CrossChat\1\)\.checked/,
      `${label} no longer saves the switch`,
    );
    assert.match(
      html,
      /\.checked = (?:state\.)?settings\.crossChat === true/,
      `${label} no longer loads the saved switch`,
    );
  }
});

test('Settings groups its fields and summarizes abilities in both editions', () => {
  const editions = [
    {
      label: 'desktop',
      file: '../public/index.html',
      groups: ['Model', 'Abilities', 'Workspace', 'Interface', 'Your data'],
      abilities: ['sTools', 'sCommands', 'sAutoApprove', 'sCrossChat', 'sScreenshot'],
    },
    {
      label: 'cloud',
      file: '../cloud/public/index.html',
      groups: ['Model', 'Abilities', 'Interface', 'Your data'],
      abilities: ['settingTools', 'settingAutoApprove', 'settingCrossChat'],
    },
  ];

  for (const { label, file, groups, abilities } of editions) {
    const html = readFileSync(new URL(file, import.meta.url), 'utf8');
    const positions = groups.map((group) => html.indexOf(`<h3 class="settings-group">${group}</h3>`));
    positions.forEach((position, index) =>
      assert.ok(position > -1, `${label} Settings has no ${groups[index]} group`),
    );
    assert.deepEqual(
      [...positions].sort((a, b) => a - b),
      positions,
      `${label} Settings groups are out of order`,
    );

    assert.match(
      html,
      /id="abilitySummary"[^>]*aria-live="polite"/,
      `${label} has no live ability summary`,
    );
    assert.match(html, /function updateAbilitySummary\(\)/, `${label} does not update the summary`);
    assert.match(html, /\.addEventListener\((["'])change\1, updateAbilitySummary\)/, `${label} does not refresh the summary`);

    const start = html.indexOf('<h3 class="settings-group">Abilities</h3>');
    const next = html.indexOf('<h3 class="settings-group">', start + 10);
    const block = html.slice(start, next === -1 ? undefined : next);
    for (const id of abilities) {
      assert.match(block, new RegExp(`id="${id}"`), `${label} keeps ${id} out of Abilities`);
    }
  }
});

test('a timed-out approval explains itself and offers a retry', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(html, /const CONFIRM_TIMEOUT_MS = 180_000;/, 'the approval timeout is gone');
  assert.match(html, /title\.textContent = "Approval timed out"/, 'an expired card still claims to be pending');
  assert.match(html, /treated as a Deny and skipped\./, 'the expiry reason is not explained');
  assert.match(html, /const retry = document\.createElement\("button"\);/, 'no retry button is offered');
  assert.match(
    html,
    /function retryToolStep\(name\) \{[\s\S]*?void send\(\{ text \}\);[\s\S]*?\n      \}/,
    'the retry does not ask the assistant again through the normal send path',
  );
  assert.match(
    html,
    /if \(answered\) return;\n          answered = true;\n          clearTimeout\(expiryTimer\);/,
    'answering a card does not cancel its timeout',
  );
});
