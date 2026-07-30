'use strict';

const B = require('./balance');
const C = require('./content');
const { mulberry32, weightedPick, pick } = require('./rng');

// ---------- derived hero stats ----------

function classDef(state) { return C.classes[state.hero.class] || C.classes.wizard; }

// An item's stat after upgrades. `atk/def/hp` stay exactly as they rolled and
// `plus` is applied here, so the original roll is never lost and an upgrade
// stays inspectable (and reversible, if that ever matters).
//
// Unrounded, because gearSum totals twelve slots and must round *once*. At 3%
// per level a single upgrade is often a sub-integer change — +3% of a def-11
// chestpiece is 0.33 — and rounding each slot before summing threw all of that
// away, so a set at +10 measured almost the same as a set at +0.
// `|| 0` catches null and undefined but not a truthy non-number: a hand-edited
// or half-migrated save carrying "12abc" multiplies to NaN, and one NaN slot
// poisons the whole gear sum. Coerce first so a bad field reads as zero.
function itemStatRaw(it, key) {
  if (!it) return 0;
  return (Number(it[key]) || 0) * B.plusMult(Number(it.plus) || 0);
}
function itemStat(it, key) { return Math.round(itemStatRaw(it, key)); }

function gearSum(state, key) {
  let n = 0;
  for (const slot of C.EQUIP_KEYS) n += itemStatRaw(state.equipment[slot], key);
  return Math.round(n);
}
function heroAtk(state) {
  const c = classDef(state);
  const base = c.atkBase + c.atkPerLvl * state.hero.level + gearSum(state, 'atk');
  return base * insightMult(state, 'atk');
}
function heroDef(state) { return gearSum(state, 'def'); }
function heroMaxHp(state) {
  const c = classDef(state);
  const n = Math.round(c.hpBase + c.hpPerLvl * (Number(state.hero.level) || 1)
    + gearSum(state, 'hp'));
  // Last line of defence. A non-finite maxHp pins hp at NaN, and since NaN > 0
  // is false the hero reads as dead on every subsequent hit — an unrecoverable
  // save that drains gold forever. Fall back to the bare class base instead.
  return Number.isFinite(n) && n > 0 ? n : Math.round(c.hpBase);
}
function refreshMaxHp(state) {
  const max = heroMaxHp(state);
  state.hero.maxHp = max;
  const hp = Number(state.hero.hp);
  state.hero.hp = Number.isFinite(hp) ? Math.min(hp, max) : max;
}

// ---------- state creation ----------

// The hero name is the only free text in the save, and it lands in a terminal
// about once a second via the HUD. Nobody but you can set it, so an escape
// sequence in there is not an attack — but it renders as a wrecked status line
// rather than as a wrecked name, which reads as a game bug and sends you
// looking in the wrong file. So drop everything that can steer a terminal: C0
// (ESC included), DEL, and C1, where U+009B is a bare CSI all by itself.
//
// Length is capped in code points, not units, because slicing mid-surrogate
// would leave a lone half that renders as a replacement char — and the whole
// point here is to not hand the terminal something surprising. Width still
// belongs to render.fit(); this only stops a name from crowding out the line.
const NAME_MAX = 24;
function sanitizeName(name) {
  const stripped = String(name == null ? '' : name)
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .trim();
  const cps = Array.from(stripped);
  return (cps.length > NAME_MAX ? cps.slice(0, NAME_MAX).join('').trim() : stripped) || 'Hero';
}

function newState(clsId, name, now) {
  const state = {
    version: 2,
    createdAt: now, updatedAt: now, lastEventAt: now, lastTickAt: now,
    hero: {
      name: sanitizeName(name), class: clsId, level: 1, xp: 0,
      hp: 0, maxHp: 0, gold: 0,
      zone: 'grove', unlockedZones: ['grove'],
    },
    equipment: C.emptyEquipment(),
    inventory: [],
    monster: null,
    counters: {
      kills: 0, bossKills: 0, killsSinceBoss: 0, zoneKills: {},
      commits: 0, pushes: 0, testsPassed: 0, testsFailed: 0,
      linesWritten: 0, goldEarned: 0, xpEarned: 0, deaths: 0, lastTestXpAt: 0,
      insightEarned: 0, drops: 0, vendored: 0,
    },
    anim: [], ticker: [], eventsFolded: 0,
  };
  openSession(state, now);
  refreshMaxHp(state);
  state.hero.hp = state.hero.maxHp;
  spawnMonster(state, mulberry32(now >>> 0));
  return state;
}

// ---------- anims + ticker ----------

// The two blow animations, both of which sum rather than queue when they arrive
// on top of themselves. A catch-up fold can hand us fifty of either, and fifty
// 1500ms frames would push everything real past ANIM_MAX_AHEAD_MS.
const COALESCING = new Set(['hit', 'mhit']);

function enqueue(state, type, dur, data, now) {
  const q = state.anim;
  const last = q[q.length - 1];
  if (COALESCING.has(type) && last && last.type === type && last.at + last.dur > now) {
    last.data.dmg += data.dmg;                      // coalesce rapid hits
    last.data.crit = last.data.crit || data.crit;
    // A volley is a property of the blow, not of the frame it lands on, so it
    // has to survive being folded into one already playing. Without this a
    // commit that arrives 200ms after a jab is drawn as the jab: the damage
    // sums, the mark stays single, and the biggest hit in the game renders as
    // the smallest one.
    last.data.big = last.data.big || data.big;
    return;
  }
  const at = Math.max(now, last ? last.at + last.dur : now);
  if (at > now + B.ANIM_MAX_AHEAD_MS) return;
  if (q.length >= B.ANIM_CAP) return;
  q.push({ type, at, dur, data: data || {} });
}
function pruneAnims(state, now) {
  const before = state.anim.length;
  state.anim = state.anim.filter(a => a.at + a.dur > now);
  return state.anim.length !== before;
}
function tick(state, msg) {
  state.ticker.unshift(msg);
  state.ticker.length = Math.min(state.ticker.length, 3);
}

// ---------- monsters ----------

