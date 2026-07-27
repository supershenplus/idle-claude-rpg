'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../lib/engine');
const B = require('../lib/balance');
const C = require('../lib/content');

const T0 = 1_700_000_000_000;
function fresh(cls) { return E.newState(cls || 'wizard', 'Test', T0); }
function ev(e, t, m) { return { t, e, m: m || {} }; }

test('newState: full hp, grove, live monster', () => {
  const s = fresh();
  assert.strictEqual(s.hero.level, 1);
  assert.strictEqual(s.hero.hp, s.hero.maxHp);
  assert.strictEqual(s.hero.zone, 'grove');
  assert.ok(s.monster.hp > 0);
  assert.ok(!s.monster.isBoss);
});

test('jabs damage the monster and eventually kill it', () => {
  const s = fresh();
  const hp0 = s.monster.hp;
  E.fold(s, [ev('attack_jab', T0 + 1000)], T0 + 1000);
  assert.ok(s.monster.hp < hp0 || s.counters.kills === 1);
  const events = [];
  for (let i = 0; i < 40; i++) events.push(ev('attack_jab', T0 + 2000 + i * 500));
  E.fold(s, events, T0 + 60_000);
  assert.ok(s.counters.kills >= 1, 'monster died');
  assert.ok(s.hero.xp > 0 || s.hero.level > 1, 'xp awarded');
  assert.ok(s.hero.gold > 0, 'gold awarded');
});

test('test_pass grants xp with a 60s cooldown', () => {
  const s = fresh();
  E.fold(s, [ev('test_pass', T0 + 1000)], T0 + 1000);
  const xp1 = s.hero.xp + (s.hero.level - 1) * 1000; // crude monotonic proxy
  E.fold(s, [ev('test_pass', T0 + 2000)], T0 + 2000); // within cooldown: attack only
  assert.strictEqual(s.counters.testsPassed, 2);
  assert.strictEqual(s.counters.lastTestXpAt, T0 + 1000, 'second grant suppressed');
  E.fold(s, [ev('test_pass', T0 + 70_000)], T0 + 70_000);
  assert.strictEqual(s.counters.lastTestXpAt, T0 + 70_000, 'cooldown expired → new grant');
  assert.ok(xp1 >= 0);
});

test('push instakills a non-boss and always drops loot', () => {
  const s = fresh();
  E.fold(s, [ev('push', T0 + 1000)], T0 + 1000);
  assert.strictEqual(s.counters.kills, 1);
  assert.strictEqual(s.counters.pushes, 1);
  assert.strictEqual(s.inventory.length, 1, 'guaranteed loot');
  assert.ok(s.monster.hp === s.monster.maxHp, 'fresh monster spawned');
});

test('failures hurt the hero; knight takes half; death respawns with gold loss', () => {
  const s = fresh('knight');
  const hp0 = s.hero.hp;
  E.fold(s, [ev('test_fail', T0 + 1000)], T0 + 1000);
  assert.ok(s.hero.hp < hp0);
  // grind the hero down
  s.hero.gold = 1000;
  const events = [];
  for (let i = 0; i < 200; i++) events.push(ev('test_fail', T0 + 2000 + i * 100));
  E.fold(s, events, T0 + 30_000);
  assert.ok(s.counters.deaths >= 1, 'died at least once');
  assert.ok(s.hero.hp > 0, 'respawned');
  assert.ok(s.hero.gold < 1000 + s.counters.goldEarned, 'death tax applied');
});

test('level-ups follow the xp curve and full-heal', () => {
  const s = fresh();
  E.fold(s, [], T0 + 1000);
  E.addXp(s, B.xpToNext(1) + 5, T0 + 1000);
  assert.strictEqual(s.hero.level, 2);
  assert.strictEqual(s.hero.hp, s.hero.maxHp);
  assert.ok(s.anim.some(a => a.type === 'levelup'));
});

