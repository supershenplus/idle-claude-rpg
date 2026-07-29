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

// The poses are drawn on the *rendered* grid, not on the raw strings: the idle
// art is ragged, so each of its rows is nudged right by half its shortfall, while
// a padded pose row is not nudged at all. Draw a pose by copying the source lines
// and the fist lands a column off the moment the pose is held — which reads as a
// twitch in the sprite rather than as a mistake in the art. `cellOf` does the
// same centring the renderer does, so these compare like for like.
test('the knight blade sweeps forward and the fist holds still', () => {
  const { raise, strike } = sprites.heroPoses.knight;
  const fists = [sprites.heroesBig.knight, raise, strike].map(a => cellOf(a, 2, '╪'));
  assert.ok(fists.every(c => c >= 0), `the crossguard leaves the fist: ${fists}`);
  assert.strictEqual(new Set(fists).size, 1, `the fist wanders mid-swing: ${fists}`);

  // Wound back, upright, come over: 45° of arc per frame, always forward.
  const tips = [cellOf(sprites.heroesBig.knight, 0, '╱'), cellOf(raise, 0, '▲'), cellOf(strike, 0, '╱')];
  assert.ok(tips.every(c => c >= 0), `the blade loses its tip: ${tips}`);
  assert.deepStrictEqual(tips, [tips[0], tips[0] + 2, tips[0] + 4],
    `the tip does not sweep an even arc: ${tips}`);

  // And the blade still traces back to the hand one cell per row in each pose.
  assert.deepStrictEqual(diagonal(raise, [[2, '╪'], [1, '┃'], [0, '▲']]),
    [fists[0], fists[0], fists[0]], 'the raised blade is not vertical over the fist');
  assert.deepStrictEqual(diagonal(strike, [[2, '╪'], [1, '╱'], [0, '╱']]),
    [fists[0], fists[0] + 1, fists[0] + 2], 'the swung blade jumps columns');
});

test('the rogue cocks its dagger before the hand comes up empty', () => {
  const { coil, throw: thrown } = sprites.heroPoses.rogue;
  const held = cellOf(sprites.heroesBig.rogue, 2, '╪');
  // Cocked: same column, one row higher — an arm drawn back, not a new weapon.
  assert.strictEqual(cellOf(coil, 1, '╪'), held, 'the cocked dagger is not over the fist');
  assert.strictEqual(cellOf(coil, 0, '╱'), held + 1, 'the cocked blade lost its slope');
  assert.strictEqual(cellOf(thrown, 1, '╪'), -1, 'the dagger is still in hand after the throw');

  // The follow-through starts in the cell the dagger vacated and runs along the
  // row the renderer flies the projectile down — otherwise the dagger leaves
  // along one track and crosses the gap on another.
  const waist = Math.floor(sprites.BIG_ROWS / 2);
  assert.strictEqual(cellOf(thrown, waist, '╌'), held,
    'the follow-through does not start where the dagger was');
});