// What actually stands between the hero and this zone's boss. Both gates are
// reported because either can bind: the kill counter keeps climbing past its
// threshold while the level gate holds, so a readout that knew only about kills
// said "0 more kills" for as long as it took to earn three levels. The spawner
// below reads the same helper, so what you're told and what spawns cannot drift.
function bossGate(state) {
  const zone = C.zoneById(state.hero.zone);
  const kills = Math.max(0, B.BOSS_KILLS_REQUIRED - state.counters.killsSinceBoss);
  const levels = Math.max(0, (zone.boss.level - 1) - state.hero.level);
  return { zone, boss: zone.boss, kills, levels, ready: kills === 0 && levels === 0 };
}

// One honest line for the CLI: never "0 more kills" while a level gate holds.
function bossGateText(state) {
  const g = bossGate(state);
  if (g.ready) return `${g.boss.name} is here — the next kill summons it`;
  const parts = [];
  if (g.kills) parts.push(`${g.kills} kill${g.kills === 1 ? '' : 's'}`);
  if (g.levels) parts.push(`${g.levels} level${g.levels === 1 ? '' : 's'}`);
  return `${g.boss.name} stirs — ${parts.join(' and ')} away`;
}

function spawnMonster(state, rand) {
  const zone = C.zoneById(state.hero.zone);
  if (bossGate(state).ready) {
    state.monster = {
      id: zone.boss.id, name: zone.boss.name, level: zone.boss.level,
      isBoss: true, sprite: zone.boss.sprite,
      maxHp: B.monsterMaxHp(zone.boss.level, rand(), true), hp: 0,
    };
  } else {
    // The goblin roll happens *inside* the non-boss branch and after the gate,
    // so a ready boss always wins — a goblin that could pre-empt the boss would
    // be able to push the one fight the zone is built around off the screen.
    //
    // It is rolled before the monster pick rather than replacing one afterwards
    // so the two share no rand() calls: a goblin consumes the same three rolls
    // a trash spawn would, which keeps a fold replaying identically whether or
    // not the goblin turned up.
    const isGoblin = rand() < B.GOBLIN_CHANCE;
    const m = pick(zone.monsters, rand);
    const mLvl = B.monsterLevel(zone, state.counters.killsSinceBoss, rand());
    const hp = B.monsterMaxHp(mLvl, rand(), false);
    state.monster = isGoblin
      ? {
        id: C.GOBLIN.id, name: C.GOBLIN.name, level: mLvl, isBoss: false,
        isGoblin: true, sprite: C.GOBLIN.sprite, maxHp: hp * B.GOBLIN_HP_MULT, hp: 0,
        // How many folded events it will stand there for. Rides on the monster
        // rather than on the save's top level so it cannot outlive the goblin
        // it belongs to — a stale counter would flee the *next* one early.
        patience: B.GOBLIN_FLEE_EVENTS,
      }
      : {
        id: m.id, name: m.name, level: mLvl, isBoss: false, sprite: m.sprite,
        maxHp: hp, hp: 0,
      };
  }
  state.monster.hp = state.monster.maxHp;
  const now = state.updatedAt || Date.now();
  if (state.monster.isBoss) enqueue(state, 'bossintro', 6000, { name: state.monster.name }, now);
  else if (state.monster.isGoblin) enqueue(state, 'goblin', 4000, { name: state.monster.name }, now);
}

// ---------- travel ----------

// One path for every zone change, automatic or typed, so the two cannot drift.
//
// `killsSinceBoss` resets. It is a single global counter meaning "kills toward
// the boss of the zone I am in", so carrying it across a border is meaningless
// in both directions — and it is what `monsterLevel` reads to escalate trash
// across the band. Arriving in an unseen zone with a full counter would spawn
// its *top* tier on the first step, which is the cliff the escalation curve
// exists to remove.
function travelTo(state, zoneId, rand, now) {
  const z = C.zoneById(zoneId);
  if (!z || state.hero.zone === zoneId) return false;
  state.hero.zone = zoneId;
  state.counters.killsSinceBoss = 0;
  spawnMonster(state, rand);
  return true;
}

// Clearing a zone's boss unlocks the next one; the hero moves up as soon as
// they meet its level floor. The floor is the whole reason this is not done on
// the kill itself: a boss can be summoned at `boss.level - 1` and the next zone
// starts one level above the boss, so on a first clear you are *always* two
// levels short of the place you just unlocked.
//
// This is the rule the balance sim has always played by — it used to implement
// its own copy at the day boundary — so every gate it asserts (death cadence,
// cap day, boss cadence) already describes a hero who travels exactly this way.
function maybeTravel(state, rand, now) {
  const next = C.nextZone(state.hero.zone);
  if (!next || !state.hero.unlockedZones.includes(next.id)) return false;
  if (state.hero.level < next.min) return false;
  // Never mid-boss. Reaching here means the zone is already cleared, so this is
  // a re-armed boss the hero chose to fight — walking them out of it mid-swing
  // is the one way automatic travel could take something away from someone.
  if (state.monster && state.monster.isBoss) return false;
  if (!travelTo(state, next.id, rand, now)) return false;
  enqueue(state, 'travel', 5000, { name: next.name }, now);
  tick(state, `travelled to ${next.name}`);
  return true;
}

// ---------- loot ----------

let itemSeq = 0;
function makeItem(state, rarity, ilvl, from, rand) {
  // Weighted by how many of that slot you wear, so rings drop four times as
  // often as helms — otherwise the four ring slots would take forever to fill.
  const slot = weightedPick(C.SLOT_TYPES.map(s => ({ id: s.id, w: s.count })), rand).id;
  const zone = C.zoneById(state.hero.zone);
  const stats = B.itemStats(slot, Math.max(1, ilvl), rarity.mult);
  let name;
  if (rarity.id === 'legendary') name = zone.legendary;
  else name = `${C.RARITY_ADJ[rarity.id]} ${zone.flavor} ${pick(C.nounsFor(slot, state.hero.class), rand)}`.trim();
  itemSeq = (itemSeq + 1) % 1296;
  return {
    id: 'itm_' + (state.counters.kills * 1296 + itemSeq).toString(36),
    slot, name, rarity: rarity.id, ilvl: Math.max(1, ilvl),
    atk: stats.atk, def: stats.def, hp: stats.hp, plus: 0,
    from, at: state.updatedAt,
  };
}

function rarityMult(it) {
  return (B.RARITIES.find(r => r.id === it.rarity) || { mult: 1 }).mult;
}

