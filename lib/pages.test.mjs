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

  test(page + ': element ids are unique', () => {
    const ids = [...load(page).matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    const duplicates = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
    assert.deepEqual(duplicates, [], 'duplicate element ids make getElementById ambiguous');
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
    assert.match(
      html,
      /id="sideBtn"[^>]*>☰\s*<span class="chats-label">Chats<\/span>/,
      'the saved-chats control is still an unlabeled icon',
    );
    // Pinned to the left edge, with the app column beside it — not on the right.
    assert.match(html, /inset:\s*0 auto 0 0/, 'the drawer is not anchored to the left edge');
    assert.ok(
      html.indexOf('id="sidebar"') < html.indexOf('class="brand"'),
      'the chats panel must come before the app column',
    );
  });

  test(page + ': an empty chats panel offers a new chat', () => {
    const html = load(page);
    assert.match(html, /thread-empty-new/, 'the empty chats panel has no new-chat action');
    assert.match(html, /Start a new chat/, 'the empty chats panel action has no label');
    assert.match(
      html,
      /if \(!query\) \{[\s\S]{0,260}?Start a new chat/,
      'a search with no matches shows the new-chat action',
    );
    if (page.startsWith('cloud/')) {
      assert.match(
        html,
        /start\.onclick = \(\) => \{[\s\S]{0,120}?startNewChat\(\);[\s\S]{0,80}?closeSidebar\(true\);/,
        'the empty cloud action does not start and dismiss a new chat',
      );
    } else {
      assert.match(
        html,
        /start\.addEventListener\("click", resetThread\)/,
        'the empty desktop action does not start a new chat',
      );
    }
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

test('cloud writes can bypass Confirm only after an explicit opt-in', () => {
  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /id="settingAutoApprove"/, 'cloud has no browser-write bypass switch');
  assert.match(
    cloud,
    /title="Bypass the Confirm card for write_file only[^"]*destructive actions still ask\./,
    'the browser-write bypass does not state its scope',
  );
  assert.match(
    cloud,
    /settingAutoApproveHelp[^>]*>[^<]*Off by default[^<]*write_file[^<]*Deleting files[^<]*still ask/,
    'the browser-write bypass help does not state the remaining confirmations',
  );
  assert.match(
    functionSource(cloud, 'readSettings'),
    /autoApproveWrites: raw\.autoApproveWrites === true/,
    'the browser-write bypass is not off by default',
  );
  const toolSend = functionSource(cloud, 'toolSend');
  assert.match(
    toolSend,
    /name === 'write_file'[\s\S]{0,120}?settings\.autoApproveWrites/,
    'the tool loop ignores the browser-write bypass',
  );
  assert.match(
    toolSend,
    /autoApprovedWrites[\s\S]{0,120}?auto-approved/,
    'the footer does not mark auto-approved writes',
  );
  assert.match(
    cloud,
    /autoApproveWrites: \$\('settingAutoApprove'\)\.checked/,
    'saving Settings drops the browser-write bypass',
  );
  assert.match(
    cloud,
    /\$\('settingAutoApprove'\)\.checked = settings\.autoApproveWrites === true/,
    'the settings modal does not load the saved browser-write bypass',
  );
});

test('desktop auto-approve is opt-in, labelled and persisted', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /id="sAutoApprove"/, 'desktop has no auto-approve switch');
  assert.match(
    desktop,
    /id="sAutoApprove"[^>]*title="[^"]*Allow \/ Deny card[^"]*"/,
    'the auto-approve switch has no tooltip',
  );
  assert.match(
    desktop,
    /sAutoApproveHelp[^>]*>[^<]*Off by default[^<]*workspace folder and program allowlist[^<]*/,
    'the auto-approve help does not state the remaining limits',
  );
  assert.match(desktop, /autoApprove: \$\("sAutoApprove"\)\.checked/, 'saving Settings drops auto-approve');
  assert.match(
    desktop,
    /state\.settings\.autoApprove === true/,
    'the settings modal does not load the saved auto-approve choice',
  );
  assert.match(
    desktop,
    /This is a global setting: it applies to every Build workspace until you turn it off/,
    'the auto-approve help does not say that the setting is global',
  );
  assert.match(desktop, /event\.type === "auto_approve"/, 'the transcript never marks an auto-approved action');
  assert.match(
    desktop,
    /event\.type === "auto_approve"[\s\S]{0,160}?log\.push\(/,
    'the auto-approved mark is not kept in the saved transcript',
  );
});

test('desktop screenshot verification is default-on, switchable and displayed', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /id="sScreenshot"/, 'desktop has no screenshot switch');
  assert.match(desktop, /screenshotChecks: true/, 'screenshot verification is not on by default');
  assert.match(
    desktop,
    /screenshotChecks: \$\("sScreenshot"\)\.checked/,
    'saving Settings drops the screenshot choice',
  );
  assert.match(desktop, /event\.screenshot/, 'the transcript ignores the captured image');
  assert.match(desktop, /className = "tool-shot"/, 'no inline screenshot style hook');
  assert.doesNotMatch(load('cloud/public/index.html'), /screenshot_preview|sScreenshot/);
});