test('the wizard staff holds its column while the orb leaves it', () => {
  const { charge, blast } = sprites.heroPoses.wizard;
  const idle = sprites.heroesBig.wizard;
  // Row 2 is where the arm meets the shaft, so blast draws a ┫ joint there
  // rather than a plain ┃ — same column, more surge going through it.
  const shaft = [[idle, '┃'], [charge, '┃'], [blast, '┫']]
    .flatMap(([art, mid]) => [cellOf(art, 1, '┃'), cellOf(art, 2, mid), cellOf(art, 3, '┃')]);
  const cols = new Set(shaft);
  assert.ok(!cols.has(-1), `the staff breaks somewhere: ${shaft}`);
  assert.strictEqual(cols.size, 1, `the staff wanders between poses: ${shaft}`);
  // The orb sits on the tip, swells there, and is gone — replaced by the
  // discharge in the same cell, so the eye tracks one object the whole way.
  const tip = [...cols][0];
  assert.strictEqual(cellOf(idle, 0, '★'), tip, 'the resting orb is off the staff');
  assert.strictEqual(cellOf(charge, 0, '◆'), tip, 'the charged orb is off the staff');
  assert.strictEqual(cellOf(blast, 0, '↯'), tip, 'the spent tip is not where the orb was');
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
function renderAnim(cols, build, mode, cls) {
  const st = E.newState(cls || 'ranger', 'Testfixture', Date.now());
  build(st, Date.now());
  S.saveState(st);
  return execFileSync('node', [CLI], {
    env: { ...process.env, COLUMNS: String(cols), IDLE_RPG_HOME: HOME, RPG_HUD: mode || '' },
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

// ---- the scripted attacks ----
//
// The recoil is the one part of the scene that moves the hero rather than the
// marks, so it is also the one part that a narrow terminal can quietly eat: the
// hero sits near the left edge by construction, and a flinch that ran into it
// would just be clamped away. These pin the displacement against the script
// itself, so it has to be real at every width rather than merely plausible.

// A run of art unique to each class that survives all of its poses. The pose art
// is padded to the idle art's block, so the same run also starts in the same
// column in every frame — which is what makes it usable as a ruler.
const GRIP = {
  ranger: '▚░▒██▓▬',
  wizard: '░▒██▓',
  knight: '░▒██▓▜█▛',
  rogue: '▚░▒██▓',
};
const BOW = GRIP.ranger;
const SCRIPT = sprites.attacks.ranger.frames;

function columnOf(out, needle) {
  const line = out.split('\n').map(R.visible).find(l => l.includes(needle));
  assert.ok(line, `${JSON.stringify(needle)} is not on screen`);
  return R.width(line.slice(0, line.indexOf(needle)));
}

function atFrame(cols, frame, data, cls) {
  return renderAnim(cols, (st, now) => {
    st.monster = { ...BOSS };
    st.anim = [{ type: 'hit', at: now - frame * sprites.FRAME_MS, dur: 1500,
      data: { dmg: 38, crit: false, counter: 0, ...data } }];
  }, 'big', cls);
}

// 100 is the roomy case and 76 the narrowest width that picks the big HUD on its
// own — but neither reaches the left edge, so neither would notice the reserved
// room going missing. 60 is a width only `RPG_HUD=big` can reach, and there the
// scene is clamped hard against column 0: it is the case the reserve exists for.
//
// Every class is checked at every width because MAX_RECOIL reserves one shared
// margin for all of them: a class that flinches deeper than the class the
// reserve was measured against gets clipped, and only at the narrow widths.
for (const cols of [100, 76, 60]) {
  for (const [cls, grip] of Object.entries(GRIP)) {
    test(`the ${cls} is shoved off its mark and recovers at ${cols} columns`, () => {
      const script = sprites.attacks[cls].frames;
      // Frame 0 is the idle art — the hero's home column.
      const home = columnOf(atFrame(cols, 0, {}, cls), grip);
      const moved = script.map((_, i) => home - columnOf(atFrame(cols, i, {}, cls), grip));
      assert.deepStrictEqual(moved, script.map(f => f.back),
        `recoil does not match the script — clamped against the left edge at ${cols} columns?`);
      assert.strictEqual(moved[moved.length - 1], 0, `the ${cls} never returns to its mark`);
    });
  }
}

test('every projectile crosses the gap instead of stalling out of the hand', () => {
  for (const [cls, a] of Object.entries(sprites.attacks)) {
    const proj = sprites.heroes[cls].proj;
    const flown = a.frames
      .map((f, i) => (f.fly == null ? null : columnOf(atFrame(100, i, {}, cls), proj)))
      .filter(x => x != null);
    assert.ok(flown.length >= 2, `${cls}: the shot is barely in flight at all`);
    for (let i = 1; i < flown.length; i++) {
      assert.ok(flown[i] >= flown[i - 1], `${cls}: the shot flew backwards: ${flown}`);
    }
    assert.ok(flown[flown.length - 1] > flown[0] + 4,
      `${cls}: the shot travels only ${flown[flown.length - 1] - flown[0]} cells: ${flown}`);
  }
});

test('the damage number waits for the blow to land', () => {
  for (const cls of Object.keys(sprites.attacks)) {
    const landed = sprites.hitFrame(cls);
    assert.doesNotMatch(atFrame(100, landed - 1, {}, cls), /✦-/,
      `${cls}: the damage is counted while the shot is still in the air`);
    assert.match(atFrame(100, landed, {}, cls), /✦-38/,
      `${cls}: the blow landed without a damage number`);
  }
});

// ---- the hurt flash ----
//
// The only cue that the monster hit *you* used to be a number in the gap. The
// hero is now washed red for the rest of the animation, which is the half of the
// exchange the scene was not narrating at all.

// The raw line — escapes intact — that the hero's art is drawn on.
function heroLine(out, cls) {
  const line = out.split('\n').find(l => R.visible(l).includes(GRIP[cls]));
  assert.ok(line, `the ${cls} is not on screen`);
  return line;
}
const REDDENED = /\x1b\[(31|91)m/;

test('the hero flashes red from the frame the counter-blow lands', () => {
  for (const cls of Object.keys(GRIP)) {
    const landed = sprites.hitFrame(cls);
    for (let f = 0; f < landed; f++) {
      assert.doesNotMatch(heroLine(atFrame(100, f, { counter: 7 }, cls), cls), REDDENED,
        `${cls}: hurt on frame ${f}, before the blow it is answering has landed`);
    }
    assert.match(heroLine(atFrame(100, landed, { counter: 7 }, cls), cls), REDDENED,
      `${cls}: the counter-blow lands without the hero showing it`);
  }
});

test('a blow that went unanswered does not redden the hero', () => {
  // `counter: 0` is what the engine writes when retaliation did not roll — the
  // hero took nothing, so there is nothing to flash about.
  const landed = sprites.hitFrame('ranger');
  assert.doesNotMatch(heroLine(atFrame(100, landed, { counter: 0 }), 'ranger'), REDDENED,
    'the hero flashes on its own attack');
  assert.match(atFrame(100, landed, { counter: 0 }), /✦-38/, 'the blow itself is missing');
});

test('dying reddens the hero for the whole banner', () => {
  const out = renderAnim(100, (st, now) => {
    st.monster = { ...BOSS };
    st.anim = [{ type: 'death', at: now - 2 * sprites.FRAME_MS, dur: 5000, data: { lost: 120 } }];
  }, 'big');
  assert.match(out, /you died/, 'the death banner is missing');
  assert.match(heroLine(out, 'ranger'), REDDENED, 'the hero dies without showing it');
});

test('the compact HUD flashes too', () => {
  const landed = sprites.hitFrame('ranger');
  const compact = (data) => renderAnim(60, (st, now) => {
    st.monster = { ...BOSS };
    st.anim = [{ type: 'hit', at: now - landed * sprites.FRAME_MS, dur: 1500,
      data: { dmg: 38, crit: false, ...data } }];
  }, 'compact');
  const sceneLine = out => out.split('\n').find(l => R.visible(l).includes(sprites.heroes.ranger.idle));
  assert.match(sceneLine(compact({ counter: 7 })), REDDENED, 'the one-line hero never flashes');
  assert.doesNotMatch(sceneLine(compact({ counter: 0 })), REDDENED, 'it flashes when unhurt');
});

// ---- the dodge ----
//
// The mirror of the flash: the other half of the same roll. A dodge bends the
// hero away from the blow with a per-row displacement — the one place in this
// renderer where rows are *meant* to come apart — and ghosts the sprite instead
// of reddening it.

// Where each row of the hero's art starts, one entry per art row. The pose art
// is padded, so on an undodged frame these are all the same column; a dodge is
// visible here as a gradient and nowhere else.
function heroColumns(out, cls, art) {
  const lines = out.split('\n').map(R.visible);
  return art.map((row, i) => {
    const ink = row.trimEnd();
    assert.ok(ink, `${cls} art row ${i} is blank`);
    const line = lines.find(l => l.includes(ink));
    assert.ok(line, `${cls} art row ${i} (${JSON.stringify(ink)}) is not on screen`);
    return R.width(line.slice(0, line.indexOf(ink)));
  });
}

function atDodge(cols, cls, extra) {
  return atFrame(cols, sprites.hitFrame(cls), { dodged: true, ...extra }, cls);
}

// Same three widths as the recoil: the lean stacks on top of whatever the attack
// script is already holding, so the wizard — deepest recoil of the four — is the
// case that proves MAX_RECOIL reserves room for the pair rather than for one.
for (const cols of [100, 76, 60]) {
  for (const cls of Object.keys(GRIP)) {
    test(`the ${cls} leans clear of a missed swing at ${cols} columns`, () => {
      const landed = sprites.hitFrame(cls);
      const art = sprites.attackFrame(cls, landed).art;
      const upright = heroColumns(atFrame(cols, landed, {}, cls), cls, art);
      const leaning = heroColumns(atDodge(cols, cls), cls, art);
      const moved = upright.map((c, i) => c - leaning[i]);
      assert.deepStrictEqual(moved, sprites.DODGE_LEAN,
        `the lean does not match DODGE_LEAN — clipped against the left edge at ${cols} columns?`);
    });
  }
}

test('the lean bends the hero rather than shifting or tearing it', () => {
  // Two properties the art depends on and a flat offset would not have: the feet
  // stay planted, and the displacement only ever decreases down the sprite. A
  // lean with a bulge in it reads as broken art, not as a body moving.
  const lean = sprites.DODGE_LEAN;
  assert.strictEqual(lean.length, sprites.BIG_ROWS, 'a row of every sprite has no lean');
  assert.strictEqual(lean[lean.length - 1], 0, 'the hero dodges by sliding, feet and all');
  assert.ok(lean[0] > 0, 'the head does not move at all');
  for (let i = 1; i < lean.length; i++) {
    assert.ok(lean[i] <= lean[i - 1], `the lean bulges at row ${i}: ${lean}`);
  }
});

test('a dodge ghosts the hero instead of reddening it', () => {
  const out = atDodge(100, 'ranger');
  const line = heroLine(out, 'ranger');
  assert.doesNotMatch(line, REDDENED, 'a swing that missed still drew blood');
  assert.match(line, /\x1b\[2m/, 'the dodging hero is not ghosted');
  assert.match(out, /↩ dodge/, 'the gap never says what happened');
  assert.doesNotMatch(out, /↩-/, 'a dodge printed a damage figure');
});

test('the dodge mark waits for the blow it is answering', () => {
  // Same causality the counter-hit has: nothing the monster does can be on
  // screen before the hero blow that provoked it has landed.
  for (const cls of Object.keys(GRIP)) {
    for (let f = 0; f < sprites.hitFrame(cls); f++) {
      const out = atFrame(100, f, { dodged: true }, cls);
      assert.doesNotMatch(out, /↩ dodge/, `${cls}: dodged on frame ${f}, before its own blow landed`);
      assert.doesNotMatch(heroLine(out, cls), /\x1b\[2m/, `${cls}: ghosted early on frame ${f}`);
    }
  }
});

test('a dodge and a landed counter never share a frame', () => {
  // The engine will not write both (`engine.retaliate`), but the renderer is the
  // last line: if a stale save ever carried both, blood wins here too.
  const out = atFrame(100, sprites.hitFrame('ranger'), { dodged: true, counter: 7 });
  assert.match(out, /↩-7/, 'the counter it took is missing');
  assert.doesNotMatch(out, /↩ dodge/, 'the hero both took the blow and slipped it');
  assert.match(heroLine(out, 'ranger'), REDDENED, 'a blow that landed did not redden the hero');
});

test('the compact HUD moves the hero out of the way', () => {
  // Compact has one row, so it cannot bend — and it has never drawn the counter
  // number either, sharing that gap with the projectile. The whole tell there is
  // the hero being somewhere else, and ghosted.
  const compact = (data) => renderAnim(60, (st, now) => {
    st.monster = { ...BOSS };
    st.anim = [{ type: 'hit', at: now - sprites.hitFrame('ranger') * sprites.FRAME_MS,
      dur: 1500, data: { dmg: 38, crit: false, ...data } }];
  }, 'compact');
  const columnOfHero = out => {
    const line = out.split('\n').map(R.visible).find(l => l.includes(sprites.heroes.ranger.idle));
    assert.ok(line, 'the hero is not on screen');
    return R.width(line.slice(0, line.indexOf(sprites.heroes.ranger.idle)));
  };
  assert.strictEqual(columnOfHero(compact({})) - columnOfHero(compact({ dodged: true })),
    Math.max(...sprites.DODGE_LEAN), 'the compact hero stands still through a dodge');
});

test('the flash is colour only — nothing in the scene moves', () => {
  // The tint wraps art the layout has already measured, and the escapes it adds
  // are invisible to R.width. If that ever stopped being true the monster would
  // step sideways on exactly the frames the hero got hit, which is the hardest
  // possible moment to notice it.
  const landed = sprites.hitFrame('ranger');
  assert.deepStrictEqual(
    monsterColumns(atFrame(100, landed, { counter: 7 })),
    monsterColumns(atFrame(100, landed, { counter: 0 })),
    'getting hit pushed the monster out of column');
});

// Reported from the statusline: the monster's blow appeared to *drive* the
// ranger's shot — bow draw and all — when nothing the hero did should be firing.
// The engine never had a counter without an attack behind it (`retaliate` runs
// only off the back of `dealDamage`); the counter mark was simply ungated, so it
// drew from frame 0 while the hero was still standing at its mark with a nocked
// bow. Two frames of a six-frame anim showed the reply before the blow, and a
// HUD redrawn about once a second lands on them often enough to read as cause.
test('the counter-hit waits for the blow it is answering', () => {
  const landed = sprites.hitFrame('ranger');
  for (let f = 0; f < landed; f++) {
    assert.doesNotMatch(atFrame(100, f, { counter: 7 }), /↩-/,
      `the monster answers on frame ${f}, before the hero's blow has landed`);
  }
  assert.match(atFrame(100, landed, { counter: 7 }), /↩-7/,
    'the counter-hit never appears at all');
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