// What an item is worth *to the hero*, and so which of two is "better". Shop
// price rolls ilvl and rarity together, which is exactly the comparison
// equipping wants; `plus` rides on top so gear you have poured gold into is
// never ranked below a raw drop and quietly displaced by it.
function itemValue(it) {
  return Math.round(B.shopPrice(it.ilvl, rarityMult(it)) * B.plusMult(it.plus));
}

// What a merchant pays — deliberately blind to `plus`. Gold spent upgrading is
// destroyed, which is the whole point of a sink: if sell price tracked upgrades,
// every one of them would be a 25%-refundable deposit and the economy would leak
// straight back open.
function sellPrice(it) {
  return Math.round(B.shopPrice(it.ilvl, rarityMult(it)) * B.SELL_FRAC);
}

// Spend gold to raise one item's `plus`. Refuses rather than throwing, so the
// CLI and the sim can both drive it in a loop without pre-checking.
function upgradeItem(state, it) {
  const plus = it.plus || 0;
  if (plus >= B.UPGRADE_MAX) return { ok: false, why: 'maxed', plus };
  const cost = B.upgradeCost(it.ilvl, plus);
  if (state.hero.gold < cost) return { ok: false, why: 'gold', cost, plus };
  state.hero.gold -= cost;
  it.plus = plus + 1;
  refreshMaxHp(state);
  return { ok: true, cost, plus: it.plus };
}

// Fill slots from the bag, best-first, and return what changed.
//
// `displace: false` (the CLI's `equip all`) only fills *empty* slots — strictly
// additive, nothing to preview and nothing to undo. `displace: true` also swaps
// out a worn item the bag beats, which is what a player does by hand with
// `equip <n>` over a session, and what the balance sim needs: it used to fold
// 83 days of combat without ever equipping a drop, so every death figure it
// produced described a hero fighting Production naked.
function autoEquip(state, opts) {
  const displace = !!(opts && opts.displace);
  const consumed = new Set();
  const benched = [];
  const changes = [];

  for (const stype of C.SLOT_TYPES) {
    const keys = C.slotKeys(stype.id);
    const bag = [];
    state.inventory.forEach((it, i) => {
      if (it && it.slot === stype.id && !consumed.has(i)) bag.push({ it, i });
    });
    bag.sort((a, b) => itemValue(b.it) - itemValue(a.it));

    if (!displace) {
      for (const key of keys) {
        if (state.equipment[key]) continue;
        const next = bag.shift();
        if (!next) break;
        consumed.add(next.i);
        state.equipment[key] = next.it;
        changes.push({ key, item: next.it, replaced: null });
      }
      continue;
    }

    // The best `keys.length` of (worn ∪ bag) end up worn. Ties keep the worn
    // item, so an idle day doesn't shuffle four identical rings between slots.
    const pool = keys.filter(k => state.equipment[k]).map(k => ({ it: state.equipment[k], worn: true }))
      .concat(bag);
    pool.sort((a, b) => (itemValue(b.it) - itemValue(a.it)) || ((b.worn ? 1 : 0) - (a.worn ? 1 : 0)));
    const wear = pool.slice(0, keys.length);

    // Survivors keep the slot they already occupy; newcomers take what's left.
    // Assigning `wear` to `keys` in rank order instead looks equivalent and
    // isn't: promoting one ring into a full set of four pushes the other three
    // down a slot each and reports four changes for one real swap. Nothing is
    // lost either way — the same items end up worn — but the count is what the
    // `equip best` report prints and what the status nudge is derived from, so
    // it has to mean "slots that actually got better".
    const held = new Map();
    for (const w of wear) {
      if (!w.worn) continue;
      const at = keys.find(k => state.equipment[k] === w.it && !held.has(k));
      if (at) held.set(at, w);
    }
    const newcomers = wear.filter(w => !w.worn);

    keys.forEach((key) => {
      const won = held.get(key) || newcomers.shift();
      const before = state.equipment[key];
      state.equipment[key] = won ? won.it : null;
      if (won && won.i != null) consumed.add(won.i);
      if (won && before !== won.it) changes.push({ key, item: won.it, replaced: before || null });
    });
    for (const left of pool.slice(keys.length)) if (left.worn) benched.push(left.it);
  }

  if (changes.length || benched.length) {
    state.inventory = state.inventory.filter((_, i) => !consumed.has(i)).concat(benched);
    refreshMaxHp(state);
  }
  return changes;
}

// What `autoEquip` *would* change, without changing it. Runs the real function
// against a throwaway facade rather than reimplementing the ranking: a
// second copy of the "best keys.length of (worn ∪ bag), ties keep the worn item"
// rule would drift from this one, and a nudge that disagrees with the command it
// recommends is worse than no nudge. The facade needs exactly the three fields
// autoEquip touches — it reads and writes equipment/inventory and calls
// refreshMaxHp, which only sets hero.maxHp/hp. Items are shared by reference and
// never mutated.
function previewAutoEquip(state, opts) {
  return autoEquip({
    hero: { ...state.hero },
    equipment: { ...state.equipment },
    inventory: state.inventory.slice(),
  }, opts);
}

// How far worn gear has fallen behind the zone. Empty slots count as the zero
// gear they are — twelve slots is the denominator, not "slots you happened to
// fill" — because four bare slots is exactly the rot this measures. `target` is
// the zone's top trash level (`max` is the boss; see balance.monsterLevel), and
// drop ilvl tracks monster level, so a hero keeping up sits near ratio 1.
function gearLag(state) {
  const zone = C.zoneById(state.hero.zone);
  const target = Math.max(1, zone.max - 1);
  const total = C.EQUIP_KEYS.reduce((s, k) => s + (state.equipment[k] ? state.equipment[k].ilvl : 0), 0);
  const mean = total / C.EQUIP_KEYS.length;
  return { mean, target, ratio: mean / target };
}
const GEAR_LAG_NUDGE = 0.6;

// Would wearing this change anything? True if it fits a slot standing empty, or
// beats the *weakest* item currently worn in its slot — weakest, not best,
// because a ring only has to out-rank the worst of three to be worth carrying.
//
// Worn gear is static in this game: nothing about levelling makes a bagged item
// catch up to one it already loses to. So a "no" here is permanent, not "not
// yet", which is what makes vendoring on the spot safe rather than hasty.
function worthKeeping(state, item) {
  const keys = C.slotKeys(item.slot);
  if (!keys.length) return true;                     // unknown slot: never eat it
  let weakest = Infinity;
  for (const key of keys) {
    const worn = state.equipment[key];
    if (!worn) return true;                          // an empty slot takes anything
    weakest = Math.min(weakest, itemValue(worn));
  }
  return itemValue(item) > weakest;
}

