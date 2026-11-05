// Sandboxed access to exactly one folder. Every path is resolved and then
// compared against the real path of the root, so "..", absolute paths and
// symlinks that point outside can never escape — the model only ever sees
// what the user explicitly opted into.

import fs from 'node:fs';
import path from 'node:path';

const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
// Assets served by the local preview server need to be larger than editor
// reads, but still bounded so a stray video cannot fill memory.
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 500;
const MAX_SEARCH_FILES = 2000;
const MAX_SEARCH_RESULTS = 80;
const MAX_SEARCH_LINE = 240;
const MAX_READ_MANY_FILES = 8;
const MAX_READ_MANY_BYTES = 320 * 1024;
const MAX_PATCH_EDITS = 20;
// Noise that is never useful to a chat model and expensive to list.
const SKIP = new Set(['node_modules', '.git']);
// Generated folders are not worth searching, but stay visible in the file list.
const SEARCH_SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '.cache', '.venv', 'target',
]);

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function createWorkspace(rootInput) {
  const root =
    typeof rootInput === 'string' && rootInput.trim() ? path.resolve(rootInput.trim()) : null;

  function realRoot() {
    if (!root) throw bad('No workspace folder is set. Choose one in Settings.');
    try {
      return fs.realpathSync(root);
    } catch {
      throw bad('The workspace folder does not exist.');
    }
  }

  // The one place that decides whether a path is allowed. Anything that
  // resolves outside the root — including through a symlink — is refused.
  function resolveInside(relative) {
    const base = realRoot();
    const wanted = path.resolve(base, String(relative ?? '') || '.');
    let real;
    try {
      real = fs.realpathSync(wanted);
    } catch {
      // It does not exist yet: walk up to the nearest existing ancestor, check
      // that one, then rebuild the missing tail. Checking only the direct
      // parent would refuse "new/folder/file.txt" and could also be fooled by
      // a symlink further up the chain.
      let probe = path.dirname(wanted);
      const tail = [path.basename(wanted)];
      let realProbe = null;
      for (let depth = 0; depth < 64; depth += 1) {
        try {
          realProbe = fs.realpathSync(probe);
          break;
        } catch {
          const next = path.dirname(probe);
          if (next === probe) throw bad('No such folder.');
          tail.unshift(path.basename(probe));
          probe = next;
        }
      }
      if (!realProbe) throw bad('No such folder.');
      if (realProbe !== base && !realProbe.startsWith(base + path.sep)) {
        throw bad('That path is outside the workspace.');
      }
      real = path.join(realProbe, ...tail);
    }
    if (real !== base && !real.startsWith(base + path.sep)) {
      throw bad('That path is outside the workspace.');
    }
    return { real, base };
  }

  const rel = (real, base) => path.relative(base, real).split(path.sep).join('/');

  function list(relativePath = '.') {
    const { real, base } = resolveInside(relativePath);
    let stat;
    try {
      stat = fs.statSync(real);
    } catch {
      throw bad('No such folder.', 404);
    }
    if (!stat.isDirectory()) throw bad('That is not a folder.');

    const entries = [];
    for (const entry of fs.readdirSync(real, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      let size = 0;
      if (entry.isFile()) {
        try {
          size = fs.statSync(path.join(real, entry.name)).size;
        } catch {
          size = 0;
        }
      }
      entries.push({ name: entry.name, type: entry.isDirectory() ? 'dir' : 'file', size });
      if (entries.length >= MAX_ENTRIES) break;
    }
    entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1,
    );
    return { path: rel(real, base), entries };
  }

  function read(relativePath) {
    const { real, base } = resolveInside(relativePath);
    let stat;
    try {
      stat = fs.statSync(real);
    } catch {
      throw bad('No such file.', 404);
    }
    if (!stat.isFile()) throw bad('That is not a file.');
    if (stat.size > MAX_READ_BYTES) throw bad('That file is larger than 256 KB.');
    const buffer = fs.readFileSync(real);
    if (buffer.includes(0)) throw bad('That looks like a binary file.');
    return { path: rel(real, base), size: stat.size, content: buffer.toString('utf8') };
  }

  /**
   * Read a file for the preview server. Unlike read(), this accepts binary
   * assets and larger files; resolveInside still enforces the workspace and
   * symlink boundary.
   */
  function readAsset(relativePath) {
    const { real, base } = resolveInside(relativePath);
    let stat;
    try {
      stat = fs.statSync(real);
    } catch {
      throw bad('No such file.', 404);
    }
    if (!stat.isFile()) throw bad('That is not a file.', 404);
    if (stat.size > MAX_ASSET_BYTES) throw bad('That asset is larger than 8 MB.', 413);
    const buffer = fs.readFileSync(real);
    return { path: rel(real, base), size: buffer.length, buffer };
  }

  function write(relativePath, content) {
    const text = typeof content === 'string' ? content : '';
    if (Buffer.byteLength(text) > MAX_WRITE_BYTES) {
      throw bad('That file is too large to write (1 MB limit).');
    }
    const target = String(relativePath ?? '').trim();
    if (!target) throw bad('A file path is required.');

    const { real, base } = resolveInside(target);
    if (fs.existsSync(real) && fs.statSync(real).isDirectory()) throw bad('That is a folder.');

    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, text, 'utf8');
    return { path: rel(real, base), size: Buffer.byteLength(text) };
  }

  /**
   * Search the workspace without a shell. Literal by default; `regex` opts in.
   * Binary files, oversized files and generated folders are skipped, and both
   * the file count and the result count are bounded.
   */
  function search(relativePath, query, options = {}) {
    const needle = String(query ?? '');
    if (!needle.trim()) throw bad('A search text is required.');
    if (needle.length > 200) throw bad('Search text is too long (200 characters).');
    const caseSensitive = options.caseSensitive === true;
    let matcher;
    if (options.regex === true) {
      try {
        matcher = new RegExp(needle, caseSensitive ? '' : 'i');
      } catch {
        throw bad('That regular expression is invalid.');
      }
    } else {
      const lower = needle.toLowerCase();
      matcher = {
        test: (line) => (caseSensitive ? line.includes(needle) : line.toLowerCase().includes(lower)),
      };
    }

    const max = Math.min(Math.max(Number(options.maxResults) || 40, 1), MAX_SEARCH_RESULTS);
    const { real, base } = resolveInside(relativePath || '.');
    let stat;
    try {
      stat = fs.statSync(real);
    } catch {
      throw bad('No such file or folder.', 404);
    }

    const matches = [];
    let scanned = 0;
    let truncated = false;

    const scanFile = (full) => {
      let size;
      try {
        size = fs.statSync(full).size;
      } catch {
        return;
      }
      if (size > MAX_READ_BYTES || scanned >= MAX_SEARCH_FILES) return;
      let text;
      try {
        const buffer = fs.readFileSync(full);
        if (buffer.subarray(0, 8192).includes(0)) return;
        text = buffer.toString('utf8');
      } catch {
        return;
      }
      scanned += 1;
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        if (!matcher.test(lines[index])) continue;
        matches.push({
          path: rel(full, base),
          line: index + 1,
          text: lines[index].trim().slice(0, MAX_SEARCH_LINE),
        });
        if (matches.length >= max) {
          truncated = true;
          return;
        }
      }
    };

    const visit = (dir, depth) => {
      if (truncated || scanned >= MAX_SEARCH_FILES || depth > 12) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (truncated) return;
        if (entry.isDirectory()) {
          if (!SEARCH_SKIP.has(entry.name)) visit(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          scanFile(path.join(dir, entry.name));
        }
      }
    };

    if (stat.isDirectory()) visit(real, 0);
    else scanFile(real);

    return { root: rel(real, base), matches, scanned, truncated };
  }

  /** Read several files at once, reporting per-file errors instead of failing all. */
  function readMany(relativePaths) {
    if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
      throw bad('Give at least one file path.');
    }
    if (relativePaths.length > MAX_READ_MANY_FILES) {
      throw bad(`Read at most ${MAX_READ_MANY_FILES} files at once.`);
    }
    const files = [];
    let total = 0;
    for (const wanted of relativePaths) {
      try {
        const file = read(wanted);
        if (total + file.size > MAX_READ_MANY_BYTES) {
          files.push({ path: String(wanted), error: 'Skipped: would exceed the 320 KB total limit.' });
          continue;
        }
        total += file.size;
        files.push(file);
      } catch (error) {
        files.push({ path: String(wanted), error: String(error?.message ?? error) });
      }
    }
    return { files, total };
  }

  /**
   * Validate exact-text edits and build the new contents plus a unified diff.
   * Nothing is written: the confirmation card uses this before the user decides.
   */
  function previewPatch(input) {
    const target = String(input?.path ?? '').trim();
    if (!target) throw bad('A file path is required.');
    const edits = Array.isArray(input?.edits) ? input.edits : [];
    if (edits.length === 0) throw bad('Give at least one edit.');
    if (edits.length > MAX_PATCH_EDITS) throw bad(`At most ${MAX_PATCH_EDITS} edits per call.`);

    const file = read(target);
    let next = file.content;
    for (const [index, edit] of edits.entries()) {
      const find = typeof edit?.find === 'string' ? edit.find : '';
      const replace = typeof edit?.replace === 'string' ? edit.replace : '';
      if (!find) throw bad(`Edit ${index + 1} has an empty find text.`);
      const occurrences = next.split(find).length - 1;
      if (occurrences === 0) {
        throw bad(`Edit ${index + 1}: the find text does not occur in /${file.path}.`);
      }
      if (occurrences > 1) {
        throw bad(
          `Edit ${index + 1}: the find text occurs ${occurrences} times in /${file.path}. ` +
            'Include more surrounding text so it is unique.',
        );
      }
      next = next.replace(find, () => replace);
    }
    if (next === file.content) throw bad('These edits would not change the file.');
    if (Buffer.byteLength(next) > MAX_WRITE_BYTES) {
      throw bad('The patched file would exceed the 1 MB write limit.');
    }

    return {
      path: file.path,
      before: file.content,
      after: next,
      size: Buffer.byteLength(next),
      edits: edits.length,
      diff: unifiedDiff(file.content, next, file.path),
    };
  }

  function applyPatch(input) {
    const preview = previewPatch(input);
    const saved = write(preview.path, preview.after);
    return { ...saved, edits: preview.edits, diff: preview.diff };
  }

  return {
    root,
    isReady: Boolean(root),
    list,
    read,
    readAsset,
    write,
    search,
    readMany,
    previewPatch,
    applyPatch,
  };
}

