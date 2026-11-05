import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_DEFINITIONS,
  parseArithmetic,
  isPublicUrl,
  htmlToText,
  currentTime,
  runTool,
} from './tools.mjs';

test('tool definitions are valid function schemas', () => {
  assert.equal(TOOL_DEFINITIONS.length, 13);
  const names = TOOL_DEFINITIONS.map((tool) => tool.function.name);
  for (const expected of ['search_files', 'read_many', 'apply_patch', 'run_tests']) {
    assert.ok(names.includes(expected), `${expected} is missing from the tool list`);
  }
  for (const tool of TOOL_DEFINITIONS) {
    assert.equal(tool.type, 'function');
    assert.match(tool.function.name, /^[a-z_]+$/);
    assert.ok(tool.function.description.length > 20);
    assert.equal(tool.function.parameters.type, 'object');
  }
});

test('arithmetic respects precedence and parentheses', () => {
  assert.equal(parseArithmetic('2 + 3 * 4'), 14);
  assert.equal(parseArithmetic('(2 + 3) * 4'), 20);
  assert.equal(parseArithmetic('2 ^ 3 ^ 2'), 512);
  assert.equal(parseArithmetic('-5 + 2'), -3);
  assert.equal(parseArithmetic('10 % 3'), 1);
  assert.equal(parseArithmetic('0.1 + 0.2').toFixed(2), '0.30');
});

test('arithmetic rejects code and bad input', () => {
  assert.throws(() => parseArithmetic('process.exit(1)'), /Only numbers/);
  assert.throws(() => parseArithmetic('1/0'), /Division by zero/);
  assert.throws(() => parseArithmetic('(1 + 2'), /Missing closing/);
  assert.throws(() => parseArithmetic(''), /Empty expression/);
  assert.throws(() => parseArithmetic('x'.repeat(300)), /too long/);
});

test('isPublicUrl blocks local and private destinations', () => {
  assert.equal(isPublicUrl('https://openrouter.ai/docs'), true);
  assert.equal(isPublicUrl('http://example.com'), true);
  for (const blocked of [
    'http://localhost:3002',
    'http://127.0.0.1/',
    'http://10.1.2.3/',
    'http://192.168.0.1/',
    'http://172.16.5.4/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:192.168.0.1]/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    'http://[ff02::1]/',
    'http://localhost./',
    'http://router.internal/',
    'ftp://example.com',
    'not a url',
  ]) {
    assert.equal(isPublicUrl(blocked), false, blocked);
  }
  assert.equal(isPublicUrl('http://[2606:4700:4700::1111]/'), true);
});

test('htmlToText strips scripts, styles and tags', () => {
  const html = '<html><head><style>body{color:red}</style></head><body><h1>Hi</h1><script>alert(1)</script><p>A &amp; B</p></body></html>';
  const text = htmlToText(html);
  assert.equal(text.includes('alert'), false);
  assert.equal(text.includes('color:red'), false);
  assert.match(text, /Hi/);
  assert.match(text, /A & B/);
});

test('currentTime formats a known zone without repeating it', () => {
  const utc = currentTime('UTC');
  assert.match(utc, /UTC/);
  assert.match(utc, /ISO: \d{4}-\d{2}-\d{2}T/);
  assert.equal(utc.includes('UTC (UTC)'), false, 'the zone should not be printed twice');
  assert.throws(() => currentTime('Mars/Olympus'), /Unknown timezone/);
});

test('runTool reports failures instead of throwing', async () => {
  const unknown = await runTool('does_not_exist', {});
  assert.equal(unknown.ok, false);
  assert.match(unknown.content, /Unknown tool/);

  const blocked = await runTool('fetch_url', { url: 'http://127.0.0.1/' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.content, /public http/);

  const math = await runTool('calculate', { expression: '6 * 7' });
  assert.equal(math.ok, true);
  assert.match(math.content, /42/);

  const time = await runTool('get_current_time', {});
  assert.equal(time.ok, true);
  assert.match(time.content, /ISO:/);
});
