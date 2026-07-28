'use strict';
// `settings.js merge` is the only thing in this repo that writes to a file the
// user did not create for us, and settings.json is the file that decides what
// runs on every tool call in every session. So it gets tested the way it runs:
// as a subprocess against a real settings.json in a throwaway CLAUDE_CONFIG_DIR.
//
// The rules worth pinning are the ones whose failures are silent or expensive:
// a second run must not double-wire the hook (the hero would tick twice per
// event), a run after moving the clone must repoint rather than append (a stale
// absolute path fails open, so the game just quietly stops), and nothing here
// may drop a hook or a status line that belongs to somebody else.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SETTINGS_JS = path.join(REPO, 'bin', 'settings.js');
const HOOK_JS = path.join(REPO, 'hooks', 'rpg-hook.js');
const LINE_JS = path.join(REPO, 'statusline', 'rpg-statusline.js');

// A guardrail that must survive every operation here untouched.
const GUARDRAIL = {
  matcher: 'Bash',
  hooks: [{ type: 'command', command: 'node "/home/u/.claude/hooks/git-guardrail.js"' }],
};

function sandbox(initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-settings-'));
  const file = path.join(dir, 'settings.json');
  // A save dir of its own as well as a settings dir: `check` reads the save,
  // and a test that reads the developer's real hero passes or fails by accident.
  const home = path.join(dir, 'state');
  fs.mkdirSync(home, { recursive: true });
  if (initial !== undefined) fs.writeFileSync(file, typeof initial === 'string' ? initial : JSON.stringify(initial, null, 2));
  return { dir, file, home };
}

function run(dir, args, { expectFail = false, home = path.join(dir, 'state') } = {}) {
  try {
    const stdout = execFileSync('node', [SETTINGS_JS, ...args], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir, IDLE_RPG_HOME: home },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.ok(!expectFail, `expected a nonzero exit from: ${args.join(' ')}`);
    return stdout;
  } catch (e) {
    assert.ok(expectFail, `unexpected failure from ${args.join(' ')}: ${e.stderr || e.message}`);
    return (e.stdout || '') + (e.stderr || '');
  }
}

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

// Every hook command anywhere in the file that belongs to this game.
function ourHooks(data) {
  const out = [];
  for (const [event, groups] of Object.entries(data.hooks || {})) {
    for (const g of groups || []) {
      for (const h of g.hooks || []) if (String(h.command).includes('rpg-hook.js')) out.push({ event, ...h });
    }
  }
  return out;
}

test('merge creates settings.json when there is none', () => {
  const { dir, file } = sandbox();
  run(dir, ['merge']);
  const data = read(file);
  assert.equal(ourHooks(data).length, 2, 'one PostToolUse hook and one Stop hook');
  assert.ok(data.hooks.PostToolUse[0].matcher.includes('Bash'));
  assert.ok(data.statusLine.command.includes(LINE_JS));
  assert.equal(data.statusLine.refreshInterval, 1, 'animations need a 1s refresh');
  assert.equal(data.statusLine.padding, 0, 'the art needs the full width');
});

test('merge preserves unrelated settings and other hook events', () => {
  const { dir, file } = sandbox({
    model: 'opus', env: { FOO: 'bar' },
    hooks: { PreToolUse: [GUARDRAIL], SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
  });
  run(dir, ['merge']);
  const data = read(file);
  assert.equal(data.model, 'opus');
  assert.deepEqual(data.env, { FOO: 'bar' });
  assert.deepEqual(data.hooks.PreToolUse, [GUARDRAIL], 'guardrails are untouched');
  assert.equal(data.hooks.SessionStart[0].hooks[0].command, 'echo hi');
  assert.equal(ourHooks(data).length, 2);
});

test('merge is idempotent — three runs wire the hook once', () => {
  const { dir, file } = sandbox({ hooks: { PreToolUse: [GUARDRAIL] } });
  run(dir, ['merge']);
  run(dir, ['merge']);
  const out = run(dir, ['merge']);
  assert.equal(ourHooks(read(file)).length, 2, 'no duplicate hooks — a double hook ticks the hero twice per event');
  assert.match(out, /already wired/);
});

test('merge repoints a hook left behind by a moved clone instead of appending', () => {
  // The failure this prevents is silent: the old path fails open, so the game
  // stops ticking with no error anywhere.
  const stale = 'node "/somewhere/else/idle-claude-rpg/hooks/rpg-hook.js"';
  const { dir, file } = sandbox({
    hooks: {
      PreToolUse: [GUARDRAIL],
      PostToolUse: [{ matcher: 'Bash|Edit', hooks: [{ type: 'command', command: stale, timeout: 5 }] }],
      Stop: [{ hooks: [{ type: 'command', command: stale, timeout: 5 }] }],
    },
    statusLine: { type: 'command', command: 'node "/somewhere/else/idle-claude-rpg/statusline/rpg-statusline.js"' },
  });
  const out = run(dir, ['merge']);
  const data = read(file);
  const ours = ourHooks(data);
  assert.equal(ours.length, 2, 'repointed, not appended alongside the stale pair');
  for (const h of ours) assert.ok(h.command.includes(HOOK_JS), `repointed at this clone: ${h.command}`);
  assert.ok(data.statusLine.command.includes(LINE_JS));
  assert.match(out, /stale/);
  assert.deepEqual(data.hooks.PreToolUse, [GUARDRAIL]);
});

test('merge refuses to take a status line that is already someone else’s', () => {
  const mine = { type: 'command', command: 'node "/home/u/my-own-statusline.js"' };
  const { dir, file } = sandbox({ statusLine: mine });
  const out = run(dir, ['merge']);
  const data = read(file);
  assert.deepEqual(data.statusLine, mine, 'the user’s status line survives verbatim');
  assert.equal(ourHooks(data).length, 2, 'the hooks still go in — a half install that ticks beats an aborted one');
  assert.match(out, /left as yours|--force/);
});

test('merge --force replaces a foreign status line, and says so', () => {
  const { dir, file } = sandbox({ statusLine: { type: 'command', command: 'node "/home/u/my-own-statusline.js"' } });
  const out = run(dir, ['merge', '--force']);
  assert.ok(read(file).statusLine.command.includes(LINE_JS));
  assert.match(out, /REPLACED/);
});

test('merge backs up the previous settings.json verbatim', () => {
  const before = { model: 'opus', hooks: { PreToolUse: [GUARDRAIL] } };
  const { dir, file } = sandbox(before);
  const original = fs.readFileSync(file, 'utf8');
  run(dir, ['merge']);
  const bak = fs.readdirSync(dir).filter(f => f.startsWith('settings.json.bak-'));
  assert.equal(bak.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, bak[0]), 'utf8'), original);
});

