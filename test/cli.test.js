'use strict';
// `equip all` and the shop live in the CLI rather than in a library, and both
// move a player's gear or gold without a confirmation step. So they get tested
// the way they are actually run: as a subprocess against a real save file.
//
// The two rules worth pinning are the ones a player can't check for themselves
// afterwards — `equip all` must never displace gear it didn't find a free slot
// for, and a shop that rotated since you last looked must not spend your gold
// on whatever landed in that slot instead.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-cli-test-'));
process.env.IDLE_RPG_HOME = HOME;

const C = require('../lib/content');
const P = require('../lib/paths');
const B = require('../lib/balance');
const E = require('../lib/engine');
const S = require('../lib/state');
const R = require('../lib/render');
const SHOP = require('../lib/shop');

const CLI = path.join(__dirname, '..', 'bin', 'rpg.js');

function run(...args) {
  return R.visible(execFileSync('node', [CLI, ...args], {
    env: { ...process.env, IDLE_RPG_HOME: HOME }, encoding: 'utf8',
  }));
}

// An item that is unmistakably for `slot`, with value driven by ilvl alone.
function item(slot, ilvl, rarity = 'common') {
  const mult = B.RARITIES.find(r => r.id === rarity).mult;
  return {
    id: `${slot}-${ilvl}-${rarity}`, slot, name: `${slot} i${ilvl}`,
    rarity, ilvl, ...B.itemStats(slot, ilvl, mult), from: 'test', at: Date.now(),
  };
}

function seed(mutate) {
  const st = E.newState('knight', 'Fixture', Date.now());
  st.hero.gold = 100000;
  if (mutate) mutate(st);
  E.refreshMaxHp(st);
  S.saveState(st);
  return st;
}

test('equip all fills every empty slot with the best thing that fits', () => {
  seed(st => {
    st.inventory = [item('head', 3), item('head', 9), item('weapon', 5), item('chest', 7)];
  });
  const out = run('equip', 'all');
  const st = S.loadState();

  assert.match(out, /Equipped 3 items/);
  assert.strictEqual(st.equipment.head.ilvl, 9, 'took the weaker helm');
  assert.strictEqual(st.equipment.weapon.ilvl, 5);
  assert.strictEqual(st.equipment.chest.ilvl, 7);
  assert.deepStrictEqual(st.inventory.map(i => i.id), ['head-3-common'],
    'the losing helm should stay in the bag, and nothing else should move');
  assert.strictEqual(st.hero.maxHp, E.heroMaxHp(st), 'maxHp not refreshed after equipping');
});

test('equip all never displaces gear you are already wearing', () => {
  const worn = item('weapon', 2);
  seed(st => {
    st.equipment.weapon = worn;
    st.inventory = [item('weapon', 40), item('feet', 6)];
  });
  const out = run('equip', 'all');
  const st = S.loadState();

  assert.strictEqual(st.equipment.weapon.ilvl, 2, 'the worn weapon was swapped out');
  assert.strictEqual(st.equipment.feet.ilvl, 6, 'the empty slot went unfilled');
  assert.deepStrictEqual(st.inventory.map(i => i.id), ['weapon-40-common'],
    'the better weapon should still be in the bag — equip all only fills empties');
  assert.match(out, /Equipped 1 item\b/);
});

test('equip all ranks four rings best-first and leaves the fifth in the bag', () => {
  seed(st => {
    st.inventory = [10, 30, 20, 50, 40].map(ilvl => item('ring', ilvl));
  });
  run('equip', 'all');
  const st = S.loadState();

  const worn = C.slotKeys('ring').map(k => st.equipment[k].ilvl);
  assert.deepStrictEqual(worn, [50, 40, 30, 20], 'rings were not filled best-first');
  assert.deepStrictEqual(st.inventory.map(i => i.ilvl), [10], 'the wrong ring was left behind');
});

