import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import {
  browserArgs,
  browserCandidates,
  browserEnv,
  captureScreenshot,
  findBrowser,
  pngSize,
  screenshotAllowed,
  screenshotViewport,
  SCREENSHOT_VIEWPORTS,
} from './screenshot.mjs';

// A 1×1 transparent PNG, enough to exercise the file/signature path.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('browserCandidates prefers the Windows Edge install and honors FREEWAY_BROWSER', () => {
  const candidates = browserCandidates({
    platform: 'win32',
    env: {
      FREEWAY_BROWSER: 'C:\\tools\\edge.exe',
      ProgramFiles: 'C:\\Program Files',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      PATH: 'C:\\Windows\\System32',
    },
    exists: () => true,
  });
  assert.equal(candidates[0], 'C:\\tools\\edge.exe');
  assert.ok(candidates.includes('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'));
  assert.ok(candidates.includes('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(candidates.includes('C:\\Windows\\System32\\msedge.exe'));
});

test('browserCandidates filters missing paths and exposes no browser gracefully', () => {
  assert.deepEqual(browserCandidates({ platform: 'linux', env: {}, exists: () => false }), []);
  assert.equal(findBrowser({ platform: 'linux', env: {}, exists: () => false }), null);
});

test('browserEnv drops provider secrets and preserves only browser basics', () => {
  const env = browserEnv({
    PATH: '/usr/bin',
    HOME: '/home/me',
    OPENROUTER_API_KEY: 'secret',
    FREEBUFF_API_KEY: 'secret',
    AWS_SECRET_ACCESS_KEY: 'secret',
    DISPLAY: ':0',
  });
  assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/home/me', DISPLAY: ':0' });
});

test('browserArgs is a bounded local headless capture', () => {
  const args = browserArgs({
    output: '/tmp/out.png',
    profile: '/tmp/profile',
    url: 'http://127.0.0.1:9999/preview',
  });
  assert.ok(args.includes('--headless=new'));
  assert.ok(args.includes('--disable-gpu'));
  assert.ok(args.includes('--window-size=800,600'));
  assert.ok(args.includes('--force-device-scale-factor=1'));
  assert.ok(args.includes('--screenshot=/tmp/out.png'));
  assert.equal(args.at(-1), 'http://127.0.0.1:9999/preview');
});

test('pngSize validates the signature and reads width and height', () => {
  assert.deepEqual(pngSize(PNG), { width: 1, height: 1 });
  assert.equal(pngSize(Buffer.from('not a png')), null);
  const corrupt = Buffer.from(PNG);
  corrupt.writeUInt32BE(0, 16);
  assert.equal(pngSize(corrupt), null);
});

test('captureScreenshot writes a data URL and removes its temp profile', async () => {
  const seen = {};
  const fakeSpawn = (program, args, options) => {
    seen.program = program;
    seen.args = args;
    seen.options = options;
    const output = args.find((arg) => arg.startsWith('--screenshot=')).slice('--screenshot='.length);
    fs.writeFileSync(output, PNG);
    const child = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => child.emit('close', 0, null));
    return child;
  };
  const shot = await captureScreenshot({
    url: 'http://127.0.0.1:4567/preview',
    browser: '/fake/edge',
    spawn: fakeSpawn,
    env: { PATH: '/usr/bin', OPENROUTER_API_KEY: 'secret' },
  });
  assert.equal(shot.width, 1);
  assert.equal(shot.height, 1);
  assert.match(shot.image, /^data:image\/png;base64,/);
  assert.equal(seen.program, '/fake/edge');
  assert.equal(seen.options.env.OPENROUTER_API_KEY, undefined);
  assert.equal(seen.options.env.PATH, '/usr/bin');
  assert.equal(seen.args.at(-1), 'http://127.0.0.1:4567/preview');
  const profile = seen.args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  assert.equal(fs.existsSync(profile), false);
});

test('captureScreenshot rejects non-local, missing-browser and oversized captures', async () => {
  await assert.rejects(
    () => captureScreenshot({ url: 'https://example.com/', browser: '/fake/edge' }),
    /limited to the local preview/,
  );
  await assert.rejects(
    () => captureScreenshot({ url: 'http://127.0.0.1:4567/', browser: null }),
    /No local Edge or Chrome/,
  );

  const fakeSpawn = (program, args) => {
    const output = args.find((arg) => arg.startsWith('--screenshot=')).slice('--screenshot='.length);
    fs.writeFileSync(output, PNG);
    const child = new EventEmitter();
    setImmediate(() => child.emit('close', 0, null));
    return child;
  };
  await assert.rejects(
    () =>
      captureScreenshot({
        url: 'http://127.0.0.1:4567/',
        browser: '/fake/edge',
        spawn: fakeSpawn,
        maxChars: 10,
      }),
    /too large/,
  );
});

test('screenshotAllowed requires every fallback model to see images', () => {
  const vision = { id: 'a', architecture: { input_modalities: ['text', 'image'] } };
  const textOnly = { id: 'b', architecture: { input_modalities: ['text'] } };
  const base = { providerId: 'openrouter', chain: ['a'], models: [vision] };

  assert.equal(screenshotAllowed(base), true);
  assert.equal(screenshotAllowed({ ...base, enabled: false }), false);
  assert.equal(screenshotAllowed({ ...base, mode: 'plan' }), false);
  assert.equal(screenshotAllowed({ ...base, toolsOffered: false }), false);
  assert.equal(screenshotAllowed({ ...base, toolsSupported: false }), false);
  assert.equal(screenshotAllowed({ ...base, workspaceReady: false }), false);
  assert.equal(screenshotAllowed({ ...base, providerId: 'groq' }), false);
  assert.equal(screenshotAllowed({ ...base, chain: [], models: [vision] }), false);
  assert.equal(screenshotAllowed({ ...base, chain: ['a', 'b'], models: [vision, textOnly] }), false);
  assert.equal(screenshotAllowed({ ...base, chain: ['a', 'missing'], models: [vision] }), false);
  assert.equal(screenshotAllowed({ ...base, models: [] }), false);
});

test('the single-file build includes the screenshot module', () => {
  const bundle = fs.readFileSync(new URL('../build/bundle.mjs', import.meta.url), 'utf8');
  assert.match(bundle, /lib\/screenshot\.mjs/, 'bundle.mjs would omit the screenshot implementation');
  assert.match(bundle, /\$\{screenshotMod\.code\}/, 'bundle output would omit the screenshot implementation');
});

test('screenshot viewports are fixed presets with a desktop fallback', () => {
  assert.deepEqual(SCREENSHOT_VIEWPORTS.mobile, { label: 'Mobile', width: 390, height: 844 });
  assert.deepEqual(screenshotViewport('tablet'), { label: 'Tablet', width: 768, height: 1024 });
  assert.deepEqual(screenshotViewport('nonsense'), SCREENSHOT_VIEWPORTS.desktop);
});

test('captureScreenshot rejects credentials in a local URL', async () => {
  await assert.rejects(
    captureScreenshot({ url: 'http://user:secret@127.0.0.1:9999/preview' }),
    /username or password/,
  );
});
