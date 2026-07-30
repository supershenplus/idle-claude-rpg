'use strict';
// The character roster: several heroes per install, one of them active.
//
// Every test here runs the real binaries in a subprocess against a throwaway
// IDLE_RPG_HOME, and that is not incidental. `lib/paths` resolves the active
// character once per process and caches it — which is exactly right for a game
// whose hook, statusline and CLI are each a fresh process, and exactly wrong for
// an in-process test, which would measure the first answer forever.
//
// The layout under test:
//
//   characters/<slug>/state.json     one directory per hero, filenames unchanged
//   active                           one line, naming the slug being played
//   events.ndjson, state.lock        global, and deliberately so
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'bin', 'rpg.js');
const HOOK = path.join(REPO, 'hooks', 'rpg-hook.js');
const R = require('../lib/render');

const mkhome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-roster-'));

function run(home, args, env = {}) {
  return R.visible(execFileSync('node', [CLI, ...args], {
    env: { ...process.env, IDLE_RPG_HOME: home, IDLE_RPG_HERO: '', ...env },
    encoding: 'utf8',
  }));
}

// A command that exits non-zero still has something to say, and here what it
// says is the whole point.
function runFail(home, args, env = {}) {
  try {
    run(home, args, env);
    assert.fail(`expected \`${args.join(' ')}\` to exit non-zero`);
  } catch (e) {
    assert.ok(e.status, `expected a non-zero exit, got ${e.status}`);
    return R.visible(String(e.stdout || ''));
  }
}

const hook = (home, fixture) => execFileSync('node', [HOOK], {
  env: { ...process.env, IDLE_RPG_HOME: home },
  input: fs.readFileSync(path.join(__dirname, 'fixtures', fixture)),
  stdio: ['pipe', 'pipe', 'pipe'],
});

const charDir = (home, slug) => path.join(home, 'characters', slug);
const saveOf = (home, slug) =>
  JSON.parse(fs.readFileSync(path.join(charDir(home, slug), 'state.json'), 'utf8'));
const activeOf = home => fs.readFileSync(path.join(home, 'active'), 'utf8').trim();
const slugsIn = home => fs.readdirSync(path.join(home, 'characters')).sort();

function makeHero(home, cls, name, env = {}) {
  run(home, ['init', '--class', cls, '--name', name], env);
}

// ---- init is no longer destructive ----

test('a second init adds a hero instead of overwriting the first', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Gavin');

  assert.deepStrictEqual(slugsIn(home), ['hero_1', 'hero_2']);
  assert.strictEqual(saveOf(home, 'hero_1').hero.name, 'Eva', 'the first hero was overwritten');
  assert.strictEqual(saveOf(home, 'hero_2').hero.name, 'Gavin');
  // …and the new one is the one you are playing, because that is what asking
  // for a hero means.
  assert.strictEqual(activeOf(home), 'hero_2');

  const out = run(home, ['roster']);
  assert.match(out, /Eva the Wizard/);
  assert.match(out, /Gavin the Knight/);
  assert.match(out, /Characters \(2\)/);
});

test('init says the other heroes are safe, since it used to delete them', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  const out = run(home, ['init', '--class', 'rogue', '--name', 'Nix']);
  assert.match(out, /1 other character untouched/);
});

// ---- switching ----

test('switch takes a number, an id, or the start of a name', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Gavin');

  run(home, ['switch', '1']);
  assert.strictEqual(activeOf(home), 'hero_1');
  run(home, ['switch', 'hero_2']);
  assert.strictEqual(activeOf(home), 'hero_2');
  const out = run(home, ['switch', 'ev']);
  assert.strictEqual(activeOf(home), 'hero_1');
  assert.match(out, /Now playing Eva the Wizard/);

  // The number is what you just read off the roster, so it has to agree with it.
  assert.match(run(home, ['status']), /Eva the Wizard/);
});

test('an ambiguous name switches nothing and says what it matched', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Evan');
  const out = runFail(home, ['switch', 'ev']);
  assert.match(out, /matches 2 heroes/);
  assert.match(out, /Eva.*Evan|Evan.*Eva/);
  assert.strictEqual(activeOf(home), 'hero_2', 'a refused switch moved the pointer anyway');
});

test('an unknown name switches nothing', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  assert.match(runFail(home, ['switch', 'nobody']), /No character called "nobody"/);
  assert.strictEqual(activeOf(home), 'hero_1');
});

// ---- one save dir, many windows ----

test('$IDLE_RPG_HERO pins one window without moving the machine', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Gavin');
  run(home, ['switch', '1']);

  // The pinned window plays its own hero…
  assert.match(run(home, ['status'], { IDLE_RPG_HERO: 'hero_2' }), /Gavin the Knight/);
  // …and every other window is still on the machine-wide one.
  assert.match(run(home, ['status']), /Eva the Wizard/);
  assert.strictEqual(activeOf(home), 'hero_1', 'a pinned window rewrote the shared pointer');
});

