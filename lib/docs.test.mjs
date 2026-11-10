import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../docs/', import.meta.url);
const page = readFileSync(new URL('index.html', root), 'utf8');

test('GitHub Pages landing page has the maintained public links', () => {
  assert.match(page, /<title>Freeway — free models, real tools<\/title>/);
  for (const url of [
    'https://site-c1cb742a18434d968b0e1d32eb992bac.freebuff.page',
    'https://site-ce5b40f2d20a48ed87e869eb5f70e832.freebuff.page',
    'https://github.com/zakker111/freeway',
    'https://github.com/zakker111/freeway/releases/latest',
  ]) {
    assert.ok(page.includes(url), 'landing page is missing ' + url);
  }
  assert.match(page, /src="\.\/icon\.svg"/, 'landing page does not use the local Chatty icon');
  assert.ok(existsSync(new URL('icon.svg', root)), 'landing page icon is missing');
  assert.ok(existsSync(new URL('.nojekyll', root)), '.nojekyll is missing');
});

test('GitHub Pages landing page is static and self-contained', () => {
  assert.doesNotMatch(page, /<script\b|on(?:click|load|error)=/i, 'landing page unexpectedly executes scripts');
  assert.doesNotMatch(page, /(?:src|href)="https?:\/\/[^"]+\.(?:js|css)"/i, 'landing page depends on an external asset');
  assert.match(page, /<meta name="viewport"/, 'landing page has no mobile viewport');
  assert.match(page, /@media \(max-width: 620px\)/, 'landing page has no phone layout');
  assert.match(page, /@media \(prefers-reduced-motion: reduce\)/, 'landing page ignores reduced motion');
});
