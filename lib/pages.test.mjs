// Guards the two single-page apps against a bug class that already shipped once:
// a second `function togglePin(...)` silently replaced the first, so the chat pin
// button called the model-pin code. Browsers report nothing; the wrong feature
// just runs. These checks are cheap and catch it before a release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGES = ['public/index.html', 'cloud/public/index.html'];

function load(page) {
  return readFileSync(new URL('../' + page, import.meta.url), 'utf8');
}

function definedFunctions(html) {
  // The shared preview core is one IIFE loaded on purpose; its private helpers
  // are not top-level page declarations and must not be counted as collisions.
  const own = html.replace(/<script id="preview-core">[\s\S]*?<\/script>/g, '');
  const names = [];
  for (const match of own.matchAll(/(?:^|\s)function\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.push(match[1]);
  return names;
}

for (const page of PAGES) {
  test(page + ': no duplicate top-level function names', () => {
    const seen = new Map();
    for (const name of definedFunctions(load(page))) seen.set(name, (seen.get(name) || 0) + 1);
    const duplicates = [...seen].filter(([, count]) => count > 1).map(([name]) => name);
    assert.deepEqual(duplicates, [], 'declared more than once, the later one silently wins');
  });

  test(page + ': every $("id") resolves to a real element', () => {
    const html = load(page);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    const refs = new Set([...html.matchAll(/\$\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]));
    const missing = [...refs].filter((id) => !ids.has(id)).sort();
    assert.deepEqual(missing, []);
  });

  test(page + ': the palette can rename and delete the current chat', () => {
    const html = load(page);
    for (const label of ['Rename this chat…', 'Delete this chat…']) {
      // A label in a comment is not a command: it has to be a palette row.
      assert.match(html, new RegExp('label: ["\']' + label + '["\']'), 'not a palette row: ' + label);
    }
  });

  test(page + ': a renamed chat keeps its name', () => {
    const html = load(page);
    // desktop: state.customTitle; cloud: titleOverride keyed to the chat id.
    assert.match(html, /customTitle|titleOverride/, 'no title override, so a rename would be overwritten');
    assert.match(html, /derivedTitle|const derived =/, 'no derived-title fallback for unnamed chats');
  });

  test(page + ': chats live in a panel docked on the left', () => {
    const html = load(page);
    for (const id of [
      'sidebar',
      'sideBtn',
      'sideClose',
      'sideNew',
      'threadList',
      'threadSearch',
      'threadCount',
      'sideBackdrop',
    ]) {
      assert.match(html, new RegExp('id="' + id + '"'), 'missing #' + id);
    }
    // Pinned to the left edge, with the app column beside it — not on the right.
    assert.match(html, /inset:\s*0 auto 0 0/, 'the drawer is not anchored to the left edge');
    assert.ok(
      html.indexOf('id="sidebar"') < html.indexOf('class="brand"'),
      'the chats panel must come before the app column',
    );
  });

  test(page + ': chat and model pins use separate storage keys', () => {
    const html = load(page);
    const chatPinKey = /const PINNED_KEY = '([^']+)'/.exec(html);
    const modelPinKey = /const PINS_KEY = '([^']+)'/.exec(html);
    if (!chatPinKey || !modelPinKey) return; // page without pins
    assert.notEqual(chatPinKey[1], modelPinKey[1], 'pinning a chat would clobber pinned models');
  });
}

test('the cloud tools setting gates the tool loop and both settings explain it', () => {
  const cloud = load('cloud/public/index.html');
  assert.match(
    cloud,
    /readSettings\(\)\.tools \? toolSend\(images\) : streamSend\(images\)/,
    'the cloud page can enter the tool loop with the setting off',
  );
  const toolSend = functionSource(cloud, 'toolSend');
  assert.match(toolSend, /tools: WORKSPACE_TOOLS/, 'the tool loop does not send workspace tools');
  assert.match(cloud, /When on, the model is told to use these tools/, 'cloud settings do not explain the tool prompt');
  const desktop = load('public/index.html');
  assert.match(
    desktop,
    /When this is on, the model is told to use the tools instead of guessing/,
    'desktop settings do not explain the tool prompt',
  );
});

test('an HTML write opens the preview without another prompt', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /function previewWorkspaceFile/, 'desktop has no workspace preview helper');
  assert.match(desktop, /previewWorkspaceFile\(event\.path\)/, 'desktop ignores the written file path');
  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /function previewSavedHtml/, 'cloud has no saved-file preview helper');
  assert.match(cloud, /await previewSavedHtml\(previewName, previewBody\)/, 'cloud upload does not preview HTML');
});

