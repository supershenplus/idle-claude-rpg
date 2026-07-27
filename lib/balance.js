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
function itemStats(slot, ilvl, mult) {
  if (slot === 'weapon') return { atk: Math.max(1, Math.round(0.8 * ilvl * mult)), def: 0, hp: 0 };
  if (slot === 'armor') return { atk: 0, def: Math.max(1, Math.round(0.3 * ilvl * mult)), hp: Math.round(2 * ilvl * mult) };
  return { atk: Math.max(1, Math.round(0.4 * ilvl * mult)), def: 0, hp: Math.round(1 * ilvl * mult) }; // trinket
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
  BOSS_KILLS_REQUIRED, BOSS_RARITY_FLOOR,
  DROP_CHANCE, RARITIES, rarityByIndex, itemStats, INVENTORY_CAP,
  shopPrice, SELL_FRAC,
  DEATH_GOLD_LOSS, REGEN_FRAC_PER_MIN, STOP_REGEN_FRAC,
  OFFLINE_MIN_GAP_MS, OFFLINE_KILLS_PER_HOUR, OFFLINE_MAX_HOURS, OFFLINE_REWARD_FRAC,
  ANIM_CAP, ANIM_MAX_AHEAD_MS, HIT_COALESCE_MS,
};
