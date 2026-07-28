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

// The scene has to narrate the kill it is animating, not the fight that has
// already started. `engine.resolveKill` spawns the replacement immediately, so
// every frame of the killing blow and the death that follows it would otherwise
// be drawn against whatever monster happened to be standing there next.
function renderAnim(cols, build) {
  const st = E.newState('ranger', 'Testfixture', Date.now());
  build(st, Date.now());
  S.saveState(st);
  return execFileSync('node', [CLI], {
    env: { ...process.env, COLUMNS: String(cols), IDLE_RPG_HOME: HOME },
    input: '{}', encoding: 'utf8',
  });
}

const CORPSE = { id: 'treant', name: 'Rootfang the Ancient Treant', sprite: '(T)', level: 9, isBoss: true, hp: 0, maxHp: 1200 };

test('the killing blow is drawn against the monster it killed', () => {
  const out = renderAnim(100, (st, now) => {
    st.monster = { id: 'sprite', name: 'Grove Sprite', sprite: '(s)', level: 3, isBoss: false, hp: 40, maxHp: 40 };
    st.anim = [{ type: 'hit', at: now - 400, dur: 1500, data: { dmg: 51, crit: false, mon: CORPSE } }];
  });
  assert.match(out, /Rootfang/, 'the dying monster is named');
  assert.doesNotMatch(out, /Grove Sprite/, 'its replacement is not on screen yet');
});

test('the death animation keeps the corpse on the field through the celebration', () => {
  const out = renderAnim(100, (st, now) => {
    st.monster = { id: 'sprite', name: 'Grove Sprite', sprite: '(s)', level: 3, isBoss: false, hp: 40, maxHp: 40 };
    st.anim = [{ type: 'bossdown', at: now - 1000, dur: 6000, data: { name: CORPSE.name, unlocked: 'Cobalt Caves', mon: CORPSE } }];
  });
  assert.match(out, /DEFEATED/);
  assert.doesNotMatch(out, /Grove Sprite/, 'the next monster does not stand in for the one being mourned');
  const dead = sprites.DEAD_MONSTER_BIG.map(r => r.trim()).filter(Boolean)[0];
  assert.ok(out.includes(dead), 'the corpse sprite is drawn, not a live one');
});

test('an untagged animation still renders the live monster', () => {
  // Every anim that is not about a kill — a level up, a drop — must go on
  // showing the fight in progress.
  const out = renderAnim(100, (st, now) => {
    st.monster = { id: 'sprite', name: 'Grove Sprite', sprite: '(s)', level: 3, isBoss: false, hp: 40, maxHp: 40 };
    st.anim = [{ type: 'levelup', at: now - 500, dur: 5000, data: { level: 9 } }];
  });
  // A banner replaces the info row, so the name is not on screen — the sprite is.
  assert.match(out, /LEVEL UP/);
  assert.ok(out.includes('(s)'), 'the fight carries on underneath the banner');
});

// The gap between the combatants is the only part of the scene drawn from raw
// combat numbers, and those numbers have no ceiling: `engine.enqueue` sums
// rapid hits into one anim and counters sum onto the same record, so a catch-up
// fold can hand the renderer a damage figure with no bound on its width.
const BOSS = { id: 'rootfang', name: 'Rootfang the Ancient Treant', sprite: '☠', level: 9, isBoss: true, hp: 900, maxHp: 1200 };

function renderHit(cols, data) {
  return renderAnim(cols, (st, now) => {
    st.monster = { ...BOSS };
    // Far enough into the anim that the damage number has appeared (frame >= 2).
    st.anim = [{ type: 'hit', at: now - 4 * sprites.FRAME_MS, dur: 1500, data }];
  });
}

// Where each row of the monster's big art starts, one entry per art row. Two
// renders that differ only in the size of the numbers must agree exactly.
function monsterColumns(out) {
  const lines = out.split('\n').map(R.visible);
  return sprites.bigMonster(BOSS.id, BOSS.sprite)
    .map(r => r.trim())
    .filter(Boolean)
    .map((art) => {
      const line = lines.find(l => l.includes(art));
      assert.ok(line, `art row ${JSON.stringify(art)} is not on screen at all`);
      return R.width(line.slice(0, line.indexOf(art)));
    });
}

test('an ordinary hit draws the projectile and both damage marks', () => {
  const out = renderHit(100, { dmg: 38, crit: true, counter: 7 });
  assert.ok(out.includes('✦-38!'), 'the damage number and its crit mark are missing');
  assert.ok(out.includes('↩-7'), 'the counter-hit mark is missing');
  assert.ok(out.includes(sprites.heroes.ranger.proj), 'the projectile never left the bow');
});

test('a coalesced hit cannot shear the monster sprite', () => {
  // The marks sit on two of the five art rows. Overrun does not move the whole
  // sprite — it moves only those rows, so the failure looks like bad art.
  const baseline = monsterColumns(renderHit(100, { dmg: 38, crit: true, counter: 7 }));
  for (const data of [
    { dmg: 1234567, crit: true, counter: 98765 },
    { dmg: 1234567890, crit: true, counter: 987654321 },
    { dmg: 1e18, crit: false, counter: 1e18 },
  ]) {
    assert.deepStrictEqual(monsterColumns(renderHit(100, data)), baseline,
      `dmg ${data.dmg} pushed the monster art out of column`);
  }
});

test('a coalesced hit cannot shove the compact monster off its centre', () => {
  // Compact draws flight and damage on one line, so they share the gap with
  // each other as well as with the monster. The sprite is one row here, so
  // overrun slides it right rather than shearing it — the scene stops being
  // centred, which is the whole point of the layout.
  const SIGIL = '(#)';   // unique to the scene row; ☠ also appears in the nameplate
  const compactColumn = (data) => {
    const out = renderAnim(60, (st, now) => {
      st.monster = { ...BOSS, sprite: SIGIL };
      st.anim = [{ type: 'hit', at: now - 4 * sprites.FRAME_MS, dur: 1500, data }];
    });
    const scene = out.split('\n').map(R.visible).find(l => l.includes(SIGIL));
    assert.ok(scene, 'the monster is not on screen');
    assert.match(scene, /✦-/, 'the damage mark is missing');
    return R.width(scene.slice(0, scene.indexOf(SIGIL)));
  };
  assert.strictEqual(compactColumn({ dmg: 1234567890, crit: true, counter: 987654321 }),
    compactColumn({ dmg: 38, crit: true, counter: 7 }),
    'the damage mark pushed the monster off the terminal midpoint');
});
