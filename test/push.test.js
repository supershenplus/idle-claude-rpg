'use strict';
// End to end: a real `git push` in a real repo reaches the hero as a War Horn,
// through the same fold the hook and the statusline both call.
//
// The regression being pinned is the one that shipped: pushes made with the `!`
// prefix, in another terminal, or from an IDE fire no PostToolUse hook, so the
// classifier never saw them and `counters.pushes` sat at 0 through three real
// pushes while `commits` counted fine.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-push-home-'));
process.env.IDLE_RPG_HOME = HOME;

const S = require('../lib/state');
const E = require('../lib/engine');

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  },
}).trim();

function repoPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-push-'));
  const bare = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  git(root, 'init', '--bare', '-b', 'main', bare);
  git(root, 'clone', '-q', bare, work);
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'one');
  git(work, 'push', '-q', 'origin', 'main');
  return { work };
}

function commitAndPush(work, text) {
  fs.appendFileSync(path.join(work, 'a.txt'), text + '\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', text);
  git(work, 'push', '-q', 'origin', 'main');
}

// A hero far enough along that a War Horn kill is unambiguous, saved fresh so
// each test starts from a known counter.
function seed() {
  for (const f of fs.readdirSync(HOME)) fs.rmSync(path.join(HOME, f), { recursive: true, force: true });
  const st = E.newState('knight', 'Horn', Date.now());
  st.hero.level = 20;
  st.hero.zone = 'caves';
  E.refreshMaxHp(st);
  st.hero.hp = st.hero.maxHp;
  S.saveState(st);
  return st;
}

test('a push made outside Claude’s tools still sounds the War Horn', () => {
  const { work } = repoPair();
  seed();

  // First fold only records where the remote is; nothing has happened yet.
  S.tryFold(Date.now(), { cwd: work });
  assert.equal(S.loadState().counters.pushes, 0, 'merely looking at a repo counted as a push');

  commitAndPush(work, 'two');

  S.tryFold(Date.now(), { cwd: work });
  const after = S.loadState();
  assert.equal(after.counters.pushes, 1, 'the push never reached the hero');
  assert.ok(after.counters.kills >= 1, 'the War Horn should have killed something');
});

test('polling an unchanged repo does not keep firing', () => {
  const { work } = repoPair();
  seed();
  S.tryFold(Date.now(), { cwd: work });
  commitAndPush(work, 'two');
  S.tryFold(Date.now(), { cwd: work });
  for (let i = 0; i < 5; i++) S.tryFold(Date.now(), { cwd: work });
  assert.equal(S.loadState().counters.pushes, 1, 'idle polls re-fired the War Horn');
});

test('the first sighting of a repo persists across folds', () => {
  // If the recorded sha did not survive the save, every poll would look like a
  // first sighting and no push would ever be detected.
  const { work } = repoPair();
  seed();
  S.tryFold(Date.now(), { cwd: work });
  const repos = S.loadState().repos;
  assert.ok(repos && Object.keys(repos).length === 1, 'the repo was not recorded in the save');
});

test('a hook-classified push and the ref moving are one War Horn, not two', () => {
  // Claude running `git push` through the Bash tool produces both signals for a
  // single push. Before the batch-level suppression this counted twice.
  const { work } = repoPair();
  seed();
  S.tryFold(Date.now(), { cwd: work });

  commitAndPush(work, 'two');
  const now = Date.now();
  S.appendEvent({ t: now, e: 'push', sid: '', m: {} });   // what the classifier queues
  S.tryFold(now, { cwd: work });

  assert.equal(S.loadState().counters.pushes, 1, 'one push was counted twice');
});

test('a commit alone is not a push', () => {
  const { work } = repoPair();
  seed();
  S.tryFold(Date.now(), { cwd: work });
  fs.appendFileSync(path.join(work, 'a.txt'), 'local\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'local only');
  S.tryFold(Date.now(), { cwd: work });
  assert.equal(S.loadState().counters.pushes, 0, 'committing sounded the War Horn');
});

test('folding without a cwd behaves exactly as before', () => {
  // Every existing caller passed no options; none of them may change behaviour.
  const { work } = repoPair();
  seed();
  commitAndPush(work, 'two');
  S.tryFold(Date.now());
  assert.equal(S.loadState().counters.pushes, 0);
});

test('a cwd that is not a repository is harmless', () => {
  seed();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-plain-'));
  assert.equal(S.tryFold(Date.now(), { cwd: dir }), true, 'the fold should still succeed');
  assert.equal(S.loadState().counters.pushes, 0);
});