test('a switch from a pinned window warns that this window will not follow', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Gavin');
  const out = run(home, ['switch', '1'], { IDLE_RPG_HERO: 'hero_2' });
  assert.strictEqual(activeOf(home), 'hero_1', 'the machine-wide switch did not happen');
  assert.match(out, /it stays on hero_2/, 'the window silently disagreed with the command');
});

test('$IDLE_RPG_HERO cannot name a path outside the save directory', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  // A slug is a path segment, and this is the one input to it that comes from
  // outside the game. Ignored, not obeyed.
  const out = run(home, ['roster'], { IDLE_RPG_HERO: '../../../etc' });
  assert.match(out, /not a valid hero id/);
  assert.match(run(home, ['status'], { IDLE_RPG_HERO: '../../../etc' }), /Eva the Wizard/);
  assert.deepStrictEqual(slugsIn(home), ['hero_1'], 'a bogus pin created something');
});

test('a window pinned at an empty slug is told to switch, not to init', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  // "No hero yet" is a lie on a machine with one, and it sends you to the
  // command that used to delete the other.
  const out = runFail(home, ['status'], { IDLE_RPG_HERO: 'hero_9' });
  assert.match(out, /you have 1 character/);
  assert.match(out, /hero switch/);
});

test('init in a window pinned at an empty slug builds the hero where it can see it', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Gavin', { IDLE_RPG_HERO: 'hero_7' });
  assert.strictEqual(saveOf(home, 'hero_7').hero.name, 'Gavin');
});

// ---- the shared inbox ----

test('work events pay whoever is on the clock, and stay out of the characters', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Gavin');
  run(home, ['switch', '1']);

  hook(home, 'bash-jab.json');
  assert.strictEqual(saveOf(home, 'hero_1').eventsFolded, 1, 'the active hero was not paid');
  assert.strictEqual(saveOf(home, 'hero_2').eventsFolded, 0, 'an idle hero was paid too');

  // The inbox and the lock are install-wide: the hook appends without knowing
  // who is active and cannot afford to load a save to find out.
  for (const slug of slugsIn(home)) {
    const left = fs.readdirSync(charDir(home, slug));
    assert.deepStrictEqual(left.filter(f => f.startsWith('events') || f === 'state.lock'), [],
      `${slug} has an inbox or lock of its own`);
  }
});

// ---- delete, and the difference between it and reset ----

test('delete previews before it deletes, and names what it would take', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Gavin');

  const out = run(home, ['delete', '1']);
  assert.match(out, /This deletes Eva the Wizard/);
  assert.match(out, /1 other character would be untouched/);
  assert.match(out, /Nothing deleted yet/);
  assert.deepStrictEqual(slugsIn(home), ['hero_1', 'hero_2'], 'a preview deleted something');
});

test('delete takes one hero and every backup of them, and nobody else', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Gavin');
  // The copies a save spills into are whole save files with a playable hero in
  // them, so "forever" has to reach them too.
  const spilled = ['state.bak.json', 'state.v1.json', `state.corrupt-${Date.now()}.json`];
  for (const f of spilled) fs.copyFileSync(path.join(charDir(home, 'hero_1'), 'state.json'),
    path.join(charDir(home, 'hero_1'), f));

  run(home, ['delete', 'Eva', '--confirm']);
  assert.deepStrictEqual(slugsIn(home), ['hero_2'], 'the directory outlived the hero');
  assert.strictEqual(saveOf(home, 'hero_2').hero.name, 'Gavin', 'deleting one took the other');
  // The inbox is shared, so deleting one character must not empty it.
  assert.strictEqual(fs.existsSync(path.join(home, 'characters', 'hero_1')), false);
});

test('deleting the hero you are playing leaves you on a real one', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Gavin');
  assert.strictEqual(activeOf(home), 'hero_2');

  const out = run(home, ['delete', '--confirm']);   // no argument: the active one
  assert.match(out, /Deleted Gavin the Knight/);
  assert.strictEqual(activeOf(home), 'hero_1', 'the pointer was left dangling');
  assert.match(run(home, ['status']), /Eva the Wizard/);
});

test('deleting your only hero leaves no pointer to a hero that is not there', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  const out = run(home, ['delete', '--confirm']);
  assert.match(out, /hero init to start over/);
  assert.strictEqual(fs.existsSync(path.join(home, 'active')), false);
  assert.match(runFail(home, ['status']), /No hero yet/);
});

test('reset says it takes every character, because it does', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Gavin');

  // The wording has to change in the same breath as the behaviour: "this
  // deletes your hero forever" is now true of a different, smaller command.
  const refused = runFail(home, ['reset']);
  assert.match(refused, /all 2 of your characters/);
  assert.match(refused, /hero delete <n> --confirm/, 'reset never mentions the scalpel');
  assert.deepStrictEqual(slugsIn(home), ['hero_1', 'hero_2']);

  run(home, ['reset', '--confirm']);
  assert.deepStrictEqual(slugsIn(home), [], 'a character survived the nuclear option');
  assert.strictEqual(fs.existsSync(path.join(home, 'active')), false);
  assert.strictEqual(fs.existsSync(path.join(home, 'events.ndjson')), false);
});

