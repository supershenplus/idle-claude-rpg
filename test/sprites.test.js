'use strict';
// The big sprites are laid out by centring each row on a cell count, so the art
// has invariants the renderer silently depends on: a fixed row count, and
// glyphs that are exactly one terminal cell wide. A stray kaomoji character
// (｀皿ᴥ are all two cells) skews every column in the battle scene without
// throwing anything, which is exactly the kind of bug a test should catch.
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../lib/sprites');
const C = require('../lib/content');
const R = require('../lib/render');

// Widest sprite that still leaves room for the hero + gap at the 76-column
// threshold where the big HUD turns on.
const MAX_MOB_W = 13;
const MAX_BOSS_W = 17;

function bigArt() {
  const out = [];
  for (const [id, art] of Object.entries(S.heroesBig)) out.push([`hero:${id}`, art, MAX_MOB_W]);
  const bossIds = new Set(C.zones.map(z => z.boss.id));
  for (const [id, art] of Object.entries(S.monstersBig)) {
    out.push([`monster:${id}`, art, bossIds.has(id) ? MAX_BOSS_W : MAX_MOB_W]);
  }
  out.push(['dead', S.DEAD_MONSTER_BIG, MAX_MOB_W]);
  return out;
}

test('every big sprite is exactly BIG_ROWS rows', () => {
  for (const [label, art] of bigArt()) {
    assert.ok(Array.isArray(art), `${label}: not an array`);
    assert.strictEqual(art.length, S.BIG_ROWS, `${label}: wrong row count`);
  }
});

test('big sprites use only single-cell glyphs', () => {
  for (const [label, art] of bigArt()) {
    art.forEach((line, i) => {
      assert.strictEqual(typeof line, 'string', `${label} row ${i}: not a string`);
      for (const ch of line) {
        const cp = ch.codePointAt(0);
        assert.strictEqual(R.charWidth(cp), 1,
          `${label} row ${i}: ${JSON.stringify(ch)} (U+${cp.toString(16)}) is not 1 cell wide`);
      }
    });
  }
});

test('big sprites fit the battle scene at 76 columns', () => {
  for (const [label, art, cap] of bigArt()) {
    const w = Math.max(...art.map(R.width));
    assert.ok(w <= cap, `${label}: ${w} cells wide, max ${cap}`);
    assert.ok(w >= 5, `${label}: only ${w} cells wide`);
  }
});

test('no big sprite row has trailing whitespace', () => {
  for (const [label, art] of bigArt()) {
    art.forEach((line, i) => {
      assert.strictEqual(line, line.replace(/\s+$/, ''), `${label} row ${i}: trailing whitespace`);
    });
  }
});

test('every monster and boss in content.js has big art', () => {
  for (const z of C.zones) {
    for (const m of [...z.monsters, z.boss]) {
      assert.ok(S.monstersBig[m.id], `${z.id}/${m.id}: no big art`);
    }
  }
});

// Attack poses are swapped in for the idle art mid-animation, so they live or
// die on lining up with it. The renderer centres each row inside the hero's
// block; a pose row narrower than the block would be nudged by half the
// difference and the sprite would slide sideways on the frame it was held —
// which reads as the artist's fault rather than the renderer's. Padding every
// row to the full block width is what makes that centring a no-op, so that is
// what gets pinned here.
function poses() {
  const out = [];
  for (const [cls, byName] of Object.entries(S.heroPoses)) {
    for (const [name, art] of Object.entries(byName)) out.push([`${cls}/${name}`, cls, art]);
  }
  return out;
}

test('every attack pose matches the shape of its class idle art', () => {
  for (const [label, cls, art] of poses()) {
    assert.ok(S.heroesBig[cls], `${label}: pose for a class with no idle art`);
    const block = Math.max(...S.heroesBig[cls].map(R.width));
    assert.strictEqual(art.length, S.BIG_ROWS, `${label}: wrong row count`);
    art.forEach((line, i) => {
      assert.strictEqual(R.width(line), block,
        `${label} row ${i}: ${R.width(line)} cells, must be padded to the ${block}-cell block`);
      for (const ch of line) {
        const cp = ch.codePointAt(0);
        assert.strictEqual(R.charWidth(cp), 1,
          `${label} row ${i}: ${JSON.stringify(ch)} (U+${cp.toString(16)}) is not 1 cell wide`);
      }
    });
  }
});