function addToInventory(state, item) {
  if (state.inventory.length >= B.INVENTORY_CAP) {
    // Backstop only — the drop filter means a full bag is now a rarity, and
    // shop buys are the realistic way to reach one. Evict on `itemValue`, the
    // same ranking `equip best` uses: rarity alone would protect a legendary i1
    // trinket and eat the common i13 weapon you were about to put on.
    let idx = 0;
    for (let i = 1; i < state.inventory.length; i++) {
      if (itemValue(state.inventory[i]) < itemValue(state.inventory[idx])) idx = i;
    }
    const sold = state.inventory.splice(idx, 1)[0];
    const gold = sellPrice(sold);
    state.hero.gold += gold;
    state.counters.goldEarned += gold;
    tick(state, `bag full — sold ${sold.name} +${gold}g`);
  }
  state.inventory.push(item);
}

function rollLoot(state, mLvl, opts, rand, now) {
  const c = classDef(state);
  const chance = Math.min(1, B.DROP_CHANCE * (c.dropMult || 1) * insightMult(state, 'drop'));
  if (!opts.guaranteed && rand() > chance) return null;
  let rarity = weightedPick(B.RARITIES, rand);
  // Ordered strongest floor first, so a caller that sets more than one gets the
  // one it most meant — the final boss passes `floorLegendary` on the first kill
  // and `floorRare` on the rest, and reads naturally either way round.
  const floor = opts.floorLegendary ? B.RARITIES.length - 1
    : opts.floorEpic ? B.GOBLIN_RARITY_FLOOR
      : (opts.floorRare ? B.BOSS_RARITY_FLOOR : -1);
  if (floor >= 0) {
    const idx = B.RARITIES.findIndex(r => r.id === rarity.id);
    if (idx < floor) rarity = B.rarityByIndex(floor);
  }
  const item = makeItem(state, rarity, mLvl, opts.from, rand);

  // A cap can only make the player choose if the player is there, and in an idle
  // game they aren't — so the bag used to fill with junk and then quietly eat
  // something on overflow. Decide at the door instead: anything that can't beat
  // what's already worn goes straight to the merchant, and the bag holds nothing
  // but real candidate upgrades. No loot flourish for a vendored drop — the
  // animation says "go look at your bag", and there'd be nothing there.
  // `keep` is the one exemption from the drop filter, and it exists for trophies
  // rather than for convenience: an item you are given for finishing something
  // is not a candidate upgrade to be judged on stats, so it is not judged.
  if (!opts.keep && !worthKeeping(state, item)) {
    const gold = sellPrice(item);
    state.hero.gold += gold;
    state.counters.goldEarned += gold;
    state.counters.vendored = (state.counters.vendored || 0) + 1;
    tick(state, `[${item.rarity}] ${item.name} → vendored +${gold}g`);
    // A *copy* carries the outcome back to the caller — the goblin needs to know
    // whether to announce a prize or a sale, and its banner must not promise an
    // epic that has already been sold. The flag rides on the copy rather than the
    // item because a kept item is the one that goes into the save, and a
    // transient `vendored: false` has no business being persisted there.
    return Object.assign({}, item, { vendored: true, gold });
  }

  state.counters.drops = (state.counters.drops || 0) + 1;
  addToInventory(state, item);
  enqueue(state, 'loot', 2500, { name: item.name, rarity: item.rarity }, now);
  tick(state, `[${item.rarity}] ${item.name} dropped`);
  return item;
}

// ---------- xp / levels ----------

// Insight points bought on a track, defaulting for every save written before
// paragon existed. Same call as `plus` on items: no migration, the read paths
// default, which is strictly safer than rewriting saves to add a zero.
function paragonPoints(state, id) {
  return Number(state.hero.paragon && state.hero.paragon[id]) || 0;
}
function insightMult(state, id) { return B.insightMult(id, paragonPoints(state, id)); }

// XP earned at the cap banks toward the next Insight instead of evaporating.
function addInsightXp(state, xp) {
  if (!(xp > 0)) return 0;
  const h = state.hero;
  h.capXp = (h.capXp || 0) + xp;
  const gained = Math.floor(h.capXp / B.INSIGHT_XP);
  if (!gained) return 0;
  h.capXp -= gained * B.INSIGHT_XP;
  h.insight = (h.insight || 0) + gained;
  state.counters.insightEarned = (state.counters.insightEarned || 0) + gained;
  tick(state, `INSIGHT +${gained} — /hero insight`);
  return gained;
}

// Buy one point on a track. Mirrors upgradeItem: the caller does the messaging,
// this only says what happened.
function spendInsight(state, id) {
  const t = B.insightTrack(id);
  if (!t) return { ok: false, why: 'track' };
  const points = paragonPoints(state, id);
  if (points >= B.INSIGHT_TRACK_MAX) return { ok: false, why: 'maxed', points };
  const cost = B.insightCost(points);
  const have = state.hero.insight || 0;
  if (have < cost) return { ok: false, why: 'insight', cost, points, have };
  state.hero.paragon = state.hero.paragon || {};
  state.hero.paragon[id] = points + 1;
  state.hero.insight = have - cost;
  refreshMaxHp(state);
  return { ok: true, cost, points: points + 1 };
}

function addXp(state, xp, now) {
  const c = classDef(state);
  xp = Math.round(xp * (c.xpMult || 1));
  // Counted after the class multiplier and before the cap branch, so it is what
  // the hero was actually awarded however that lands — levels below the cap,
  // banked Insight at it. `hero.xp` cannot stand in for this: it resets on every
  // level and zeroes at the cap, so it measures progress, never earnings.
  state.counters.xpEarned = (state.counters.xpEarned || 0) + xp;
  if (state.hero.level >= B.LEVEL_CAP) { addInsightXp(state, xp); return; }
  state.hero.xp += xp;
  while (state.hero.level < B.LEVEL_CAP && state.hero.xp >= B.xpToNext(state.hero.level)) {
    state.hero.xp -= B.xpToNext(state.hero.level);
    state.hero.level += 1;
    refreshMaxHp(state);
    state.hero.hp = state.hero.maxHp; // level-up full heal
    enqueue(state, 'levelup', 5000, { level: state.hero.level }, now);
    tick(state, `LEVEL UP — ${state.hero.level}`);
  }
  // Overflow on the level that *reaches* the cap banks too, rather than being
  // rounded off the end of the run.
  if (state.hero.level >= B.LEVEL_CAP && state.hero.xp > 0) {
    addInsightXp(state, state.hero.xp);
    state.hero.xp = 0;
  }
}

