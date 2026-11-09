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
const MAX_FIND_RESULTS = 200;
const MAX_FIND_FILES = 5000;
const MAX_FIND_DEPTH = 12;
const MAX_FIND_PATTERN = 200;
const MAX_SEARCH_LINE = 240;
const MAX_READ_MANY_FILES = 8;
const MAX_READ_MANY_BYTES = 320 * 1024;
const MAX_PATCH_EDITS = 20;
const MAX_PREVIEW_SCAN = 400;
const MAX_REGEX_SOURCE = 500;
const MAX_REGEX_LINE = 4000;
// A regex search is bounded per request. A single pathological expression can
// still stall V8, so the source guard below rejects the common backtracking
// shapes before the file walk starts.
const REGEX_BUDGET_MS = 250;
// Folders that cannot contain a useful first preview page, even when a build
// tool has put stale output there.
const PREVIEW_SKIP = new Set(['node_modules', '.git', '.next', '.nuxt', '.cache', '.venv', 'coverage', 'target']);
const PREVIEW_ENTRY = /\.(?:html?|svg|md|markdown)$/i;
// Noise that is never useful to a chat model and expensive to list.
const SKIP = new Set(['node_modules', '.git']);
// Generated folders are not worth searching, but stay visible in the file list.
const SEARCH_SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '.cache', '.venv', 'target',
]);