// Three of the four classes throw something, and the projectile in the gap is
// supposed to *be* that thing: the ranger's arrow, the rogue's dagger, the
// wizard's orb. If it is still in the sprite's hands while its copy flies across
// the screen, the shot reads as a decoration rather than as the attack. The
// knight is deliberately absent — it swings a sword it never lets go of, and
// keeping it out of this table is what says so.
const THROWN = {
  ranger: ['release', ['┼', '▶']],
  rogue: ['throw', ['╪']],
  wizard: ['blast', ['★']],
};

test('a released pose has given up whatever it throws', () => {
  for (const [cls, [pose, glyphs]] of Object.entries(THROWN)) {
    const held = S.heroesBig[cls].join('\n');
    const released = S.heroPoses[cls][pose].join('\n');
    for (const ch of glyphs) {
      assert.ok(held.includes(ch), `${cls} idle is missing ${ch} — nothing left to throw`);
      assert.ok(!released.includes(ch), `${cls}/${pose}: ${ch} is still in hand after the release`);
    }
  }
  assert.ok(S.heroPoses.knight.strike.join('\n').includes('╪'),
    'the knight let go of its sword — the swing is not a throw');
});

test('every class scripts its own attack', () => {
  for (const id of Object.keys(C.classes)) {
    assert.ok(S.attacks[id],
      `${id}: no attack script — it falls back to the generic mark in the gap`);
    assert.ok(S.heroPoses[id] && Object.keys(S.heroPoses[id]).length,
      `${id}: an attack script with no poses is a recoil and nothing else`);
  }
});

// A hit can start while the previous one is still fading, and between blows the
// layout assumes the hero is standing where it says it is. Both hold only if
// every script begins and ends at rest.
test('every attack script opens and closes at rest on the hero mark', () => {
  for (const [cls, a] of Object.entries(S.attacks)) {
    for (const [when, f] of [['opens', a.frames[0]], ['closes', a.frames[a.frames.length - 1]]]) {
      assert.strictEqual(f.pose, null, `${cls}: ${when} on a pose instead of the idle art`);
      assert.strictEqual(f.back, 0, `${cls}: ${when} ${f.back} cells off its mark`);
      assert.strictEqual(f.fly, null, `${cls}: ${when} with a projectile already in the gap`);
    }
    assert.ok(a.frames.some(f => f.back > 0), `${cls}: the hero never moves at all`);
    assert.ok(a.frames.some(f => f.pose), `${cls}: the hero never changes pose`);
  }
});

test('a projectile only ever travels forward, and starts short of the target', () => {
  for (const [cls, a] of Object.entries(S.attacks)) {
    const fly = a.frames.map(f => f.fly).filter(v => v != null);
    assert.ok(fly.length >= 2, `${cls}: the shot is on screen for one frame`);
    for (let i = 1; i < fly.length; i++) {
      assert.ok(fly[i] >= fly[i - 1], `${cls}: the shot flew backwards: ${fly}`);
    }
    assert.ok(fly[0] < 1, `${cls}: the shot is already home on the frame it leaves`);
    assert.strictEqual(fly[fly.length - 1], 1, `${cls}: the shot never arrives: ${fly}`);
  }
});

// The mark in the gap is anchored to the projectile's *position* once a script
// is moving it, so a head wider than one cell is the first thing to run out of
// room at the far end of the flight — R.fit eats the projectile and leaves a
// trail pointing at nothing. The wizard's `☆ﾟ.*` did exactly that the moment it
// got a script, having been fine for as long as nothing moved it.
test('every projectile and trail is a single cell', () => {
  for (const [id, h] of Object.entries(S.heroes)) {
    assert.strictEqual(R.width(h.proj), 1, `${id}: projectile ${JSON.stringify(h.proj)} is not 1 cell`);
    assert.strictEqual(R.width(h.trail), 1, `${id}: trail ${JSON.stringify(h.trail)} is not 1 cell`);
  }
});

