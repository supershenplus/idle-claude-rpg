'use strict';

// Every tunable constant and formula in the game. Tune here, nowhere else.

const LEVEL_CAP = 60;

// XP curve: total to cap ≈ 1.07M. Knobs: coefficient (100) and exponent (1.5).
function xpToNext(level) { return Math.floor(100 * Math.pow(level, 1.5)); }

// Monsters: ~4.2 events per kill at every level (HP scales with effective ATK).
function monsterMaxHp(mLvl, roll, isBoss) {
  const hp = Math.round((25 + 10 * mLvl) * (0.85 + 0.3 * roll));
  return isBoss ? hp * 10 : hp;
}
function killXp(mLvl, isBoss) { return (10 + 5 * mLvl) * (isBoss ? 8 : 1); }
function killGold(mLvl, isBoss, roll) {
  return Math.round((5 + 2 * mLvl) * (0.7 + 0.6 * roll) * (isBoss ? 10 : 1));
}
// Armour is a *ratio*, not a subtraction. `mLvl − def` was a cliff: a full set
// rolls def ≈ 1.0–1.2× ilvl and ilvl tracks monster level, so def crossed mLvl
// and every blow clamped to the floor of 1. A kitted hero was literally immune
// (1 death across a 90-day sim) while a naked one ate the whole curve (198), and
// there was no stable ground between them to tune on.
//
// Here def equal to the monster's level halves the blow, twice its level cuts it
// to a third, and nothing ever reduces it to nothing. Because a full set's def
// tracks monster level, mitigation sits near 50% for a geared hero at *every*
// level — the difficulty curve is flat by construction rather than by luck, and
// gear stays worth wearing without ending the game.
function monsterHitDamage(mLvl, def, heavy) {
  const raw = (heavy ? 2 : 1) * mLvl;
  return Math.max(1, Math.round(raw * mLvl / (mLvl + Math.max(0, def))));
}

// Retaliation: the monster swings back when the hero attacks, so damage no
// longer depends solely on you fumbling a command.
//
// Trash is attrition the game expects you to shrug off: ~0.7% of max HP per kill
// for a geared hero against passive regen of 1%/min, so the HP bar stays full
// while you grind and only an under-geared hero feels it — which is the signal
// that you should go equip something.
//
// **Bosses are where death lives.** A boss now counters *more* often than trash,
// inverting the original rule. That rule existed because a boss fight runs ~25
// attacks instead of ~4, so per-attack parity meant far more total damage — and
// since dying used to restore the boss to full HP, "hard" silently meant
// "impossible" and the zone became a wall. Death drives the boss off now
// (see engine.hurtHero), so a lost fight is a setback with a way back rather
// than a dead end, and a boss is finally free to be genuinely dangerous.
//
// Tuned against test/sim.js across all three equip profiles: an attentive player
// expects to lose roughly one boss fight in four or five — often enough that the
// HP bar means something, rare enough that losing one is an event.
const RETALIATE_CHANCE = 0.30;
const RETALIATE_CHANCE_BOSS = 0.45;
const RETALIATE_MULT = 0.45;
const RETALIATE_MULT_BOSS = 1.6;

// Damage multipliers per event type (× hero ATK)
const DMG = {
  jab: 0.4,
  build: 1.5,
  commit: 3.0,
  pushVsBoss: 5.0,
  test: 1.0,
};
// Edit/Write: diminishing returns, 0.76× at 1 line → caps at 1.25× (lines capped upstream at 300)
const LINE_CAP = 300;
function lineDamageMult(lines) {
  const l = Math.min(lines, LINE_CAP);
  return 0.75 + 0.5 * (1 - Math.exp(-l / 60));
}

// Test XP grant (the "training" reward) + anti-loop cooldown
function testXp(level) { return 5 + 3 * level; }
const TEST_XP_COOLDOWN_MS = 60 * 1000;

// Bosses
const BOSS_KILLS_REQUIRED = 15;   // zone kills since last boss before the boss spawns
const BOSS_RARITY_FLOOR = 2;      // index into RARITIES: bosses drop rare or better