test('boss spawns after threshold kills + level gate, unlocks next zone on death', () => {
  const s = fresh();
  s.hero.level = 9; // meet the grove boss gate
  E.refreshMaxHp(s);
  s.counters.killsSinceBoss = B.BOSS_KILLS_REQUIRED;
  E.spawnMonster(s, () => 0.5);
  assert.ok(s.monster.isBoss, 'boss spawned');
  assert.strictEqual(s.monster.id, 'rootfang');
  // kill the boss with overwhelming force
  s.monster.hp = 1;
  E.fold(s, [ev('commit', T0 + 1000)], T0 + 1000);
  assert.strictEqual(s.counters.bossKills, 1);
  assert.ok(s.hero.unlockedZones.includes('caves'), 'next zone unlocked');
  assert.ok(s.inventory.length >= 1, 'boss loot guaranteed');
  const order = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
  const bossItem = s.inventory.find(i => i.from.startsWith('boss:'));
  assert.ok(order[bossItem.rarity] >= 2, 'boss loot is rare or better');
});

test('offline gap grants away progress; small gaps do not', () => {
  const s = fresh();
  E.fold(s, [], T0 + 60_000); // 1min: nothing
  assert.strictEqual(s.counters.kills, 0);
  E.fold(s, [], T0 + 60_000 + 4 * 3600_000); // 4h away
  assert.strictEqual(s.counters.kills, Math.floor(4 * B.OFFLINE_KILLS_PER_HOUR));
  assert.ok(s.hero.gold > 0);
  assert.ok(s.anim.some(a => a.type === 'idle'));
});

test('passive regen heals over wall-clock time', () => {
  const s = fresh();
  s.hero.hp = 10;
  E.fold(s, [], T0 + 10 * 60_000); // 10 min → 10% maxHp
  assert.ok(s.hero.hp >= 10 + Math.floor(0.1 * s.hero.maxHp) - 1);
});

test('rest (Stop) heals 25% of missing hp', () => {
  const s = fresh();
  s.hero.hp = s.hero.maxHp - 40;
  E.fold(s, [ev('rest', T0 + 1000)], T0 + 1000);
  assert.ok(s.hero.hp >= s.hero.maxHp - 40 + 10 - 1);
});

test('anim queue: caps, coalescing, serialized starts', () => {
  const s = fresh();
  const events = [];
  for (let i = 0; i < 50; i++) events.push(ev('attack_jab', T0 + 1000 + i));
  E.fold(s, events, T0 + 2000);
  assert.ok(s.anim.length <= B.ANIM_CAP);
  for (let i = 1; i < s.anim.length; i++) {
    assert.ok(s.anim[i].at >= s.anim[i - 1].at + s.anim[i - 1].dur, 'no overlap');
  }
});

test('inventory cap auto-sells the worst item', () => {
  const s = fresh();
  for (let i = 0; i < B.INVENTORY_CAP; i++) {
    E.addToInventory(s, { id: 'x' + i, slot: 'weapon', name: 'Junk ' + i, rarity: 'common', ilvl: 1, atk: 1, def: 0, hp: 0 });
  }
  const gold0 = s.hero.gold;
  E.addToInventory(s, { id: 'y', slot: 'weapon', name: 'Keeper', rarity: 'epic', ilvl: 5, atk: 9, def: 0, hp: 0 });
  assert.strictEqual(s.inventory.length, B.INVENTORY_CAP);
  assert.ok(s.hero.gold > gold0, 'auto-sell paid out');
  assert.ok(s.inventory.some(i => i.id === 'y'));
});

test('malformed events are skipped, not fatal', () => {
  const s = fresh();
  E.fold(s, [null, { t: T0, e: 42 }, ev('attack_jab', T0 + 1000), { nope: true }], T0 + 1000);
  assert.ok(s.eventsFolded >= 1);
});

test('level cap: no xp past 60', () => {
  const s = fresh();
  s.hero.level = B.LEVEL_CAP;
  E.addXp(s, 1e9, T0);
  assert.strictEqual(s.hero.level, B.LEVEL_CAP);
  assert.strictEqual(s.hero.xp, 0);
});

test('zone content is coherent', () => {
  let prevMax = 0;
  for (const z of C.zones) {
    assert.ok(z.monsters.length >= 3 || z.id === 'prod');
    assert.ok(z.boss && z.boss.level === z.max, `${z.id} boss level matches zone max`);
    assert.ok(z.min > prevMax, 'zones ascend');
    prevMax = z.max;
  }
});
