// The failure this guards against: a free model prints its tool call as text
// ("<tool_call><function=write_file>…") instead of sending tool_calls, so the
// app runs nothing and the user sees no file. These tests pin the parser that
// recovers that shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTextToolCalls } from './tools.mjs';

test('recovers a Hermes-style XML tool call with parameters', () => {
  const text = [
    'Writing that for you.',
    '<tool_call>',
    '<function=write_file>',
    '<parameter=path>hello/index.html</parameter>',
    '<parameter=content><!doctype html><h1>Hello World</h1></parameter>',
    '</function>',
    '</tool_call>',
  ].join('\n');

  const { calls, text: cleaned } = parseTextToolCalls(text);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'write_file');
  assert.equal(calls[0].arguments.path, 'hello/index.html');
  assert.equal(calls[0].arguments.content, '<!doctype html><h1>Hello World</h1>');
  assert.equal(cleaned, 'Writing that for you.');
});

test('keeps multi-line parameter content intact', () => {
  const text =
    '<tool_call><function=write_file><parameter=path>a.txt</parameter>' +
    '<parameter=content>line one\nline two\nline three</parameter></function></tool_call>';

  const { calls } = parseTextToolCalls(text);
  assert.equal(calls[0].arguments.content, 'line one\nline two\nline three');
});

test('recovers several calls in one message', () => {
  const text =
    '<tool_call><function=list_files><parameter=path>src</parameter></function></tool_call>' +
    '<tool_call><function=read_file><parameter=path>src/demo.js</parameter></function></tool_call>';

  const { calls } = parseTextToolCalls(text);
  assert.deepEqual(
    calls.map((call) => call.name),
    ['list_files', 'read_file'],
  );
});

test('recovers a block whose closing tag never arrived', () => {
  const text = 'Here you go:\n<tool_call>\n<function=read_file>\n<parameter=path>made/by-rail.txt</parameter>';

  const { calls, text: cleaned } = parseTextToolCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'read_file');
  assert.equal(calls[0].arguments.path, 'made/by-rail.txt');
  assert.equal(cleaned, 'Here you go:');
});

test('accepts the JSON form inside the block', () => {
  const text =
    '<tool_call>{"name":"calculate","arguments":{"expression":"6*7"}}</tool_call>';

  const { calls } = parseTextToolCalls(text);
  assert.equal(calls[0].name, 'calculate');
  assert.equal(calls[0].arguments.expression, '6*7');
});

test('leaves ordinary prose alone', () => {
  const text = 'I would use write_file, but the tools are turned off. Nothing to run.';
  const { calls, text: cleaned } = parseTextToolCalls(text);
  assert.equal(calls.length, 0);
  assert.equal(cleaned, text);
});

test('a block with no function name is dropped, not guessed', () => {
  const { calls, text: cleaned } = parseTextToolCalls('<tool_call>just some words</tool_call>');
  assert.equal(calls.length, 0);
  assert.equal(cleaned, '');
});