// ---------- combat ----------

function resolveKill(state, opts, rand, now) {
  const m = state.monster;
  const c = classDef(state);
  const xp = B.killXp(m.level, m.isBoss) * (m.isGoblin ? B.GOBLIN_XP_MULT : 1);
  let gold = B.killGold(m.level, m.isBoss, rand()) * (c.goldMult || 1) * insightMult(state, 'gold');
  if (opts.viaPush) gold *= 1.5;
  gold = Math.round(gold);
  state.hero.gold += gold;
  state.counters.goldEarned += gold;
  state.counters.kills += 1;

  const zoneId = state.hero.zone;
  state.counters.zoneKills[zoneId] = (state.counters.zoneKills[zoneId] || 0) + 1;

  // `spawnMonster` below replaces `state.monster` on the spot — the next attack
  // has to have something to land on — but the animations still queued are about
  // the monster that just died, and they play *after* that swap. So they carry
  // their own copy of the corpse and the HUD renders that in preference to
  // `state.monster`. Without it the scene ran in the wrong order: the killing
  // blow landed on the newly spawned monster, then a death played for a monster
  // that was no longer on screen, then the new one came back.
  const corpse = { id: m.id, name: m.name, sprite: m.sprite, level: m.level, isBoss: !!m.isBoss, isGoblin: !!m.isGoblin, hp: 0, maxHp: m.maxHp };
  // The blow that killed it is the anim `dealDamage` just queued (or coalesced
  // into) — unless the queue was full, in which case there is nothing to tag.
  const blow = state.anim[state.anim.length - 1];
  if (blow && blow.type === 'hit') blow.data.mon = corpse;

  enqueue(state, 'kill', 2500, { name: m.name, xp, gold, sprite: m.sprite, mon: corpse }, now);
  tick(state, `${m.name} slain +${xp}xp +${gold}g`);

  if (m.isBoss) {
    state.counters.bossKills += 1;
    state.counters.killsSinceBoss = 0;
    const nz = C.nextZone(zoneId);

    // The last boss in the last zone. Until this branch existed, beating the
    // game drew the *same banner as the fifth time you killed Rootfang* — `nz`
    // came back null, the unlock line was skipped, and the generic `bossdown`
    // played. Two months of work ended in a frame indistinguishable from an
    // ordinary Tuesday, which is the one moment in this game that had to land
    // and was the only one nobody had written.
    if (!nz) {
      finalBossDown(state, m, corpse, rand, now);
    } else {
      rollLoot(state, m.level, { guaranteed: true, floorRare: true, from: 'boss:' + m.id }, rand, now);
      if (!state.hero.unlockedZones.includes(nz.id)) {
        state.hero.unlockedZones.push(nz.id);
        enqueue(state, 'bossdown', 6000, { name: m.name, unlocked: nz.name, mon: corpse }, now);
        tick(state, `${m.name} defeated — ${nz.name} unlocked`);
      } else {
        enqueue(state, 'bossdown', 6000, { name: m.name, mon: corpse }, now);
      }
    }
  } else if (m.isGoblin) {
    // Boss progress is credited for the *time* the goblin took, not the one
    // spawn it occupied — which is the difference between neutral and a tax,
    // and it is measured rather than guessed. Crediting 1 looks fair and isn't:
    // a controlled sim (same rand() stream, GOBLIN_CHANCE 0 vs 0.05) put boss
    // kills over 90 days at 65 without goblins and 56 with, a 14% cut, because
    // a ×3-HP monster eats three trash mobs' worth of the clock and settles one
    // mob's debt. Bosses are the gear engine, so that shortfall showed up as a
    // 36% smaller upgrade sink. Crediting GOBLIN_HP_MULT makes the exchange
    // even: you spend three mobs of time and you are three mobs closer.
    state.counters.killsSinceBoss += B.GOBLIN_HP_MULT;
    state.counters.goblinKills = (state.counters.goblinKills || 0) + 1;

    // One payout, one of two ways. The gold arm is a multiple of this monster's
    // own kill gold and the epic arm rolls at this monster's own level, so both
    // are windfalls scaled to where you actually are — the Grove pays Grove
    // rates. Never both: two prizes makes the second one the expected outcome
    // and the goblin stops being a coin-flip you look forward to.
    if (rand() < B.GOBLIN_EPIC_CHANCE) {
      const item = rollLoot(state, m.level, {
        guaranteed: true, floorEpic: true, from: 'goblin:' + m.id,
      }, rand, now);
      // The prize can land on a hero already wearing better, in which case the
      // drop filter sells it on the spot — so the banner reports the sale rather
      // than an item the player will go looking for and not find.
      enqueue(state, 'goblinloot', 5000, {
        name: m.name, item: item.name, rarity: item.rarity,
        vendored: !!item.vendored, gold: item.gold,
      }, now);
    } else {
      const slug = Math.round(B.killGold(m.level, false, rand())
        * B.GOBLIN_GOLD_MULT * (c.goldMult || 1) * insightMult(state, 'gold'));
      state.hero.gold += slug;
      state.counters.goldEarned += slug;
      enqueue(state, 'goblinloot', 5000, { name: m.name, gold: slug }, now);
      tick(state, `the goblin drops its sack +${slug}g`);
    }
  } else {
    state.counters.killsSinceBoss += 1;
    rollLoot(state, m.level, {
      guaranteed: !!opts.viaPush, from: (opts.viaPush ? 'push:' : 'kill:') + m.id,
    }, rand, now);
  }

  addXp(state, xp, now);
  spawnMonster(state, rand);
}

