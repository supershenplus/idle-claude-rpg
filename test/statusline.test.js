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
const B = require('../lib/balance');
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

// 30 cols is the case `mini` used to own. Compact inherited it when mini was
// removed, so it is tested at both a comfortable width and a hostile one.
for (const [mode, cols] of [['big', 100], ['compact', 60], ['compact', 30]]) {
  test(`${mode} HUD at ${cols} cols survives Claude Code's per-line trim`, () => {
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
//
// Every anim below is timestamped a whole number of frames back from `now`, so
// the frame the child draws is only the frame asked for if the child's clock
// agrees with `now`. It does not by default: spawning node costs about 90ms of
// a 250ms frame, and under a parallel `node --test` run that gap can cross a
// frame boundary — which made the recoil tests fail by exactly one frame's
// displacement, and only ever on a loaded machine. $RPG_NOW hands the child the
// same clock, which is what makes "at frame 3" mean it.
function renderAnim(cols, build, mode, cls) {
  const now = Date.now();
  const st = E.newState(cls || 'ranger', 'Testfixture', now);
  build(st, now);
  S.saveState(st);
  return execFileSync('node', [CLI], {
    env: {
      ...process.env, COLUMNS: String(cols), IDLE_RPG_HOME: HOME,
      RPG_HUD: mode || '', RPG_NOW: String(now),
    },
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
// A monster with no entry in `sprites.BOSS_SWING`, so it swings the shared
// script at the default depth. Every displacement test below runs against both,
// because the failure a per-boss depth introduces is not "the boss doesn't lunge
// further" — it is the 22 monsters that have no depth quietly acquiring one.
const MOB = { id: 'kobold', name: 'Kobold Scrapper', sprite: '(x)', level: 8, isBoss: false, hp: 60, maxHp: 90 };

function renderHit(cols, data) {
  return renderAnim(cols, (st, now) => {
    st.monster = { ...BOSS };
    // Far enough into the anim that the damage number has appeared (frame >= 2).
    st.anim = [{ type: 'hit', at: now - 4 * sprites.FRAME_MS, dur: 1500, data }];
  });
}

// Where each row of the monster's big art starts, one entry per art row. Two
// renders that differ only in the size of the numbers must agree exactly.
function monsterColumns(out, mon = BOSS) {
  const lines = out.split('\n').map(R.visible);
  return sprites.bigMonster(mon.id, mon.sprite)
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

function atFrame(cols, frame, data, cls, mon = BOSS) {
  return renderAnim(cols, (st, now) => {
    st.monster = { ...mon };
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

// ---- the monster's half of the exchange ----
//
// Reported from play, and the other half of the counter-ordering report above:
// HP came off the bar with nothing on screen at all. `test_fail` and `bash_fail`
// hurt the hero and never touched the anim queue, so the only monster blow the
// scene ever drew was the counter — which borrows the hero's animation. The
// monster now has one of its own, and reacts to taking one.
//
// Everything here is displacement rather than art: one number per frame for all
// 28 monsters. Which means the tests are all "did the sprite move by exactly
// what the script says", and the failure they exist to catch is the sprite
// moving by *nearly* that — clamped by an edge, or butted aside by a mark.

function atMonsterFrame(cols, frame, data, cls, mon = BOSS) {
  return renderAnim(cols, (st, now) => {
    st.monster = { ...mon };
    st.anim = [{ type: 'mhit', at: now - frame * sprites.FRAME_MS, dur: 1500,
      data: { dmg: 46, name: mon.name, ...data } }];
  }, 'big', cls);
}

// Cells the monster has moved *toward* the hero since it was standing on its
// mark. One displacement for the whole sprite, so disagreement between the art
// rows is a shear — the failure the marks in the gap can inflict by overrunning
// (`row.put` butts rather than overlaps) and the one that looks like bad art.
function monsterShove(out, home, mon = BOSS) {
  const moved = monsterColumns(home, mon).map((c, i) => c - monsterColumns(out, mon)[i]);
  assert.strictEqual(new Set(moved).size, 1, `the monster sprite sheared: ${moved}`);
  return moved[0];
}

// 60 is again the width only `RPG_HUD=big` reaches, where the scene is clamped
// hard — the monster's floor column is pushed right by the hero's own reserved
// margin, which is exactly where its art can start falling off the far end.
for (const cols of [100, 76, 60]) {
  for (const mon of [BOSS, MOB]) {
    test(`the ${mon.id} winds up, lunges and returns to its mark at ${cols} columns`, () => {
      const home = atMonsterFrame(cols, 0, {}, undefined, mon);
      const moved = sprites.monsterAttack.frames
        .map((_, i) => monsterShove(atMonsterFrame(cols, i, {}, undefined, mon), home, mon));
      // Against its *own* script, not the shared one: `rootfang` has a depth in
      // BOSS_SWING and `kobold` does not, and the pair passing this together is
      // what says the depth is applied by id rather than to everything.
      assert.deepStrictEqual(moved,
        sprites.monsterAttack.frames.map((_, i) => sprites.monsterAttackFrame(i, mon.id).shove),
        `the lunge does not match the script — clipped by an edge at ${cols} columns?`);
      assert.strictEqual(moved[moved.length - 1], 0, 'the monster never returns to its mark');
    });
  }

  // Why the depth is paid for in standoff rather than out of the gap. The figure
  // appears on the impact frame — the one frame the boss has closed the distance
  // — so a lunge taken out of the gap would shorten the room for the number by
  // exactly the depth, and the deepest boss in the game hits hardest. This is
  // that failure stated as the thing you would see: four digits arriving as
  // `♥-1.2` off the Garbage Collector and in full off everything else.
  test(`a deep lunge does not eat the figure it costs you at ${cols} columns`, () => {
    for (const id of ['kobold', ...Object.keys(sprites.BOSS_SWING)]) {
      const out = atMonsterFrame(cols, sprites.MONSTER_HIT_FRAME, { dmg: 1234 },
        'ranger', { ...MOB, id });
      assert.match(out, /♥-1234/, `${id} truncated the HP it took at ${cols} columns`);
    }
  });

  test(`a struck monster is knocked back and recovers at ${cols} columns`, () => {
    for (const cls of Object.keys(GRIP)) {
      const landed = sprites.hitFrame(cls);
      const home = atFrame(cols, 0, {}, cls);
      for (let f = 0; f < landed; f++) {
        assert.strictEqual(monsterShove(atFrame(cols, f, {}, cls), home), 0,
          `${cls}: the monster reels on frame ${f}, before the blow has landed`);
      }
      const knocked = sprites.MONSTER_FLINCH
        .map((_, i) => monsterShove(atFrame(cols, landed + i, {}, cls), home));
      assert.deepStrictEqual(knocked, sprites.MONSTER_FLINCH.map(f => f.shove),
        `${cls}: the knockback does not match the script at ${cols} columns`);
    }
  });
}

// `monsterColumns` fails outright on an art row that is not on screen, so it is
// also the check that nothing was trimmed away — R.fit cuts the end of a line
// silently, and the failure is a boss quietly losing its last columns on exactly
// the frames something is happening to it.
test('nothing on the monster side is trimmed off the right-hand edge', () => {
  // The deepest boss is included because a standoff is bought out of the same
  // budget: it raises the monster's *floor* column by the depth, which is the
  // clamp that fights the right-hand edge at the widths where the scene is
  // tightest. `gc` reaches furthest and is among the widest art in the game, so
  // it is the case where the two constraints meet.
  const deepest = Object.keys(sprites.BOSS_SWING)
    .reduce((a, b) => (sprites.monsterStandoff(b) > sprites.monsterStandoff(a) ? b : a));
  for (const cols of [100, 76, 60]) {
    for (const mon of [BOSS, MOB, { ...BOSS, id: deepest }]) {
      for (const [what, out] of [
        ['wind-up', atMonsterFrame(cols, 1, {}, undefined, mon)],
        ['knockback', atFrame(cols, sprites.hitFrame('ranger'), {}, undefined, mon)],
      ]) {
        for (const line of monsterColumns(out, mon)) {
          assert.ok(line >= 0, `${mon.id} ${what} at ${cols}: the monster art is off the edge`);
        }
        assert.doesNotMatch(out.split('\n')[3], /…/,
          `${mon.id} ${what} at ${cols}: an art row was trimmed`);
      }
    }
  }
});

// The raw line — escapes intact — an art row of the monster is drawn on. Row 0
// carries no marks (they sit on the three middle rows) and the hero's own art
// row 0 is untinted unless it is hurt, so an escape here is the monster's.
function monsterLine(out, row) {
  const art = sprites.bigMonster(BOSS.id, BOSS.sprite)[row];
  const line = out.split('\n').find(l => R.visible(l).includes(art));
  assert.ok(line, `monster art row ${row} is not on screen`);
  return line;
}
const LIT = /\x1b\[93m/;   // brightYellow, the colour of the damage figure

test('a struck monster lights up in the colour of the number hitting it', () => {
  const landed = sprites.hitFrame('ranger');
  assert.doesNotMatch(monsterLine(atFrame(100, landed - 1, {}), 0), LIT,
    'the monster lights up before the blow has landed');
  assert.match(monsterLine(atFrame(100, landed, {}), 0), LIT,
    'the blow lands and the monster does not react at all');
  assert.doesNotMatch(monsterLine(atFrame(100, landed + sprites.MONSTER_FLINCH.length, {}), 0), LIT,
    'the monster is still lit after the flinch is over');
});

test('a monster with no big art can still be struck', () => {
  // `bigMonster` pads an unknown id out to BIG_ROWS with blank strings, and
  // colouring one of those leaves a bare pair of zero-width escapes on the end
  // of the line — which `keepIndent` cannot trim off, because what precedes them
  // is whitespace and what follows is not. The line then carries trailing
  // spaces that nothing downstream will strip either.
  const out = renderAnim(100, (st, now) => {
    st.monster = { id: 'notamonster', name: 'Unknown', sprite: '(?)', level: 3, hp: 40, maxHp: 40 };
    st.anim = [{ type: 'hit', at: now - sprites.hitFrame('ranger') * sprites.FRAME_MS,
      dur: 1500, data: { dmg: 38, crit: false, counter: 0 } }];
  });
  assert.ok(out.includes('(?)'), 'the fallback sprite is not on screen');
  for (const line of out.trim().split('\n')) {
    assert.strictEqual(line.trimEnd(), line, `trailing whitespace: ${JSON.stringify(line)}`);
    assert.doesNotMatch(line, /\x1b\[\d+m\x1b\[0m\s*$/, `an empty row was coloured: ${JSON.stringify(line)}`);
  }
});

test('the corpse never flinches', () => {
  // `kill` and `bossdown` pin their own copy of the monster and swap the corpse
  // art in. The flinch has to end where the death begins — a dead sprite jogging
  // sideways under a DEFEATED banner is the one failure mode both features have.
  const corpse = f => renderAnim(100, (st, now) => {
    st.monster = { ...BOSS };
    st.anim = [{ type: 'kill', at: now - f * sprites.FRAME_MS, dur: 2500,
      data: { name: BOSS.name, xp: 910, gold: 1340, mon: { ...BOSS, hp: 0 } } }];
  });
  const first = corpse(0);
  for (let f = 1; f < 6; f++) {
    assert.strictEqual(corpse(f), first, `the celebration moves on frame ${f}`);
  }
});

test('the unprovoked blow crosses the gap and says what it cost', () => {
  const landed = sprites.MONSTER_HIT_FRAME;
  for (let f = 0; f < landed; f++) {
    assert.doesNotMatch(atMonsterFrame(100, f), /♥-/,
      `the HP is counted on frame ${f}, before the blow has landed`);
  }
  const out = atMonsterFrame(100, landed);
  assert.match(out, /♥-46/, 'the blow landed without saying what it took');
  assert.ok(out.includes(sprites.MONSTER_PROJ), 'the blow never crossed the gap');
  // `↩-N` is the counter — "in answer to yours" — and this is not one.
  assert.doesNotMatch(out, /↩/, 'an unprovoked blow is drawn as a counter-hit');
});

test('a blow the hero never provoked still reddens it', () => {
  const landed = sprites.MONSTER_HIT_FRAME;
  for (const cls of Object.keys(GRIP)) {
    assert.doesNotMatch(heroLine(atMonsterFrame(100, landed - 1, {}, cls), cls), REDDENED,
      `${cls}: hurt before the blow reached it`);
    assert.match(heroLine(atMonsterFrame(100, landed, {}, cls), cls), REDDENED,
      `${cls}: took the blow without showing it`);
  }
});

test('the blow drives the hero back within its reserved margin', () => {
  for (const cols of [100, 76, 60]) {
    // Both depths again: a deeper boss drives the hero further, and MAX_RECOIL
    // is derived over every depth precisely so the extra is reserved rather than
    // clamped away against the left edge at the widths where it would bind.
    for (const mon of [BOSS, MOB]) {
      const home = columnOf(atMonsterFrame(cols, 0, {}, 'ranger', mon), BOW);
      const moved = sprites.monsterAttack.frames
        .map((_, i) => home - columnOf(atMonsterFrame(cols, i, {}, 'ranger', mon), BOW));
      assert.deepStrictEqual(moved,
        sprites.monsterAttack.frames.map((_, i) => sprites.monsterAttackFrame(i, mon.id).hero),
        `the ${mon.id} does not drive the hero back as scripted at ${cols} columns`);
    }
  }
});

test('a coalesced blow cannot shear the monster sprite', () => {
  // `enqueue` sums repeated blows onto one anim, so the figure has no ceiling
  // and can outgrow the gap it lives in — the same overrun as the hero's, from
  // the other side, and the monster is now moving while it happens.
  const at = sprites.MONSTER_HIT_FRAME;
  const baseline = monsterColumns(atMonsterFrame(100, at));
  for (const dmg of [1234567, 1234567890, 1e18]) {
    assert.deepStrictEqual(monsterColumns(atMonsterFrame(100, at, { dmg })), baseline,
      `a blow of ${dmg} pushed the monster art out of column`);
  }
});

test('the compact HUD hangs the monster\'s mark from the monster', () => {
  // Compact ignores `flightCol` — the mark and the figure share one row, so a
  // head that crossed the gap would shove the figure off the end of it — and
  // travel is carried by the trail lengthening instead. Which end it grows from
  // is then the only thing left saying which way the blow is going: pinned to
  // the hero, the head sits against the hero a frame before it is even thrown.
  const compact = f => renderAnim(60, (st, now) => {
    st.monster = { ...BOSS, sprite: '(#)' };
    st.anim = [{ type: 'mhit', at: now - f * sprites.FRAME_MS, dur: 1500,
      data: { dmg: 46, name: BOSS.name } }];
  }, 'compact');
  //
  // Pinned to the monster, the mark also rides the arm: it gives a cell back as
  // the lunge recovers. That is left alone deliberately — a reach retracting
  // with the body it belongs to is the thing being drawn — so what is pinned
  // here is where the blow *starts* and that it genuinely crosses, rather than
  // a frame-by-frame monotonicity the recovery would break for good reasons.
  const thrown = sprites.monsterAttack.frames.findIndex(f => f.fly === 0);
  const at = i => columnOf(compact(i), sprites.MONSTER_PROJ);
  const from = at(thrown);
  const to = at(sprites.MONSTER_HIT_FRAME);
  assert.ok(to < from - 2, `the blow barely crossed the gap: ${from} → ${to}`);
  const hero = columnOf(compact(thrown), sprites.heroes.ranger.idle);
  const monster = columnOf(compact(thrown), '(#)');
  assert.ok(from - hero > monster - from,
    `the blow is thrown from the hero's end of the gap: ${hero} | ${from} | ${monster}`);
  assert.match(compact(sprites.MONSTER_HIT_FRAME), /♥-46/, 'compact never says what it cost');
});

// ---- HUD layout precedence ----
// Three tiers pick a layout, and the two that aren't width are new: a mode
// pinned in the save (`/hero hud <mode>`) and $RPG_HUD above it. Line count is
// the discriminator because it *is* the contract — each layout is documented by
// how many lines it occupies, and the header comment claiming compact was three
// of them was wrong for as long as the comment existed.
const HUD_LINES = { big: 8, compact: 4 };

function renderPinned(cols, hud, env = {}) {
  const st = E.newState('ranger', 'Testfixture', Date.now());
  if (hud !== undefined) st.hud = hud;
  S.saveState(st);
  return execFileSync('node', [CLI], {
    env: { ...process.env, COLUMNS: String(cols), IDLE_RPG_HOME: HOME, RPG_HUD: '', ...env },
    input: '{}', encoding: 'utf8',
  }).trim().split('\n').length;
}

test('a pinned layout beats the one the width would have picked', () => {
  // Both directions: compact held at a width that would have chosen big, and
  // big held at a width that would have chosen compact. Pinning a layout wider
  // than the terminal warns in the CLI but is obeyed here.
  assert.strictEqual(renderPinned(100, 'compact'), HUD_LINES.compact,
    'pinned compact did not survive at 100 cols');
  assert.strictEqual(renderPinned(60, 'big'), HUD_LINES.big,
    'pinned big was overridden by width');
});

test('$RPG_HUD overrides a pinned layout', () => {
  assert.strictEqual(renderPinned(60, 'compact', { RPG_HUD: 'big' }), HUD_LINES.big,
    'the saved pin won over the environment override');
});

test('an unrecognised pin falls back to width instead of rendering nothing', () => {
  // `hud` is a field in a file the player can edit. An unknown value used to
  // fall through every layout branch, which renders an empty status line —
  // failing in the one way the HUD is built never to fail.
  //
  // `mini` is in this list on purpose. It was a real layout until it was
  // removed, so a save written by the previous version can still be pinned to
  // it — and this validation is the whole reason that needs no migration: an
  // orphaned pin is just an unrecognised one, and heals to width on the next
  // frame.
  for (const junk of ['sideways', 'mini', '', 'BIG ', 42, null]) {
    assert.strictEqual(renderPinned(100, junk), HUD_LINES.big,
      `pin ${JSON.stringify(junk)} did not fall back to the width-picked layout`);
  }
});

test('auto is the absence of a pin, not a third layout', () => {
  assert.strictEqual(renderPinned(100, undefined), HUD_LINES.big);
  assert.strictEqual(renderPinned(60, undefined), HUD_LINES.compact);
  // Below the width mini used to serve, compact is now the floor rather than a
  // handoff to a third layout.
  assert.strictEqual(renderPinned(30, undefined), HUD_LINES.compact);
});

// ---- $RPG_NOW: the clock the scene is drawn against ----
// The HUD is rendered by a process the caller has to spawn, so "draw frame 3"
// only means something if both sides agree what time it is. They do not by
// default: the anim is timestamped before the spawn and starting node costs
// about 90ms of a 250ms frame, which is a third of the budget gone before the
// child asks the clock anything. Nothing fails while the drift stays under one
// frame — it just quietly picks a neighbouring frame once a loaded machine
// pushes it over, which is how the recoil tests above came to fail by exactly
// one frame's displacement and only when the suite ran in parallel.
//
// So the pin is the fix, and these are its two halves: it has to actually
// decide the frame, and it has to reach no further than the picture.

// Synchronous and idle — a spin loop would compete for the CPU that makes the
// drift visible in the first place.
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Split from the render on purpose. The obvious way to write these is one
// helper that builds and draws in a breath — but then the anim is re-anchored
// to `Date.now()` on every call, so it slides forward by exactly as much as the
// clock does and the drift cancels itself out. That test passes whether or not
// the pin does anything. Saving against an anchor the caller holds is what
// keeps the wall clock as the only thing moving between two renders.
function saveScene(anchor, frame) {
  const st = E.newState('ranger', 'Testfixture', anchor);
  st.monster = { ...BOSS };
  st.anim = [{ type: 'hit', at: anchor - frame * sprites.FRAME_MS, dur: 1500,
    data: { dmg: 38, crit: false, counter: 0 } }];
  S.saveState(st);
}

function drawAt(pin) {
  return execFileSync('node', [CLI], {
    env: {
      ...process.env, COLUMNS: '100', IDLE_RPG_HOME: HOME, RPG_HUD: 'big',
      RPG_NOW: pin == null ? '' : String(pin),
    },
    // Pointed away from this repo: the fold also polls the working directory
    // for pushes, and a push landing mid-test would rewrite the scene.
    input: JSON.stringify({ cwd: HOME }), encoding: 'utf8',
  });
}

test('a pinned clock draws the same frame however late the render happens', () => {
  const anchor = Date.now();
  saveScene(anchor, 0);
  const first = drawAt(anchor);
  // Longer than a frame, so an unpinned render is guaranteed to have moved on:
  // this is the exact drift that used to be a coin toss under load.
  sleep(sprites.FRAME_MS + 100);
  // Re-saved against the *same* anchor, so the file the child reads is byte for
  // byte what it read the first time and the clock is the only thing that moved.
  saveScene(anchor, 0);
  assert.strictEqual(drawAt(anchor), first,
    'the scene moved between two renders of one state — the clock is not pinned');
});

test('the pinned clock is what picks the frame, not the wall clock', () => {
  // One state, two clocks. Frame 0 is the wind-up and has thrown nothing; by the
  // frame the blow lands the damage number is in the gap. Reading the same state
  // twice and getting both is the pin doing the only job it has.
  const anchor = Date.now();
  saveScene(anchor, 0);
  const early = drawAt(anchor);
  saveScene(anchor, 0);
  const late = drawAt(anchor + sprites.hitFrame('ranger') * sprites.FRAME_MS);
  assert.doesNotMatch(R.visible(early), /✦-38/, 'the blow landed before it was thrown');
  assert.match(R.visible(late), /✦-38/, 'winding the clock forward did not advance the frame');
});

test('a nonsense pin falls back to the real clock instead of breaking the HUD', () => {
  // It is read from the environment, so it is exactly as trustworthy as the
  // saved `hud` pin two sections up — and gets the same treatment. A HUD that
  // renders nothing is the one failure this file exists to prevent.
  //
  // Line count alone would not catch much: a `now` of NaN or 0 still draws a
  // full scene, it just matches no animation, and the hero stands there as if
  // nothing were happening. So the damage number is the real assertion — it is
  // on screen only if the clock found the live anim, which only a real one does.
  // The blow is anchored a frame past impact and runs 1500ms, so it stays landed
  // and unexpired across a spawn either way.
  const landed = sprites.hitFrame('ranger') + 1;
  for (const junk of ['banana', '', '-5', '0', 'NaN', 'Infinity', '1e999']) {
    saveScene(Date.now(), landed);
    const out = R.visible(drawAt(junk));
    assert.strictEqual(out.trim().split('\n').length, HUD_LINES.big,
      `pin ${JSON.stringify(junk)} did not fall back to a full scene`);
    assert.match(out, /Testfixture/, `pin ${JSON.stringify(junk)} lost the hero`);
    assert.match(out, /✦-38/, `pin ${JSON.stringify(junk)} left the clock somewhere the anim isn't`);
  }
});

test('the pinned clock moves the picture and not the save', () => {
  // The fold turns elapsed time into kills and writes them down, so it keeps the
  // real clock however the render is pinned. Otherwise the seam that exists to
  // make a test deterministic would also be a way to bank an absence that never
  // happened — six hours of it, here, on top of the two that really elapsed.
  const real = Date.now();
  const away = 2 * 3600000;
  const st = E.newState('ranger', 'Testfixture', real - away);
  st.lastTickAt = st.lastEventAt = st.updatedAt = real - away;
  S.saveState(st);
  execFileSync('node', [CLI], {
    env: {
      ...process.env, COLUMNS: '100', IDLE_RPG_HOME: HOME, RPG_HUD: 'big',
      RPG_NOW: String(real + 6 * 3600000),
    },
    // Pointed away from this repo on purpose: the fold also polls the working
    // directory for pushes, and the kill count below is only exact if nothing
    // but the away window is paying into it.
    input: JSON.stringify({ cwd: HOME }), encoding: 'utf8',
  });

  const after = S.loadState();
  const hours = away / 3600000;
  assert.strictEqual(after.counters.kills, Math.floor(hours * B.OFFLINE_KILLS_PER_HOUR),
    'the fold paid out against the pinned clock rather than the real elapsed time');
  assert.ok(Math.abs(after.updatedAt - real) < 60000,
    `the save was stamped with the pinned clock (${after.updatedAt - real}ms off)`);
});

test('the ending gets its own banner, and keeps the corpse under it', () => {
  const out = renderAnim(100, (st, now) => {
    st.monster = { id: 'sprite', name: 'Grove Sprite', sprite: '(s)', level: 3, isBoss: false, hp: 40, maxHp: 40 };
    st.anim = [{ type: 'cleared', at: now - 1000, dur: 9000, data: { name: 'The Root Cause', clears: 1, mon: CORPSE } }];
  });
  assert.match(out, /THE ROOT CAUSE DEFEATED — YOU HAVE SHIPPED/);
  assert.doesNotMatch(out, /unlocked/, 'the ending promised a zone that does not exist');
  assert.doesNotMatch(out, /Grove Sprite/, 'the scene flipped to a live monster under the credits');
  const dead = sprites.DEAD_MONSTER_BIG.map(r => r.trim()).filter(Boolean)[0];
  assert.ok(out.includes(dead), 'the corpse sprite is drawn, not a live one');
});

test('a repeat clear counts itself, and a first one does not', () => {
  const banner = clears => renderAnim(100, (st, now) => {
    st.anim = [{ type: 'bossdown', at: now - 1000, dur: 6000, data: { name: 'The Root Cause', clears, mon: CORPSE } }];
  });
  assert.match(banner(4), /DEFEATED ×4/);
  // ×1 on a boss you have beaten once reads as a tally with nothing to tally.
  assert.doesNotMatch(banner(1), /×/);
});

// ---- the volley ----
//
// Only a commit and a push against a boss set `big`, and until the volley landed
// the whole of their weight was the colour of the damage number — which they had
// to borrow from `crit` to get, so the two biggest blows in the game drew exactly
// the same mark as a jab.
test('a big blow throws a volley, an ordinary one throws a single mark', () => {
  const at = cls => sprites.hitFrame(cls) * sprites.FRAME_MS;
  const shot = (cls, big) => renderAnim(100, (st, now) => {
    st.anim = [{ type: 'hit', at: now - at(cls), dur: 1500, data: { dmg: 90, crit: false, big } }];
  }, 'big', cls);

  for (const cls of ['wizard', 'knight', 'rogue', 'ranger']) {
    const { proj, trail } = sprites.heroes[cls];
    const one = shot(cls, false);
    const many = shot(cls, true);
    const count = out => out.split(proj).length - 1;

    assert.strictEqual(count(one), 1, `${cls}: an ordinary hit drew ${count(one)} marks`);
    assert.strictEqual(count(many), sprites.VOLLEY,
      `${cls}: a big hit drew ${count(many)} marks, want ${sprites.VOLLEY}`);
    // Strung on the class's own trail, so it reads as one weapon fired three
    // times rather than as three unrelated things crossing the gap together.
    assert.ok(many.includes(proj + trail.repeat(sprites.VOLLEY_GAP - 1) + proj),
      `${cls}: the volley is not spaced on its own trail`);
  }
});

// The marks arrive one at a time. A volley drawn whole from frame one would come
// out of a staff that has not finished emptying — and worse, would have to start
// off-screen behind the hero to fit, which is the one thing `flightCol` cannot
// express.
test('a volley grows out of the gap instead of appearing whole', () => {
  const seen = [0, 0.5, 1].map(fly => {
    const head = Math.round(fly * 14);
    return sprites.volleyCols(head, sprites.VOLLEY).length;
  });
  assert.deepStrictEqual(seen, [1, 3, 3], 'the volley did not build up as the head advanced');
  // Never behind the hero, at any head position a script can ask for.
  for (let head = 0; head <= 40; head++) {
    for (const c of sprites.volleyCols(head, sprites.VOLLEY)) {
      assert.ok(c >= 0 && c <= head, `mark at ${c} for a head at ${head}`);
    }
  }
});

// A volley is a property of the blow, not of the frame it lands on. `enqueue`
// sums rapid hits into whichever anim is already playing, so a commit arriving
// 200ms after a jab used to be drawn as the jab: damage summed, mark stayed
// single, and the biggest hit in the game rendered as the smallest one.
test('a big blow folded into a hit already playing keeps its volley', () => {
  const st = E.newState('wizard', 'Fixture', 1);
  st.monster.hp = st.monster.maxHp = 1e9;
  E.dealDamage(st, 1, {}, () => 0.99, 1000);                 // an ordinary jab
  E.dealDamage(st, B.DMG.commit, { big: true }, () => 0.99, 1200);  // a commit, mid-anim

  assert.strictEqual(st.anim.filter(a => a.type === 'hit').length, 1, 'the two blows did not coalesce');
  assert.ok(st.anim[0].data.big, 'the commit lost its volley on the way into the jab');
});