test('merge refuses to touch a settings.json it cannot parse', () => {
  const broken = '{ "model": "opus", }  // trailing comma';
  const { dir, file } = sandbox(broken);
  const out = run(dir, ['merge'], { expectFail: true });
  assert.equal(fs.readFileSync(file, 'utf8'), broken, 'left exactly as found');
  assert.match(out, /not valid JSON/);
});

test('remove strips only our wiring, leaving co-tenants in place', () => {
  const mixed = {
    matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit',
    hooks: [
      { type: 'command', command: 'node "/home/u/other-tool.js"' },
      { type: 'command', command: `node "${HOOK_JS}"`, timeout: 5 },
    ],
  };
  const { dir, file } = sandbox({ hooks: { PreToolUse: [GUARDRAIL], PostToolUse: [mixed] } });
  run(dir, ['remove']);
  const data = read(file);
  assert.equal(ourHooks(data).length, 0);
  assert.equal(data.hooks.PostToolUse[0].hooks.length, 1, 'the co-tenant hook survives in its group');
  assert.match(data.hooks.PostToolUse[0].hooks[0].command, /other-tool/);
  assert.deepEqual(data.hooks.PreToolUse, [GUARDRAIL]);
});

test('remove drops the empty shells it created but not a foreign status line', () => {
  const { dir, file } = sandbox({ hooks: { PreToolUse: [GUARDRAIL] } });
  run(dir, ['merge']);
  const mine = { type: 'command', command: 'node "/home/u/my-own-statusline.js"' };
  const withMine = read(file); withMine.statusLine = mine;
  fs.writeFileSync(file, JSON.stringify(withMine, null, 2));
  run(dir, ['remove']);
  const data = read(file);
  assert.ok(!data.hooks.Stop, 'the Stop array we added is gone, not left as []');
  assert.ok(!data.hooks.PostToolUse, 'ditto PostToolUse');
  assert.deepEqual(data.hooks.PreToolUse, [GUARDRAIL], 'the guardrail survives a full uninstall');
  assert.deepEqual(data.statusLine, mine);
});

test('merge then remove round-trips back to the original file', () => {
  const before = { model: 'opus', env: { FOO: 'bar' }, hooks: { PreToolUse: [GUARDRAIL] } };
  const { dir, file } = sandbox(before);
  run(dir, ['merge']);
  run(dir, ['remove']);
  assert.deepEqual(read(file), before);
});

test('check reports a missing hook rather than claiming everything is fine', () => {
  const { dir } = sandbox({ hooks: { PreToolUse: [GUARDRAIL] } });
  const out = run(dir, ['check'], { expectFail: true });
  assert.match(out, /PostToolUse hook not wired/);
  assert.match(out, /problem\(s\) found/);
});

test('check passes on a freshly merged install', () => {
  const { dir } = sandbox({ hooks: { PreToolUse: [GUARDRAIL] } });
  fs.mkdirSync(path.join(dir, 'skills', 'hero'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'skill', 'SKILL.md'), path.join(dir, 'skills', 'hero', 'SKILL.md'));
  run(dir, ['merge']);
  const out = run(dir, ['check']);
  assert.doesNotMatch(out, /FAIL/);
});

test('check reads the hero out of a real save', () => {
  // Pinned because it is read off the save's own shape: the first cut of this
  // read guessed `state.name` / `state.class` and printed "undefined the ?"
  // against a perfectly healthy save, which is worse than not printing it.
  const { dir, home } = sandbox({ hooks: { PreToolUse: [GUARDRAIL] } });
  execFileSync('node', [path.join(REPO, 'bin', 'rpg.js'), 'init', '--class', 'rogue', '--name', 'Doctor'], {
    env: { ...process.env, IDLE_RPG_HOME: home }, stdio: 'ignore',
  });
  const out = run(dir, ['check'], { expectFail: true }); // fails on the unwired hooks, not the save
  assert.match(out, /hero: Doctor the rogue, level 1/);
  assert.doesNotMatch(out, /undefined/);
});

test('check names a missing hero as a nudge, not a failure', () => {
  const { dir } = sandbox({ hooks: { PreToolUse: [GUARDRAIL] } });
  const out = run(dir, ['check'], { expectFail: true });
  assert.match(out, /warn no hero yet/);
  assert.match(out, /\/hero init/);
});

test('print emits the snippet with this clone’s absolute paths', () => {
  const { dir } = sandbox();
  const out = run(dir, ['print']);
  assert.ok(out.includes(HOOK_JS), 'the hook path is absolute and points here');
  assert.ok(out.includes(LINE_JS));
  assert.match(out, /"statusLine"/);
});