// The end of the game, and the victory laps after it.
//
// The first kill is the only one that is an ending, so it is the only one that
// gets the banner and the trophy; every one after it is a boss you can now farm,
// and says so with a count. `clearedAt` is what makes that distinction survive a
// restart — the counter alone can't, since a save that reaches 4 has no record
// of when 1 happened.
function finalBossDown(state, m, corpse, rand, now) {
  const clears = (state.counters.finalBossKills || 0) + 1;
  state.counters.finalBossKills = clears;
  const first = clears === 1;
  if (first) state.hero.clearedAt = now;

  // Deliberately the reverse of the ordinary boss order, where the loot flourish
  // plays and the DEFEATED banner follows it. Here the banner is the climax and
  // the Postmortem is the closing beat, so it is queued first and the drop lands
  // under it.
  enqueue(state, first ? 'cleared' : 'bossdown', first ? 9000 : 6000,
    { name: m.name, mon: corpse, clears }, now);

  // `floorLegendary` on the first kill, so the thing you are handed for finishing
  // the game is the zone's named legendary rather than whatever the table rolled
  // — `makeItem` names any legendary after the zone it dropped in, and Production's
  // is The Postmortem. You found the root cause; you get to write it up.
  //
  // `keep` because the drop filter would otherwise vendor it at the door for a
  // hero already wearing something better in that slot, which is a real outcome
  // at level 60 with a +10 set on. Selling someone their own trophy, thirty
  // seconds after the credits, is the single worst frame this game could draw.
  rollLoot(state, m.level, {
    guaranteed: true,
    floorLegendary: first, floorRare: !first,
    keep: first,
    from: 'boss:' + m.id,
  }, rand, now);

  tick(state, first
    ? `${m.name} FOUND — the Postmortem is yours`
    : `${m.name} defeated ×${clears}`);
}

function dealDamage(state, mult, opts, rand, now) {
  const c = classDef(state);
  let dmg = heroAtk(state) * mult;
  let crit = false;
  if (c.critChance && rand() < c.critChance) { dmg *= c.critMult; crit = true; }
  dmg = Math.max(1, Math.round(dmg));
  state.monster.hp -= dmg;
  // `big` rides alongside `crit` rather than inside it. They already differed in
  // meaning — a crit is a roll, a commit is a kind of blow — and folding one into
  // the other was harmless only while the sole consequence was the colour of the
  // number. The volley reads off `big`, so it needs the distinction back.
  enqueue(state, 'hit', 1500, { dmg, crit: crit || !!opts.big, big: !!opts.big }, now);
  if (crit) tick(state, `+${dmg} crit!`);
  if (state.monster.hp <= 0) { resolveKill(state, opts, rand, now); return; }
  retaliate(state, rand, now);
}

// The monster hits back. Folded into the hero's own hit anim rather than queued
// as a separate frame: a burst of 50 attacks would otherwise saturate the anim
// queue with counters and push real events past ANIM_MAX_AHEAD_MS.
function retaliate(state, rand, now) {
  const m = state.monster;
  if (!m || m.hp <= 0) return;
  const chance = m.isBoss ? B.RETALIATE_CHANCE_BOSS
    : m.isGoblin ? B.GOBLIN_RETALIATE_CHANCE : B.RETALIATE_CHANCE;
  // One roll, read three ways. Under the threshold the monster connects; in the
  // band just above it, it swung and missed and the HUD gets to say so; above
  // that it never swung. Only the first branch touches HP, so the whole dodge
  // tell is a narration of a roll the game was already making.
  const roll = rand();
  if (roll >= chance) {
    if (roll < chance + B.NEAR_MISS_BAND) markDodge(state);
    return;
  }
  const mult = m.isBoss ? B.RETALIATE_MULT_BOSS
    : m.isGoblin ? B.GOBLIN_RETALIATE_MULT : B.RETALIATE_MULT;
  const before = state.hero.hp;
  hurtHero(state, B.monsterHitDamage(m.level, heroDef(state), false) * mult, now);
  const dealt = before - state.hero.hp;   // ≤0 if that blow killed and respawned
  const last = state.anim[state.anim.length - 1];
  if (dealt > 0 && last && last.type === 'hit') {
    last.data.counter = (last.data.counter || 0) + dealt;
    // A burst of attacks coalesces into one hit anim, so a dodge and a landed
    // counter can end up on the same record. Blood wins: the frame that shows
    // you shrugging off a swing you actually took is a lie, and `↩-N` is the
    // half of the exchange that matters.
    last.data.dodged = false;
  }
}

// Tag the hit anim the near miss belongs to, if it is still the one on the end
// of the queue. Deliberately silent when a counter has already landed on that
// record — see the note above.
function markDodge(state) {
  const last = state.anim[state.anim.length - 1];
  if (last && last.type === 'hit' && !last.data.counter) last.data.dodged = true;
}

// A blow the hero did not provoke: a failing test, a command that came back
// non-zero. These used to call `hurtHero` and nothing else, so HP came off the
// bar with no frame on screen anywhere — the counter is the only monster blow
// the scene has ever drawn, and that one borrows the hero's animation. This
// gives them one of their own (`sprites.monsterAttack`).
//
// The damage is read back off the hero rather than passed through, for the same
// two reasons `retaliate` reads it back: `hurtHero` applies the class's
// damage-taken multiplier, and a blow that kills respawns the hero at full HP —
// which makes `dealt` zero or negative, and leaves the death banner as the only
// frame worth drawing.
function monsterStrikes(state, amount, now) {
  const m = state.monster;                          // hurtHero can respawn past it
  const before = state.hero.hp;
  hurtHero(state, amount, now);
  const dealt = before - state.hero.hp;
  if (dealt > 0) enqueue(state, 'mhit', 1500, { dmg: dealt, name: m && m.name }, now);
}

function hurtHero(state, amount, now) {
  const c = classDef(state);
  const dmg = Math.max(1, Math.round(amount * (c.damageTakenMult || 1)));
  state.hero.hp -= dmg;
  if (state.hero.hp > 0) return;

  const lost = Math.round(state.hero.gold * B.DEATH_GOLD_LOSS);
  state.hero.gold -= lost;
  state.counters.deaths += 1;
  state.hero.hp = state.hero.maxHp;

  // Losing to a boss drives it off instead of restarting the fight. A boss used
  // to reset to full HP alongside you, so a hero who couldn't win one could
  // never do anything else either: the zone became a wall with no way around it
  // and the run simply stopped (the balance sim's `fill` player died ~2000 times
  // and never reached the cap). Forfeiting the approach costs the 15 kills that
  // earned the attempt — a setback you can work off — and the grind back is
  // exactly where the levels and loot that win the rematch come from.
  if (state.monster && state.monster.isBoss) {
    const name = state.monster.name;
    state.counters.killsSinceBoss = 0;
    enqueue(state, 'death', 5000, { lost, drovenOffBy: name }, now);
    tick(state, `${name} drove you off… -${lost}g`);
    spawnMonster(state, mulberry32((now ^ state.counters.deaths) >>> 0));
    return;
  }

  state.monster.hp = state.monster.maxHp;
  enqueue(state, 'death', 5000, { lost }, now);
  tick(state, `you died… -${lost}g`);
}

