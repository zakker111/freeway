import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_DEFINITIONS,
  parseArithmetic,
  isPublicUrl,
  htmlToText,
  currentTime,
  fetchAsText,
  runTool,
} from './tools.mjs';

test('tool definitions are valid function schemas', () => {
  assert.equal(TOOL_DEFINITIONS.length, 57);
  const names = TOOL_DEFINITIONS.map((tool) => tool.function.name);
  for (const expected of [
    'search_files',
    'find_files',
    'project_info',
    'git_history',
    'run_check',
    'read_many',
    'apply_patch',
    'run_tests',
    'scaffold_project',
    'preview_check',
    'preview_link',
    'screenshot_preview',
    'browser_open',
    'browser_snapshot',
    'browser_click',
    'browser_type',
    'browser_wait',
    'browser_console',
    'browser_network',
    'browser_screenshot',
    'browser_close',
    'git_status',
    'git_diff',
    'git_commit',
    'git_revert',
    'propose_plan',
    'update_plan_step',
    'start_process',
    'process_logs',
    'stop_process',
    'github_clone',
    'github_update_issue',
    'github_comment',
    'github_create_pull',
    'github_review_pull',
    'github_merge_pull',
    'github_actions',
    'github_create_release',
    'github_create_repo',
    'github_search',
    'github_pull',
    'github_push',
    'github_branch',
    'render_chart',
    'notify',
    'post_url',
    'list_chats',
    'read_chat',
  ]) {
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
    'http://[fec0::1]/',
    'http://[fec0:0:0:0:0:0:0:1]/',
    'http://[fd00::1]/',
    'http://[ff02::1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[2002:7f00:1::]/',
    'http://[2001::1]/',
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

test('fetchAsText checks every redirect hop before following it', async () => {
  const calls = [];
  const redirect = (to) => async (url) => {
    calls.push(String(url));
    return new Response(null, { status: 302, headers: { location: to } });
  };

  // A public address that points at loopback must stop at the hop check, not
  // make the second request.
  await assert.rejects(
    () => fetchAsText('http://1.1.1.1/', { fetchImpl: redirect('http://127.0.0.1/') }),
    /public http/i,
  );
  assert.deepEqual(calls, ['http://1.1.1.1/'], 'the loopback destination was fetched');

  calls.length = 0;
  await assert.rejects(
    () => fetchAsText('http://1.1.1.1/', { fetchImpl: redirect('http://169.254.169.254/latest/meta-data') }),
    /public http/i,
  );
  assert.deepEqual(calls, ['http://1.1.1.1/'], 'the link-local destination was fetched');

  // An initial private URL is refused before any request is made.
  calls.length = 0;
  await assert.rejects(
    () => fetchAsText('http://127.0.0.1/', { fetchImpl: redirect('https://example.com/') }),
    /public http/i,
  );
  assert.deepEqual(calls, []);

  // A redirect loop is bounded instead of running forever.
  let fetches = 0;
  await assert.rejects(
    () => fetchAsText('http://1.1.1.1/', {
      fetchImpl: async (url) => {
        fetches += 1;
        return new Response(null, { status: 302, headers: { location: String(url) } });
      },
    }),
    /redirected too many times/i,
  );
  assert.ok(fetches > 1 && fetches < 10, `unexpected hop count: ${fetches}`);
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

test('managed process tools report the port, logs and a stop', async () => {
  const record = {
    id: 'dev-1',
    program: 'node',
    args: ['server.mjs'],
    cwd: '',
    status: 'running',
    port: 5173,
    url: 'http://127.0.0.1:5173',
    ready: true,
    ms: 1200,
    exitCode: null,
    error: null,
  };
  const calls = [];
  const fake = {
    start: async (input) => {
      calls.push(['start', input]);
      return record;
    },
    logs: () => ({ process: record, text: 'listening on 5173', clipped: false, bytes: 20 }),
    stop: async (id) => {
      calls.push(['stop', id]);
      return [{ ...record, status: 'stopped' }];
    },
    list: () => [record],
  };

  const started = await runTool(
    'start_process',
    { program: 'node', args: ['server.mjs'] },
    { processes: fake },
  );
  assert.equal(started.ok, true);
  assert.match(started.content, /dev-1/);
  assert.match(started.content, /http:\/\/127\.0\.0\.1:5173/);
  assert.equal(started.process.port, 5173);

  const read = await runTool('process_logs', {}, { processes: fake });
  assert.equal(read.ok, true);
  assert.match(read.content, /listening on 5173/);

  const stopped = await runTool('stop_process', { id: 'dev-1' }, { processes: fake });
  assert.equal(stopped.ok, true);
  assert.match(stopped.content, /stopped/);
  assert.deepEqual(calls[1], ['stop', 'dev-1']);

  const missing = await runTool('start_process', { program: 'node' }, {});
  assert.equal(missing.ok, false);
  assert.match(missing.content, /desktop app/);
});

test('preview_link hands the model the URL the app opens', async () => {
  let asked = '';
  const result = await runTool(
    'preview_link',
    { entry: 'site/index.html' },
    {
      workspace: { isReady: true },
      previewLink: (entry) => {
        asked = entry;
        return {
          ok: true,
          entry,
          url: 'http://127.0.0.1:4567/__freeway_preview__/abc/site/index.html',
          content: 'Preview link for /site/index.html:\nhttp://127.0.0.1:4567/__freeway_preview__/abc/site/index.html',
        };
      },
    },
  );
  assert.equal(asked, 'site/index.html');
  assert.equal(result.ok, true);
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+\//);
  assert.match(result.content, /Preview link/);

  const missing = await runTool('preview_link', {}, { workspace: { isReady: true } });
  assert.equal(missing.ok, false);
  assert.match(missing.content, /desktop app/);
});

test('screenshot_preview runs preview_check before asking for a capture', async () => {
  const calls = [];
  const workspace = {
    isReady: true,
    read(file) {
      assert.equal(file, 'index.html');
      return { path: file, content: '<!doctype html><html><body>Hello</body></html>' };
    },
  };
  const result = await runTool(
    'screenshot_preview',
    {},
    {
      workspace,
      screenshot: async (input) => {
        calls.push(input);
        return {
          ok: true,
          content: 'Captured /index.html.',
          image: 'data:image/png;base64,AAAA',
          width: 800,
          height: 600,
          entry: input.entry,
        };
      },
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ entry: 'index.html' }]);
  assert.match(result.content, /Static check first/);
  assert.match(result.content, /Preview check passed/);
  assert.equal(result.image, 'data:image/png;base64,AAAA');
});

test('screenshot_preview does not take a picture of a broken preview', async () => {
  let captured = false;
  const result = await runTool(
    'screenshot_preview',
    {},
    {
      workspace: {
        isReady: true,
        read() {
          throw new Error('missing');
        },
      },
      screenshot: async () => {
        captured = true;
      },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(captured, false);
  assert.match(result.content, /No screenshot was taken/);
});
