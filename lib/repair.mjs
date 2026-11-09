// A host-enforced repair budget. The model still decides what to change, but
// this module decides when a failed verification has used its two repair
// cycles. Keeping the state machine pure makes the limit testable without a
// model, a subprocess, or a browser.

export const REPAIR_MAX_ATTEMPTS = 2;

const VERIFY_TOOLS = new Set(['preview_check', 'run_tests', 'run_check']);

export function isRepairCheck(name) {
  return VERIFY_TOOLS.has(name);
}

function cleanFailure(content) {
  return String(content ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function createRepairTracker({ maxAttempts = REPAIR_MAX_ATTEMPTS } = {}) {
  const limit = Math.max(0, Math.floor(Number(maxAttempts) || 0));
  let active = false;
  let check = null;
  let failures = 0;
  let written = false;
  let lastFailure = '';

  function reset() {
    active = false;
    check = null;
    failures = 0;
    written = false;
    lastFailure = '';
  }

  /**
   * Observe a verification result. `failed` starts the clock, `retry` means the
   * previous repair did not work, and `exhausted` means the host must stop
   * offering mutating tools and ask for a report.
   */
  function observe(name, outcome = {}) {
    if (!VERIFY_TOOLS.has(name)) return null;
    if (outcome.ok === true) {
      if (!active) return { state: 'pass' };
      const result = {
        state: 'passed',
        check,
        attempts: Math.max(0, failures - 1),
        maxAttempts: limit,
      };
      reset();
      return result;
    }

    if (!active) {
      active = true;
      check = name;
      failures = 0;
      written = false;
    }
    failures += 1;
    lastFailure = cleanFailure(outcome.content);
    if (failures >= limit + 1) {
      return {
        state: 'exhausted',
        check,
        attempts: limit,
        maxAttempts: limit,
        failure: lastFailure,
        written,
      };
    }
    return {
      state: failures === 1 ? 'failed' : 'retry',
      check,
      attempt: Math.min(failures, limit),
      maxAttempts: limit,
      failure: lastFailure,
      written,
    };
  }

  /** Record a successful mutating tool while a repair is active. */
  function noteMutation(name, outcome = {}) {
    if (active && outcome.ok === true && ['write_file', 'apply_patch', 'scaffold_project'].includes(name)) {
      written = true;
      return true;
    }
    return false;
  }

  function instruction(result) {
    if (!result) return '';
    if (result.state === 'exhausted') {
      return (
        `Repair limit reached for ${result.check} after ${result.maxAttempts} repair attempts. ` +
        'Do not make more changes. Report which check still fails, what you changed, and what the user should inspect. ' +
        'The latest file change can be undone from the composer.'
      );
    }
    return (
      `Verification failed: ${result.check}. Repair attempt ${result.attempt} of ${result.maxAttempts}. ` +
      'Fix only the reported failure, preserve working behavior, and re-run the same check before finishing. ' +
      'Do not start unrelated work or claim success before the check passes.'
    );
  }

  function status() {
    return {
      active,
      check,
      failures,
      maxAttempts: limit,
      written,
      failure: lastFailure,
    };
  }

  return { observe, noteMutation, instruction, reset, status, maxAttempts: limit };
}