test('both editions use one shared preview core and the same error card', () => {
  for (const page of PAGES) {
    const html = load(page);
    assert.match(html, /<script id="preview-core">/, page + ' has no shared preview core');
    assert.match(html, /FreewayPreview\.bundleStatic/, page + ' does not bundle linked assets');
    assert.match(html, /FreewayPreview\.renderError/, page + ' does not render preview errors');
    assert.match(html, /FreewayPreview\.renderMarkdown/, page + ' does not preview Markdown');
    assert.match(html, /id="(?:pv|preview)Error"/, page + ' has no preview error host');
    assert.doesNotMatch(html, /external files are not loaded/, page + ' still claims linked files are never loaded');
  }
});

test('both editions collect preview runtime problems through the shared bridge', () => {
  for (const page of PAGES) {
    const html = load(page);
    const problems = page.startsWith('cloud/') ? 'previewProblems' : 'pvProblems';
    const title = page.startsWith('cloud/') ? 'previewProblemsTitle' : 'pvProblemsTitle';
    const show = page.startsWith('cloud/') ? 'showPreview' : 'showLocalPreview';
    assert.match(html, new RegExp('id="' + problems + '"'), page + ' has no preview problem host');
    assert.match(html, new RegExp('id="' + title + '"'), page + ' has no preview problem title');
    assert.match(html, /FreewayPreview\.createPreviewMonitor/, page + ' has no shared diagnostics monitor');
    assert.match(html, /FreewayPreview\.withPreviewBridge/, page + ' does not attach the preview bridge');
    assert.match(html, /<script type="application\/json" id="preview-bridge">/, page + ' has no bridge source');
    assert.match(functionSource(html, show), /withPreviewBridge/, page + ' preview path does not use the bridge');
  }
});

