#!/usr/bin/env node
// Copy the one shared preview core, diagnostics bridge and Chatty runtime into
// both pages. The pages are otherwise self-contained, so this keeps desktop and
// cloud on exactly the same shared behaviour.
import fs from 'node:fs';
import path from 'node:path';
import { PREVIEW_BRIDGE_SOURCE } from '../lib/preview-bridge.mjs';

const root = path.resolve(import.meta.dirname, '..');
const core = fs.readFileSync(path.join(root, 'shared', 'preview.js'), 'utf8');
if (core.includes('</script')) throw new Error('shared/preview.js contains a literal </script>');
if (PREVIEW_BRIDGE_SOURCE.includes('</script')) {
  throw new Error('lib/preview-bridge.mjs contains a literal </script>');
}
const bridgeJson = JSON.stringify(PREVIEW_BRIDGE_SOURCE).replace(/</g, () => '\\u003c');
const chatty = fs.readFileSync(path.join(root, 'shared', 'chatty.js'), 'utf8');
if (chatty.includes('</script')) throw new Error('shared/chatty.js contains a literal </script>');

for (const relative of ['public/index.html', 'cloud/public/index.html']) {
  const file = path.join(root, relative);
  const page = fs.readFileSync(file, 'utf8');
  const coreMarker = /<script id="preview-core">[\s\S]*?<\/script>/;
  const bridgeMarker = /<script type="application\/json" id="preview-bridge">[\s\S]*?<\/script>/;
  const chattyMarker = /<script id="chatty-core">[^]*?<[/]script>/;
  if (!coreMarker.test(page)) throw new Error(`${relative}: missing <script id="preview-core">`);
  if (!bridgeMarker.test(page)) throw new Error(`${relative}: missing <script id="preview-bridge">`);
  if (!chattyMarker.test(page)) throw new Error(`${relative}: missing <script id="chatty-core">`);
  // A function replacer is required: `$'` and other dollar sequences inside
  // the core would otherwise be interpreted as replacement patterns.
  const next = page
    .replace(coreMarker, () => `<script id="preview-core">\n${core}\n</script>`)
    .replace(
      bridgeMarker,
      () => `<script type="application/json" id="preview-bridge">${bridgeJson}</script>`,
    )
    .replace(chattyMarker, () => `<script id="chatty-core">\n${chatty}\n</script>`);
  fs.writeFileSync(file, next);
  console.log(`synced preview core + bridge + Chatty into ${relative}`);
}