// Frames past the end of the hit are dead art: `attackFrame` clamps to the last
// entry, so anything beyond the animation's own length simply never draws.
test('no attack script runs past the animation it plays over', () => {
  const E = require('../lib/engine');
  const st = E.newState('wizard', 'Fixture', 1);
  st.monster.hp = st.monster.maxHp = 1e9;      // survive the blow, so no kill anim
  E.dealDamage(st, 1, {}, () => 0.99, 1);      // 0.99: no crit, no retaliation
  const hit = st.anim.find(a => a.type === 'hit');
  assert.ok(hit, 'the engine no longer queues a hit anim');
  const budget = Math.ceil(hit.dur / S.FRAME_MS);
  for (const [cls, a] of Object.entries(S.attacks)) {
    assert.ok(a.frames.length <= budget,
      `${cls}: ${a.frames.length} frames for a ${hit.dur}ms hit — the last ${a.frames.length - budget} never draw`);
  }
});

test('every scripted attack frame names a pose its class actually has', () => {
  for (const [cls, a] of Object.entries(S.attacks)) {
    assert.ok(S.heroesBig[cls], `${cls}: attack script for an unknown class`);
    assert.ok(a.frames.length > 0, `${cls}: empty attack script`);
    for (const [i, f] of a.frames.entries()) {
      if (f.pose) {
        assert.ok(S.heroPoses[cls] && S.heroPoses[cls][f.pose],
          `${cls} frame ${i}: no pose named ${f.pose}`);
      }
      assert.ok(f.back >= 0 && f.back <= S.MAX_RECOIL, `${cls} frame ${i}: recoil out of range`);
      assert.ok(f.fly == null || (f.fly >= 0 && f.fly <= 1), `${cls} frame ${i}: fly out of 0..1`);
    }
    assert.ok(a.hitFrame >= 0 && a.hitFrame < a.frames.length,
      `${cls}: hitFrame ${a.hitFrame} lands outside the script`);
    assert.strictEqual(a.frames[a.hitFrame].fly, 1,
      `${cls}: the damage lands on a frame where the projectile has not arrived`);
  }
});

// ---- the monster's half ----
//
// One script for 28 monsters, so there is no per-monster case to check — what
// there is instead is a set of invariants the hero's four scripts each get
// checked against individually, and which this one has to satisfy alone.

test('the monster opens and closes its swing on its own mark', () => {
  const f = S.monsterAttack.frames;
  for (const [when, fr] of [['opens', f[0]], ['closes', f[f.length - 1]]]) {
    assert.strictEqual(fr.shove, 0, `${when} ${fr.shove} cells off its mark`);
    assert.strictEqual(fr.hero, 0, `${when} with the hero already driven back`);
    assert.strictEqual(fr.fly, null, `${when} with a blow already in the gap`);
  }
  assert.ok(f.some(fr => fr.shove > 0), 'the monster never comes forward at all');
  assert.ok(f.some(fr => fr.shove < 0), 'the monster swings with no wind-up');
  assert.strictEqual(S.MONSTER_FLINCH[S.MONSTER_FLINCH.length - 1].shove, 0,
    'a flinch leaves the monster standing off its mark');
});

test("the monster's blow crosses the gap toward the hero and arrives", () => {
  const fly = S.monsterAttack.frames.map(f => f.fly).filter(v => v != null);
  assert.ok(fly.length >= 2, 'the blow is on screen for one frame');
  for (let i = 1; i < fly.length; i++) {
    assert.ok(fly[i] >= fly[i - 1], `the blow travelled backwards: ${fly}`);
  }
  assert.ok(fly[0] < 1, 'the blow is already home on the frame it is thrown');
  assert.strictEqual(fly[fly.length - 1], 1, `the blow never arrives: ${fly}`);
  assert.strictEqual(S.monsterAttack.frames[S.MONSTER_HIT_FRAME].fly, 1,
    'the HP comes off on a frame where the blow has not landed');
});