test('desktop preview rediscovers a generated page after a reload', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /function findPreviewEntry/, 'desktop has no workspace entry discovery');
  assert.match(desktop, /\/api\/fs\/preview-entry/, 'desktop does not ask for the best entry');
  assert.match(functionSource(desktop, 'openPreview'), /findPreviewEntry|preview-entry/, 'Preview does not discover an entry');
  assert.match(functionSource(desktop, 'quickPreview'), /await openPreview\(\)/, 'the header button bypasses discovery');
  assert.match(functionSource(desktop, 'showLocalPreview'), /in memory/, 'the in-memory sample is treated as a real file entry');
});

test('desktop preview falls through a stale remembered entry', () => {
  const desktop = load('public/index.html');
  const open = functionSource(desktop, 'openPreview');
  assert.match(open, /for \(const entry of candidates\)/, 'Preview never tries the remembered or discovered entries');
  assert.match(open, /findPreviewEntry/, 'Preview does not rescan after a failed entry');
  assert.match(open, /if \(attempted\) return true/, 'a failed entry is replaced by the sample');
  assert.match(open, /previewEntry = ""/, 'a stale entry is not cleared');
  assert.match(functionSource(desktop, 'previewWorkspaceFile'), /return false/, 'preview failures are not reported');
});

test('both editions hand the model a preview link and let the user copy it', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /id="pvCopy"/, 'desktop has no copy-link control');
  assert.match(
    functionSource(desktop, 'copyPreviewLink'),
    /navigator\.clipboard\.writeText/,
    'desktop does not copy the preview link',
  );
  assert.match(desktop, /event\.previewUrl/, 'desktop ignores the link a tool returned');

  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /name: 'preview_link'/, 'cloud does not offer preview_link');
  assert.match(
    functionSource(cloud, 'previewLinkFor'),
    /#preview=/,
    'cloud preview links do not name the file',
  );
  assert.match(
    functionSource(cloud, 'openPreviewFromHash'),
    /previewSavedHtml/,
    'cloud does not reopen a preview link',
  );
  assert.match(
    functionSource(cloud, 'openPreviewFromHash'),
    /switchRail\('preview'\)/,
    'a cloud preview deep link can fail without opening the panel',
  );
  assert.match(
    functionSource(cloud, 'showMissingPreview'),
    /not saved in this browser/,
    'a missing cloud preview file has no explanation',
  );
  assert.match(cloud, /id="previewCopy"/, 'cloud has no copy-link control');
  assert.match(
    functionSource(cloud, 'runTool'),
    /Preview link:/,
    'cloud writes never return a preview link',
  );
});

