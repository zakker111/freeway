// Bundle the Worker into the single module the deploy manifest uploads.
// The deployer uploads files, it never runs npm, so anything the Worker imports
// has to be inlined here first.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
// The cloud page carries the same preview core as the desktop page.
import '../build/sync-preview.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(here, 'dist', 'worker.mjs');

await build({
  entryPoints: [path.join(here, 'worker.mjs')],
  outfile,
  bundle: true,
  format: 'esm',
  // A Worker is neither node nor browser: keep it neutral so no node built-in
  // or DOM shim sneaks in.
  platform: 'neutral',
  target: 'es2022',
  mainFields: ['module', 'main'],
  conditions: ['worker', 'import'],
  legalComments: 'none',
  logLevel: 'info',
});

console.log(`bundled ${path.relative(process.cwd(), outfile)}`);