test('both editions send build-required source to the adapter card', () => {
  for (const page of PAGES) {
    const html = load(page);
    assert.match(html, /packageJson/, page + ' does not pass project metadata to the preview core');
    assert.match(html, /\.\(ts\|tsx\|jsx\|scss\|sass\|less/, page + ' does not identify build source files');
  }
});

test('both editions hide the preview frame when a build is required', () => {
  for (const page of PAGES) {
    const html = load(page);
    const frameId = page.startsWith('cloud/') ? 'previewFrame' : 'pvFrame';
    const restore = page.startsWith('cloud/') ? 'showPreview' : 'showLocalPreview';
    assert.match(
      html,
      new RegExp(`<iframe id="${frameId}"[^>]*style="[^"]*display:\\s*none`),
      page + ' shows an empty white frame before a preview exists',
    );
    assert.match(
      functionSource(html, 'showPreviewFailure'),
      /style\.display\s*=\s*['"]none['"]/,
      page + ' leaves the frame visible under a BUILD_REQUIRED card',
    );
    assert.match(
      functionSource(html, restore),
      /style\.display\s*=\s*(['"]{2}|['"]block['"])/,
      page + ' does not reveal the frame when a preview succeeds',
    );
  }
});

test('the inlined preview core stays inside its own script', () => {
  for (const page of PAGES) {
    const html = load(page);
    const start = html.indexOf('<script id="preview-core">');
    const end = html.indexOf('</script>', start);
    const firstHeadMeta = html.indexOf('<meta charset="utf-8" />', start);
    assert.ok(start >= 0 && end > start, page + ' has no bounded preview core');
    assert.ok(firstHeadMeta > end, page + ' preview core swallowed the document head');
    assert.ok(end - start < 80_000, page + ' preview core contains more than the shared file');
  }
});

test('cloud: chats are the left panel, not a dialog', () => {
  const html = load('cloud/public/index.html');
  assert.equal(html.includes('historyDialog'), false, 'the old chats dialog is back');
  assert.match(html, /\$\('threadList'\)/, 'the cloud panel is not fed by renderHistory');
});

test('both editions offer a first run without a key', () => {
  for (const page of PAGES) {
    const html = load(page);
    // A key wall on the first screen is the fastest way to lose a visitor.
    assert.match(html, /id="keyTry"/, page + ' has no keyless first-run button');
    assert.match(html, /anonymous/, page + ' cannot find its keyless provider');
    assert.doesNotMatch(html, /Try it now — no key/, page + ' still has the vague keyless label');
    assert.match(html, /OVHcloud instead — no key/, page + ' does not name the provider the button switches to');
    assert.match(html, /Cancel keeps/, page + ' does not explain that Cancel keeps the chosen provider');
  }
  assert.match(load('public/index.html'), /provider: free\.id/, 'desktop does not select the keyless provider');
  assert.match(load('cloud/public/index.html'), /applyProvider\(free\.id\)/, 'cloud does not select the keyless provider');
});

test('cloud files upload, preview in a sandbox and sync to an account', () => {
  const html = load('cloud/public/index.html');
  for (const id of [
    'fileUpload',
    'fileDownload',
    'filePreview',
    'accountUpload',
    'accountRefresh',
    'accountSave',
    'accountFileList',
    'previewNote',
    'previewOpen',
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing #' + id);
  }
  // The workspace moved off the 5 MB localStorage string.
  assert.match(html, /indexedDB\.open\('freeway-files'/, 'browser files are not using IndexedDB');
  assert.match(html, /srcdoc/, 'HTML preview has no srcdoc path');
  assert.match(html, /\/api\/files/, 'account files do not call the file API');
  assert.doesNotMatch(html, /sandbox="[^"]*allow-same-origin/, 'an uploaded page would share this origin');
});

test('both editions collect Cloudflare account ids beside the token', () => {
  for (const page of PAGES) {
    const html = load(page);
    for (const id of ['keyAccountField', 'keyAccount', 'keyAccountHelp']) {
      assert.match(html, new RegExp('id="' + id + '"'), page + ' missing #' + id);
    }
  }
  assert.match(load('cloud/public/index.html'), /x-provider-account/, 'cloud does not send the account id');
  assert.match(load('public/index.html'), /value, account/, 'desktop does not send the account id');
});

test('both editions keep the rail tab strip on one line', () => {
  for (const page of PAGES) {
    const html = load(page);
    assert.match(
      html,
      /\.rail-head\s*\{[^}]*flex-wrap:\s*nowrap/,
      page + ' still lets the Health tab wrap onto its own row',
    );
    assert.match(html, /\.rail-tab\s*\{[^}]*min-width:\s*0/, page + ' cannot shrink the rail tabs');
  }
});

function functionSource(html, name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) return '';
  let depth = 0;
  let opened = false;
  for (let i = start; i < html.length; i += 1) {
    if (html[i] === '{') {
      depth += 1;
      opened = true;
    } else if (html[i] === '}' && opened) {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return '';
}

test('cloud file rows and chat saves do not reference desktop chat pins', () => {
  const html = load('cloud/public/index.html');
  for (const name of ['renderFiles', 'saveThread']) {
    const body = functionSource(html, name);
    assert.ok(body, 'could not isolate ' + name + '()');
    assert.doesNotMatch(
      body,
      /\bpins\b|\btogglePin\b/,
      name + ' must not call desktop chat-pin code',
    );
  }
});

test('both editions offer a sample page and safe local preview', () => {
  const desktop = load('public/index.html');
  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /id="fileSample"/, 'cloud has no sample action');
  assert.match(cloud, /function loadSamplePage\(/, 'cloud sample action has no handler');
  assert.match(desktop, /id="fsSample"/, 'desktop has no sample action');
  assert.match(desktop, /id="fsPreview"/, 'desktop has no local preview action');    assert.match(desktop, /PV_LOCAL_SANDBOX = "allow-scripts allow-forms allow-popups"/, 'local preview has too much sandbox access');
    assert.match(desktop, /frame\.srcdoc = FreewayPreview\.withPreviewBridge\(String\(html\), previewBridgeSource\(\)\)/, 'desktop preview does not use the bridged srcdoc path');
    assert.match(desktop, /\/api\/preview\/serve/, 'desktop has no local preview server route');
    assert.match(desktop, /PV_SERVER_SANDBOX = "allow-scripts allow-same-origin/, 'served previews cannot use modules');
    assert.match(desktop, /function showServedPreview/, 'desktop cannot display a served preview');
    assert.match(desktop, /Static preview \(/, 'desktop has no static fallback explanation');
  });

test('cloud service worker fetches the shell before using its cache', () => {
  const sw = readFileSync(new URL('../cloud/public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /request\.mode === 'navigate'/, 'service worker does not detect navigations');
  assert.match(sw, /const fresh = await fetch\(request\)/, 'service worker is still cache-first for the shell');
  assert.match(sw, /cache\.match\('\/'\)/, 'service worker has no offline fallback');
});

test('both editions expose one image attachment with a vision-aware send path', () => {
  for (const page of PAGES) {
    const html = load(page);
    for (const id of ['imageFile', 'imageBar', 'imageThumb', 'imageRemove']) {
      assert.match(html, new RegExp('id="' + id + '"'), page + ' missing #' + id);
    }
    assert.match(html, /accept="image\/png,image\/jpeg,image\/webp"/, page + ' accepts the wrong image types');
    assert.match(html, /toDataURL\(["']image\/jpeg/, page + ' does not compress before sending');
    assert.match(html, /recentImages\(/, page + ' resends every image');
    assert.match(html, /vision/, page + ' does not know which models can see');
  }
});