test('cloud preview links are labelled and a missing file offers a way forward', () => {
  const cloud = load('cloud/public/index.html');
  for (const id of [
    'previewLinkScope',
    'previewSignIn',
    'previewMissing',
    'previewMissingFiles',
    'previewMissingSample',
  ]) {
    assert.match(cloud, new RegExp('id="' + id + '"'), 'missing #' + id);
  }
  const set = functionSource(cloud, 'setPreviewLink');
  assert.match(set, /Browser-only link/, 'a browser link is not labelled');
  assert.match(set, /Portable link/, 'an account link is not labelled');
  assert.match(set, /previewSignIn/, 'no sign-in path for a portable link');
  const missing = functionSource(cloud, 'showMissingPreview');
  assert.match(missing, /previewMissingSample/, 'a missing sample cannot be saved');
  assert.match(missing, /previewMissing'\)\.hidden = false/, 'missing-file actions stay hidden');
  assert.match(functionSource(cloud, 'openPreviewFromHash'), /showMissingPreview/, 'the missing state is bypassed');
});

test('the fixed file rail never covers the header actions', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /inset: var\(--header-h/, 'the fixed rail starts at the viewport top');
  assert.match(functionSource(desktop, 'railOpen'), /syncHeaderHeight/, 'opening the rail does not measure the header');
  assert.match(functionSource(desktop, 'syncHeaderHeight'), /offsetHeight/, 'the header height is not read');
  assert.match(desktop, /new ResizeObserver\(syncHeaderHeight\)/, 'a late header wrap is not tracked');
});

