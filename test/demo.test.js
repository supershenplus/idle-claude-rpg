'use strict';
// The demo scenes exist to be looked at, which means nothing fails loudly when
// one rots — a scene that stopped rendering its banner still prints a perfectly
// good battle scene, and you only notice when you go to take a screenshot.
//
// These are also the only place several banners get exercised at all: a
// legendary drop, a boss intro and a death are rare by design, so "run the game
// and wait" doesn't cover them. Rendering every scene in every layout is the
// cheapest coverage this repo has of the animation branches.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

const DEMO = path.join(__dirname, '..', 'bin', 'demo.js');

function demo(args, { expectFail = false } = {}) {
  try {
    const out = execFileSync('node', [DEMO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.ok(!expectFail, `expected failure from: ${args.join(' ')}`);
    return out;
  } catch (e) {
    assert.ok(expectFail, `unexpected failure from ${args.join(' ')}: ${e.stderr || e.message}`);
    return (e.stdout || '') + (e.stderr || '');
  }
}

const SCENES = demo(['--list']).trim().split('\n').map(l => l.trim().split(/\s+/)[0]);

test('--list names every scene', () => {
  assert.ok(SCENES.length >= 10, `only ${SCENES.length} scenes`);
  for (const s of SCENES) assert.match(s, /^[a-z]+$/);
});

for (const [mode, cols] of [['big', 100], ['compact', 60], ['mini', 40]]) {
  test(`every scene renders in the ${mode} HUD`, () => {
    for (const scene of SCENES) {
      const out = demo([scene, '--mode', mode, '--cols', String(cols)]);
      assert.ok(out.includes(scene), `${scene}: not labelled in its own output`);
      // A blown template renders the word rather than throwing.
      assert.doesNotMatch(out, /undefined|NaN|\[object Object\]/, `${scene}/${mode}: a value failed to interpolate`);
    }
  });
}

test('scene output survives the same per-line trim as the live HUD', () => {
  // Same transform Claude Code applies. A demo whose indentation does not
  // survive it is showing a scene the player will never actually see.
  for (const scene of SCENES) {
    const body = demo([scene, '--mode', 'big', '--cols', '100'])
      .split('\n').filter(l => l.startsWith('⠀'));
    assert.ok(body.length, `${scene}: rendered no HUD rows`);
    for (const line of body) assert.strictEqual(line.trim(), line, `${scene}: indentation is lost to the trim`);
  }
});

test('every banner-bearing scene actually draws its banner', () => {
  // The point of these scenes; each is a distinct branch of bannerText().
  const wants = {
    boss: /BOSS: AURELIA/, bossdown: /DEFEATED/, levelup: /LEVEL UP — 24/,
    loot: /\[legendary\].*dropped/, death: /drove you off/, away: /while away/,
    kill: /slain/, insight: /✦41/,
  };
  for (const [scene, re] of Object.entries(wants)) {
    assert.match(demo([scene, '--cols', '100']), re, `${scene}: banner missing`);
  }
});

test('gold in a banner is formatted like gold everywhere else', () => {
  // Caught by looking at a screenshot: the death banner printed a bare -21594g
  // beside a vitals line reading 410,300g.
  const out = demo(['death', '--cols', '100']);
  assert.match(out, /-21,594g/, 'death loss is unseparated');
  assert.doesNotMatch(out, /-21594g/);
  assert.match(demo(['away', '--cols', '100']), /\+890g/);
});

test('a hero the engine would never build is not screenshottable', () => {
  // maxHp is derived, not asserted: the demo poses heroes, so the numbers it
  // prints have to be ones the real engine produces.
  const E = require('../lib/engine');
  const st = E.newState('wizard', 'X', Date.now());
  st.hero.level = 60;
  E.refreshMaxHp(st);
  assert.ok(st.hero.maxHp > 0 && Number.isFinite(st.hero.maxHp));
  assert.match(demo(['insight', '--cols', '100']), new RegExp(`/${st.hero.maxHp}`),
    'the capped scene quotes a maxHp the engine disagrees with');
});

test('an unknown scene fails loudly instead of rendering nothing', () => {
  const out = demo(['nosuchscene'], { expectFail: true });
  assert.match(out, /unknown scene/);
});
