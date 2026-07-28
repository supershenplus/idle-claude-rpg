'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classify } = require('../lib/classify');

function bash(command, exit_code) {
  return {
    hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command },
    tool_response: { type: 'text', content: { exit_code, output: '' } },
  };
}

test('bash command classification', () => {
  const cases = [
    ['ls -la', 0, 'attack_jab'],
    ['ls /nope', 1, 'bash_fail'],
    ['cargo test', 0, 'test_pass'],
    ['npm test', 1, 'test_fail'],
    ['npx vitest run', 0, 'test_pass'],
    ['pytest tests/', 0, 'test_pass'],
    ['swift test', 0, 'test_pass'],
    ['go test ./...', 0, 'test_pass'],
    ['node --test test/', 0, 'test_pass'],
    ['npm run test:unit', 0, 'test_pass'],
    ['xcodebuild -scheme App test', 0, 'test_pass'],
    // "git commit -m 'run tests'" is a commit, not a test — TEST_RE must not fire on the word "tests"
    ['git commit -m "run tests"', 0, 'commit'],
    ['git add -A && git commit -m "x"', 0, 'commit'],
    ['git push origin main', 0, 'push'],
    ['git commit -m "x" && git push', 0, 'push'], // push wins over commit
    ['git push --dry-run', 0, 'push'],
    ['git status', 0, 'attack_jab'],
    // known accepted false positive: quoted "git commit" text still matches
    // (avoiding it would need real shell parsing; harmless for a game)
    ['echo "git commit is fun"', 0, 'commit'],
    ['git log --oneline | head', 0, 'attack_jab'],
    ['cargo build --release', 0, 'attack_build'],
    ['tsc --noEmit', 0, 'attack_build'],
    ['make -j8', 0, 'attack_build'],
    ['xcodebuild -scheme App build', 0, 'attack_build'],
    ['git commit --amend --no-edit', 1, 'bash_fail'], // failed commit is no smite
  ];
  for (const [cmd, code, expected] of cases) {
    const ev = classify(bash(cmd, code));
    assert.ok(ev, `no event for: ${cmd}`);
    assert.strictEqual(ev.e, expected, `"${cmd}" (exit ${code}) → ${ev.e}, want ${expected}`);
  }
});

test('self-farming via the game CLI yields no event', () => {
  for (const cmd of [
    'node /home/dev/Projects/idle-claude-rpg/bin/rpg.js status',
    'node bin/rpg.js status',
    './bin/rpg.js sell all --confirm',
    'node bin/demo.js boss',
    'node bin/settings.js --check',
    'IDLE_RPG_HOME=/tmp/x node bin/rpg.js fold',
  ]) {
    assert.strictEqual(classify(bash(cmd, 0)), null, `should not farm: ${cmd}`);
  }
});

test('real work inside the game repo still counts', () => {
  // The old guard was a bare `cmd.includes('idle-claude-rpg')`, so every command
  // run while working on this project — the one repo its author uses most —
  // silently produced no event at all.
  const cases = [
    ['cd /home/dev/Projects/idle-claude-rpg && git commit -am fix', 'commit'],
    ['git -C /home/dev/Projects/idle-claude-rpg push origin main', 'push'],
    ['node --test /home/dev/Projects/idle-claude-rpg/test/state.test.js', 'test_pass'],
    ['ls /home/dev/Projects/idle-claude-rpg/lib', 'attack_jab'],
    ['grep -rn rpg.json /home/dev/Projects/idle-claude-rpg', 'attack_jab'],
  ];
  for (const [cmd, expected] of cases) {
    const ev = classify(bash(cmd, 0));
    assert.ok(ev, `no event for: ${cmd}`);
    assert.strictEqual(ev.e, expected, `"${cmd}" → ${ev.e}, want ${expected}`);
  }
});

test('edit tools count lines from tool_input', () => {
  const ev = classify({
    hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: '/t', old_string: 'a', new_string: 'x\ny\nz' },
  });
  assert.deepStrictEqual(ev, { e: 'attack_lines', m: { lines: 3 } });

  const big = classify({
    hook_event_name: 'PostToolUse', tool_name: 'Write',
    tool_input: { file_path: '/t', content: Array(5000).fill('l').join('\n') },
  });
  assert.strictEqual(big.m.lines, 300, 'line cap applies');

  const multi = classify({
    hook_event_name: 'PostToolUse', tool_name: 'MultiEdit',
    tool_input: { edits: [{ new_string: 'a\nb' }, { new_string: 'c' }] },
  });
  assert.strictEqual(multi.m.lines, 3);
});

test('stop → rest, unknown/malformed → null', () => {
  assert.strictEqual(classify({ hook_event_name: 'Stop' }).e, 'rest');
  assert.strictEqual(classify({ hook_event_name: 'PostToolUse', tool_name: 'Grep', tool_input: {} }), null);
  assert.strictEqual(classify(null), null);
  assert.strictEqual(classify({}), null);
});

test('undocumented tool_response shapes fail open as success', () => {
  const ev = classify({
    hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'cargo test' },
    tool_response: { type: 'text', content: [{ type: 'text', text: 'ok' }] },
  });
  assert.strictEqual(ev.e, 'test_pass');
});
