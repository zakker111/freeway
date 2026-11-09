// Per-turn file checkpoints for model writes. The store keeps only the before
// image of each changed file, never the after image: undo restores the previous
// bytes or removes a file that did not exist. It is deliberately in memory and
// bounded, like the browser session, so a checkpoint cannot outlive the process
// or grow without limit.

import { randomUUID } from 'node:crypto';

export const CHECKPOINT_LIMITS = Object.freeze({
  maxCheckpoints: 20,
  maxFiles: 24,
  maxBytes: 4 * 1024 * 1024,
});

const CHECKPOINT_TOOLS = new Set(['write_file', 'apply_patch', 'scaffold_project']);

/**
 * The paths a confirmed tool is about to change. `preview` is the result of
 * workspace.previewPatch() and `layout` is scaffoldLayout(); neither writes.
 */
export function checkpointPaths(name, input = {}, { preview = null, layout = null } = {}) {
  if (!CHECKPOINT_TOOLS.has(name)) return [];
  if (name === 'apply_patch') return preview?.path ? [preview.path] : [];
  if (name === 'scaffold_project') return Array.isArray(layout?.paths) ? layout.paths : [];
  return typeof input?.path === 'string' && input.path.trim() ? [input.path.trim()] : [];
}

function checkpointView(checkpoint) {
  return {
    id: checkpoint.id,
    at: checkpoint.at,
    tool: checkpoint.tool,
    files: checkpoint.files.map((file) => ({
      path: file.path,
      existed: file.existed,
      size: file.size,
    })),
    bytes: checkpoint.bytes,
  };
}

/**
 * @param {object} options
 * @param {number} options.maxCheckpoints most recent checkpoints kept per chat
 * @param {number} options.maxBytes total before-image bytes kept per chat
 * @param {() => number} options.now clock injection for tests
 * @param {() => string} options.id generator injection for tests
 */
export function createCheckpointStore({
  maxCheckpoints = CHECKPOINT_LIMITS.maxCheckpoints,
  maxBytes = CHECKPOINT_LIMITS.maxBytes,
  now = Date.now,
  id = randomUUID,
} = {}) {
  const stacks = new Map();

  function stackFor(owner, root) {
    const key = `${String(owner || 'legacy')}\0${String(root || '')}`;
    let stack = stacks.get(key);
    if (!stack) {
      stack = { items: [], bytes: 0 };
      stacks.set(key, stack);
    }
    return stack;
  }

  function trim(stack) {
    while (stack.items.length > maxCheckpoints) {
      stack.bytes -= stack.items.shift().bytes;
    }
    while (stack.bytes > maxBytes && stack.items.length > 1) {
      stack.bytes -= stack.items.shift().bytes;
    }
  }

  /**
   * Capture the before state. Throws instead of silently creating an
   * un-undoable checkpoint; the caller must not run the write in that case.
   */
  function prepare(workspace, paths, { owner = 'legacy', tool = 'write' } = {}) {
    if (!workspace?.isReady || !workspace.root) {
      throw Object.assign(new Error('No workspace folder is set. Choose one in Settings.'), { status: 400 });
    }
    const unique = [...new Set((Array.isArray(paths) ? paths : []).map((path) => String(path ?? '').trim()).filter(Boolean))];
    if (unique.length === 0) {
      throw Object.assign(new Error('No file path was supplied for the checkpoint.'), { status: 400 });
    }
    if (unique.length > CHECKPOINT_LIMITS.maxFiles) {
      throw Object.assign(
        new Error(`A checkpoint can cover at most ${CHECKPOINT_LIMITS.maxFiles} files.`),
        { status: 400 },
      );
    }

    const files = unique.map((path) => {
      const snapshot = workspace.snapshot(path);
      return {
        path: snapshot.path,
        existed: snapshot.exists,
        size: snapshot.size,
        buffer: snapshot.buffer,
      };
    });
    const bytes = files.reduce((sum, file) => sum + file.size, 0);
    return {
      id: id(),
      at: new Date(now()).toISOString(),
      owner: String(owner || 'legacy'),
      root: workspace.root,
      tool: String(tool || 'write').slice(0, 40),
      files,
      bytes,
    };
  }

  /** Keep a prepared checkpoint after its write succeeded. */
  function commit(checkpoint) {
    if (!checkpoint) return null;
    const stack = stackFor(checkpoint.owner, checkpoint.root);
    stack.items.push(checkpoint);
    stack.bytes += checkpoint.bytes;
    trim(stack);
    return checkpointView(checkpoint);
  }

  function latest(owner, workspace) {
    if (!workspace?.isReady || !workspace.root) return null;
    const stack = stacks.get(`${String(owner || 'legacy')}\0${String(workspace.root || '')}`);
    const checkpoint = stack?.items.at(-1);
    return checkpoint ? checkpointView(checkpoint) : null;
  }

  /**
   * Restore the newest checkpoint, or the one named by `checkpointId` when it
   * is still the newest. Refusing an older id prevents an accidental undo from
   * silently throwing away a newer edit.
   */
  function undo(owner, workspace, checkpointId = null) {
    if (!workspace?.isReady || !workspace.root) {
      throw Object.assign(new Error('No workspace folder is set. Choose one in Settings.'), { status: 400 });
    }
    const stack = stacks.get(`${String(owner || 'legacy')}\0${String(workspace.root || '')}`);
    const checkpoint = stack?.items.at(-1);
    if (!checkpoint) {
      throw Object.assign(new Error('There is no checkpoint to undo in this chat.'), { status: 404 });
    }
    if (checkpointId && String(checkpointId) !== checkpoint.id) {
      throw Object.assign(new Error('Undo the newest change first.'), { status: 409 });
    }

    for (const file of [...checkpoint.files].reverse()) {
      workspace.restore(file.path, file.existed ? file.buffer : null);
    }
    stack.items.pop();
    stack.bytes -= checkpoint.bytes;
    return checkpointView(checkpoint);
  }

  function clear(owner, workspace) {
    if (owner === undefined && workspace === undefined) {
      stacks.clear();
      return;
    }
    stacks.delete(`${String(owner || 'legacy')}\0${String(workspace?.root || '')}`);
  }

  return { prepare, commit, latest, undo, clear, limits: CHECKPOINT_LIMITS };
}
