'use strict';
// The hook fixtures, finally used by something.
//
// `test/fixtures/` has carried seven recorded Claude Code hook payloads since v1
// and only `install.sh`'s smoke test ever read one of them (`bash-jab.json`).
// They were the repo's only record of the shape Claude Code actually sends —
// PostToolUse nesting, `tool_response.content.exit_code`, the Stop event's total
// lack of a tool — and nothing checked that `lib/classify.js` still understood
// it. A payload-shape change upstream would have surfaced as the hero quietly
// never levelling again, since the hook fails open by design and says nothing.
//
// Two layers, because they fail for different reasons: `classify` against each
// fixture pins the mapping, and the real hook binary against each fixture pins
// that the whole chain — parse, classify, append, fold — survives the payload.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const HOOK_JS = path.join(REPO, 'hooks', 'rpg-hook.js');
const RPG_JS = path.join(REPO, 'bin', 'rpg.js');
const FIXTURES = path.join(__dirname, 'fixtures');

const { classify } = require('../lib/classify');

// What each fixture is *for*. Kept here rather than derived, so that a fixture
// edited to mean something else fails loudly instead of re-pinning itself.
const CORPUS = [
  ['bash-jab.json', 'attack_jab', 'an ordinary shell command is the basic hit'],
  ['bash-test-pass.json', 'test_pass', 'a passing test suite, matched on the command not the output'],
  ['bash-test-fail.json', 'test_fail', 'the same command with a nonzero exit'],
  ['bash-git-commit.json', 'commit', 'a commit, recognised through the `&&` chain in front of it'],
  ['bash-git-push.json', 'push', 'a push — the War Horn'],
  ['edit.json', 'attack_lines', 'an Edit, whose damage scales with lines written'],
  ['stop.json', 'rest', 'the Stop event, which carries no tool at all'],
];

const read = name => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

for (const [file, expected, why] of CORPUS) {
  test(`classify: ${file} → ${expected} (${why})`, () => {
    const ev = classify(read(file));
    assert.ok(ev, `${file} classified as nothing at all`);
    assert.strictEqual(ev.e, expected);
  });
}

test('edit.json carries the line count the damage scales with', () => {
  // 5 lines in `new_string`. The count comes from `tool_input`, not the
  // response, because the Edit/Write `tool_response` schema is undocumented.
  assert.strictEqual(classify(read('edit.json')).m.lines, 5);
});

// ---- the same fixtures through the real hook binary ----

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-hook-'));
  execFileSync('node', [RPG_JS, 'init', '--class', 'wizard', '--name', 'Fixture'], {
    env: { ...process.env, IDLE_RPG_HOME: home }, stdio: 'ignore',
  });
  return home;
}

function pipe(home, file) {
  execFileSync('node', [HOOK_JS], {
    env: { ...process.env, IDLE_RPG_HOME: home },
    input: fs.readFileSync(path.join(FIXTURES, file)),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// Through the `active` pointer rather than a hardcoded slug, because that is
// the indirection the hook itself goes through to find the save.
const stateOf = (home) => {
  const slug = fs.readFileSync(path.join(home, 'active'), 'utf8').trim();
  return JSON.parse(fs.readFileSync(path.join(home, 'characters', slug, 'state.json'), 'utf8'));
};

for (const [file, expected] of CORPUS) {
  test(`the hook folds ${file} rather than dropping it`, () => {
    const home = sandbox();
    const before = stateOf(home).eventsFolded;
    pipe(home, file);
    assert.strictEqual(stateOf(home).eventsFolded, before + 1,
      `${file} (${expected}) reached the hook but was never folded`);
  });
}

test('the hook writes nothing to stdout — it costs zero tokens', () => {
  const home = sandbox();
  const out = execFileSync('node', [HOOK_JS], {
    env: { ...process.env, IDLE_RPG_HOME: home },
    input: fs.readFileSync(path.join(FIXTURES, 'bash-jab.json')),
    encoding: 'utf8',
  });
  assert.strictEqual(out, '', 'the hook spoke, which spends tokens on every tool call');
});

// Fail-open is the property that keeps a bug in this game out of the user's
// actual work, so it is worth a case of its own rather than trusting the
// try/catch to stay there.
test('the hook exits clean on a payload it cannot parse', () => {
  const home = sandbox();
  for (const junk of ['', 'not json', '{"hook_event_name":', 'null', '[]']) {
    const out = execFileSync('node', [HOOK_JS], {
      env: { ...process.env, IDLE_RPG_HOME: home }, input: junk, encoding: 'utf8',
    });
    assert.strictEqual(out, '', `spoke on input ${JSON.stringify(junk)}`);
  }
});
