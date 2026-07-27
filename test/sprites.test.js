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

test('every class has hero art and a one-line sprite', () => {
  for (const id of Object.keys(C.classes)) {
    assert.ok(S.heroesBig[id], `${id}: no big art`);
    assert.ok(S.heroes[id] && S.heroes[id].idle, `${id}: no one-line sprite`);
  }
});