// ---------- the sitting ----------

// A "sitting" is one stretch at the keyboard, and its totals are a delta against
// a snapshot of the lifetime counters rather than a second set of counters
// incremented alongside them. Every reward path already writes to `counters`;
// a parallel set of increments is precisely the thing that drifts the first time
// someone adds a gold source and updates only one of the two. This way the two
// views cannot disagree, because there is only one number.
//
// The boundary is the away gap, not Claude Code's session id — even though the
// hook already carries one. The save is global: one hero is shared by every repo
// and every open window, so two concurrent sessions keyed by id would reset each
// other's totals all day and the view would measure nothing but which window
// folded last. `OFFLINE_MIN_GAP_MS` is the game's existing answer to "you left",
// and reusing it means the sitting ends exactly when the away window starts.
const SESSION_KEYS = [
  'kills', 'bossKills', 'goblinKills', 'goblinFled', 'deaths',
  'commits', 'pushes', 'testsPassed', 'testsFailed', 'linesWritten',
  'goldEarned', 'xpEarned', 'insightEarned', 'drops', 'vendored',
];

function openSession(state, now) {
  const at = {};
  for (const k of SESSION_KEYS) at[k] = Number(state.counters[k]) || 0;
  state.session = { startedAt: now, level: state.hero.level, at };
}

// The sitting so far. `null` for a save written before sittings existed and not
// yet folded — the view says so rather than reporting a fabricated zero.
//
// Every delta is floored at zero. A counter cannot run backwards on its own, but
// a hand-edited save can make it look like it did, and a negative kill count is a
// worse answer than a wrong one.
function sessionStats(state, now) {
  const s = state.session;
  if (!s || !s.at) return null;
  const end = now == null ? state.updatedAt || s.startedAt : now;
  const out = {
    startedAt: s.startedAt,
    ms: Math.max(0, end - s.startedAt),
    fromLevel: s.level || state.hero.level,
    levels: Math.max(0, state.hero.level - (s.level || state.hero.level)),
  };
  for (const k of SESSION_KEYS) {
    out[k] = Math.max(0, (Number(state.counters[k]) || 0) - (Number(s.at[k]) || 0));
  }
  return out;
}

// Did anything at all happen? A sitting you opened and walked away from should
// say so in one line instead of printing eight rows of zeroes.
function sessionIsQuiet(s) {
  return !s || (!SESSION_KEYS.some(k => s[k] > 0) && !s.levels);
}

// Freeze the sitting and keep it as `lastSession`, so opening a fresh window
// still has something to show before the first monster dies.
//
// It ends at the last fold, not at `now`: `now` is when you came back, and
// counting the absence as part of the sitting would report an eight-hour session
// for twenty minutes of work.
function closeSession(state, endedAt) {
  const totals = sessionStats(state, endedAt);
  if (totals) {
    totals.endedAt = endedAt;
    state.lastSession = totals;
  }
  state.session = null;
}

// ---------- time effects (regen, offline) ----------

function applyTime(state, now, rand) {
  let dirty = false;
  const gap = now - (state.lastTickAt || now);
  if (gap <= 0) return pruneAnims(state, now);

  // The sitting is bounded by the same gap the away window is, but not by the
  // same condition: the away rewards need a monster to scale off, and an absence
  // with no monster standing is still an absence. So this is rolled on the gap
  // alone, either side of the block below — closed before the away rewards land
  // and reopened after, which leaves the absence's take in neither sitting. It
  // belongs to neither: the away summary already reports it, and folding it into
  // keyboard hours would overstate whichever one it was charged to.
  const away = gap >= B.OFFLINE_MIN_GAP_MS;
  if (away) closeSession(state, state.lastTickAt || now);

  // away progress: no folds for a while = Claude Code was closed / machine asleep
  if (gap >= B.OFFLINE_MIN_GAP_MS && state.monster) {
    const hours = Math.min(gap / 3600000, B.OFFLINE_MAX_HOURS);
    const kills = Math.floor(hours * B.OFFLINE_KILLS_PER_HOUR);
    if (kills > 0) {
      const mLvl = state.monster.level;
      const xp = Math.round(B.killXp(mLvl, false) * B.OFFLINE_REWARD_FRAC * kills);
      const gold = Math.round(B.killGold(mLvl, false, 0.5) * B.OFFLINE_REWARD_FRAC * kills);

      // A goblin does not get to wait behind a closed laptop. Away kills are the
      // away window's unit of work, so they spend its patience the way folded
      // events do — otherwise closing the lid mid-goblin froze it in place with
      // the deadline suspended, and "get it before it runs" stopped being true
      // the moment you stopped looking.
      const m = state.monster;
      let goblinFled = 0;
      if (m.isGoblin) {
        const patience = m.patience == null ? B.GOBLIN_FLEE_EVENTS : m.patience;
        if (kills >= patience) goblinFled = 1;
        else m.patience = patience - kills;
      }

      state.counters.kills += kills;
      state.hero.gold += gold;
      state.counters.goldEarned += gold;
      addXp(state, xp, now);
      // Reported in the summary rather than only in a banner nobody was here to
      // see: an escape is the one outcome in this game the player can lose
      // without ever being told it happened.
      enqueue(state, 'idle', 5000, { kills, xp, gold, goblinFled }, now);
      tick(state, `while away: ${kills} kills +${xp}xp +${gold}g`
        + (goblinFled ? ' · a goblin got away' : ''));
      if (goblinFled) {
        goblinFlees(state, rand || mulberry32(((state.counters.kills + 1) * 2654435761) ^ (now & 0xffffffff)),
          now, { creditBoss: false, announce: false });
      }
      dirty = true;
    }
  }

  // Opened here rather than only on `away` so a save from before sittings existed
  // starts counting on its next fold instead of needing a migration for a field
  // that is pure derived bookkeeping.
  if (away || !state.session) { openSession(state, now); dirty = true; }

  // passive regen: 1% max HP per minute
  if (state.hero.hp < state.hero.maxHp) {
    const heal = Math.floor((gap / 60000) * B.REGEN_FRAC_PER_MIN * state.hero.maxHp);
    if (heal > 0) {
      state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + heal);
      dirty = true;
    }
  }

  if (pruneAnims(state, now)) dirty = true;
  state.lastTickAt = now;
  // Persist quiet ticks at most ~once a minute so the 1s statusline poll
  // doesn't rewrite state.json continuously, but lastTickAt never lags far
  // enough for idle-with-app-open to look like "away".
  return dirty || gap > 60000;
}