/**
 * Minimal unified diff: trim the common prefix and suffix, then show the changed
 * middle with surrounding context. Good enough for an approval card, and it
 * never walks a huge file twice.
 */
export function unifiedDiff(before, after, file = 'file', context = 3) {
  const a = String(before).split('\n');
  const b = String(after).split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  if (start === endA && start === endB) return '';

  const from = Math.max(0, start - context);
  const toA = Math.min(a.length, endA + context);
  const toB = Math.min(b.length, endB + context);
  const out = [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${from + 1},${toA - from} +${from + 1},${toB - from} @@`,
  ];
  for (let index = from; index < start; index += 1) out.push(` ${a[index]}`);
  for (let index = start; index < endA; index += 1) out.push(`-${a[index]}`);
  for (let index = start; index < endB; index += 1) out.push(`+${b[index]}`);
  for (let index = endA; index < toA; index += 1) out.push(` ${a[index]}`);
  if (out.length > 400) {
    out.length = 400;
    out.push('… diff truncated at 400 lines');
  }
  return out.join('\n');
}

export const workspaceLimits = {
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  MAX_ASSET_BYTES,
  MAX_ENTRIES,
  MAX_SEARCH_FILES,
  MAX_SEARCH_RESULTS,
  MAX_READ_MANY_FILES,
  MAX_READ_MANY_BYTES,
  MAX_PATCH_EDITS,
};