// Same reasoning as the hero's projectile: the mark is anchored to the blow's
// position in the gap, so a head wider than a cell runs out of room first.
test("the monster's mark is a single cell and belongs to nothing else", () => {
  for (const [what, ch] of [['head', S.MONSTER_PROJ], ['trail', S.MONSTER_TRAIL]]) {
    assert.strictEqual(R.width(ch), 1, `${what} ${JSON.stringify(ch)} is not 1 cell`);
  }
  // Monsters face left, so ◀ is the obvious head and half the roster already
  // wears one as a maw — a mark drawn from glyphs the art uses reads as a piece
  // of the monster that came loose, and is untestable besides.
  const drawn = new Set();
  for (const art of [...Object.values(S.heroesBig), ...Object.values(S.monstersBig),
    ...Object.values(S.heroPoses).flatMap(p => Object.values(p)), S.DEAD_MONSTER_BIG]) {
    for (const row of art) for (const ch of row) drawn.add(ch);
  }
  for (const h of Object.values(S.heroes)) { drawn.add(h.proj); drawn.add(h.trail); }
  for (const [what, ch] of [['head', S.MONSTER_PROJ], ['trail', S.MONSTER_TRAIL]]) {
    assert.ok(!drawn.has(ch), `the monster's ${what} ${ch} is also drawn as art somewhere`);
  }
});

// The hero's margin is a clamp against column 0; this is the one against the
// right-hand edge, where nothing throws — R.fit just trims the line and a
// knocked-back boss quietly loses its last columns.
test('the reserved margins cover every displacement that can happen', () => {
  for (const [i, f] of S.monsterAttack.frames.entries()) {
    assert.ok(-f.shove <= S.MAX_MONSTER_BACK, `attack frame ${i} winds up past the reserve`);
    assert.ok(f.hero >= 0 && f.hero <= S.MAX_RECOIL, `attack frame ${i} drives the hero past its margin`);
    assert.ok(f.fly == null || (f.fly >= 0 && f.fly <= 1), `attack frame ${i}: fly out of 0..1`);
  }
  for (const [i, f] of S.MONSTER_FLINCH.entries()) {
    assert.ok(-f.shove <= S.MAX_MONSTER_BACK, `flinch frame ${i} is knocked past the reserve`);
  }
  assert.ok(S.MAX_MONSTER_BACK > 0, 'nothing on the monster side moves at all');
});

// Both scripts are read by frame index off the same 1500ms animation the hero's
// are, and `monsterAttackFrame` clamps past the end — so frames beyond it are
// art nobody ever sees. The flinch is the tighter case: it does not start until
// the hero's blow lands, so it has only the frames left after that one.
test('neither monster script runs past the animation it plays over', () => {
  const E = require('../lib/engine');
  const st = E.newState('wizard', 'Fixture', 1);
  st.monster.hp = st.monster.maxHp = 1e9;
  E.monsterStrikes(st, 5, 1);
  const blow = st.anim.find(a => a.type === 'mhit');
  assert.ok(blow, 'the engine no longer queues a frame for an unprovoked blow');
  const budget = Math.ceil(blow.dur / S.FRAME_MS);
  assert.ok(S.monsterAttack.frames.length <= budget,
    `${S.monsterAttack.frames.length} frames for a ${blow.dur}ms blow`);
  for (const cls of Object.keys(S.attacks)) {
    assert.ok(S.hitFrame(cls) + S.MONSTER_FLINCH.length <= budget,
      `the ${cls} lands on frame ${S.hitFrame(cls)}, leaving no room for the flinch`);
  }
});

test('every class has hero art and a one-line sprite', () => {
  for (const id of Object.keys(C.classes)) {
    assert.ok(S.heroesBig[id], `${id}: no big art`);
    assert.ok(S.heroes[id] && S.heroes[id].idle, `${id}: no one-line sprite`);
  }
});