// ---------- the fold reducer ----------

function applyEvent(state, ev, rand, now) {
  const cnt = state.counters;
  switch (ev.e) {
    case 'attack_jab': dealDamage(state, B.DMG.jab, {}, rand, now); break;
    case 'attack_build': dealDamage(state, B.DMG.build, {}, rand, now); break;
    case 'attack_lines': {
      const lines = Math.max(1, (ev.m && ev.m.lines) || 1);
      cnt.linesWritten += lines;
      const c = classDef(state);
      dealDamage(state, B.lineDamageMult(lines) * (c.editMult || 1), {}, rand, now);
      break;
    }
    case 'commit': {
      cnt.commits += 1;
      const c = classDef(state);
      dealDamage(state, B.DMG.commit * (c.commitMult || 1), { big: true }, rand, now);
      break;
    }
    case 'push': {
      cnt.pushes += 1;
      if (state.monster.isBoss) {
        dealDamage(state, B.DMG.pushVsBoss, { big: true, viaPush: true }, rand, now);
      } else {
        tick(state, 'WAR HORN! git push');
        state.monster.hp = 0;
        resolveKill(state, { viaPush: true }, rand, now);
      }
      break;
    }
    case 'test_pass': {
      cnt.testsPassed += 1;
      if (ev.t - cnt.lastTestXpAt >= B.TEST_XP_COOLDOWN_MS) {
        cnt.lastTestXpAt = ev.t;
        addXp(state, B.testXp(state.hero.level), now);
      }
      dealDamage(state, B.DMG.test, {}, rand, now);
      break;
    }
    case 'test_fail':
      cnt.testsFailed += 1;
      monsterStrikes(state, B.monsterHitDamage(state.monster.level, heroDef(state), true), now);
      break;
    case 'bash_fail':
      monsterStrikes(state, B.monsterHitDamage(state.monster.level, heroDef(state), false), now);
      break;
    case 'rest': {
      const missing = state.hero.maxHp - state.hero.hp;
      if (missing > 0) state.hero.hp += Math.round(missing * B.STOP_REGEN_FRAC);
      break;
    }
    default: break;
  }
}

// The goblin gives up on you and leaves with the sack.
//
// It still credits the boss cycle exactly as a kill would. It stood in the
// vanguard's place and ate the same stretch of clock, so charging the boss
// cycle for it as well would make a fled goblin worse than the trash mob it
// displaced — the tax this feature was explicitly built not to be. Losing the
// prize is the whole penalty, and it is enough of one.
function goblinFlees(state, rand, now, opts) {
  const m = state.monster;
  const o = opts || {};
  state.counters.goblinFled = (state.counters.goblinFled || 0) + 1;
  // An away window grants no boss progress at all (`OFFLINE_REWARD_FRAC`), so a
  // goblin that gives up during one has nothing to pay back — crediting it here
  // would hand out progress the away window is defined not to give.
  if (o.creditBoss !== false) state.counters.killsSinceBoss += B.GOBLIN_HP_MULT;
  // The away summary says it in one line already; a second banner behind it
  // would report the same loss twice to someone who saw neither happen.
  if (o.announce !== false) {
    enqueue(state, 'goblinflee', 4000, { name: m.name }, now);
    tick(state, `${m.name} slipped away with the sack`);
  }
  spawnMonster(state, rand);
}

// events: [{t, e, m}] (sorted by caller or here). Returns true if state changed.
function fold(state, events, now) {
  const rand = mulberry32(((state.eventsFolded + 1) * 2654435761) ^ (now & 0xffffffff));
  let dirty = applyTime(state, now, rand);
  events = (events || [])
    .filter(ev => ev && typeof ev.e === 'string')
    .sort((a, b) => (a.t || 0) - (b.t || 0));
  for (const ev of events) {
    // Held across the event because `dealDamage` can kill and immediately
    // respawn, swapping `state.monster` underneath us. Charging patience
    // without this identity check would bill a freshly spawned goblin for the
    // event that killed the monster before it.
    const facing = state.monster;
    try { applyEvent(state, ev, rand, now); dirty = true; } catch (_) { /* one bad event ≠ lost fold */ }
    if (state.monster === facing && facing && facing.isGoblin && facing.hp > 0) {
      facing.patience = (facing.patience == null ? B.GOBLIN_FLEE_EVENTS : facing.patience) - 1;
      if (facing.patience <= 0) {
        try { goblinFlees(state, rand, now); } catch (_) { /* never block a fold */ }
      }
    }
    state.eventsFolded += 1;
    if (ev.t) state.lastEventAt = ev.t;
  }
  // Once per batch rather than per event: travel turns on level and unlocks,
  // neither of which can change twice within one fold in a way the last check
  // would miss, and a batch is usually a single event anyway.
  try { if (maybeTravel(state, rand, now)) dirty = true; } catch (_) { /* never block a fold */ }
  state.updatedAt = now;
  return dirty;
}

module.exports = {
  newState, sanitizeName, NAME_MAX,
  fold, applyTime, spawnMonster, bossGate, bossGateText, travelTo, maybeTravel,
  heroAtk, heroDef, heroMaxHp, refreshMaxHp,
  addXp, dealDamage, resolveKill, hurtHero, monsterStrikes, retaliate, rollLoot, addToInventory, worthKeeping, enqueue, tick,
  itemValue, sellPrice, itemStat, itemStatRaw, upgradeItem, autoEquip, previewAutoEquip,
  gearLag, GEAR_LAG_NUDGE,
  openSession, closeSession, sessionStats, sessionIsQuiet, SESSION_KEYS,
  paragonPoints, insightMult, addInsightXp, spendInsight,
};
