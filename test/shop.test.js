'use strict';
// The shelf has to be two contradictory things at once: random enough that a
// rotation is worth checking, and stable enough that `shop buy 3` charges you
// for the item you just read off `shop`. Both come from seeding the roll on
// (zone, rotation window), so these tests pin that seeding — a shelf that
// re-rolls per call would silently turn every purchase into a lottery.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-shop-test-'));
process.env.IDLE_RPG_HOME = HOME;

const C = require('../lib/content');
const B = require('../lib/balance');
const E = require('../lib/engine');
const SHOP = require('../lib/shop');

const T0 = 1_700_000_000_000;                    // lands mid-window, not on a boundary
const HOUR = 3600000;

test('the shelf is stable inside a rotation and different across one', () => {
  const a = SHOP.rollStock('grove', T0);
  const b = SHOP.rollStock('grove', T0 + 60000);
  assert.deepStrictEqual(a, b, 'same window rolled a different shelf');

  const next = SHOP.rollStock('grove', T0 + SHOP.ROTATION_MS);
  assert.notStrictEqual(next.window, a.window, 'window index did not advance');
  assert.notDeepStrictEqual(
    next.offers.map(o => o.name + o.ilvl), a.offers.map(o => o.name + o.ilvl),
    'the shelf survived a rotation unchanged');
});

test('every zone rolls its own shelf', () => {
  const seen = new Set();
  for (const z of C.zones) {
    const key = SHOP.rollStock(z.id, T0).offers.map(o => o.name + o.ilvl).join('|');
    assert.ok(!seen.has(key), `${z.id} stocks the same shelf as another zone`);
    seen.add(key);
  }
});

test('offers are legal items: real slots, in-zone ilvl, priced off the curve', () => {
  for (const z of C.zones) {
    for (let w = 0; w < 40; w++) {
      const stock = SHOP.rollStock(z.id, T0 + w * SHOP.ROTATION_MS);
      assert.strictEqual(stock.offers.length, SHOP.STOCK_SIZE);
      const slots = new Set();
      for (const o of stock.offers) {
        assert.ok(C.slotType(o.slot), `${z.id}: offer in unknown slot ${o.slot}`);
        assert.ok(!slots.has(o.slot), `${z.id}: two offers for slot ${o.slot} on one shelf`);
        slots.add(o.slot);
        assert.ok(o.ilvl >= z.min && o.ilvl <= z.max, `${z.id}: ilvl ${o.ilvl} outside ${z.min}-${z.max}`);
        const rarity = B.RARITIES.find(r => r.id === o.rarity);
        assert.ok(rarity, `${z.id}: unknown rarity ${o.rarity}`);
        assert.notStrictEqual(o.rarity, 'common', 'the shop should not sell commons');
        assert.deepStrictEqual(
          { atk: o.atk, def: o.def, hp: o.hp }, B.itemStats(o.slot, o.ilvl, rarity.mult),
          `${z.id}: ${o.name} stats are off the curve`);
        assert.strictEqual(o.listPrice, B.shopPrice(o.ilvl, rarity.mult));
        assert.strictEqual(o.price, o.sale ? Math.round(o.listPrice * SHOP.SALE_FRAC) : o.listPrice);
        assert.ok(o.price > 0);
      }
    }
  }
});

test('every shelf carries at least one rare or better', () => {
  const rank = id => B.RARITIES.findIndex(r => r.id === id);
  const rare = rank('rare');
  for (const z of C.zones) {
    for (let w = 0; w < 60; w++) {
      const stock = SHOP.rollStock(z.id, T0 + w * SHOP.ROTATION_MS);
      assert.ok(stock.offers.some(o => rank(o.rarity) >= rare),
        `${z.id} window ${w}: nothing rare+ on the shelf`);
    }
  }
});

test('rotations actually vary the stock over a week', () => {
  const names = new Set(), rarities = new Set(), ilvls = new Set();
  for (let w = 0; w < 42; w++) {                  // 42 windows = one week
    for (const o of SHOP.rollStock('caves', T0 + w * SHOP.ROTATION_MS).offers) {
      names.add(o.name); rarities.add(o.rarity); ilvls.add(o.ilvl);
    }
  }
  assert.ok(names.size > 20, `only ${names.size} distinct items in a week of rotations`);
  assert.ok(rarities.size >= 3, `only ${rarities.size} rarities in a week`);
  assert.ok(ilvls.size >= 5, `only ${ilvls.size} item levels in a week`);
});

test('refresh caches the shelf and reports rotations and zone changes', () => {
  const st = E.newState('rogue', 'Shopper', T0);
  st.hero.unlockedZones.push('caves');

  const first = SHOP.refresh(st, T0);
  assert.strictEqual(first.stocked, true, 'first look should stock the shelf');
  assert.strictEqual(first.rotated, false);
  assert.strictEqual(st.shop.zone, 'grove');

  const again = SHOP.refresh(st, T0 + HOUR);
  assert.strictEqual(again.rotated, false, 'same window reported a rotation');
  assert.strictEqual(again.stock, st.shop, 'cached shelf was rebuilt inside its window');

  const later = SHOP.refresh(st, T0 + SHOP.ROTATION_MS);
  assert.strictEqual(later.rotated, true, 'a crossed window was not reported');
  assert.deepStrictEqual(later.stock, SHOP.rollStock('grove', T0 + SHOP.ROTATION_MS));

  // Travelling is not a rotation: you're looking at a different shop, and the
  // buy guard exists to protect a shelf you already read, not to block a move.
  st.hero.zone = 'caves';
  const moved = SHOP.refresh(st, T0 + SHOP.ROTATION_MS);
  assert.strictEqual(moved.rotated, false, 'changing zone reported as a rotation');
  assert.strictEqual(moved.stocked, true);
  assert.strictEqual(st.shop.zone, 'caves');
});

test('the restock countdown runs down to the next window boundary', () => {
  const start = SHOP.windowOf(T0) * SHOP.ROTATION_MS;
  assert.strictEqual(SHOP.msToRestock(start), SHOP.ROTATION_MS);
  assert.strictEqual(SHOP.msToRestock(start + HOUR), 3 * HOUR);
  assert.strictEqual(SHOP.fmtRestock(start + HOUR), '3h 0m');
  assert.strictEqual(SHOP.fmtRestock(start + SHOP.ROTATION_MS - 90000), '2m');
});