test('equip all reports rather than fails when nothing fits or nothing is empty', () => {
  seed(st => { st.inventory = []; });
  assert.match(run('equip', 'all'), /Bag is empty/);

  seed(st => { st.equipment.weapon = item('weapon', 1); st.inventory = [item('weapon', 9)]; });
  const out = run('equip', 'all');
  assert.match(out, /Nothing in the bag fits/);
  assert.deepStrictEqual(S.loadState().inventory.map(i => i.id), ['weapon-9-common'],
    'the bag was touched despite nothing fitting');

  seed(st => {
    for (const k of C.EQUIP_KEYS) st.equipment[k] = item(C.keySlot(k), 5);
    st.inventory = [item('ring', 9)];
  });
  assert.match(run('equip', 'all'), /Every slot is already filled/);
});

// `equip all` being strictly additive is the trap: run it once and you read as
// geared forever while the zone climbs past you. `equip best` is the way out,
// and the two dead ends above now have to point at it rather than just shrug.
test('equip best displaces what the bag beats and says what it cost you', () => {
  seed(st => { st.equipment.weapon = item('weapon', 1); st.inventory = [item('weapon', 9)]; });
  const out = run('equip', 'best');
  assert.match(out, /weapon-9|weapon/, 'no report of what got equipped');
  assert.match(out, /replaced/, 'displacing a worn item was not reported');
  assert.match(out, /not sold/, 'did not say where the displaced item went');

  const st = S.loadState();
  assert.strictEqual(st.equipment.weapon.id, 'weapon-9-common', 'the better weapon is not worn');
  assert.deepStrictEqual(st.inventory.map(i => i.id), ['weapon-1-common'],
    'the displaced weapon should be in the bag, not gone');

  assert.match(run('equip', 'best'), /Nothing in the bag beats/, 'equip best is not idempotent');
});

test('the dead ends of equip all point at equip best when it would help', () => {
  seed(st => { st.equipment.weapon = item('weapon', 1); st.inventory = [item('weapon', 9)]; });
  assert.match(run('equip', 'all'), /\/hero equip best/, 'nothing fits, but a swap would — unsaid');

  seed(st => {
    for (const k of C.EQUIP_KEYS) st.equipment[k] = item(C.keySlot(k), 5);
    st.inventory = [item('ring', 9)];
  });
  assert.match(run('equip', 'all'), /bag beats 1 of them/);

  // …and stays quiet when the bag genuinely holds nothing better.
  seed(st => {
    for (const k of C.EQUIP_KEYS) st.equipment[k] = item(C.keySlot(k), 9);
    st.inventory = [item('ring', 1)];
  });
  const out = run('equip', 'all');
  assert.match(out, /nothing in the bag beats/i);
  assert.doesNotMatch(out, /equip best/, 'nudged toward a command that would do nothing');
});

// Insight is the one currency you cannot farm back in an afternoon, so `max`
// gets the same two-step the gold sinks get: a preview that spends nothing.
test('insight max previews before it spends, and only spends on --confirm', () => {
  seed(st => { st.hero.level = B.LEVEL_CAP; st.hero.insight = 10; });

  const preview = run('insight', 'gold', 'max');
  assert.match(preview, /Nothing spent yet/);
  assert.strictEqual(S.loadState().hero.insight, 10, 'the preview spent insight');
  assert.strictEqual(E.paragonPoints(S.loadState(), 'gold'), 0, 'the preview moved the track');

  run('insight', 'gold', 'max', '--confirm');
  const st = S.loadState();
  assert.ok(E.paragonPoints(st, 'gold') > 0, 'confirming bought nothing');
  assert.ok(st.hero.insight < 10, 'confirming charged nothing');

  // A single point is a small purchase and goes through immediately.
  const before = E.paragonPoints(S.loadState(), 'atk');
  run('insight', 'atk');
  assert.strictEqual(E.paragonPoints(S.loadState(), 'atk'), before + 1);
});

test('insight explains itself below the cap instead of erroring', () => {
  seed(st => { st.hero.level = 5; st.hero.insight = 0; st.hero.capXp = 0; });
  const out = run('insight');
  assert.match(out, new RegExp(`past level ${B.LEVEL_CAP}`));
  assert.doesNotMatch(out, /NaN|undefined/);
});

