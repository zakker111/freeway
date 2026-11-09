// The archive walker never follows a symlink and never includes credential
// files. Every path is checked against the real workspace root before it is
// read, so a crafted project cannot turn a download into an arbitrary-file read.

import fs from 'node:fs';
import path from 'node:path';
import { createZip } from './zip.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', '.nuxt', '.cache', '.venv', 'coverage', 'target']);
const MAX_FILES = 5_000;
const MAX_BYTES = 64 * 1024 * 1024;

function archiveBad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function inside(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

export function createWorkspaceArchive(workspace, { maxFiles = MAX_FILES, maxBytes = MAX_BYTES } = {}) {
  if (!workspace?.isReady) throw archiveBad('No workspace folder is set. Choose one in Settings.');
  const root = fs.realpathSync(workspace.root);
  const entries = [];
  let total = 0;
  let count = 0;

  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (count >= maxFiles) throw archiveBad(`The workspace has too many files (${maxFiles} maximum).`, 413);
      if (item.name.startsWith('.')) continue;
      const full = path.join(dir, item.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (workspace.isSecretPath(rel)) continue;
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) {
        if (SKIP_DIRS.has(item.name)) continue;
        walk(full);
        continue;
      }
      if (!item.isFile()) continue;
      const real = fs.realpathSync(full);
      if (!inside(root, real)) throw archiveBad('A workspace file points outside the workspace.', 403);
      const stat = fs.statSync(real);
      if (stat.size > maxBytes) throw archiveBad('A file is too large to archive.', 413);
      if (total + stat.size > maxBytes) {
        throw archiveBad(`The workspace is too large to archive (${Math.round(maxBytes / 1024 / 1024)} MB maximum).`, 413);
      }
      count += 1;
      total += stat.size;
      entries.push({ path: rel, data: fs.readFileSync(real) });
    }
  };

  walk(root);
  if (entries.length === 0) throw archiveBad('There are no files to archive.');
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    buffer: createZip(entries, { maxFiles, maxBytes }),
    files: entries.length,
    bytes: total,
    name: `freeway-${stamp}.zip`,
  };
}