// ---- migrating an install that predates all of this ----

// What a pre-roster install looks like on disk: everything flat in the root.
function legacyInstall(name = 'Legacy') {
  const home = mkhome();
  run(home, ['init', '--class', 'rogue', '--name', name]);
  const dir = charDir(home, 'hero_1');
  for (const f of fs.readdirSync(dir)) fs.renameSync(path.join(dir, f), path.join(home, f));
  fs.rmSync(path.join(home, 'characters'), { recursive: true, force: true });
  fs.rmSync(path.join(home, 'active'), { force: true });
  return home;
}

test('a pre-roster install is adopted without the player noticing', () => {
  const home = legacyInstall('Ancient');
  // Everything a save spills into, all of it flat in the root the old way.
  for (const f of ['state.bak.2.json', 'state.bak.json', 'state.v1.json', 'state.corrupt-1700000000000.json']) {
    fs.copyFileSync(path.join(home, 'state.json'), path.join(home, f));
  }

  assert.match(run(home, ['status']), /Ancient the Rogue/, 'the hero did not survive the move');
  assert.strictEqual(activeOf(home), 'hero_1');
  assert.strictEqual(fs.existsSync(path.join(home, 'state.json')), false, 'the save was copied, not moved');

  // The backups are the whole recovery story, so they have to come along —
  // stranding them at the top level loses the history silently.
  const moved = fs.readdirSync(charDir(home, 'hero_1'));
  for (const f of ['state.json', 'state.bak.2.json', 'state.bak.json', 'state.v1.json',
    'state.corrupt-1700000000000.json']) {
    assert.ok(moved.includes(f), `${f} was left behind at the top level`);
  }
});

test('the shared files stay where they were when a save is adopted', () => {
  const home = legacyInstall();
  fs.writeFileSync(path.join(home, 'events.ndjson'), '');
  run(home, ['roster']);
  assert.ok(fs.existsSync(path.join(home, 'events.ndjson')), 'the inbox was dragged into a character');
});

test('an adoption interrupted before the save moves is resumed, not restarted', () => {
  const home = legacyInstall('Half');
  // The crash this ordering exists for: the backups made it down, `state.json`
  // did not. The next process has to finish into the *same* directory, or the
  // hero and its history end up in two different characters.
  fs.mkdirSync(charDir(home, 'hero_1'), { recursive: true });
  fs.renameSync(path.join(home, 'state.bak.1.json'),
    path.join(charDir(home, 'hero_1'), 'state.bak.1.json'));

  assert.match(run(home, ['status']), /Half the Rogue/);
  assert.deepStrictEqual(slugsIn(home), ['hero_1'], 'the resumed adoption made a second character');
  const files = fs.readdirSync(charDir(home, 'hero_1')).sort();
  assert.ok(files.includes('state.json') && files.includes('state.bak.1.json'),
    'the hero and its backups landed in different places');
});

test('a save restored into the old location becomes a new character, not an overwrite', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  // Someone drops a backup back where saves used to live. Adoption must not
  // write it over the hero already sitting in hero_1.
  fs.copyFileSync(path.join(charDir(home, 'hero_1'), 'state.json'), path.join(home, 'state.json'));

  run(home, ['roster']);
  assert.deepStrictEqual(slugsIn(home), ['hero_1', 'hero_2']);
  assert.strictEqual(saveOf(home, 'hero_1').hero.name, 'Eva', 'the live hero was overwritten');
});

// ---- fail-open, everywhere ----

test('a dangling active pointer finds a hero rather than reporting none', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  fs.writeFileSync(path.join(home, 'active'), 'hero_404\n');
  // Losing the pointer must never cost you access to a hero that is right there
  // on disk.
  assert.match(run(home, ['status']), /Eva the Wizard/);
});

test('a missing active pointer falls back to the first hero on disk', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Gavin');
  fs.rmSync(path.join(home, 'active'));
  assert.match(run(home, ['status']), /Eva the Wizard/);
});

test('an unreadable save still gets a row in the roster', () => {
  const home = mkhome();
  makeHero(home, 'wizard', 'Eva');
  makeHero(home, 'knight', 'Gavin');
  fs.writeFileSync(path.join(charDir(home, 'hero_1'), 'state.json'), '{"hero":{TRUNCATED');
  // A roster that quietly omits a hero is the one thing it must not do — that
  // is how you conclude a character is gone and delete the directory.
  const out = run(home, ['roster']);
  assert.match(out, /Characters \(2\)/);
  assert.match(out, /unreadable save/);
});
