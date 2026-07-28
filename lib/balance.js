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
function monsterHitDamage(mLvl, def, heavy) {
  return Math.max(1, Math.round((heavy ? 2 : 1) * mLvl - def));
}

// Retaliation: the monster swings back when the hero attacks, so damage no
// longer depends solely on you fumbling a command. Tuned so a full kill costs
// roughly 5% of max HP (~4.2 attacks/kill × chance × mult vs the HP curve),
// which passive regen plus Stop-rests can outpace — but a bad streak can't.
// Boss chance is LOWER than trash, not higher: a boss has 10x HP, so its fight
// runs ~42 attacks instead of ~4. Per-attack parity would mean ~10x the total
// incoming damage, and since death restores the monster to full HP that made
// bosses unkillable rather than merely hard. Damage per swing is what makes a
// boss scary; frequency is what makes it unwinnable.
const RETALIATE_CHANCE = 0.30;
const RETALIATE_CHANCE_BOSS = 0.25;
const RETALIATE_MULT = 0.45;
const RETALIATE_MULT_BOSS = 0.55;

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
  DEATH_GOLD_LOSS, REGEN_FRAC_PER_MIN, STOP_REGEN_FRAC,
  OFFLINE_MIN_GAP_MS, OFFLINE_KILLS_PER_HOUR, OFFLINE_MAX_HOURS, OFFLINE_REWARD_FRAC,
  ANIM_CAP, ANIM_MAX_AHEAD_MS, HIT_COALESCE_MS,
};