test('file and secret lists scroll independently on a short screen', () => {
  for (const page of PAGES) {
    const html = load(page);
    assert.match(
      html,
      /\.rail-body\s*\{[\s\S]{0,240}?overflow-y:\s*auto/,
      page + ' has no scrolling rail body',
    );
    assert.match(
      html,
      /\.rail-body\s*\{[\s\S]{0,280}?overscroll-behavior:\s*contain/,
      page + ' lets the rail scroll the whole page when it reaches the end',
    );
    assert.match(html, /@media \(max-height:\s*640px\)/, page + ' has no short-screen rail rule');
    if (page.startsWith('cloud/')) {
      assert.match(
        html,
        /#fileList,\s*#accountFileList,\s*#secretList\s*\{[^}]*max-height:\s*min\(34vh,\s*300px\)/,
        page + ' lets a long file or secret list push the editor away',
      );
      assert.match(
        html,
        /#fileList,\s*#accountFileList,\s*#secretList\s*\{[^}]*overflow-y:\s*auto/,
        page + ' has no scrollable file or secret list',
      );
      assert.match(
        html,
        /#fileList,\s*#accountFileList,\s*#secretList\s*\{[^}]*flex:\s*0\s+0\s+auto/,
        page + ' lets the panel squeeze the list to an unusable height',
      );
    } else {
      assert.match(
        html,
        /\.fs-list\s*\{[^}]*max-height:\s*min\(34vh,\s*300px\)/,
        page + ' lets a long file or secret list push the editor away',
      );
      assert.match(
        html,
        /\.fs-list\s*\{[^}]*overflow-y:\s*auto/,
        page + ' has no scrollable file or secret list',
      );
      assert.match(
        html,
        /\.fs-list\s*\{[^}]*flex:\s*0\s+0\s+auto/,
        page + ' lets the panel squeeze the list to an unusable height',
      );
      assert.match(
        html,
        /@media \(max-height:\s*640px\)[\s\S]{0,500}?\.fs-editor\s*\{[^}]*min-height:\s*170px/,
        page + ' shrinks the editor below its textarea on a short screen',
      );
      assert.match(
        functionSource(html, 'revealFileEditor'),
        /scrollIntoView/,
        page + ' opens a file below the fold without revealing it',
      );
      assert.match(
        functionSource(html, 'openFile'),
        /revealFileEditor\(\)/,
        page + ' does not reveal the editor when a file is selected',
      );
      assert.match(
        functionSource(html, 'loadEditorFile'),
        /revealFileEditor\(\{\s*focus:\s*false\s*\}\)/,
        page + ' steals focus while preparing a preview',
      );
    }
  }
});

test('the cloud rail also starts below its header', () => {
  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /top: var\(--header-h/, 'the cloud rail starts at the viewport top');
  assert.match(functionSource(cloud, 'switchRail'), /syncHeaderHeight/, 'opening the cloud rail does not measure the header');
  assert.match(functionSource(cloud, 'syncHeaderHeight'), /offsetHeight/, 'the cloud header height is not read');
  assert.match(cloud, /new ResizeObserver\(syncHeaderHeight\)/, 'a late cloud header wrap is not tracked');
});

test('both editions keep the composer usable on narrow screens', () => {
  for (const page of PAGES) {
    const html = load(page);
    const start = html.indexOf('@media (max-width: 700px)');
    assert.ok(start >= 0, page + ' has no narrow-screen composer rule');
    const block = html.slice(start, start + 450);
    assert.match(block, /\.composer \{ flex-wrap: wrap; \}/, page + ' keeps the composer on one row');
    assert.match(block, /\.composer #input \{ flex: 1 0 100%; \}/, page + ' squeezes the message box beside the controls');
    assert.match(block, /\.composer \.primary \{ margin-left: auto; min-height: 46px; \}/, page + ' leaves Send stranded at the left');
  }
});

test('both editions scale the reading column from phone to laptop', () => {
  for (const page of PAGES) {
    const html = load(page);
    for (const snippet of [
      '--content: 860px;',
      '@media (min-width: 1200px) { :root { --content: 1040px; } }',
      'max-width: var(--content);',
      'font-size: clamp(15px, 0.25vw + 14.2px, 16.8px)',
      'body { font-size: 16px; }',
      '.composer .primary { margin-left: auto; min-height: 46px; }',
    ]) {
      assert.ok(html.includes(snippet), page + ' is missing: ' + snippet);
    }
    assert.doesNotMatch(html, /max-width: 860px/, page + ' still has a hard-coded content width');
  }
});

test('cloud preview reopens a saved page before the sample', () => {
  const cloud = load('cloud/public/index.html');
  assert.match(cloud, /function findSavedPreview/, 'cloud has no saved-page discovery');
  const quick = functionSource(cloud, 'quickPreview');
  assert.match(quick, /findSavedPreview\(\)/, 'cloud Preview ignores saved pages');
  assert.match(quick, /previewSavedHtml\(entry\)/, 'cloud does not reopen the discovered page');
  assert.ok(
    quick.indexOf('previewSavedHtml(entry)') < quick.indexOf('sample (in memory)'),
    'cloud shows the sample before trying the saved page',
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

test('2.17.0: shared links are manageable and no dev tunnel ships', () => {
  const cloud = load('cloud/public/index.html');
  assert.doesNotMatch(cloud, /style\.dev/, 'a temporary preview host is still in the shipped cloud page');
  assert.match(cloud, /id="desktopLink"/, 'the cloud page has no stable desktop download link');
  assert.match(cloud, /desktopDownloadUrl/, 'the cloud page ignores the configured download URL');
  for (const id of ['railShares', 'shareList', 'sharesRefresh', 'sharesRevokeAll', 'askDialog', 'askInput', 'live']) {
    assert.match(cloud, new RegExp('id="' + id + '"'), 'cloud missing #' + id);
  }
  assert.match(cloud, /loadPreviewShares\(\)/, 'the cloud page never loads shared previews');
  assert.match(cloud, /revokeAllPreviewShares\(\)/, 'the cloud page cannot revoke all shares');
  assert.match(cloud, /aria-live="polite"/, 'the cloud page has no live status');
  assert.match(cloud, /state\.previewName === share\.name/, 'revoking the open share leaves its old URL behind');
  assert.match(cloud, /if \(state\.previewName\) setPreviewLink\(state\.previewName\);/, 'sign-out and revoke-all do not reset the preview link');
  assert.doesNotMatch(cloud, /\bprompt\(/, 'the cloud page still calls the browser prompt');
  assert.doesNotMatch(cloud, /\bconfirm\(/, 'the cloud page still calls the browser confirm');
});

test('2.17.0: the desktop uses real dialogs and a release link', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /id="askDialog"/, 'desktop has no in-app ask dialog');
  assert.match(desktop, /role="dialog"/, 'desktop overlays have no dialog role');
  assert.match(desktop, /trapModalFocus/, 'desktop does not trap focus in custom overlays');
  assert.match(desktop, /aria-live="polite"/, 'desktop has no live status');
  assert.match(desktop, /https:\/\/github\.com\/zakker111\/freeway\/releases\/latest/, 'desktop has no stable release link');
  assert.doesNotMatch(desktop, /\bprompt\(/, 'the desktop page still calls the browser prompt');
  assert.doesNotMatch(desktop, /\bconfirm\(/, 'the desktop page still calls the browser confirm');
});

test('cloud: chats are the left panel, not a dialog', () => {
  const html = load('cloud/public/index.html');
  assert.equal(html.includes('historyDialog'), false, 'the old chats dialog is back');
  assert.match(html, /\$\('threadList'\)/, 'the cloud panel is not fed by renderHistory');
});

test('cloud: a reload reopens the last chat and sync is two-way', () => {
  const html = load('cloud/public/index.html');
  assert.match(html, /const ACTIVE_KEY = 'orc\.activeThread\.v1'/, 'no active-chat key');
  assert.match(html, /async function restoreActiveChat\(\)/, 'no boot restore');
  assert.match(html, /await restoreActiveChat\(\)/, 'boot never calls the restore');
  assert.match(html, /function threadKeyFor\(sub\)/, 'chats are not namespaced per account');
  assert.match(html, /migrateLegacyThreads\(before, now\)/, 'old chats are not migrated');
  assert.match(html, /mergeThreads\(threadsKey\(\), \[\.\.\.local, \.\.\.remote\]\)/, 'sync is not two-way');
  assert.match(html, /const uploads = local\.filter/, 'local-only chats are not uploaded');
  assert.doesNotMatch(html, /localStorage\.setItem\(THREADS_KEY/, 'a chat bypasses the account key');
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
  let parens = 0;
  let closeParen = -1;
  for (let i = html.indexOf('(', start); i < html.length; i += 1) {
    if (html[i] === '(') parens += 1;
    else if (html[i] === ')') {
      parens -= 1;
      if (parens === 0) {
        closeParen = i;
        break;
      }
    }
  }
  if (closeParen < 0) return '';
  const bodyStart = html.indexOf('{', closeParen + 1);
  if (bodyStart < 0) return '';
  let depth = 0;
  for (let i = bodyStart; i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return '';
}

test('a new chat is visible in the sidebar before its first message', () => {
  const desktop = load('public/index.html');
  const reset = functionSource(desktop, 'resetThread');
  assert.match(reset, /showEmptyThread\(\)/, 'New Chat does not add the empty chat to the list');
  assert.match(
    desktop,
    /function showEmptyThread\(\)[\s\S]*?scheduleSave\(\{ allowEmpty: true \}\)/,
    'the empty chat is not saved for the next load',
  );
  assert.match(
    desktop,
    /if \(state\.messages\.length === 0\) showEmptyThread\(\);/,
    'a first-run draft is not listed at boot',
  );

  const cloud = load('cloud/public/index.html');
  const start = functionSource(cloud, 'startNewChat');
  assert.match(start, /saveThread\(\{ allowEmpty: true \}\)/, 'cloud New Chat does not save its empty thread');
  const save = functionSource(cloud, 'saveThread');
  assert.match(save, /allowEmpty = false/, 'cloud saves cannot opt into an empty thread');
  assert.match(save, /&& !allowEmpty\) return;/, 'cloud still drops empty threads');
});

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

test('both editions have a one-click preview action', () => {
  for (const [name, rel] of [
    ['desktop', 'public/index.html'],
    ['cloud', 'cloud/public/index.html'],
  ]) {
    const html = load(rel);
    assert.match(html, /id="quickPreview"/, `${name} has no header preview button`);
    assert.match(html, /function quickPreview\(/, `${name} has no quick preview handler`);
    assert.match(
      html,
      /quickPreview[\s\S]{0,100}(?:addEventListener|onclick)/,
      `${name} does not wire the quick preview handler`,
    );
  }
  assert.match(
    load('public/index.html'),
    /showLocalPreview\(SAMPLE_PREVIEW, "sample \(in memory\)"\)/,
    'desktop quick preview does not show the in-memory sample',
  );
  assert.match(
    load('cloud/public/index.html'),
    /showPreview\(SAMPLE_PREVIEW, 'sample \(in memory\)'\)/,
    'cloud quick preview does not show the in-memory sample',
  );
});

test('a chat owns its files and preview', () => {
  const desktop = load('public/index.html');
  for (const pattern of [
    /workspacePath: null/,
    /function fsParams\(/,
    /chatId: state\.threadId/,
    /\/api\/preview\/close/,
    /state\.threadId = newId\(\)/,
    /resetFilePanel\(\)/,
    /function scheduleFileOnlySave\(/,
    /allowEmpty = false/,
    /scheduleFileOnlySave\(\);/,
  ]) {
    assert.match(desktop, pattern, `desktop is missing per-chat state: ${pattern}`);
  }
  const cloud = load('cloud/public/index.html');
  for (const pattern of [
    /let fileNamespaces = \{\}/,
    /const workspaceKey = \(\) => state\.threadId \|\| 'draft'/,
    /function claimLegacyFiles\(/,
    /function startNewChat\(/,
    /function clearPreview\(/,
    /function accountQuery\(/,
    /loadAccountFiles\(\{ claim: true \}\)/,
    /state\.threadId = newId\(\)/,
    /function saveFileOnlyThread\(/,
    /if \(!state\.messages\.length && !Object\.keys\(readFiles\(\)\)\.length && !allowEmpty\) return;/,
    /function saveThread\(\{ allowEmpty = false \} = \{\}\)/,
    /&& !allowEmpty\) return;/,
    /if \(state\.messages\.length \|\| Object\.keys\(readFiles\(\)\)\.length\) saveThread\(\);/,
    /saveThread\(\{ allowEmpty: true \}\);/,
    /saveFileOnlyThread\(\);/,
  ]) {
    assert.match(cloud, pattern, `cloud is missing per-chat state: ${pattern}`);
  }
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

test('desktop: Plan is the default and Build is one click away', () => {
  const html = load('public/index.html');
  for (const id of ['modePlan', 'modeBuild', 'modeHint']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing #' + id);
  }
  assert.match(html, /mode: "plan"/, 'a new chat does not start in Plan');
  assert.match(html, /mode: state\.mode/, 'the chat request does not carry the mode');
  assert.match(html, /PLAN · READ-ONLY/, 'the plan card does not say it is read-only');
  assert.match(html, /function buildApprovedPlan/, 'the plan card has no Build action');
  assert.match(html, /mode: job\.mode[\s\S]*plan: job\.plan/, 'a saved chat does not carry its mode and plan');
});

test('desktop: Build shows a bounded step budget and scaffolds ask first', () => {
  const html = load('public/index.html');
  for (const id of ['buildBudget']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing #' + id);
  }
  assert.match(html, /function renderBuildProgress\(/, 'no Build budget renderer');
  assert.match(html, /event\.type === "build"/, 'the page ignores Build progress events');
  assert.match(html, /event\.build/, 'the page ignores the Build limits in meta');
  assert.match(html, /event\.name === "scaffold_project"/, 'the scaffold approval card has no file list');
  assert.match(html, /renderBuildProgress\(null\)/, 'the budget is never cleared');
});

test('desktop: managed dev servers open in Preview and can be stopped', () => {
  const html = load('public/index.html');
  assert.match(html, /id="devServers"/, 'no dev-server bar');
  assert.match(html, /async function refreshDevServers\(/, 'no dev-server refresh');
  assert.match(html, /function showDevServerPreview\(/, 'no dev-server preview');
  assert.match(html, /\/api\/processes/, 'the page never asks for managed processes');
  assert.match(html, /event\.name === "start_process"/, 'start_process has no approval card');
  assert.match(html, /event\.process/, 'a started process is never shown');
  assert.match(html, /void refreshDevServers\(\)/, 'the bar is not restored on boot');
});

test('both pages parse every inline script', () => {
  for (const page of PAGES) {
    const html = load(page);
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(([, attrs]) => !/type=["']application\/json["']/i.test(attrs));
    assert.ok(scripts.length > 0, page + ' has no inline scripts');
    scripts.forEach(([, , code], index) => {
      assert.doesNotThrow(
        () => new Function(code),
        page + ' inline script ' + (index + 1) + ' does not parse',
      );
    });
  }
});

test('desktop preview exposes a user capture and PNG download without cloud code', () => {
  const desktop = load('public/index.html');
  assert.match(desktop, /id="pvViewport"/, 'no screenshot viewport selector');
  assert.match(desktop, /id="pvShot"/, 'no capture button');
  assert.match(desktop, /id="pvShotDownload"/, 'no PNG download button');
  assert.match(desktop, /\/api\/preview\/screenshot/, 'the capture button has no endpoint');
  assert.match(desktop, /function capturePreviewShot/, 'no capture handler');
  assert.match(desktop, /previewShot/, 'no in-memory capture state');
  assert.doesNotMatch(load('cloud/public/index.html'), /pvShot|preview\/screenshot/);
});
