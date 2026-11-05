#!/usr/bin/env node
// Copy the one shared preview core into both pages. The pages are otherwise
// self-contained, so this keeps desktop and cloud on exactly the same code.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const core = fs.readFileSync(path.join(root, 'shared', 'preview.js'), 'utf8');
if (core.includes('</script')) throw new Error('shared/preview.js contains a literal </script>');

for (const relative of ['public/index.html', 'cloud/public/index.html']) {
  const file = path.join(root, relative);
  const page = fs.readFileSync(file, 'utf8');
  const marker = /<script id="preview-core">[\s\S]*?<\/script>/;
  if (!marker.test(page)) throw new Error(`${relative}: missing <script id="preview-core">`);
  const next = page.replace(marker, `<script id="preview-core">\n${core}\n</script>`);
  fs.writeFileSync(file, next);
  console.log(`synced preview core into ${relative}`);
}
