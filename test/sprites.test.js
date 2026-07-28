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

test('the ranger release pose has loosed its arrow', () => {
  const drawn = S.heroesBig.ranger.join('\n');
  const loosed = S.heroPoses.ranger.release.join('\n');
  for (const ch of ['┼', '▶']) {
    assert.ok(drawn.includes(ch), `the idle bow is missing ${ch} — the nocked arrow is gone`);
    assert.ok(!loosed.includes(ch), `${ch} is still on the string after the shot`);
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

test('every class has hero art and a one-line sprite', () => {
  for (const id of Object.keys(C.classes)) {
    assert.ok(S.heroesBig[id], `${id}: no big art`);
    assert.ok(S.heroes[id] && S.heroes[id].idle, `${id}: no one-line sprite`);
  }
});