test('shop lists a full rotating shelf and buying charges the listed price', () => {
  const st0 = seed();
  const out = run('shop');
  // The hours part is omitted inside the last hour of a 4-hour window, so
  // demanding `\d+h \d+m` failed for one hour in every four — a flake that only
  // ever showed up for whoever happened to run the suite in that window.
  assert.match(out, /restocks in (\d+h )?\d+m/, 'no restock countdown on the shelf');
  const listed = out.split('\n').filter(l => /^\s+\d+\. \[/.test(l));
  assert.strictEqual(listed.length, SHOP.STOCK_SIZE, `shelf listed ${listed.length} offers`);

  const stock = SHOP.rollStock(st0.hero.zone, Date.now(), st0.hero.class);
  const offer = stock.offers[0];
  const bought = run('shop', 'buy', '1');
  assert.match(bought, new RegExp(`Bought .*${offer.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  const st = S.loadState();
  assert.strictEqual(st.hero.gold, st0.hero.gold - offer.price, 'charged the wrong price');
  assert.strictEqual(st.inventory.length, 1);
  assert.strictEqual(st.inventory[0].ilvl, offer.ilvl);
});

test('a shelf that rotated since you last looked cancels the buy', () => {
  const st0 = seed(st => {
    // A shelf the player read one rotation ago, for this same zone.
    st.shop = SHOP.rollStock('grove', Date.now() - SHOP.ROTATION_MS);
  });
  const out = run('shop', 'buy', '1');

  assert.match(out, /restocked before that went through — nothing bought/);
  const st = S.loadState();
  assert.strictEqual(st.hero.gold, st0.hero.gold, 'gold was spent on the cancelled buy');
  assert.strictEqual(st.inventory.length, 0, 'an item arrived from a cancelled buy');
  assert.strictEqual(st.shop.window, SHOP.windowOf(Date.now()), 'the new shelf was not stocked');

  // …and the retry, now against the shelf that was just printed, goes through.
  const retry = run('shop', 'buy', '1');
  assert.match(retry, /^Bought /);
  assert.strictEqual(S.loadState().inventory.length, 1);
});

// ---------------------------------------------------------------------------
// The destructive paths. Every one of these either empties the bag, spends
// gold that never comes back, or deletes the hero, and each is gated by
// --confirm. The gates were read and found correct; nothing pinned them, so a
// refactor could drop one silently and the first person to notice would be a
// player who had already lost the thing.

// `reset` without --confirm exits 1, so it cannot go through `run`.
function runFail(...args) {
  try {
    execFileSync('node', [CLI, ...args], {
      env: { ...process.env, IDLE_RPG_HOME: HOME }, encoding: 'utf8', stdio: 'pipe',
    });
  } catch (e) {
    return { out: R.visible(String(e.stdout || '')), code: e.status };
  }
  assert.fail(`${args.join(' ')} succeeded — it was expected to exit non-zero`);
}

const bagValue = st => st.inventory.reduce((sum, it) => sum + E.sellPrice(it), 0);

test('sell all previews the whole bag and only empties it on --confirm', () => {
  const st0 = seed(st => {
    st.inventory = [item('head', 3), item('weapon', 12, 'rare'), item('feet', 7, 'epic')];
  });
  const worth = bagValue(st0);

  const preview = run('sell', 'all');
  assert.match(preview, /This would sell 3 of 3 items/);
  assert.match(preview, /Nothing sold yet/);
  assert.match(preview, /confirm with:\s+\/hero sell all --confirm/);
  assert.strictEqual(S.loadState().inventory.length, 3, 'the preview emptied the bag');
  assert.strictEqual(S.loadState().hero.gold, st0.hero.gold, 'the preview paid out');

  const out = run('sell', 'all', '--confirm');
  assert.match(out, /Sold 3 items/);
  const st = S.loadState();
  assert.strictEqual(st.inventory.length, 0, 'the bag was not emptied');
  assert.strictEqual(st.hero.gold, st0.hero.gold + worth, 'paid out something other than the listed total');
});

test('sell <rarities> takes only the rarities it named', () => {
  const keep = [item('head', 3), item('chest', 4, 'legendary')];
  const st0 = seed(st => {
    st.inventory = [keep[0], item('weapon', 12, 'rare'), keep[1], item('feet', 7, 'epic'), item('neck', 5, 'rare')];
  });
  const worth = bagValue(st0) - bagValue({ inventory: keep });

  // Plural and comma forms both resolve, and both name the same set.
  const preview = run('sell', 'rares,epic');
  assert.match(preview, /This would sell 3 of 5 items/);
  assert.match(preview, /2 items would stay in the bag/);
  assert.strictEqual(S.loadState().inventory.length, 5, 'the preview sold something');

  run('sell', 'rares,epic', '--confirm');
  const st = S.loadState();
  assert.deepStrictEqual(st.inventory.map(i => i.id), keep.map(i => i.id),
    'sold the wrong items — the survivors are not the ones it was told to keep');
  assert.strictEqual(st.hero.gold, st0.hero.gold + worth, 'paid out the wrong total');
});

test('selling one item by number needs no confirmation', () => {
  // The deliberate asymmetry: a number names exactly one line you just read off
  // `/hero inventory`, so there is nothing a preview would tell you.
  const st0 = seed(st => { st.inventory = [item('head', 3), item('weapon', 12, 'rare')]; });
  const gone = st0.inventory[1];

  const out = run('sell', '2');
  assert.match(out, new RegExp(`Sold ${gone.name} for`));
  const st = S.loadState();
  assert.deepStrictEqual(st.inventory.map(i => i.id), [st0.inventory[0].id]);
  assert.strictEqual(st.hero.gold, st0.hero.gold + E.sellPrice(gone));
});

test('upgrade max previews the spend and the stats before it takes the gold', () => {
  const st0 = seed(st => {
    st.hero.gold = 60000;
    st.equipment.weapon = item('weapon', 40, 'rare');
  });

  const preview = run('upgrade', 'weapon', 'max');
  assert.match(preview, /from \+0 to \+\d+ for/);
  assert.match(preview, /ATK \d+ → \d+/, 'the preview did not show what the gold buys');
  assert.match(preview, /Nothing spent yet/);
  assert.strictEqual(S.loadState().hero.gold, st0.hero.gold, 'the preview spent gold');
  assert.strictEqual(S.loadState().equipment.weapon.plus || 0, 0, 'the preview upgraded the item');

  run('upgrade', 'weapon', 'max', '--confirm');
  const st = S.loadState();
  assert.ok(st.equipment.weapon.plus > 0, 'confirming upgraded nothing');
  assert.ok(st.hero.gold < st0.hero.gold, 'confirming cost nothing');
  // `max` spends until the next step is unaffordable, so what is left over must
  // not cover it — otherwise it stopped early and the preview lied.
  assert.ok(st.equipment.weapon.plus === B.UPGRADE_MAX
    || st.hero.gold < B.upgradeCost(st.equipment.weapon.ilvl, st.equipment.weapon.plus),
    'stopped upgrading while it could still afford another level');
});

test('reset refuses without --confirm and leaves the save untouched', () => {
  const st0 = seed(st => { st.inventory = [item('head', 3)]; });
  const { out, code } = runFail('reset');

  assert.match(out, /deletes your hero forever/);
  assert.strictEqual(code, 1, 'refusing to delete should be a failure exit');
  const st = S.loadState();
  assert.ok(st, 'the save is gone');
  assert.strictEqual(st.hero.gold, st0.hero.gold);
  assert.strictEqual(st.inventory.length, 1);
});

test('reset --confirm deletes every file the save is spread across', () => {
  seed();
  // A save is five files, not one: leaving the inbox or the lock behind means
  // the next hero inherits the last one's queued events.
  const files = [P.stateFile, P.bakFile, P.eventsFile, P.processingFile, P.lockFile];
  for (const f of files) fs.writeFileSync(f, f === P.stateFile ? fs.readFileSync(P.stateFile) : 'x');

  // …and the copies a save spills into. Both of these are whole save files
  // with a playable hero inside them, so "forever" has to reach them too.
  const spilled = [`state.corrupt-${Date.now()}.json`, 'state.v1.json']
    .map(f => path.join(P.CHAR_DIR, f));
  for (const f of spilled) fs.writeFileSync(f, fs.readFileSync(P.stateFile));

  const out = run('reset', '--confirm');
  assert.match(out, /Save deleted/);
  for (const f of [...files, ...spilled]) {
    assert.ok(!fs.existsSync(f), `${path.basename(f)} survived the reset`);
  }
  assert.strictEqual(S.loadState(), null, 'a hero can still be loaded after a reset');
});

// ---- /hero hud ----
// The layout pin is the only setting the game stores, and it is stored in the
// save rather than in settings.json on purpose: the skill is allowed to run
// rpg.js and nothing else, so a preference it can reach has to live here.

function runHud(cols, ...args) {
  return R.visible(execFileSync('node', [CLI, 'hud', ...args], {
    env: { ...process.env, IDLE_RPG_HOME: HOME, COLUMNS: String(cols), RPG_HUD: '' },
    encoding: 'utf8',
  }));
}

test('hud <mode> pins a layout and hud auto clears it', () => {
  seed();
  runHud(100, 'compact');
  assert.strictEqual(S.loadState().hud, 'compact');

  // auto is stored as the *absence* of the key, so a save made before this
  // command existed is already in the right state rather than needing a
  // migration to give it one.
  runHud(100, 'auto');
  assert.ok(!('hud' in S.loadState()), 'auto should remove the key, not set it to "auto"');
});

test('hud warns about a layout too wide for the terminal but pins it anyway', () => {
  seed();
  const out = runHud(60, 'big');
  assert.match(out, /≥76 cols and this terminal is 60/);
  assert.match(out, /Pinned anyway/);
  assert.strictEqual(S.loadState().hud, 'big', 'the warning must not have blocked the pin');
});

test('hud stays quiet about width when there is none to read', () => {
  seed();
  // Run through a tool's captured stdout with no COLUMNS: inventing a warning
  // about an 80-column terminal nobody is sitting at is worse than saying
  // nothing, because the player cannot tell it is a guess.
  const out = R.visible(execFileSync('node', [CLI, 'hud', 'big'], {
    env: { ...process.env, IDLE_RPG_HOME: HOME, COLUMNS: '', RPG_HUD: '' }, encoding: 'utf8',
  }));
  assert.doesNotMatch(out, /cols and this terminal/);
  assert.strictEqual(S.loadState().hud, 'big');
});

test('hud rejects an unknown mode without touching the save', () => {
  seed();
  runHud(100, 'compact');
  const { out, code } = runFail('hud', 'sideways');
  assert.match(out, /Unknown HUD mode "sideways"/);
  assert.strictEqual(code, 1);
  assert.strictEqual(S.loadState().hud, 'compact', 'a rejected mode changed the pin');
});

test('hud reports the $RPG_HUD override that would silently beat it', () => {
  seed();
  const out = R.visible(execFileSync('node', [CLI, 'hud', 'compact'], {
    env: { ...process.env, IDLE_RPG_HOME: HOME, COLUMNS: '100', RPG_HUD: 'big' }, encoding: 'utf8',
  }));
  assert.match(out, /\$RPG_HUD=big is set, and overrides this/);
});

// ---------- `/hero stats` ----------
//
// The engine tests pin what a sitting *is*. These pin the only things the view
// can get wrong on its own: showing the lifetime totals where the sitting's
// belong, and printing a wall of zeroes at someone who just sat down.

test('stats reports the sitting and the lifetime separately', () => {
  seed(st => {
    Object.assign(st.counters, {
      kills: 500, bossKills: 4, commits: 200, goldEarned: 90_000,
      linesWritten: 40_000, testsPassed: 300, testsFailed: 12, drops: 30, vendored: 60,
    });
    E.openSession(st, Date.now() - 2 * 3600_000 - 14 * 60_000);
    st.counters.kills += 143;
    st.counters.bossKills += 2;
    st.counters.commits += 9;
    st.counters.goldEarned += 12_405;
    st.counters.xpEarned = 8_420;
    st.counters.drops += 3;
    st.counters.vendored += 11;
  });
  const out = run('stats');

  assert.match(out, /This sitting — 2h 14m:/);
  assert.match(out, /kills 143/, 'the sitting borrowed the lifetime kill count');
  assert.match(out, /2 bosses/);
  assert.match(out, /gold \+12,405g/);
  assert.match(out, /commits 9\b/);
  assert.match(out, /loot 3 kept, 11 vendored/);
  // 143 kills over 2h14m ≈ 64/h — reported because the sitting is long enough
  // for the division to mean something.
  assert.match(out, /kills 143 \(6[0-9]\/h\)/);

  assert.match(out, /Lifetime \(\d+ days\):/);
  assert.match(out, /kills 643 \(6 bosses\)/, 'the lifetime block lost the sitting');
});

// Just the sitting block — the lifetime block below it legitimately prints
// `kills 0` for a fresh hero, and a whole-output match would read that as a pass.
const sitting = out => out.slice(out.indexOf('This sitting'), out.indexOf('Lifetime'));

test('a sitting nobody has played yet says so instead of printing zeroes', () => {
  seed(st => { E.openSession(st, Date.now()); });
  const out = run('stats');
  assert.match(out, /nothing yet — no kills, no commits, no code/);
  assert.doesNotMatch(sitting(out), /kills 0/);
});

test('stats falls back to the last sitting when this one is empty', () => {
  const now = Date.now();
  seed(st => {
    E.openSession(st, now);
    st.lastSession = {
      startedAt: now - 7 * 3600_000, endedAt: now - 4 * 3600_000, ms: 3 * 3600_000,
      fromLevel: 8, levels: 2, kills: 210, bossKills: 1, goblinKills: 0, goblinFled: 0,
      deaths: 1, commits: 12, pushes: 3, testsPassed: 40, testsFailed: 2,
      linesWritten: 3000, goldEarned: 18_900, xpEarned: 4000, insightEarned: 0,
      drops: 4, vendored: 9,
    };
  });
  const out = run('stats');
  assert.match(out, /before that — 3h 00m, ended 4h ago: 210 kills · \+18,900g · 12 commits/);
});

test('a quiet last sitting is left unsaid rather than reported as nothing', () => {
  const now = Date.now();
  seed(st => {
    E.openSession(st, now);
    st.lastSession = { startedAt: now - 3600_000, endedAt: now, ms: 3600_000, levels: 0, kills: 0 };
  });
  assert.doesNotMatch(run('stats'), /before that/);
});

test('a short sitting reports no rate, because it would not be one', () => {
  seed(st => {
    E.openSession(st, Date.now() - 60_000);
    st.counters.kills += 3;
  });
  const out = run('stats');
  assert.match(out, /kills 3(?!\s*\()/, `want a bare kill count, got: ${out}`);
});

test('span keeps the minutes relTime deliberately throws away', () => {
  // The two formatters answer different questions and round differently for it.
  // A sitting reported as "2h" hides the fourteen minutes it is being read for.
  assert.strictEqual(R.span(0), '0s');
  assert.strictEqual(R.span(45_000), '45s');
  assert.strictEqual(R.span(59_999), '59s');
  assert.strictEqual(R.span(60_000), '1m');
  assert.strictEqual(R.span(59 * 60_000), '59m');
  assert.strictEqual(R.span(3600_000), '1h 00m');
  assert.strictEqual(R.span(2 * 3600_000 + 14 * 60_000), '2h 14m');
  assert.strictEqual(R.span(25 * 3600_000), '1d 1h');
  assert.strictEqual(R.span(-5), '0s', 'a clock that stepped back reported a negative span');
});

test('a cleared save says so in status and in stats, permanently', () => {
  const cleared = Date.UTC(2026, 8, 14, 12, 0, 0);
  seed(st => { st.hero.clearedAt = cleared; st.counters.finalBossKills = 1; });
  assert.match(run('status'), /✦ CLEARED 2026-09-14/);
  assert.match(run('stats'), /✦ CLEARED 2026-09-14/);

  // The count only appears once there is something to count.
  assert.doesNotMatch(run('status'), /down ×/);
  seed(st => { st.hero.clearedAt = cleared; st.counters.finalBossKills = 4; });
  assert.match(run('status'), /✦ CLEARED 2026-09-14 — The Root Cause down ×4/);
});

test('a hero who has not finished is not told they have', () => {
  seed();
  assert.doesNotMatch(run('status'), /CLEARED/);
  assert.doesNotMatch(run('stats'), /CLEARED/);
});
