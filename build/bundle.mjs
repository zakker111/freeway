#!/usr/bin/env node
// Builds freeway.mjs: server, tools, model logic and the entire UI
// (inlined as a string) in one runnable file.
//
//   node build/bundle.mjs        (or: npm run build:single)
//
// The modular sources stay the source of truth — the tests import them.

import fs from 'node:fs';
import path from 'node:path';
// Keep both pages on the one shared preview core before inlining the desktop page.
import './sync-preview.mjs';

const root = path.resolve(import.meta.dirname, '..');
// Git checkouts on Windows can be CRLF. Normalize once so import stripping and
// the pageHtml() terminator search do not depend on the checkout's line endings.
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const version = JSON.parse(read('package.json')).version;

/** Drop ESM syntax so the modules can be concatenated into one scope. */
function stripModule(source, label) {
  let code = source.replace(/^#![^\n]*\n/, '');
  const imports = [];

  code = code.replace(/^import\s[\s\S]*?;\s*$/gm, (line) => {
    // Relative imports point at files that are being concatenated in, so only
    // the built-ins and packages survive into the single file.
    const specifier = line.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? '';
    if (!specifier.startsWith('.')) imports.push(line.trim());
    return '';
  });
  code = code.replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
  code = code.replace(/^export\s+default\s+/gm, 'const __default = ');
  code = code.replace(/^export\s+/gm, '');

  const leftover = code.match(/^\s*(import|export)\s/m);
  if (leftover) throw new Error(`${label}: could not strip "${leftover[0].trim()}"`);

  return { code: code.trim(), imports };
}

const DECL = /^(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const owners = new Map();

function collectNames(code, label) {
  for (const match of code.matchAll(DECL)) {
    const name = match[1];
    if (owners.has(name)) {
      throw new Error(`Duplicate top-level "${name}" in ${label} and ${owners.get(name)}`);
    }
    owners.set(name, label);
  }
}

const page = read('public/index.html');
const models = stripModule(read('lib/models.mjs'), 'lib/models.mjs');
const memory = stripModule(read('lib/memory.mjs'), 'lib/memory.mjs');
const testparseMod = stripModule(read('lib/testparse.mjs'), 'lib/testparse.mjs');
const projectMod = stripModule(read('lib/project.mjs'), 'lib/project.mjs');
const scaffoldMod = stripModule(read('lib/scaffold.mjs'), 'lib/scaffold.mjs');
const gitMod = stripModule(read('lib/git.mjs'), 'lib/git.mjs');
const previewCheckMod = stripModule(read('lib/preview-check.mjs'), 'lib/preview-check.mjs');
const zipMod = stripModule(read('lib/zip.mjs'), 'lib/zip.mjs');
const markdownMod = stripModule(read('lib/markdown.mjs'), 'lib/markdown.mjs');
const docxMod = stripModule(read('lib/docx.mjs'), 'lib/docx.mjs');
const pdfMod = stripModule(read('lib/pdf.mjs'), 'lib/pdf.mjs');
const chartMod = stripModule(read('lib/chart.mjs'), 'lib/chart.mjs');
const archiveMod = stripModule(read('lib/archive.mjs'), 'lib/archive.mjs');
const tools = stripModule(read('lib/tools.mjs'), 'lib/tools.mjs');
const planMod = stripModule(read('lib/plan.mjs'), 'lib/plan.mjs');
const toolPrompt = stripModule(read('lib/tool-prompt.mjs'), 'lib/tool-prompt.mjs');
const chatStore = stripModule(read('lib/store.mjs'), 'lib/store.mjs');
const redact = stripModule(read('lib/redact.mjs'), 'lib/redact.mjs');
const workspaceMod = stripModule(read('lib/workspace.mjs'), 'lib/workspace.mjs');
const previewBridgeMod = stripModule(read('lib/preview-bridge.mjs'), 'lib/preview-bridge.mjs');
const previewServerMod = stripModule(read('lib/preview-server.mjs'), 'lib/preview-server.mjs');
const screenshotMod = stripModule(read('lib/screenshot.mjs'), 'lib/screenshot.mjs');
const browserMod = stripModule(read('lib/browser.mjs'), 'lib/browser.mjs');
const checkpointsMod = stripModule(read('lib/checkpoints.mjs'), 'lib/checkpoints.mjs');
const repairMod = stripModule(read('lib/repair.mjs'), 'lib/repair.mjs');
const secretsMod = stripModule(read('lib/secrets.mjs'), 'lib/secrets.mjs');
const githubMod = stripModule(read('lib/github.mjs'), 'lib/github.mjs');
const commandsMod = stripModule(read('lib/commands.mjs'), 'lib/commands.mjs');
const processesMod = stripModule(read('lib/processes.mjs'), 'lib/processes.mjs');
const statusMod = stripModule(read('lib/status.mjs'), 'lib/status.mjs');
const providersMod = stripModule(read('lib/providers.mjs'), 'lib/providers.mjs');
const app = stripModule(read('app.mjs'), 'app.mjs');

collectNames(models.code, 'lib/models.mjs');
collectNames(memory.code, 'lib/memory.mjs');
collectNames(testparseMod.code, 'lib/testparse.mjs');
collectNames(projectMod.code, 'lib/project.mjs');
collectNames(scaffoldMod.code, 'lib/scaffold.mjs');
collectNames(gitMod.code, 'lib/git.mjs');
collectNames(previewCheckMod.code, 'lib/preview-check.mjs');
collectNames(zipMod.code, 'lib/zip.mjs');
collectNames(markdownMod.code, 'lib/markdown.mjs');
collectNames(docxMod.code, 'lib/docx.mjs');
collectNames(pdfMod.code, 'lib/pdf.mjs');
collectNames(chartMod.code, 'lib/chart.mjs');
collectNames(archiveMod.code, 'lib/archive.mjs');
collectNames(tools.code, 'lib/tools.mjs');
collectNames(planMod.code, 'lib/plan.mjs');
collectNames(toolPrompt.code, 'lib/tool-prompt.mjs');
collectNames(chatStore.code, 'lib/store.mjs');
collectNames(redact.code, 'lib/redact.mjs');
collectNames(workspaceMod.code, 'lib/workspace.mjs');
collectNames(previewBridgeMod.code, 'lib/preview-bridge.mjs');
collectNames(previewServerMod.code, 'lib/preview-server.mjs');
collectNames(screenshotMod.code, 'lib/screenshot.mjs');
collectNames(browserMod.code, 'lib/browser.mjs');
collectNames(checkpointsMod.code, 'lib/checkpoints.mjs');
collectNames(repairMod.code, 'lib/repair.mjs');
collectNames(secretsMod.code, 'lib/secrets.mjs');
collectNames(githubMod.code, 'lib/github.mjs');
collectNames(commandsMod.code, 'lib/commands.mjs');
collectNames(processesMod.code, 'lib/processes.mjs');
collectNames(statusMod.code, 'lib/status.mjs');
collectNames(providersMod.code, 'lib/providers.mjs');
collectNames(app.code, 'app.mjs');

const start = app.code.indexOf('async function pageHtml() {');
if (start === -1) throw new Error('app.mjs: pageHtml() not found');
const end = app.code.indexOf('\n}\n', start);
if (end === -1) throw new Error('app.mjs: end of pageHtml() not found');

const pageFunction = 'async function pageHtml() {\n  return EMBEDDED_PAGE;\n}';
app.code = `${app.code.slice(0, start)}${pageFunction}${app.code.slice(end + 2)}`;
if (!app.code.includes('return EMBEDDED_PAGE;')) throw new Error('pageHtml() was not replaced');

// Two modules can import overlapping names from the same built-in (app.mjs and
// store.mjs both want randomUUID), and two import lines for one specifier is a
// SyntaxError in the single file. Merge per specifier instead of concatenating.
function mergeImports(lines) {
  const groups = new Map();
  for (const line of lines) {
    const match = line.match(
      /^import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+['"]([^'"]+)['"];?$/,
    );
    if (!match) continue;
    const [, fallback, named, specifier] = match;
    const group = groups.get(specifier) ?? { defaultName: null, names: new Set() };
    if (fallback) group.defaultName = fallback;
    for (const part of (named ?? '').split(',')) {
      const name = part.trim();
      if (name) group.names.add(name);
    }
    groups.set(specifier, group);
  }

  const out = [];
  for (const [specifier, group] of groups) {
    const names = [...group.names].sort();
    if (group.defaultName && names.length) {
      out.push(`import ${group.defaultName}, { ${names.join(', ')} } from '${specifier}';`);
    } else if (group.defaultName) {
      out.push(`import ${group.defaultName} from '${specifier}';`);
    } else if (names.length) {
      out.push(`import { ${names.join(', ')} } from '${specifier}';`);
    }
  }
  return out;
}

const imports = mergeImports([
  ...models.imports,
  ...memory.imports,
  ...testparseMod.imports,
  ...projectMod.imports,
  ...scaffoldMod.imports,
  ...previewCheckMod.imports,
  ...zipMod.imports,
  ...markdownMod.imports,
  ...docxMod.imports,
  ...pdfMod.imports,
  ...chartMod.imports,
  ...archiveMod.imports,
  ...tools.imports,
  ...toolPrompt.imports,
  ...chatStore.imports,
  ...redact.imports,
  ...workspaceMod.imports,
  ...previewBridgeMod.imports,
  ...previewServerMod.imports,
  ...screenshotMod.imports,
  ...browserMod.imports,
  ...checkpointsMod.imports,
  ...repairMod.imports,
  ...secretsMod.imports,
    ...githubMod.imports,
    ...commandsMod.imports,
    ...processesMod.imports,
    ...statusMod.imports,
    ...providersMod.imports,
    ...app.imports,
]);

const output = `#!/usr/bin/env node
// Freeway ${version} — single-file build.
// Generated by build/bundle.mjs from app.mjs, lib/ and public/index.html.
// Do not edit this file: edit the sources and run \`npm run build:single\`.

${imports.join('\n')}

/* ------------------------------------------------------------- UI inlined */

const EMBEDDED_PAGE = ${JSON.stringify(page)};

/* --------------------------------------------------------- lib/models.mjs */

${models.code}

/* --------------------------------------------------------- lib/memory.mjs */

${memory.code}

/* ------------------------------------------------------ lib/testparse.mjs */

${testparseMod.code}

/* -------------------------------------------------------- lib/project.mjs */

${projectMod.code}

/* ------------------------------------------------------- lib/scaffold.mjs */

${scaffoldMod.code}

/* -------------------------------------------------- lib/preview-check.mjs */

${previewCheckMod.code}

/* ------------------------------------------------------------ lib/zip.mjs */

${zipMod.code}

/* ------------------------------------------------------- lib/markdown.mjs */

${markdownMod.code}

/* ----------------------------------------------------------- lib/docx.mjs */

${docxMod.code}

/* ------------------------------------------------------------ lib/pdf.mjs */

${pdfMod.code}

/* ---------------------------------------------------------- lib/chart.mjs */

${chartMod.code}

/* -------------------------------------------------------- lib/archive.mjs */

${archiveMod.code}

/* ---------------------------------------------------------- lib/tools.mjs */

${tools.code}

/* ----------------------------------------------------------- lib/plan.mjs */

${planMod.code}

/* ---------------------------------------------------- lib/tool-prompt.mjs */

${toolPrompt.code}

/* --------------------------------------------------------- lib/redact.mjs */

${redact.code}

/* ------------------------------------------------------------ lib/git.mjs */

${gitMod.code}

/* ------------------------------------------------------ lib/workspace.mjs */

${workspaceMod.code}

/* ------------------------------------------------- lib/preview-bridge.mjs */

${previewBridgeMod.code}

/* ------------------------------------------------- lib/preview-server.mjs */

${previewServerMod.code}

/* ---------------------------------------------------- lib/screenshot.mjs */

${screenshotMod.code}

/* ------------------------------------------------------- lib/browser.mjs */

${browserMod.code}

/* -------------------------------------------------------- lib/secrets.mjs */

${secretsMod.code}

/* --------------------------------------------------------- lib/github.mjs */

${githubMod.code}

/* ------------------------------------------------------ lib/commands.mjs */

${commandsMod.code}

/* ----------------------------------------------------- lib/processes.mjs */

${processesMod.code}

/* --------------------------------------------------------- lib/status.mjs */

${statusMod.code}

/* ---------------------------------------------------------- lib/store.mjs */

${chatStore.code}

/* ----------------------------------------------------- lib/providers.mjs */

${providersMod.code}

/* ------------------------------------------------------- lib/checkpoints.mjs */

${checkpointsMod.code}

/* ---------------------------------------------------------- lib/repair.mjs */

${repairMod.code}

/* ---------------------------------------------------------------- app.mjs */

${app.code}
`;

// Node SEA loads a CommonJS main; an ESM main dies at startup with
// "Failed to load the ES module". The bundle is already one flat scope, so the
// only difference between the two outputs is the import lines at the top.
function toRequire(line) {
  const match = line.match(
    /^import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+['"]([^'"]+)['"];?$/,
  );
  if (!match) return '';
  const [, fallback, named, specifier] = match;
  const out = [];
  if (fallback) out.push(`const ${fallback} = require('${specifier}');`);
  const namedList = (named ?? '').trim();
  if (namedList) {
    // "spawn as nodeSpawn" is ESM syntax; CommonJS destructuring spells it
    // "spawn: nodeSpawn". Without this the emitted .cjs is a syntax error.
    const parts = namedList
      .split(',')
      .map((part) => part.trim().replace(/\s+as\s+/, ': '))
      .filter(Boolean);
    out.push(`const { ${[...new Set(parts)].join(', ')} } = require('${specifier}');`);
  }
  return out.join('\n');
}

const target = path.join(root, 'freeway.mjs');
fs.writeFileSync(target, output, { mode: 0o755 });

const cjsImports = imports.map(toRequire).filter(Boolean).join('\n');
let cjsOutput = imports.length > 0 ? output.replace(imports.join('\n'), cjsImports) : output;
// import.meta does not exist in CommonJS; these are the only forms used.
cjsOutput = cjsOutput
  .replaceAll('import.meta.dirname', '__dirname')
  .replaceAll('import.meta.filename', '__filename')
  .replaceAll('import.meta.url', "require('node:url').pathToFileURL(__filename).href");
// app.mjs uses top-level await (it probes node:sea), which CommonJS forbids. An
// async entry point keeps the body unchanged and still gives SEA a CJS main.
const cjsBody = cjsOutput.replace(/^#![^\n]*\n/, '');
cjsOutput = `#!/usr/bin/env node\n(async () => {\n${cjsBody}\n})().catch((error) => {\n  console.error(error);\n  process.exit(1);\n});\n`;
const cjsTarget = path.join(root, 'freeway.cjs');
fs.writeFileSync(cjsTarget, cjsOutput, { mode: 0o755 });

const kb = (output.length / 1024).toFixed(0);
console.log(`Wrote ${path.relative(root, target)} (${kb} KB, ${output.split('\n').length} lines)`);
console.log(`Wrote ${path.relative(root, cjsTarget)} for Node SEA`);
