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