// Trash level rises across the zone's band as the boss cycle fills, so a zone
// escalates toward its boss instead of spawning bottom-tier monsters forever.
// The old rule was `min + rand()*4` clamped to `max`, which made `zone.max` dead
// data: the Grove advertised 1-9 and never spawned anything above 4, then asked
// you to fight a level 9 boss. The vanguard now tops out one step below the boss
// (`zone.max` *is* the boss's level — asserted in engine.test), so the boss is a
// step up rather than a cliff.
//
// Progress is measured in kills rather than hero level on purpose: a hero held
// back by the boss's level gate keeps meeting tougher trash, which pays more XP,
// which clears the gate. The stall is self-correcting instead of a flat grind.
function monsterLevel(zone, killsSinceBoss, roll) {
  const top = zone.max - 1;
  const progress = Math.min(1, Math.max(0, killsSinceBoss) / BOSS_KILLS_REQUIRED);
  const tier = zone.min + Math.round((top - zone.min) * progress);
  const jittered = tier - Math.floor(roll * 3);   // 0-2 below the tier, for variety
  return Math.max(zone.min, Math.min(top, jittered));
}

// Loot
const DROP_CHANCE = 0.18;
const RARITIES = [
  { id: 'common',    w: 60, mult: 1.0 },
  { id: 'uncommon',  w: 25, mult: 1.4 },
  { id: 'rare',      w: 10, mult: 2.0 },
  { id: 'epic',      w: 4,  mult: 3.0 },
  { id: 'legendary', w: 1,  mult: 4.5 },
];
function rarityByIndex(i) { return RARITIES[Math.max(0, Math.min(i, RARITIES.length - 1))]; }
// Per-slot stat profile: weight × ilvl × rarity mult. Every slot rolls a
// different mix so a chestpiece reads as armour and an amulet reads as jewelry
// instead of all twelve being the same item with a different noun. `primary` is
// the stat that slot is *for*, and never rounds away to nothing.
//
// A full set totals ≈ atk 1.6 / def 0.6 / hp 4.5 per ilvl-point, against
// 1.2 / 0.3 / 3.0 for the old three-slot layout — stronger, but it takes four
// times as many drops to get there.
const SLOT_STATS = {
  weapon:  { primary: 'atk', atk: 0.80 },
  offhand: { primary: 'hp',  atk: 0.10, def: 0.10, hp: 0.30 },
  head:    { primary: 'hp',  def: 0.08, hp: 0.55 },
  chest:   { primary: 'def', def: 0.16, hp: 0.90 },
  back:    { primary: 'hp',  def: 0.07, hp: 0.45 },
  hands:   { primary: 'atk', atk: 0.10, def: 0.05, hp: 0.25 },
  feet:    { primary: 'hp',  def: 0.07, hp: 0.40 },
  neck:    { primary: 'atk', atk: 0.15, hp: 0.45 },
  ring:    { primary: 'atk', atk: 0.11, def: 0.02, hp: 0.30 },
};
function itemStats(slot, ilvl, mult) {
  const p = SLOT_STATS[slot] || SLOT_STATS.ring;
  const out = {
    atk: Math.round((p.atk || 0) * ilvl * mult),
    def: Math.round((p.def || 0) * ilvl * mult),
    hp: Math.round((p.hp || 0) * ilvl * mult),
  };
  out[p.primary] = Math.max(1, out[p.primary]);
  return out;
}
const INVENTORY_CAP = 20;

// Economy
function shopPrice(ilvl, rarityMult) { return Math.round(60 * ilvl * rarityMult); }
const SELL_FRAC = 0.25;

// ---------- upgrading: the gold sink ----------
//
// Levels cap and loot caps, but gold never did. An attentive player finishes a
// run holding ~1.07M with nothing to spend it on, because the shop's five slots
// are the entire economy — and the number barely moves whatever the death
// penalty is, since they only die about four times. Upgrading gives gold a
// permanent home that scales with ilvl, and turns "which item do I pour money
// into" into the second real decision the game has after which gear to wear.
//
// The curve is quadratic on purpose. The first + on an item is pocket change and
// the tenth costs a hundred times as much, so a full set at +10 runs to ~1.16M
// for twelve ilvl-50 items — about a whole run's income. You are meant to be
// choosing the whole way up, never maxing everything.
//
// Gold spent here is destroyed: sell price ignores `plus` entirely (see
// engine.sellPrice). Otherwise every upgrade is a 25%-refundable deposit and the
// sink leaks straight back open.
const UPGRADE_MAX = 10;
const UPGRADE_COST_BASE = 5;
const UPGRADE_STAT_PER_PLUS = 0.02;   // +10 = +20% of whatever the item rolled

function upgradeCost(ilvl, plus) {
  return Math.round(UPGRADE_COST_BASE * Math.max(1, ilvl) * Math.pow((plus || 0) + 1, 2));
}
function plusMult(plus) { return 1 + UPGRADE_STAT_PER_PLUS * Math.max(0, plus || 0); }

