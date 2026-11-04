// Turn test-runner output into a small, model-readable failure list. Pure and
// framework-agnostic so the tool result is useful even when a project prints a
// format we only partly recognise.
const MAX_FAILURES = 20;
const MAX_MESSAGE = 300;

export function parseTestOutput(output, { exitCode = null } = {}) {
  const text = String(output ?? '');
  const lines = text.split('\n');
  const failures = [];
  const add = (test, file, line, message) => {
    if (failures.length >= MAX_FAILURES) return;
    failures.push({
      test: String(test ?? '').trim() || '(unnamed test)',
      file: file ? String(file) : null,
      line: Number(line) || null,
      message: String(message ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE),
    });
  };

  let framework = 'unknown';
  if (/^not ok \d+/m.test(text) || /^# Subtest:/m.test(text)) framework = 'node';
  else if (/^FAILED .+::/m.test(text) || /^=+ FAILURES/m.test(text)) framework = 'pytest';
  else if (/^test .+ \.\.\. FAILED/m.test(text)) framework = 'cargo';
  else if (/^--- FAIL: /m.test(text)) framework = 'go';

  if (framework === 'node') {
    for (let i = 0; i < lines.length; i += 1) {
      const match = /not ok \d+ - (.+)/.exec(lines[i]);
      if (!match) continue;
      let file = null;
      let line = null;
      const messages = [];
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j += 1) {
        const location = /location: '([^']+):(\d+):(\d+)'/.exec(lines[j]);
        if (location) {
          file = location[1];
          line = location[2];
        }
        const error = /error: '([^']*)'/.exec(lines[j]);
        if (error) messages.push(error[1]);
      }
      add(match[1], file, line, messages.join(' ') || 'test failed');
    }
  } else if (framework === 'pytest') {
    for (const line of lines) {
      const match = /^FAILED (.+?)::([^\s]+)(?: - (.*))?$/.exec(line.trim());
      if (match) add(match[2], match[1], null, match[3] || 'test failed');
    }
    if (failures.length === 0) {
      const match = /^E\s+(.+)$/m.exec(text);
      if (match) add('pytest failure', null, null, match[1]);
    }
  } else if (framework === 'cargo') {
    for (let i = 0; i < lines.length; i += 1) {
      const match = /^test (.+) \.\.\. FAILED/.exec(lines[i]);
      if (!match) continue;
      let file = null;
      let line = null;
      let message = 'test failed';
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j += 1) {
        const panic = /panicked at (.+):(\d+):(\d+)/.exec(lines[j]);
        if (panic) {
          file = panic[1];
          line = panic[2];
          message = lines[j + 1]?.trim() || message;
          break;
        }
      }
      add(match[1], file, line, message);
    }
  } else if (framework === 'go') {
    for (let i = 0; i < lines.length; i += 1) {
      const match = /^\s*--- FAIL: (\S+)/.exec(lines[i]);
      if (!match) continue;
      let file = null;
      let line = null;
      let message = 'test failed';
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j += 1) {
        const where = /^\s*(\S+_test\.go):(\d+): (.+)$/.exec(lines[j]);
        if (where) {
          file = where[1];
          line = where[2];
          message = where[3];
          break;
        }
      }
      add(match[1], file, line, message);
    }
  }

  if (failures.length === 0 && exitCode !== 0 && exitCode !== null) {
    const tail = lines.filter((line) => line.trim()).slice(-3).join(' ');
    add('test command failed', null, null, tail || 'the test command exited non-zero');
  }

  const passed = exitCode === 0 && failures.length === 0;
  return {
    framework,
    passed,
    exitCode,
    failures,
    summary: passed
      ? 'Tests passed.'
      : `${failures.length || 'Some'} failing test${failures.length === 1 ? '' : 's'}.`,
  };
}
