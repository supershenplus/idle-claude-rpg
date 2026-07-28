'use strict';
// The HUD is laid out entirely with leading spaces, and Claude Code renders a
// status line as
//   stdout.trim().split('\n').flatMap(l => l.trim() || []).join('\n')
// which eats them. The art still *looks* like art afterwards — each row just
// slides left by its own indent — so nothing fails loudly and the sprite reads
// as sloppy drawing rather than as a renderer bug. These tests pin the two
// halves of that: the emitted lines survive the trim untouched, and the art
// itself is column-true once centred.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-hud-test-'));
process.env.IDLE_RPG_HOME = HOME;

const S = require('../lib/state');
const E = require('../lib/engine');
const R = require('../lib/render');
const sprites = require('../lib/sprites');

const CLI = path.join(__dirname, '..', 'statusline', 'rpg-statusline.js');

// Exactly what Claude Code does to a status line command's stdout.
function claudeCodeTrim(stdout) {
  return stdout.trim().split('\n').flatMap(l => l.trim() || []).join('\n');
}

function render(cols) {
  S.saveState(E.newState('ranger', 'Testfixture', Date.now()));
  return execFileSync('node', [CLI], {
    env: { ...process.env, COLUMNS: String(cols), IDLE_RPG_HOME: HOME },
    input: '{}', encoding: 'utf8',
  });
}

for (const [mode, cols] of [['big', 100], ['compact', 60], ['mini', 40]]) {
  test(`${mode} HUD survives Claude Code's per-line trim`, () => {
    const out = render(cols).trim();
    assert.ok(out.length > 0, 'rendered nothing');
    assert.strictEqual(claudeCodeTrim(out), out,
      `${mode}: lines are altered by the trim — indentation will be lost`);
  });
}

test('big HUD rows all start with a non-whitespace cell', () => {
  for (const line of render(100).trim().split('\n')) {
    assert.ok(!/^\s/.test(line), `leading whitespace survives into: ${JSON.stringify(line)}`);
    assert.ok(line.trim() !== '', 'blank line would be dropped entirely');
  }
});

// Rendered cell of a glyph, given that the renderer centres each row inside the
// sprite's own block. Every big-art glyph is one cell wide (asserted in
// sprites.test.js), so a character index is a cell index.
function cellOf(art, row, ch) {
  const W = Math.max(...art.map(R.width));
  const i = [...art[row]].indexOf(ch);
  return i < 0 ? -1 : Math.round((W - R.width(art[row])) / 2) + i;
}

test('ranger bowstring holds one column across all five rows', () => {
  const art = sprites.heroesBig.ranger;
  const cols = art.map((_, i) => {
    const s = cellOf(art, i, '│');
    return s >= 0 ? s : cellOf(art, i, '┼');   // the nock, where the arrow crosses
  });
  assert.ok(cols.every(c => c >= 0), `no string on every row: ${cols}`);
  assert.strictEqual(new Set(cols).size, 1, `string wanders across columns: ${cols}`);
});

// The rogue's old art failed exactly here: a ╲ on row 3 and a ▼ on row 4 that
// touched nothing and read as debris. A weapon is only legible if you can trace
// it back to the fist, one cell per row, so both blades get pinned by their
// slope rather than by their glyphs.
function diagonal(art, steps) {
  return steps.map(([row, ch]) => cellOf(art, row, ch));
}

test('rogue dagger climbs unbroken from the fist to the tip', () => {
  const art = sprites.heroesBig.rogue;
  const fist = cellOf(art, 2, '▙');
  const blade = diagonal(art, [[2, '╪'], [1, '╱'], [0, '╱']]);
  assert.ok(blade.every(c => c >= 0), `blade is missing a row: ${blade}`);
  assert.strictEqual(blade[0], fist + 1, 'crossguard is not in the rogue\'s hand');
  assert.deepStrictEqual(blade, [blade[0], blade[0] + 1, blade[0] + 2],
    `blade jumps columns instead of climbing one per row: ${blade}`);
});

test('knight sword winds back over the shoulder unbroken', () => {
  const art = sprites.heroesBig.knight;
  const body = cellOf(art, 2, '░');
  const blade = diagonal(art, [[2, '╪'], [1, '╱'], [0, '╱']]);
  assert.ok(blade.every(c => c >= 0), `blade is missing a row: ${blade}`);
  assert.strictEqual(blade[0], body - 1, 'crossguard is not against the knight\'s body');
  assert.deepStrictEqual(blade, [blade[0], blade[0] - 1, blade[0] - 2],
    `blade jumps columns instead of sweeping one per row: ${blade}`);
  // Sword behind, shield in front: the two must not swap sides.
  assert.ok(blade[0] < cellOf(art, 2, '◆'), 'sword is on the shield side');
});

test('ranger bow limbs bulge symmetrically toward the target', () => {
  const art = sprites.heroesBig.ranger;
  const string = cellOf(art, 0, '│');
  const limbs = [cellOf(art, 0, '╲'), cellOf(art, 1, '╲'), cellOf(art, 3, '╱'), cellOf(art, 4, '╱')];
  assert.ok(limbs.every(c => c > string), `limbs must sit ahead of the string: ${limbs}`);
  assert.strictEqual(limbs[0], limbs[3], 'top and bottom tips off by a column');
  assert.strictEqual(limbs[1], limbs[2], 'upper and lower limbs off by a column');
  assert.ok(limbs[1] > limbs[0], 'limbs do not widen toward the grip');
});