// Files whose contents are credentials, not project source. The model may
// still create an example file, but it must never read the real one through a
// tool or the preview server.
const ENV_EXAMPLE = new Set(['.env.example', '.env.sample', '.env.template']);
const SECRET_NAMES = new Set([
  '.envrc',
  '.git-credentials',
  '.htpasswd',
  '.netrc',
  '.npmrc',
  '.pgpass',
  'credentials.json',
  'credentials.txt',
  'credentials.yaml',
  'credentials.yml',
  'secrets.json',
  'secrets.txt',
  'secrets.yaml',
  'secrets.yml',
]);
const SECRET_SUFFIX = /\.(?:pem|key|p12|pfx|jks|keystore)$/i;
const SECRET_KEY_NAME = /^(?:id_(?:rsa|ed25519|ecdsa|dsa)|identity)(?:\.|$)/i;

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/** Is this relative path a credential file that no workspace tool may touch? */
export function isSecretPath(relativePath) {
  const normalized = String(relativePath ?? '').replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  const name = lower.split('/').filter(Boolean).pop() ?? '';
  if (!name || ENV_EXAMPLE.has(name)) return false;
  if (/^\.env(?:\.|$)/.test(name)) return true;
  if (SECRET_NAMES.has(name)) return true;
  if (SECRET_KEY_NAME.test(name) || SECRET_SUFFIX.test(name)) return true;
  // Whole credential folders, even when a key uses an unexpected filename.
  if (/(^|\/)\.ssh\//.test(lower)) return true;
  if (/(^|\/)\.aws\/credentials$/.test(lower)) return true;
  if (/(^|\/)\.docker\/config\.json$/.test(lower)) return true;
  return false;
}

function refuseSecret(relativePath) {
  if (isSecretPath(relativePath)) {
    throw bad('Secret files are not available to the assistant.', 403);
  }
}

/** Reject the common catastrophic-backtracking shapes before V8 sees them. */
function assertSafeRegex(source) {
  if (source.length > MAX_REGEX_SOURCE) {
    throw bad(`That regular expression is too long (${MAX_REGEX_SOURCE} characters).`);
  }
  if (/\\[1-9]/.test(source)) {
    throw bad('Backreferences are not allowed in search expressions.');
  }
  if (/\(\?<[=!]/.test(source)) {
    throw bad('Lookbehind is not allowed in search expressions.');
  }
  // A quantified group that itself contains an unbounded quantifier — e.g.
  // `(a+)+` or `(\w*)*` — is the classic exponential case.
  if (/\((?:\?:)?[^()]*(?:\*|\+|\{\d*,?\d*\})[^()]*\)(?:\*|\+|\{)/.test(source)) {
    throw bad('That regular expression contains a nested quantifier and is too expensive.');
  }
  if (/(?:\.\*){2,}/.test(source)) {
    throw bad('That regular expression contains repeated wildcards and is too expensive.');
  }
}

/** Prefer a real entry page over a README, and a shallower page over a deep one. */
function previewEntryScore(file) {
  const parts = file.split('/');
  const name = parts[parts.length - 1].toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';
  let score = (parts.length - 1) * 10;
  if (ext === '.html') score -= 20;
  else if (ext === '.htm') score -= 19;
  else if (ext === '.svg') score += 20;
  else score += 50;
  if (!/^index\./.test(name)) score += 15;
  if (file === 'index.html') score -= 5;
  if (parts[0] === 'public') score -= 3;
  return score;
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
      const child = rel(path.join(real, entry.name), base);
      if (isSecretPath(child)) continue;
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
    refuseSecret(relativePath);
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
    refuseSecret(relativePath);
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

  /** Existence check for preflight decisions; containment is still enforced by write. */
  function exists(relativePath) {
    try {
      const { real } = resolveInside(relativePath);
      return fs.existsSync(real);
    } catch {
      return false;
    }
  }

  function write(relativePath, content) {
    refuseSecret(relativePath);
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

  /** Compile a small, dependency-free glob: *, **, ?. A bare name matches anywhere. */
  function findMatcher(pattern) {
    const source = String(pattern ?? '').trim().replace(/\\/g, '/');
    if (!source) throw bad('A file name or glob is required.');
    if (source.length > MAX_FIND_PATTERN) throw bad(`That pattern is too long (${MAX_FIND_PATTERN} characters).`);
    if (/[\0\r\n]/.test(source)) throw bad('That pattern contains an invalid character.');
    const hasSlash = source.includes('/');
    if (!/[*?]/.test(source)) {
      const needle = source.toLowerCase();
      return (relative) => {
        const value = (hasSlash ? relative : relative.split('/').pop()).toLowerCase();
        return value.includes(needle);
      };
    }
    let out = '^';
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '*') {
        if (source[index + 1] === '*') {
          index += 1;
          if (source[index + 1] === '/') {
            index += 1;
            out += '(?:.*/)?';
          } else {
            out += '.*';
          }
        } else {
          out += '[^/]*';
        }
      } else if (char === '?') {
        out += '[^/]';
      } else {
        out += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }
    out += '$';
    let regex;
    try {
      regex = new RegExp(out, 'i');
    } catch {
      throw bad('That file pattern is invalid.');
    }
    return (relative) => regex.test(hasSlash ? relative : relative.split('/').pop());
  }

  /**
   * Search the workspace without a shell. Literal by default; `regex` opts in.
   * Binary files, oversized files and generated folders are skipped, and both
   * the file count and the result count are bounded.
   */
  function search(relativePath, query, options = {}) {
    refuseSecret(relativePath);
    const needle = String(query ?? '');
    if (!needle.trim()) throw bad('A search text is required.');
    if (needle.length > 200) throw bad('Search text is too long (200 characters).');
    const caseSensitive = options.caseSensitive === true;
    let matcher;
    if (options.regex === true) {
      try {
        assertSafeRegex(needle);
        matcher = new RegExp(needle, caseSensitive ? '' : 'i');
      } catch (error) {
        if (error?.status === 400) throw error;
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
    const regexStarted = options.regex === true ? Date.now() : 0;

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
      const relative = rel(full, base);
      if (isSecretPath(relative)) return;
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        const line = regexStarted ? lines[index].slice(0, MAX_REGEX_LINE) : lines[index];
        if (!matcher.test(line)) continue;
        matches.push({
          path: relative,
          line: index + 1,
          text: lines[index].trim().slice(0, MAX_SEARCH_LINE),
        });
        if (matches.length >= max) {
          truncated = true;
          return;
        }
        if (regexStarted && (index & 63) === 0 && Date.now() - regexStarted > REGEX_BUDGET_MS) {
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
        const child = path.join(dir, entry.name);
        if (isSecretPath(rel(child, base))) continue;
        if (entry.isDirectory()) {
          if (!SEARCH_SKIP.has(entry.name)) visit(child, depth + 1);
        } else if (entry.isFile()) {
          scanFile(child);
        }
      }
    };

    if (stat.isDirectory()) visit(real, 0);
    else scanFile(real);

    return { root: rel(real, base), matches, scanned, truncated };
  }

  /** Find files by name or glob without following symlinks or scanning generated folders. */
  function find(pattern, options = {}) {
    refuseSecret(options.path || '.');
    const matches = findMatcher(pattern);
    const max = Math.min(Math.max(Number(options.maxResults) || 100, 1), MAX_FIND_RESULTS);
    const { real, base } = resolveInside(options.path || '.');
    let stat;
    try {
      stat = fs.statSync(real);
    } catch {
      throw bad('No such folder.', 404);
    }
    if (!stat.isDirectory()) throw bad('That is not a folder.');

    const files = [];
    let scanned = 0;
    let truncated = false;
    const visit = (dir, depth) => {
      if (truncated || depth > MAX_FIND_DEPTH) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (truncated) return;
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SEARCH_SKIP.has(entry.name)) visit(child, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        if (scanned >= MAX_FIND_FILES) {
          truncated = true;
          return;
        }
        const relative = rel(child, base);
        if (isSecretPath(relative)) continue;
        scanned += 1;
        if (!matches(relative)) continue;
        let size = 0;
        try {
          size = fs.statSync(child).size;
        } catch {
          size = 0;
        }
        files.push({ path: relative, size });
        if (files.length >= max) {
          truncated = true;
          return;
        }
      }
    };
    visit(real, 0);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { root: rel(real, base), files, scanned, truncated };
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
   * Find the page a chat should reopen when Preview is selected after a reload.
   * This is deliberately a small scan, not a project search: generated pages
   * normally live at the root or one folder down, and every candidate must
   * stay inside the same realpath-checked workspace as every other file.
   */
  function findPreviewEntry() {
    const found = [];
    const walk = (dir, depth) => {
      if (found.length >= MAX_PREVIEW_SCAN || depth > 4) return;
      let listing;
      try {
        listing = list(dir || '.');
      } catch {
        return;
      }
      for (const entry of listing.entries) {
        if (entry.name.startsWith('.')) continue;
        const child = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.type === 'dir') {
          if (!PREVIEW_SKIP.has(entry.name)) walk(child, depth + 1);
        } else if (PREVIEW_ENTRY.test(entry.name)) {
          found.push(child);
          if (found.length >= MAX_PREVIEW_SCAN) return;
        }
      }
    };
    walk('', 0);
    found.sort((a, b) => previewEntryScore(a) - previewEntryScore(b) || a.localeCompare(b));
    return found[0] ?? null;
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

  /** Capture the exact bytes of one file for an undo checkpoint. */
  function snapshot(relativePath) {
    refuseSecret(relativePath);
    const target = String(relativePath ?? '').trim();
    if (!target) throw bad('A file path is required.');
    const { real, base } = resolveInside(target);
    let stat;
    try {
      stat = fs.statSync(real);
    } catch (error) {
      if (error?.code === 'ENOENT') return { path: rel(real, base), exists: false, size: 0, buffer: null };
      throw bad('That file could not be read for a checkpoint.', 500);
    }
    if (!stat.isFile()) throw bad('That is not a file.');
    if (stat.size > MAX_ASSET_BYTES) {
      throw bad(`That file is too large to checkpoint (${Math.round(MAX_ASSET_BYTES / 1024 / 1024)} MB limit).`, 413);
    }
    const buffer = fs.readFileSync(real);
    return { path: rel(real, base), exists: true, size: buffer.length, buffer };
  }

  /** Restore a checkpoint. A null buffer removes a file that did not exist. */
  function restore(relativePath, buffer) {
    refuseSecret(relativePath);
    const target = String(relativePath ?? '').trim();
    if (!target) throw bad('A file path is required.');
    const { real, base } = resolveInside(target);

    if (buffer === null || buffer === undefined) {
      let stat;
      try {
        stat = fs.lstatSync(real);
      } catch (error) {
        if (error?.code === 'ENOENT') return { path: rel(real, base), removed: false, size: 0 };
        throw bad('That checkpoint file could not be removed.', 500);
      }
      if (!stat.isFile() && !stat.isSymbolicLink()) throw bad('That is not a file.');
      fs.rmSync(real, { force: true });
      let parent = path.dirname(real);
      while (parent !== base && parent.startsWith(base + path.sep)) {
        try {
          if (fs.readdirSync(parent).length > 0) break;
          fs.rmdirSync(parent);
        } catch {
          break;
        }
        parent = path.dirname(parent);
      }
      return { path: rel(real, base), removed: true, size: 0 };
    }

    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'utf8');
    if (data.length > MAX_ASSET_BYTES) {
      throw bad(`That checkpoint is too large to restore (${Math.round(MAX_ASSET_BYTES / 1024 / 1024)} MB limit).`, 413);
    }
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, data);
    return { path: rel(real, base), removed: false, size: data.length };
  }

  return {
    root,
    isReady: Boolean(root),
    list,
    read,
    readAsset,
    exists,
    write,
    search,
    find,
    readMany,
    findPreviewEntry,
    isSecretPath,
    previewPatch,
    applyPatch,
    snapshot,
    restore,
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
  MAX_FIND_RESULTS,
  MAX_FIND_FILES,
  MAX_READ_MANY_FILES,
  MAX_READ_MANY_BYTES,
  MAX_PATCH_EDITS,
};
