'use strict';
// Push detection, tested against real git repositories rather than fixtures —
// the whole point of this module is that it reads what git actually wrote, so a
// fake .git directory would be testing my idea of the format.
//
// This exists because the classifier only ever sees commands Claude runs. A
// push typed with `!`, made in a second terminal, or made from an IDE fires no
// hook at all, and the War Horn is the headline feature. It was found the
// honest way: three real pushes, counters.pushes still 0.
//
// The rule under test is "the remote-tracking ref moved AND now equals local
// HEAD". The second half is what separates a push from a fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const GW = require('../lib/gitwatch');

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  },
}).trim();

// A clone with a real (bare) upstream, which is the only way to get genuine
// refs/remotes/* entries that move only when something is actually pushed.
function repoPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-git-'));
  const bare = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  git(root, 'init', '--bare', '-b', 'main', bare);
  git(root, 'clone', '-q', bare, work);
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'one');
  git(work, 'push', '-q', 'origin', 'main');
  return { root, bare, work };
}

function commit(work, text) {
  fs.appendFileSync(path.join(work, 'a.txt'), text + '\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', text);
}

test('a push fires exactly once, and only after a first sighting is recorded', () => {
  const { work } = repoPair();
  const state = {};

  const first = GW.sync(state, work);
  assert.equal(first.pushed, false, 'the first look at a repo must not fire');
  assert.equal(first.firstSight, true);
  assert.equal(first.recorded, true, 'the first sighting still has to persist');

  assert.equal(GW.sync(state, work).pushed, false, 'an idle poll fires nothing');

  commit(work, 'two');
  assert.equal(GW.sync(state, work).pushed, false, 'committing is not pushing');

  git(work, 'push', '-q', 'origin', 'main');
  assert.equal(GW.sync(state, work).pushed, true, 'the push was missed');
  assert.equal(GW.sync(state, work).pushed, false, 'the same push fired twice');
});

test('a fetch that brings down someone else’s work is not a push', () => {
  // The discriminator. origin/main advancing is necessary but not sufficient:
  // it has to advance to a commit you already have.
  const { bare, work, root } = repoPair();
  const other = path.join(root, 'other');
  git(root, 'clone', '-q', bare, other);
  commit(other, 'theirs');
  git(other, 'push', '-q', 'origin', 'main');

  const state = {};
  GW.sync(state, work);                       // record the pre-fetch position
  git(work, 'fetch', '-q', 'origin');
  const r = GW.sync(state, work);
  assert.equal(r.pushed, false, 'a fetch of work you do not have counted as a push');
  assert.equal(r.recorded, true, 'the moved ref still has to be recorded');

  // And having merged it, pushing again is a real push.
  git(work, 'merge', '-q', '--ff-only', 'origin/main');
  commit(work, 'mine');
  git(work, 'push', '-q', 'origin', 'main');
  assert.equal(GW.sync(state, work).pushed, true);
});

test('detection works from a subdirectory, not just the repo root', () => {
  const { work } = repoPair();
  const sub = path.join(work, 'deep', 'nested');
  fs.mkdirSync(sub, { recursive: true });
  const state = {};
  GW.sync(state, sub);
  commit(work, 'two');
  git(work, 'push', '-q', 'origin', 'main');
  assert.equal(GW.sync(state, sub).pushed, true, 'walking up to the git dir failed');
});

test('packed refs are read, not just loose ones', () => {
  // `git gc` moves refs into packed-refs; a loose-only reader goes blind at
  // exactly the moment a long-lived repo gets tidied.
  const { work } = repoPair();
  const state = {};
  GW.sync(state, work);
  commit(work, 'two');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'pack-refs', '--all');
  assert.ok(!fs.existsSync(path.join(work, '.git', 'refs', 'remotes', 'origin', 'main')),
    'precondition: the loose ref should be gone after pack-refs');
  const info = GW.inspect(work);
  assert.ok(info.upstream, 'upstream ref not found once packed');
  assert.equal(info.upstream, info.head);
});

test('a branch tracking a non-origin remote is followed', () => {
  const { bare, work } = repoPair();
  git(work, 'remote', 'rename', 'origin', 'upstream');
  const info = GW.inspect(work);
  assert.equal(info.remote, 'upstream', `read the wrong remote: ${info.remote}`);
  assert.ok(info.upstream, 'no upstream sha for a renamed remote');
  assert.ok(bare);
});

test('a repo with no upstream at all is quiet rather than noisy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-git-solo-'));
  git(root, 'init', '-q', '-b', 'main', root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'x\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'x');
  const state = {};
  const r = GW.sync(state, root);
  assert.equal(r.pushed, false);
  assert.deepEqual(state.repos, undefined, 'a repo with no remote should not be recorded at all');
});

test('a detached HEAD has nothing to push', () => {
  const { work } = repoPair();
  commit(work, 'two');
  git(work, 'checkout', '-q', '--detach', 'HEAD');
  assert.equal(GW.inspect(work), null);
  assert.equal(GW.sync({}, work).pushed, false);
});

test('somewhere that is not a repository at all is not an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-nogit-'));
  assert.equal(GW.gitDirOf(dir), null);
  assert.equal(GW.inspect(dir), null);
  const state = {};
  assert.equal(GW.sync(state, dir).pushed, false);
  assert.equal(GW.sync(state, undefined).pushed, false);
  assert.equal(GW.sync(state, '/nonexistent/nowhere').pushed, false);
});

test('the repo map stays bounded', () => {
  // A save is long-lived and follows the user across every project they open.
  const state = { repos: {} };
  for (let i = 0; i < GW.MAX_REPOS + 10; i++) state.repos[`/repo/${i}`] = 'sha' + i;
  const { work } = repoPair();
  GW.sync(state, work);
  assert.ok(Object.keys(state.repos).length <= GW.MAX_REPOS,
    `map grew to ${Object.keys(state.repos).length}`);
  assert.ok(!state.repos['/repo/0'], 'the oldest entry should be the one dropped');
});

test('two pollers sharing one save cannot fire the same push twice', () => {
  // The hook and the statusline both call sync against the same state. Whoever
  // gets there first records the sha; the other sees no change. That shared
  // record *is* the dedup — there is no window or timestamp to tune.
  const { work } = repoPair();
  const state = {};
  GW.sync(state, work);
  commit(work, 'two');
  git(work, 'push', '-q', 'origin', 'main');
  const a = GW.sync(state, work);   // the hook, say
  const b = GW.sync(state, work);   // the statusline, a fraction later
  assert.equal(a.pushed, true);
  assert.equal(b.pushed, false);
});
