// Fast unit coverage for Chatty's conversation reading, model suggestion and
// message picker.
//
// shared/chatty.js runs in a Node VM with a stub document, localStorage and
// matchMedia. It only mounts its DOM and timers on DOMContentLoaded, so the
// decision helpers can be driven here in milliseconds. Math.random and Date.now
// are replaced inside the VM realm, which makes the dice and the once-per-topic
// memory deterministic; the browser suite still covers the bubble, the typing
// hold and the wiring into the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../shared/chatty.js', import.meta.url), 'utf8');

const DEBUGGING_TIPS = [
  'Start with the error message, not the whole codebase. The first line that names a file and a line number is your clue.',
  'Change one thing that tests one guess. A giant rewrite is just a box; I will sit in it.',
  'If a reply misses, name one thing to keep and one thing to change. Smaller follow-ups land better.',
];
const DRAFTS = {
  debugging: 'Fix the bug: this request throws an exception in app.mjs at line 42.',
  coding: 'Refactor the function so it retries twice.',
  explaining: 'Explain how this cache invalidates entries',
  writing: 'Write a short email to the team',
};

function storage(initial) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(String(key), String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

function boot({ user = '', assistant = '', draft = '', model = '' } = {}) {
  const input = { value: draft };
  const userBubbles = user ? [{ textContent: user }] : [];
  const assistantBubbles = assistant ? [{ textContent: assistant }] : [];
  const document = {
    // Anything but 'complete' keeps onCreate from mounting the DOM and timers.
    readyState: 'loading',
    hidden: false,
    addEventListener() {},
    querySelector: (selector) => (selector === '#input' ? input : null),
    querySelectorAll: (selector) => {
      if (selector === '.msg.user .bubble') return userBubbles;
      if (selector === '.msg.assistant .bubble') return assistantBubbles;
      return [];
    },
  };
  const sandbox = {
    console,
    document,
    localStorage: storage(model ? { 'openrouter.model': model } : {}),
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(SOURCE, context, { filename: 'shared/chatty.js' });
  const chatty = vm.runInContext('window.FreewayChatty', context);

  // Replace the dice and the clock inside the VM realm only: the host's Math
  // and Date stay untouched and every test gets its own run.
  const setRandom = (fn) => {
    sandbox.__random = fn;
    vm.runInContext('Math.random = globalThis.__random;', context);
  };
  const setNow = (value) => {
    sandbox.__now = value;
    vm.runInContext('Date.now = () => globalThis.__now;', context);
  };

  return {
    internals: chatty.__internals,
    setRandom,
    setNow,
    setDraft: (text) => {
      input.value = text;
    },
  };
}

test('the conversation reader keeps the draft behind a long assistant reply', () => {
  const assistant = 'The quick brown fox jumps over the lazy dog. '.repeat(140);
  const env = boot({ assistant, draft: DRAFTS.debugging });
  assert.equal(env.internals.detectConversationTopic(), 'debugging');
  const text = env.internals.readConversationText();
  assert.ok(text.includes('throws an exception'), 'the composer draft was not read at all');
  assert.ok(text.length <= 4000, `the reader grew to ${text.length} characters`);
});

test('the first tip for a topic is contextual and needs no chance roll', () => {
  const env = boot({ draft: DRAFTS.debugging });
  let draws = 0;
  env.setRandom(() => {
    draws += 1;
    return 0.99;
  });
  const text = env.internals.pickMessage();
  assert.ok(DEBUGGING_TIPS.includes(text), `expected a debugging tip, got: ${text}`);
  assert.equal(draws, 1, 'the first contextual tip should only draw its index');
});

test('a missed contextual roll is not rolled a second time', () => {
  const env = boot({ draft: DRAFTS.debugging });
  env.setRandom(() => 0.5);
  assert.ok(DEBUGGING_TIPS.includes(env.internals.pickMessage()), 'the first tip should be contextual');
  // The chance draw misses (0.99) and the joke draw misses too (0.5 >= 0.3),
  // which is the only branch that used to reach pickTip(). There the contextual
  // pool was rolled again, so the next 0.0 would have returned a debugging tip.
  const queue = [0.99, 0.5, 0, 0];
  env.setRandom(() => (queue.length ? queue.shift() : 0.5));
  const text = env.internals.pickMessage();
  assert.ok(!DEBUGGING_TIPS.includes(text), `the contextual pool was rolled twice: ${text}`);
});

test('a model suggestion is said once per topic, not once per tip', () => {
  const env = boot({ draft: DRAFTS.debugging, model: 'Qwen3-Coder-480B-A35B-Instruct' });
  env.setRandom(() => 0.5);
  assert.match(env.internals.modelSuggestionTip(), /^You're debugging\. gpt-oss-120b /);
  assert.equal(env.internals.modelSuggestionTip(), '', 'the same topic suggested a model twice');
  env.setDraft(DRAFTS.explaining);
  assert.match(env.internals.modelSuggestionTip(), /^You're explaining something\. Llama 3\.3 70B /);
  // The memory belongs to the page, not the clock: time alone does not re-arm it.
  env.setNow(Date.now() + 30 * 24 * 60 * 60 * 1000);
  assert.equal(env.internals.modelSuggestionTip(), '', 'a clock jump re-armed the suggestion');
});

test('family matching reads the model id, not a display name', () => {
  const cases = [
    ['debugging', 'Qwen3-Coder-480B-A35B-Instruct', /gpt-oss-120b/],
    ['debugging', 'gpt-oss-120b', ''],
    ['debugging', '@cf/openai/gpt-oss-120b', ''],
    // gpt-oss is OpenAI's open-weight model, not GPT-4o: it is its own family.
    ['explaining', 'openai/gpt-4o', /Llama 3\.3 70B/],
    ['explaining', 'Meta-Llama-3_3-70B-Instruct', ''],
    ['coding', '@cf/qwen/qwen3.8-27b', ''],
    ['writing', 'mistral-small-latest', ''],
    ['writing', 'Meta-Llama-3_3-70B-Instruct', /Mistral Small/],
  ];
  for (const [topic, model, expected] of cases) {
    const env = boot({ draft: DRAFTS[topic], model });
    const text = env.internals.modelSuggestionTip();
    const label = `${topic} with ${model}`;
    if (expected === '') assert.equal(text, '', `${label} should not get a suggestion`);
    else assert.match(text, expected, `${label} should suggest a free model`);
  }
});

test('no suggestion is made before a model is chosen', () => {
  const env = boot({ draft: DRAFTS.debugging });
  assert.equal(env.internals.currentModelId(), '');
  assert.equal(env.internals.modelSuggestionTip(), '', 'a fresh install has no model id to compare');
});