// ---------- paragon: what the cap is actually for ----------
//
// The cap used to be a wall with the XP counter nailed to `MAX`. `engine.addXp`
// returned early above level 60 and every point earned past it was discarded, so
// a hero who got there had the loot chase and nothing else — and this game keeps
// ticking while you work. You don't stop coding because your hero peaked.
//
// Insight is the post-cap currency, and deliberately *not* a prestige reset:
// level, gear, gold and zone are never touched. This repo's line on setbacks is
// that they should have a way back (see the boss-reset note above), and wiping
// twelve slots you spent weeks filling — while you were looking at a compiler
// rather than at the game — is the opposite of that.
//
// Rate: 40% of a cap-level per point, which the sim puts at ~3 points a day at
// 300 events/day. The first point lands within hours — the cap should visibly
// stop being a wall the moment you reach it — and all 75 points across the three
// tracks take ~120 days past the cap, against the 45 days it took to get there.
// A tenth of a cap-level was the first guess and maxed everything in under a
// month, which is a tail no longer than the climb.
const INSIGHT_XP = Math.round(xpToNext(LEVEL_CAP) * 0.4);
const INSIGHT_TRACK_MAX = 25;
const INSIGHT_TRACKS = [
  { id: 'atk',  label: 'attack power', per: 0.02, of: 'hero ATK' },
  { id: 'gold', label: 'gold found',   per: 0.03, of: 'gold per kill' },
  { id: 'drop', label: 'loot rate',    per: 0.02, of: 'drop chance' },
];
function insightTrack(id) { return INSIGHT_TRACKS.find(t => t.id === id) || null; }

// The first three points in a track cost 1 each and the twenty-fifth costs 9, so
// a full track is 117 Insight and all three are 351 — roughly as long a tail past
// the cap as the 45-day run that reached it. Tracks cap rather than running
// forever: an unbounded ATK multiplier eventually deletes the difficulty curve
// that balance.monsterHitDamage exists to keep flat.
function insightCost(points) { return 1 + Math.floor(Math.max(0, points || 0) / 3); }
function insightMult(id, points) {
  const t = insightTrack(id);
  if (!t) return 1;
  return 1 + t.per * Math.min(Math.max(0, points || 0), INSIGHT_TRACK_MAX);
}

// Hero survival
const DEATH_GOLD_LOSS = 0.05;
const REGEN_FRAC_PER_MIN = 0.01;   // passive, lazy, wall-clock
const STOP_REGEN_FRAC = 0.25;      // of missing HP, on Stop ("rest")

// Offline / away progress (gap measured against lastTickAt)
const OFFLINE_MIN_GAP_MS = 30 * 60 * 1000;
const OFFLINE_KILLS_PER_HOUR = 1.5;
const OFFLINE_MAX_HOURS = 8;
const OFFLINE_REWARD_FRAC = 0.5;   // xp/gold vs a real kill; no loot, no boss progress

// Anim queue
const ANIM_CAP = 10;
const ANIM_MAX_AHEAD_MS = 30 * 1000;
const HIT_COALESCE_MS = 2000;

module.exports = {
  LEVEL_CAP, xpToNext,
  monsterMaxHp, killXp, killGold, monsterHitDamage,
  RETALIATE_CHANCE, RETALIATE_CHANCE_BOSS, RETALIATE_MULT, RETALIATE_MULT_BOSS,
  DMG, LINE_CAP, lineDamageMult, testXp, TEST_XP_COOLDOWN_MS,
  BOSS_KILLS_REQUIRED, BOSS_RARITY_FLOOR, monsterLevel,
  DROP_CHANCE, RARITIES, rarityByIndex, itemStats, SLOT_STATS, INVENTORY_CAP,
  shopPrice, SELL_FRAC,
  UPGRADE_MAX, UPGRADE_COST_BASE, UPGRADE_STAT_PER_PLUS, upgradeCost, plusMult,
  INSIGHT_XP, INSIGHT_TRACK_MAX, INSIGHT_TRACKS, insightTrack, insightCost, insightMult,
  DEATH_GOLD_LOSS, REGEN_FRAC_PER_MIN, STOP_REGEN_FRAC,
  OFFLINE_MIN_GAP_MS, OFFLINE_KILLS_PER_HOUR, OFFLINE_MAX_HOURS, OFFLINE_REWARD_FRAC,
  ANIM_CAP, ANIM_MAX_AHEAD_MS, HIT_COALESCE_MS,
};
