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

// Class flavour renames the shelf; it must not re-roll it. If the class ever
// leaks into the seed, a Knight and a Wizard start seeing different ilvls and
// prices for the same rotation, and the shop quietly becomes class-balanced by
// accident — which nobody tuned it to be.
test('class changes the nouns on a shelf and nothing else about it', () => {
  const ids = Object.keys(C.classes);
  for (const z of C.zones) {
    for (let w = 0; w < 12; w++) {
      const now = T0 + w * SHOP.ROTATION_MS;
      const base = SHOP.rollStock(z.id, now, ids[0]);
      for (const cls of ids.slice(1)) {
        const other = SHOP.rollStock(z.id, now, cls);
        assert.deepStrictEqual(
          other.offers.map(({ name, ...rest }) => rest),
          base.offers.map(({ name, ...rest }) => rest),
          `${cls} got a different shelf from ${ids[0]} in ${z.id}`);
      }
    }
  }

  // ...and it does actually rename something. Search a day of rotations rather
  // than one shelf: any single window can roll five slots nobody flavours.
  const flavoured = new Set();
  for (let w = 0; w < 6; w++) {
    const now = T0 + w * SHOP.ROTATION_MS;
    const wiz = SHOP.rollStock('grove', now, 'wizard').offers;
    const kni = SHOP.rollStock('grove', now, 'knight').offers;
    wiz.forEach((o, i) => { if (o.name !== kni[i].name) flavoured.add(o.slot); });
  }
  assert.ok(flavoured.size > 0, 'no shelf in a day of rotations named a class-flavoured slot');
});

// The v1→v2 migration reads an item's slot back off its name, so a noun a class
// can generate but NOUN_SLOT does not know would produce gear that cannot be
// placed. Cheap to guarantee, miserable to debug.
test('every class-flavoured noun round-trips back to its own slot', () => {
  for (const [id, cls] of Object.entries(C.classes)) {
    for (const slot of C.SLOT_IDS) {
      for (const noun of C.nounsFor(slot, id)) {
        assert.strictEqual(C.slotFromNoun(`Runed Grove ${noun}`), slot,
          `${id}'s "${noun}" does not resolve back to ${slot}`);
      }
    }
  }
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
  assert.deepStrictEqual(later.stock, SHOP.rollStock('grove', T0 + SHOP.ROTATION_MS, 'rogue'));

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

// ---------- appraisal: telling the player which offers are dead ----------
//
// `rollStock` rolls ilvl uniformly over the zone span and never looks at the
// hero, which is deliberate — it keeps the shelf a hunt rather than a vending
// machine, and keeps it identical for two players in the same grove. The cost
// is that a shelf can legitimately contain a copy of the weapon you're wearing
// at full price, and an i1 with a SALE tag pointing at it. These pin the
// listing-side fix: the roll stays honest, the *listing* stops lying.

function heroWearing(spec) {
  const s = E.newState('wizard', 'Shopper', T0);
  for (const [key, ilvl] of Object.entries(spec)) {
    s.equipment[key] = {
      id: 'w_' + key, slot: C.keySlot(key), name: 'Worn ' + key,
      rarity: 'rare', ilvl, atk: 1, def: 1, hp: 1, plus: 0,
    };
  }
  return s;
}
function offer(slot, ilvl, rarity, extra) {
  return Object.assign({ slot, ilvl, rarity: rarity || 'rare', price: 100, listPrice: 100, sale: false }, extra);
}

test('an offer identical to the worn item reads as already worn', () => {
  const s = heroWearing({ weapon: 7 });
  assert.strictEqual(SHOP.offerVerdict(s, offer('weapon', 7)), 'same');
});

test('a strictly dominated offer reads as worse, an upgrade reads as upgrade', () => {
  const s = heroWearing({ weapon: 7 });
  assert.strictEqual(SHOP.offerVerdict(s, offer('weapon', 1)), 'worse');
  assert.strictEqual(SHOP.offerVerdict(s, offer('weapon', 9)), 'upgrade');
});

test('an empty slot makes any offer an upgrade', () => {
  const s = heroWearing({});
  assert.strictEqual(SHOP.offerVerdict(s, offer('weapon', 1, 'uncommon')), 'upgrade');
});

test('a ring is judged against the weakest of the worn set, not the best', () => {
  const keys = C.slotKeys('ring');
  const spec = {};
  keys.forEach((k, i) => { spec[k] = i === 0 ? 2 : 30; });
  const s = heroWearing(spec);
  // Beats the i2 straggler and nothing else — still an upgrade, because buying
  // it retires the straggler. Judging against the best worn ring would call
  // this dead and leave the hero in the i2 indefinitely.
  assert.strictEqual(SHOP.offerVerdict(s, offer('ring', 10)), 'upgrade');
  assert.strictEqual(SHOP.offerVerdict(s, offer('ring', 1)), 'worse');
});

test('SALE is stripped from offers the hero cannot use, and the price is not', () => {
  const s = heroWearing({ weapon: 7, head: 7 });
  const shelf = SHOP.appraise(s, [
    offer('weapon', 1, 'rare', { sale: true, price: 75, listPrice: 100 }),
    offer('head', 9, 'rare', { sale: true, price: 75, listPrice: 100 }),
  ]);
  assert.strictEqual(shelf[0].sale, false, 'a dominated offer kept its SALE flourish');
  assert.strictEqual(shelf[0].price, 75, 'stripping SALE changed what it costs');
  assert.strictEqual(shelf[1].sale, true, 'a real upgrade lost its SALE');
});

test('appraisal does not mutate the cached shelf', () => {
  const s = heroWearing({ weapon: 7 });
  const raw = [offer('weapon', 1, 'rare', { sale: true })];
  SHOP.appraise(s, raw);
  assert.strictEqual(raw[0].sale, true, 'appraise wrote through to the saved shelf');
  assert.ok(!('verdict' in raw[0]), 'appraise leaked a verdict into the save');
});

test('the roll still ignores the hero, so two heroes share a shelf', () => {
  // The appraisal is per-hero; the shelf underneath it must not be, or the
  // "same grove, same window, same five offers" property is gone.
  const naked = heroWearing({});
  const kitted = heroWearing(Object.fromEntries(C.EQUIP_KEYS.map(k => [k, 30])));
  const shelf = SHOP.rollStock('grove', T0, 'wizard').offers;
  assert.deepStrictEqual(
    SHOP.appraise(naked, shelf).map(o => ({ ...o, verdict: null, sale: null })),
    SHOP.appraise(kitted, shelf).map(o => ({ ...o, verdict: null, sale: null })),
    'the offers themselves differed between two heroes');
});
