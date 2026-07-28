'use strict';

const balance = require('./balance');

// [^|;&]* keeps a match from crossing command separators, so
// `git add && git commit` matches on the second segment only.
const TEST_RE = /\b(npx\s+)?(jest|vitest|mocha|pytest|py\.test|go\s+test|cargo\s+(test|nextest)|swift\s+test|xcodebuild[^|;&]*\btest\b|npm\s+(test|run\s+test[\w:.-]*)|yarn\s+test|pnpm\s+test|bun\s+test|node\s+--test|rspec|phpunit|ctest|dotnet\s+test)\b/;
const GIT_PUSH_RE = /\bgit\b[^|;&]*\bpush\b/;
const GIT_COMMIT_RE = /\bgit\b[^|;&]*\bcommit\b/;
const BUILD_RE = /\b(npm\s+run\s+build|tsc\b|cargo\s+build|make\b|go\s+build|swift\s+build|xcodebuild(?![^|;&]*\btest\b)|vite\s+build|next\s+build|webpack|docker\s+build)\b/;

// Our own entrypoints, matched as an invoked path token: `node bin/rpg.js`,
// `node /abs/…/bin/rpg.js`, `./bin/rpg.js`. This used to be a bare
// `cmd.includes('idle-claude-rpg')`, which dropped *every* event for any command
// whose text merely mentioned the project — so working inside this repo
// (`cd ~/Projects/idle-claude-rpg && git commit …`) silently earned nothing.
// `demo`/`settings` are qualified with `bin/` because those are common
// filenames elsewhere; `rpg.js` is distinctive enough to stand alone.
const SELF_RE = /(?:^|[\s|;&"'])(?:[^\s|;&"']*\/)?(?:rpg\.js|bin\/(?:demo|settings)\.js)(?=$|[\s|;&"'])/;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// tool_response for Bash is documented as {exit_code, output} under content,
// but parse defensively; unknown shape = success (fail open toward fun).
function bashExitCode(tr) {
  try {
    if (!tr || typeof tr !== 'object') return 0;
    if (typeof tr.exit_code === 'number') return tr.exit_code;
    const cnt = tr.content;
    if (cnt && typeof cnt === 'object' && !Array.isArray(cnt) && typeof cnt.exit_code === 'number') {
      return cnt.exit_code;
    }
    if (Array.isArray(cnt)) {
      for (const b of cnt) if (b && typeof b.exit_code === 'number') return b.exit_code;
    }
  } catch (_) { /* fall through */ }
  return 0;
}

function countLines(toolName, ti) {
  if (!ti || typeof ti !== 'object') return 0;
  let text = '';
  if (toolName === 'Edit') text = String(ti.new_string || '');
  else if (toolName === 'Write') text = String(ti.content || '');
  else if (toolName === 'NotebookEdit') text = String(ti.new_source || '');
  else if (toolName === 'MultiEdit') {
    const edits = Array.isArray(ti.edits) ? ti.edits : [];
    return Math.min(balance.LINE_CAP,
      edits.reduce((n, e) => n + String((e && e.new_string) || '').split('\n').length, 0));
  }
  if (!text) return 0;
  return Math.min(balance.LINE_CAP, text.split('\n').length);
}

// hook stdin JSON → {e, m} game event, or null for no event
function classify(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.hook_event_name === 'Stop') return { e: 'rest', m: {} };
  if (input.hook_event_name !== 'PostToolUse') return null;

  const tool = input.tool_name;
  if (tool === 'Bash') {
    const cmd = String((input.tool_input && input.tool_input.command) || '');
    if (!cmd) return null;
    if (SELF_RE.test(cmd)) return null; // no self-farming via /hero
    const ok = bashExitCode(input.tool_response) === 0;
    if (TEST_RE.test(cmd)) return { e: ok ? 'test_pass' : 'test_fail', m: {} };
    if (!ok) return { e: 'bash_fail', m: {} };
    if (GIT_PUSH_RE.test(cmd)) return { e: 'push', m: {} };
    if (GIT_COMMIT_RE.test(cmd)) return { e: 'commit', m: {} };
    if (BUILD_RE.test(cmd)) return { e: 'attack_build', m: {} };
    return { e: 'attack_jab', m: {} };
  }

  if (EDIT_TOOLS.has(tool)) {
    const lines = countLines(tool, input.tool_input);
    if (lines <= 0) return null;
    return { e: 'attack_lines', m: { lines } };
  }

  return null;
}

module.exports = { classify, bashExitCode, countLines, TEST_RE, BUILD_RE, GIT_PUSH_RE, GIT_COMMIT_RE, SELF_RE };
