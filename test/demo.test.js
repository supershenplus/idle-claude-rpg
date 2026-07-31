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

for (const [mode, cols] of [['big', 100], ['compact', 60], ['compact', 30]]) {
  test(`every scene renders in the ${mode} HUD at ${cols} cols`, () => {
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

test('NO_COLOR emits no escape sequences at all', () => {
  // For piping a scene into a file or an issue report. Deliberately keyed off
  // the env var and NOT off isTTY: the status line's stdout is a pipe by
  // construction, since Claude Code captures it, so a TTY check would strip
  // the colour from the one place that most needs it.
  const plain = execFileSync('node', [DEMO, 'boss', '--cols', '90'],
    { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.doesNotMatch(plain, /\x1b\[/, 'escape sequences survive NO_COLOR');
  assert.match(plain, /BOSS: AURELIA/, 'stripped the content along with the colour');

  const coloured = execFileSync('node', [DEMO, 'boss', '--cols', '90'],
    { encoding: 'utf8', env: { ...process.env, NO_COLOR: '' } });
  assert.match(coloured, /\x1b\[/, 'an empty NO_COLOR should not disable colour');

  const R = require('../lib/render');
  assert.strictEqual(R.visible(coloured), plain,
    'the two differ by more than colour — NO_COLOR is changing the layout');
});

// ---- --frames ----
//
// The flag exists because the frames worth checking are the ones nobody catches
// in play: a 1500ms blow is sampled once or twice at the statusline's redraw
// rate, so "run it and wait" shows you a random one of five. Walking a scene is
// also the only way to see a *sequence* — that the recoil recovers, that the
// mark crosses — rather than a still.
test('--frames walks a blow across its whole script', () => {
  const sprites = require('../lib/sprites');
  const out = demo(['loose', '--frames', '--cols', '100']);
  const labels = out.split('\n').map(l => require('../lib/render').visible(l).trim())
    .filter(l => /^frame \d/.test(l));
  assert.strictEqual(labels.length, sprites.BEATS,
    `walked ${labels.length} frames of a ${sprites.BEATS}-frame script`);
  // Every frame is named on its own clock, and the impact is called out, so the
  // output can be read against `sprites.attacks` rather than counted by eye.
  labels.forEach((l, i) => assert.ok(l.startsWith(`frame ${i} `), `frame ${i} is labelled ${l}`));
  assert.strictEqual(labels.filter(l => l.includes('impact')).length, 1,
    'the impact frame is not called out exactly once');
  assert.ok(labels[sprites.hitFrame('ranger')].includes('impact'),
    'the impact is marked on a frame the script does not land on');
});

test('the frames a walk prints are actually different pictures', () => {
  // The failure this catches is the flag being a no-op: five renders of one
  // frame look plausible until you notice the arrow never moves. Scenes are
  // rebuilt per frame, so a state mutated by the previous render would show up
  // here too.
  const R = require('../lib/render');
  const scenes = demo(['loose', '--frames', '--cols', '100'])
    .split('\n').filter(l => l.startsWith('⠀')).map(R.visible);
  assert.ok(scenes.length >= 10, `only ${scenes.length} HUD rows across the walk`);
  // The waist row is where both the hero's grip and the mark in the gap live.
  const waists = scenes.filter(l => l.includes('▚░▒██▓▬') || l.includes('▚░▒██▓▬┼──▶'));
  assert.ok(new Set(waists).size >= 4,
    `the walk drew ${new Set(waists).size} distinct waist rows — the frames are not moving`);
});

test('a banner scene walks its flash instead of a script it does not have', () => {
  // Banners have no attack script; what they do over time is alternate two
  // colours on the flat tick. Walking them on the blow grid would print five
  // identical marquees, so the walk asks each scene which clock it runs on.
  const out = demo(['boss', '--frames', '--cols', '100']);
  const R = require('../lib/render');
  const ticks = out.split('\n').map(l => R.visible(l).trim()).filter(l => /^tick \d/.test(l));
  assert.strictEqual(ticks.length, 2, `walked ${ticks.length} ticks of a two-tick flash`);
  const banners = out.split('\n').filter(l => l.includes('BOSS: AURELIA'));
  assert.strictEqual(banners.length, 2, 'the banner is not drawn once per tick');
  assert.notStrictEqual(banners[0], banners[1], 'both ticks drew the same colour — the flash is dead');
});

test('a scene with no animation still renders once under --frames', () => {
  const out = demo(['fresh', '--frames', '--cols', '100']);
  assert.match(out, /Whispering Grove/, 'an unanimated scene vanished under the walk');
  assert.doesNotMatch(out, /frame \d/, 'a scene with no anim was given frames to walk');
});
