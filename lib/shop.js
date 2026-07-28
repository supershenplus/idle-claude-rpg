'use strict';

// The shop's shelf. Stock used to be a pure function of the zone: three fixed
// slots, three fixed rarities, the same three items forever. That made the shop
// a one-time purchase per zone and then scenery. Here it is a *roll* instead,
// re-rolled on a 4-hour wall-clock rotation, so checking the shelf is worth
// doing again — and so gold has somewhere to go besides the next zone.
//
// The roll is seeded by (zone, rotation window), not by Math.random: every
// command re-derives the same shelf for as long as the window lasts, which is
// what lets `shop buy <n>` resolve the same offer the player just read off
// `shop`. The shelf is cached in the save purely so a rotation that lands
// between those two commands can be *detected* (see `refresh`) rather than
// silently swapping the item under the player's gold.

const B = require('./balance');
const C = require('./content');
const { mulberry32, weightedPick, pick } = require('./rng');

const ROTATION_MS = 4 * 60 * 60 * 1000;
const STOCK_SIZE = 5;
const SALE_CHANCE = 0.15;
const SALE_FRAC = 0.75;

// The shop's own rarity table, deliberately not the drop table: commons are
// what every slime in the grove already hands you for free, so paying gold for
// one is never the interesting choice. Legendaries stay a sighting rather than
// stock — at ~4% over five slots that is a couple of shelves a week.
const SHOP_RARITIES = [
  { id: 'uncommon', w: 42 },
  { id: 'rare', w: 34 },
  { id: 'epic', w: 20 },
  { id: 'legendary', w: 4 },
];
const RARE_INDEX = B.RARITIES.findIndex(r => r.id === 'rare');
function rarityRank(id) { return B.RARITIES.findIndex(r => r.id === id); }

function windowOf(now) { return Math.floor(now / ROTATION_MS); }
function msToRestock(now) { return ROTATION_MS - (now % ROTATION_MS); }
function fmtRestock(now) {
  const ms = msToRestock(now);
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// FNV-1a over "<zone>:<window>" — any two shelves differ in one of the two, and
// mulberry32 wants a spread-out 32-bit seed rather than a small integer.
function seedFor(zoneId, win) {
  const s = `${zoneId}:${win}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Roll the shelf for one zone in one rotation window. Deterministic in both.
function rollStock(zoneId, now) {
  const zone = C.zoneById(zoneId);
  const win = windowOf(now);
  const rand = mulberry32(seedFor(zone.id, win));

  // Distinct slots, so a shelf is never three variations on the same ring, and
  // over a day of rotations every slot you can wear turns up somewhere.
  const slots = shuffle(C.SLOT_TYPES, rand).slice(0, STOCK_SIZE);
  const span = zone.max - zone.min;

  // Roll the parameters first, materialise second: the rare+ guarantee below
  // rewrites a rarity, and rebuilding an offer from its parameters keeps the
  // name, price and stats consistent with it.
  const rolls = slots.map(st => ({
    st,
    rarity: weightedPick(SHOP_RARITIES, rand).id,
    ilvl: zone.min + Math.floor(rand() * (span + 1)),
    noun: pick(st.nouns, rand),
    sale: rand() < SALE_CHANCE,
  }));

  // Every rotation is worth the walk. Five uncommons is a possible roll and a
  // boring shelf, so the highest-ilvl slot on it gets bumped to rare.
  if (!rolls.some(r => rarityRank(r.rarity) >= RARE_INDEX)) {
    let best = 0;
    for (let i = 1; i < rolls.length; i++) if (rolls[i].ilvl > rolls[best].ilvl) best = i;
    rolls[best].rarity = 'rare';
  }

  const offers = rolls.map(r => {
    const rarity = B.RARITIES.find(x => x.id === r.rarity);
    const stats = B.itemStats(r.st.id, r.ilvl, rarity.mult);
    const base = B.shopPrice(r.ilvl, rarity.mult);
    return {
      slot: r.st.id,
      name: r.rarity === 'legendary'
        ? zone.legendary
        : `${C.RARITY_ADJ[r.rarity]} ${zone.flavor} ${r.noun}`.trim(),
      rarity: r.rarity,
      ilvl: r.ilvl,
      atk: stats.atk, def: stats.def, hp: stats.hp,
      price: r.sale ? Math.round(base * SALE_FRAC) : base,
      listPrice: base,
      sale: r.sale,
    };
  });

  return { zone: zone.id, window: win, offers };
}

// The shelf for the hero's current zone and the current window, writing it back
// into `state.shop`. `rotated` is true when this call replaced a shelf the
// player had already seen — the caller uses it to refuse a buy that would land
// on an item they never read, and `stocked` when there was no shelf at all.
function refresh(state, now) {
  const zoneId = state.hero.zone;
  const win = windowOf(now);
  const prev = state.shop;
  if (prev && prev.zone === zoneId && prev.window === win && Array.isArray(prev.offers)) {
    return { stock: prev, rotated: false, stocked: false };
  }
  state.shop = rollStock(zoneId, now);
  return {
    stock: state.shop,
    rotated: !!(prev && prev.zone === zoneId && prev.window !== win),
    stocked: !prev || prev.zone !== zoneId,
  };
}

module.exports = {
  ROTATION_MS, STOCK_SIZE, SHOP_RARITIES, SALE_FRAC,
  windowOf, msToRestock, fmtRestock, rollStock, refresh,
};
