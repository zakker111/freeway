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

test('GitHub Pages guide link targets the README file', () => {
  assert.match(page, /href="https:\/\/github\.com\/zakker111\/freeway\/blob\/main\/README\.md"/);
  assert.doesNotMatch(page, /freeway#readme/);
});

test('the live Pages smoke check is wired into CI', () => {
  assert.ok(existsSync(new URL('../scripts/check-pages.mjs', import.meta.url)));
  const workflow = readFileSync(new URL('../.github/workflows/pages-smoke.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node scripts\/check-pages\.mjs/);
  assert.match(workflow, /PAGES_WAIT_SECONDS/);
});

test('CI launches the packaged Windows client on every push', () => {
  const tests = readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');
  const build = readFileSync(new URL('../.github/workflows/build-windows.yml', import.meta.url), 'utf8');
  // The Windows ZIP is a single binary and nothing on a pull request used to run
  // it, so a build that could not start reached a tag unnoticed. Both paths now
  // build and launch through the same two scripts.
  assert.match(tests, /runs-on: windows-latest/, 'no job builds the Windows client on a push');
  assert.match(tests, /scripts\/build-windows-client\.ps1/, 'the push job builds the client some other way');
  assert.match(tests, /scripts\/smoke-windows-client\.mjs/, 'the push job never launches the packaged client');
  assert.match(tests, /scripts\/pack-windows-client\.ps1/, 'the push job never assembles the ZIP');
  assert.match(tests, /start\.cmd/, 'the push job never runs the launcher from the unzipped ZIP');
  assert.match(tests, /windows-client-zip/, 'the ZIP the push job launches is not downloadable');
  // start.cmd's `node app.mjs` fallback only happens while no Freeway.exe exists,
  // so the step that covers it has to come before the one that builds the exe.
  const fallback = tests.indexOf('without Freeway.exe');
  const built = tests.indexOf('Build the Windows client\n');
  assert.ok(fallback > 0 && built > 0 && fallback < built, 'the node app.mjs fallback is never exercised with no exe present');
  // The third branch has no exe and no node, so it also belongs before the build.
  const noRuntime = tests.indexOf('no runtime at all');
  assert.ok(noRuntime > 0 && noRuntime < built, 'start.cmd is never tried with neither an exe nor node');
  assert.match(tests, /Neither Freeway/, 'the no-runtime step does not check what start.cmd says');
  assert.match(build, /scripts\/pack-windows-client\.ps1/, 'the release ZIP is assembled some other way');
  assert.match(build, /scripts\/build-windows-client\.ps1/, 'the release build is not the CI build');
  assert.match(build, /scripts\/smoke-windows-client\.mjs/, 'the release build does not run the CI smoke test');
});

test('publishing a release dispatches the verification workflow', () => {
  const build = readFileSync(new URL('../.github/workflows/build-windows.yml', import.meta.url), 'utf8');
  const verify = readFileSync(new URL('../.github/workflows/verify-release.yml', import.meta.url), 'utf8');

  // GITHUB_TOKEN does not start release:published runs, so the workflow needs a
  // dispatch entry point and the publish job needs permission to call it.
  assert.match(verify, /^  workflow_dispatch:/m, 'the verification workflow cannot be dispatched');
  assert.match(verify, /inputs:[\s\S]*?version:/, 'the dispatch takes no version');
  assert.match(build, /actions: write/, 'the publish job may not dispatch a workflow');
  assert.match(
    build,
    /gh workflow run verify-release\.yml[^\n]*--ref "\$TAG"[^\n]*-f version=/,
    'the publish job does not dispatch verification for its tag',
  );
  assert.match(build, /The Verify release workflow never started/, 'a missing verification run is not reported');
});
