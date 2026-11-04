import test from 'node:test';
import assert from 'node:assert/strict';
import { compactMessages, estimateMessageTokens } from './memory.mjs';

const msg = (role, content) => ({ role, content });
const longChat = () => {
  const messages = [msg('user', 'Build a login page with a dark theme.')];
  for (let i = 0; i < 30; i += 1) {
    messages.push(msg(i % 2 === 0 ? 'assistant' : 'user', `step ${i} ` + 'x'.repeat(900)));
  }
  messages.push(msg('user', 'the newest question must stay verbatim'));
  return messages;
};

test('a short conversation is returned untouched', () => {
  const messages = [msg('user', 'hello'), msg('assistant', 'hi')];
  const result = compactMessages(messages);
  assert.equal(result.compacted, 0);
  assert.deepEqual(result.messages, messages);
  assert.equal(result.afterTokens, result.beforeTokens);
});

test('a long conversation gets one memory note and keeps the newest messages', () => {
  const messages = longChat();
  const before = estimateMessageTokens(messages);
  const result = compactMessages(messages);

  assert.ok(result.compacted > 0, 'nothing was compacted');
  assert.equal(result.messages[0].role, 'system');
  assert.match(result.messages[0].content, /Earlier in this conversation/);
  assert.match(result.messages[0].content, /Build a login page with a dark theme\./);
  assert.equal(result.messages.at(-1).content, 'the newest question must stay verbatim');
  assert.ok(result.afterTokens < before, 'the note did not reduce the estimate');
  assert.ok(
    result.messages.filter((message) => message.role === 'system').length === 1,
    'expected exactly one memory note',
  );
  assert.equal(messages.length, 32, 'the caller history was mutated');
});

test('the verbatim window starts at a user turn and preserves system messages', () => {
  const messages = [msg('system', 'You are a careful engineer.'), ...longChat()];
  const result = compactMessages(messages);
  assert.equal(result.messages[0].content, 'You are a careful engineer.');
  assert.equal(result.messages[1].role, 'system');
  assert.match(result.messages[1].content, /Earlier in this conversation/);
  // Everything after the note is recent history, beginning with a user turn.
  assert.equal(result.messages[2].role, 'user');
});

test('the trigger is configurable and never drops the newest message', () => {
  const messages = longChat();
  assert.equal(compactMessages(messages, { triggerTokens: 1_000_000 }).compacted, 0);
  const result = compactMessages(messages, { triggerTokens: 500 });
  assert.ok(result.compacted > 0);
  assert.equal(result.messages.at(-1).content, 'the newest question must stay verbatim');
});

test('the summary is capped and says when older messages were omitted', () => {
  const messages = longChat();
  const result = compactMessages(messages, { summaryChars: 500 });
  assert.ok(result.summary.length < 1200);
  if (result.omitted > 0) assert.match(result.summary, /older message/);
});

test('compaction keeps images on verbatim turns and drops them from the summary', () => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const messages = longChat().map((message) => ({ ...message }));
  messages[0] = { ...messages[0], images: [image] };
  messages[messages.length - 1] = { ...messages[messages.length - 1], images: [image] };
  const result = compactMessages(messages);
  assert.ok(result.compacted > 0);
  assert.equal(result.messages[0].role, 'system');
  assert.equal(JSON.stringify(result.messages[0]).includes(image), false, 'an image was copied into the note');
  assert.deepEqual(result.messages.at(-1).images, [image], 'the newest image was lost');
});
