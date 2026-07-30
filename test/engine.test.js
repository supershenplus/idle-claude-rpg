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

test('a hero name cannot steer the terminal it renders into', () => {
  // The HUD prints the name roughly once a second. Anything here that survives
  // reaches the terminal as a command, not as text.
  assert.strictEqual(E.sanitizeName('\x1b[2JEva\x1b]8;;http://x\x07'), '[2JEva]8;;http://x');
  assert.strictEqual(E.sanitizeName('a\x00b\x7fc\x9bd'), 'abcd');
  assert.strictEqual(E.sanitizeName('Eva\nthe Bold'), 'Evathe Bold');

  // Legitimate names are not collateral: accents, CJK and emoji all outlive it.
  for (const ok of ['Évá', '勇者', 'Eva 🗡']) assert.strictEqual(E.sanitizeName(ok), ok);

  // Empty, blank and unset all land on the same default rather than on ''.
  for (const bad of ['', '   ', '\x1b\x1b', null, undefined]) {
    assert.strictEqual(E.sanitizeName(bad), 'Hero');
  }
});

test('a hero name is capped in code points, never mid-surrogate', () => {
  const long = E.sanitizeName('🗡'.repeat(40));
  assert.strictEqual(Array.from(long).length, E.NAME_MAX);
  assert.ok(!/[\uD800-\uDFFF]/.test(long.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')),
    'the cap split a surrogate pair and left half a character behind');
  assert.strictEqual(E.sanitizeName('x'.repeat(30)), 'x'.repeat(E.NAME_MAX));
});

test('newState sanitizes the name it is handed', () => {
  assert.strictEqual(E.newState('wizard', '\x1b[31mRed', T0).hero.name, '[31mRed');
  assert.strictEqual(E.newState('wizard', '', T0).hero.name, 'Hero');
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

// ---- the blows the hero did not provoke ----
//
// Reported from play: HP came off the bar with nothing on screen. `test_fail`
// and `bash_fail` called `hurtHero` and stopped there, never touching the anim
// queue — so the only monster blow the game drew was the counter, which borrows
// the hero's animation. A failing test was a number changing and nothing else.

test('a failing test is drawn, not just deducted', () => {
  for (const e of ['test_fail', 'bash_fail']) {
    const s = fresh();
    const hp0 = s.hero.hp;
    E.fold(s, [ev(e, T0 + 1000)], T0 + 1000);
    const blow = s.anim.find(a => a.type === 'mhit');
    assert.ok(blow, `${e}: took HP off the hero with no frame on screen`);
    assert.strictEqual(blow.data.dmg, hp0 - s.hero.hp,
      `${e}: the figure on screen is not the HP that came off`);
    assert.ok(blow.data.name, `${e}: the blow names no monster`);
  }
});

test('the damage drawn is what the class actually took, not what was rolled', () => {
  // The knight halves incoming damage (`damageTakenMult`), which `hurtHero`
  // applies after the caller has handed over its number — so a figure passed
  // through rather than read back would overstate every blow it takes.
  const s = fresh('knight');
  const hp0 = s.hero.hp;
  E.fold(s, [ev('test_fail', T0 + 1000)], T0 + 1000);
  assert.strictEqual(s.anim.find(a => a.type === 'mhit').data.dmg, hp0 - s.hero.hp);
});

test('a killing blow leaves the death banner rather than a blow nobody survived', () => {
  const s = fresh();
  s.hero.hp = 1;
  s.hero.gold = 1000;
  E.fold(s, [ev('test_fail', T0 + 1000)], T0 + 1000);
  assert.strictEqual(s.counters.deaths, 1, 'the blow did not kill');
  assert.ok(s.anim.some(a => a.type === 'death'), 'no death banner');
  // The respawn puts HP back to full, so there is no honest figure to draw —
  // and `♥-0` under a corpse-to-be reads as a blow that did nothing.
  assert.ok(!s.anim.some(a => a.type === 'mhit'), 'a blow was drawn over the death');
});

test('a burst of failures coalesces instead of saturating the queue', () => {
  // Same reasoning as the hero's hits: 50 blows at 1500ms each would push every
  // real event past ANIM_MAX_AHEAD_MS and out of the queue entirely.
  const s = fresh('knight');
  s.hero.maxHp = s.hero.hp = 1e6;              // survive the whole burst
  const events = [];
  for (let i = 0; i < 40; i++) events.push(ev('bash_fail', T0 + 1000 + i));
  E.fold(s, events, T0 + 1000);
  const blows = s.anim.filter(a => a.type === 'mhit');
  assert.strictEqual(blows.length, 1, `${blows.length} separate blows queued for one burst`);
  assert.ok(blows[0].data.dmg > 0, 'the coalesced blow lost its damage');
});

test('monsters retaliate while the hero attacks, without any failed command', () => {
  // The bug this guards: damage used to arrive only via test_fail/bash_fail, so
  // a clean session meant the monster never touched you.
  let hurtRuns = 0;
  for (let k = 0; k < 60; k++) {
    const s = fresh();
    s.monster.maxHp = 1e6; s.monster.hp = 1e6;   // immortal: isolate retaliation
    const hp0 = s.hero.hp;
    const events = [];
    for (let i = 0; i < 20; i++) events.push(ev('attack_jab', T0 + 1000 + i));
    E.fold(s, events, T0 + 1500);
    assert.strictEqual(s.counters.testsFailed, 0, 'no failures involved');
    if (s.hero.hp < hp0) hurtRuns++;
  }
  assert.ok(hurtRuns >= 55, `monster hit back in ${hurtRuns}/60 clean runs`);
});

// ---- the near miss ----
//
// A dodge is a *reading* of the retaliation roll, not a second roll and not a
// damage reduction: under the threshold the monster connects, in the band just
// above it the HUD gets to say it swung and missed, above that it never swung.
// These pin that the reading never leaks into the outcome.

// One attack against an immortal monster, with retaliation forced to land on a
// chosen point of the roll.
function swing(roll, monster) {
  const s = fresh();
  Object.assign(s.monster, { maxHp: 1e6, hp: 1e6 }, monster || {});
  E.dealDamage(s, 1, {}, () => roll, T0 + 1000);
  return { s, hit: s.anim.find(a => a.type === 'hit') };
}

test('a roll in the near-miss band is narrated, and costs nothing', () => {
  const { s, hit } = swing(B.RETALIATE_CHANCE + B.NEAR_MISS_BAND / 2);
  assert.strictEqual(hit.data.dodged, true, 'the swing that missed is not on the anim');
  assert.strictEqual(hit.data.counter, undefined, 'a dodge counted as damage');
  assert.strictEqual(s.hero.hp, s.hero.maxHp, 'a dodge cost HP');
});

test('a roll past the band is silence, not a dodge', () => {
  // Most hits are not answered at all. Narrating every one of them as a dodge
  // would put the hero perpetually mid-lean and make the tell meaningless.
  const { s, hit } = swing(B.RETALIATE_CHANCE + B.NEAR_MISS_BAND + 0.01);
  assert.ok(!hit.data.dodged, 'a swing that never happened was dodged');
  assert.strictEqual(s.hero.hp, s.hero.maxHp);
});

test('a landed counter costs HP and is never also a dodge', () => {
  const { s, hit } = swing(B.RETALIATE_CHANCE - 0.01);
  assert.ok(hit.data.counter > 0, 'the counter did not land');
  assert.ok(s.hero.hp < s.hero.maxHp, 'the counter cost nothing');
  assert.ok(!hit.data.dodged);
});

test('a burst that coalesces reports the blood, not the dodge', () => {
  // `enqueue` folds rapid hits into one anim, so a dodge and a landed counter
  // can reach the same record. A frame showing the hero shrugging off a swing it
  // actually took is a lie; `↩-N` is the half of the exchange that matters.
  const s = fresh();
  Object.assign(s.monster, { maxHp: 1e6, hp: 1e6 });
  E.dealDamage(s, 1, {}, () => B.RETALIATE_CHANCE + B.NEAR_MISS_BAND / 2, T0 + 1000);
  assert.strictEqual(s.anim.at(-1).data.dodged, true);
  E.dealDamage(s, 1, {}, () => B.RETALIATE_CHANCE - 0.01, T0 + 1100);
  const hit = s.anim.at(-1);
  assert.strictEqual(s.anim.filter(a => a.type === 'hit').length, 1, 'the burst did not coalesce');
  assert.ok(hit.data.counter > 0);
  assert.strictEqual(hit.data.dodged, false, 'the dodge outlived the blow that landed');

  // …and the reverse order cannot resurrect it either.
  E.dealDamage(s, 1, {}, () => B.RETALIATE_CHANCE + B.NEAR_MISS_BAND / 2, T0 + 1200);
  assert.strictEqual(s.anim.at(-1).data.dodged, false, 'a later dodge overwrote the blow');
});

test('reading the roll three ways still spends exactly one of them', () => {
  // The whole claim that this changes no balance rests on the RNG stream being
  // untouched: every tuned number and every seeded test downstream of a
  // retaliation would shift if a branch started drawing a second value.
  for (const roll of [0.01, B.RETALIATE_CHANCE + 0.01, 0.99]) {
    let draws = 0;
    const s = fresh();
    Object.assign(s.monster, { maxHp: 1e6, hp: 1e6 });
    E.retaliate(s, () => { draws++; return roll; }, T0 + 1000);
    assert.strictEqual(draws, 1, `roll ${roll}: retaliate drew ${draws} numbers`);
  }
});

test('bosses and goblins dodge as often as trash, though they swing more', () => {
  // The band sits above each monster's own threshold rather than at a fixed
  // point, so a boss's extra aggression eats into the silence, not into the
  // dodges.
  for (const [label, monster, chance] of [
    ['boss', { isBoss: true }, B.RETALIATE_CHANCE_BOSS],
    ['goblin', { isGoblin: true }, B.GOBLIN_RETALIATE_CHANCE],
  ]) {
    assert.strictEqual(swing(chance + B.NEAR_MISS_BAND / 2, monster).hit.data.dodged, true,
      `${label}: a near miss inside its own band was not narrated`);
    assert.ok(!swing(chance - 0.01, monster).hit.data.dodged,
      `${label}: a landed counter was drawn as a dodge`);
    assert.ok(!swing(chance + B.NEAR_MISS_BAND + 0.01, monster).hit.data.dodged,
      `${label}: a swing that never happened was dodged`);
  }
});

test('retaliation never fires from a corpse, and folds into the hit anim', () => {
  const s = fresh();
  s.monster.hp = 1;                      // next attack kills it
  const hp0 = s.hero.hp;
  E.fold(s, [ev('attack_jab', T0 + 1000)], T0 + 1000);
  assert.strictEqual(s.counters.kills, 1);
  assert.strictEqual(s.hero.hp, hp0, 'a dead monster does not counter');

  // counters ride on the existing hit anim rather than queuing their own frame
  const s2 = fresh();
  s2.monster.maxHp = 1e6; s2.monster.hp = 1e6;
  const many = [];
  for (let i = 0; i < 40; i++) many.push(ev('attack_jab', T0 + 1000 + i));
  E.fold(s2, many, T0 + 1200);
  assert.ok(s2.anim.length <= B.ANIM_CAP, 'anim queue not saturated by counters');
  assert.ok(s2.anim.every(a => a.type !== 'counter'), 'no separate counter frames');
});

// A hero wearing a full at-level set of the given rarity — the case that
// actually matters, and the one the balance numbers are quoted against. The old
// guards here measured a *naked* hero, which described nobody: armour is a ratio
// now, so def is the single biggest term in what a monster does to you.
function gearedIn(zoneId, level, rarityId) {
  const s = fresh();
  const zone = C.zoneById(zoneId);
  s.hero.level = level;
  s.hero.zone = zoneId;
  const mult = B.RARITIES.find(r => r.id === (rarityId || 'uncommon')).mult;
  // The gear you actually hold when the boss comes up: trash escalates to
  // `zone.max - 1` as the cycle fills, and ilvl tracks the monster that dropped
  // it, so kit from the top of the band is what you face a boss wearing.
  const ilvl = zone.max - 1;
  for (const key of C.EQUIP_KEYS) {
    const slot = C.keySlot(key);
    s.equipment[key] = Object.assign({ slot, ilvl, rarity: rarityId || 'uncommon' },
      B.itemStats(slot, ilvl, mult));
  }
  E.refreshMaxHp(s);
  s.hero.hp = s.hero.maxHp;
  return s;
}

// Weighted mean attack multiplier for a real session (see test/sim.js MIX:
// 58% jab, 25% edits, 8% tests, 4% builds, 3% commits, 2% pushes) — not
// jab-only, which is the slowest possible way to fight and thus the most
// punishing, but not how anyone actually plays.
const AVG_ATTACK_MULT = 0.58 * B.DMG.jab + 0.25 * B.lineDamageMult(20)
  + 0.08 * 0.8 * B.DMG.test + 0.04 * B.DMG.build
  + 0.03 * B.DMG.commit + 0.02 * B.DMG.pushVsBoss;

function bossFightCost(s) {
  const boss = C.zoneById(s.hero.zone).boss;
  const attacks = B.monsterMaxHp(boss.level, 0.5, true) / (E.heroAtk(s) * AVG_ATTACK_MULT);
  const perSwing = B.monsterHitDamage(boss.level, E.heroDef(s), false) * B.RETALIATE_MULT_BOSS;
  return attacks * B.RETALIATE_CHANCE_BOSS * perSwing / s.hero.maxHp;
}

test('a boss is dangerous but survivable for a geared hero, at every zone', () => {
  // The guard this replaced asserted boss counters were *rarer* than trash
  // counters, which is how the game used to stop a lost boss fight from becoming
  // a wall: dying restored the boss to full HP, so a boss you could not beat was
  // a boss you could never get past. hurtHero drives the boss off now, so the
  // invariant worth holding is the honest one — a boss must be able to hurt a
  // properly equipped hero without reliably killing them.
  // The bounds are the design statement, not fitted numbers. Below 15% of max HP
  // a boss is scenery. At or above 100% the *expected* outcome of a boss fight
  // is death, which is a different game from a dangerous one — you should expect
  // to win and occasionally not. This is measured against a merely uncommon set,
  // the floor of "properly equipped": a player who actually chases upgrades sits
  // far under it (the sim's attentive profile loses ~1 boss fight in 25), and
  // that gap is the reward for managing gear at all.
  for (const z of C.zones) {
    const s = gearedIn(z.id, Math.min(B.LEVEL_CAP, z.max - 1));
    const cost = bossFightCost(s);
    assert.ok(cost > 0.15, `${z.id}: boss costs only ${(cost * 100).toFixed(0)}% of max HP — not a threat`);
    assert.ok(cost < 1.00, `${z.id}: boss costs ${(cost * 100).toFixed(0)}% of max HP — death is the expected outcome`);
  }
});

test('trash is attrition regen outpaces, for a geared hero', () => {
  // The other half of the split: trash must not be what kills you. A kill takes
  // ~4.2 events, which at any realistic typing pace is minutes of wall clock,
  // and passive regen pays 1%/min throughout — so a few percent per kill is a
  // race the hero wins comfortably and the HP bar stays full while grinding.
  // Anything above that and the zone grinds you down instead.
  const CEILING = 0.03;
  for (const z of C.zones) {
    const s = gearedIn(z.id, Math.min(B.LEVEL_CAP, z.max - 1));
    const mLvl = B.monsterLevel(z, B.BOSS_KILLS_REQUIRED, 0.5);
    const attacks = B.monsterMaxHp(mLvl, 0.5, false) / (E.heroAtk(s) * AVG_ATTACK_MULT);
    const cost = attacks * B.RETALIATE_CHANCE
      * B.monsterHitDamage(mLvl, E.heroDef(s), false) * B.RETALIATE_MULT / s.hero.maxHp;
    assert.ok(cost < CEILING,
      `${z.id}: a kill costs ${(cost * 100).toFixed(1)}% of max HP, over the ${CEILING * 100}% attrition ceiling`);
  }
});

test('armour is a ratio: it never zeroes damage and never stops mattering', () => {
  for (const mLvl of [1, 9, 27, 45, 60]) {
    const naked = B.monsterHitDamage(mLvl, 0, false);
    assert.strictEqual(naked, mLvl, `def 0 takes the full blow at mLvl ${mLvl}`);
    // Def equal to the monster's level halves it — the anchor the curve is built on.
    assert.strictEqual(B.monsterHitDamage(mLvl, mLvl, false), Math.max(1, Math.round(mLvl / 2)));
    // Absurd def still never reaches zero, so no amount of gear grants immunity.
    assert.ok(B.monsterHitDamage(mLvl, 10_000, false) >= 1);
    // …and more def is never worse.
    for (let d = 1; d <= 60; d++) {
      assert.ok(B.monsterHitDamage(mLvl, d, false) <= B.monsterHitDamage(mLvl, d - 1, false),
        `def ${d} must not take more damage than def ${d - 1} at mLvl ${mLvl}`);
    }
  }
});

test('losing to a boss drives it off instead of restarting the fight', () => {
  const s = fresh();
  s.hero.level = 9;
  E.refreshMaxHp(s);
  s.counters.killsSinceBoss = B.BOSS_KILLS_REQUIRED;
  E.spawnMonster(s, () => 0.5);
  assert.ok(s.monster.isBoss, 'boss is up');
  s.hero.gold = 1000;

  E.hurtHero(s, s.hero.maxHp * 5, T0 + 1000);

  assert.strictEqual(s.counters.deaths, 1);
  assert.ok(!s.monster.isBoss, 'the boss left rather than resetting to full HP');
  assert.strictEqual(s.counters.killsSinceBoss, 0, 'the approach has to be re-earned');
  assert.strictEqual(s.hero.hp, s.hero.maxHp, 'respawn at full HP');
  assert.strictEqual(s.hero.gold, 1000 - Math.round(1000 * B.DEATH_GOLD_LOSS));
  const anim = s.anim.find(a => a.type === 'death');
  assert.ok(anim && anim.data.drovenOffBy, 'death frame names who drove you off');
  // …and the gate agrees, so the HUD immediately stops promising a boss.
  assert.ok(!E.bossGate(s).ready);
});

test('dying to trash restarts that fight and nothing else', () => {
  const s = fresh();
  s.counters.killsSinceBoss = 3;
  assert.ok(!s.monster.isBoss);
  s.monster.hp = 1;
  E.hurtHero(s, s.hero.maxHp * 5, T0 + 1000);
  assert.strictEqual(s.counters.deaths, 1);
  assert.strictEqual(s.monster.hp, s.monster.maxHp, 'the mob is back to full');
  assert.strictEqual(s.counters.killsSinceBoss, 3, 'boss progress survives a trash death');
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

test('trash fills the zone band and stops one step below the boss', () => {
  for (const z of C.zones) {
    for (let k = 0; k <= B.BOSS_KILLS_REQUIRED * 2; k++) {
      for (const roll of [0, 0.34, 0.67, 0.999]) {
        const lvl = B.monsterLevel(z, k, roll);
        assert.ok(lvl >= z.min && lvl <= z.max - 1,
          `${z.id}: level ${lvl} outside ${z.min}-${z.max - 1} (k=${k}, roll=${roll})`);
      }
    }
    // The bug this replaced: `zone.max` was dead data, so the Grove advertised
    // 1-9 and never spawned above 4. The top of the band must be reachable.
    const top = Math.max(...Array.from({ length: 40 }, (_, i) =>
      B.monsterLevel(z, B.BOSS_KILLS_REQUIRED, (i % 20) / 20)));
    assert.strictEqual(top, z.max - 1, `${z.id}: band tops out at ${top}, want ${z.max - 1}`);
  }
});

test('trash escalates as the boss cycle fills', () => {
  for (const z of C.zones) {
    const at = k => B.monsterLevel(z, k, 0.5);
    assert.strictEqual(at(0), z.min, `${z.id}: a fresh cycle starts at the band floor`);
    assert.ok(at(B.BOSS_KILLS_REQUIRED / 2) > at(0), `${z.id}: mid-cycle outranks the floor`);
    assert.ok(at(B.BOSS_KILLS_REQUIRED) > at(B.BOSS_KILLS_REQUIRED / 2),
      `${z.id}: the vanguard outranks mid-cycle`);
  }
});

test('bossGate agrees with what actually spawns', () => {
  // The readout and the spawner must not drift: the old status line could say
  // "0 more kills" while the level gate silently held the boss back.
  const zone = C.zoneById('grove');
  for (const kills of [0, B.BOSS_KILLS_REQUIRED - 1, B.BOSS_KILLS_REQUIRED, 60]) {
    for (const level of [1, zone.boss.level - 2, zone.boss.level - 1, zone.boss.level + 5]) {
      const s = fresh();
      s.hero.level = level;
      s.counters.killsSinceBoss = kills;
      const gate = E.bossGate(s);
      E.spawnMonster(s, () => 0.5);
      assert.strictEqual(gate.ready, !!s.monster.isBoss,
        `kills=${kills} level=${level}: gate said ready=${gate.ready}, spawned boss=${!!s.monster.isBoss}`);
    }
  }
});

test('bossGateText always names the gate that is actually binding', () => {
  const s = fresh();
  const zone = C.zoneById(s.hero.zone);

  // The live-save case: kills long since satisfied, level still holding.
  s.counters.killsSinceBoss = 58;
  s.hero.level = 5;
  let txt = E.bossGateText(s);
  assert.ok(/3 levels away/.test(txt), `want the level gate, got: ${txt}`);
  assert.ok(!/kill/.test(txt), `must not mention kills when kills are satisfied: ${txt}`);

  // Both gates pending: report both rather than half the truth.
  s.counters.killsSinceBoss = 10;
  txt = E.bossGateText(s);
  assert.ok(/5 kills and 3 levels away/.test(txt), `want both gates, got: ${txt}`);

  // Level satisfied, kills pending.
  s.hero.level = zone.boss.level - 1;
  txt = E.bossGateText(s);
  assert.ok(/5 kills away/.test(txt) && !/level/.test(txt), `want the kill gate, got: ${txt}`);

  // Both satisfied — the next kill summons it, and the spawner agrees.
  s.counters.killsSinceBoss = B.BOSS_KILLS_REQUIRED;
  txt = E.bossGateText(s);
  assert.ok(/next kill/.test(txt), `want the ready line, got: ${txt}`);
  assert.ok(E.bossGate(s).ready);
});

test('upgrading raises stats, costs gold, and stops at the cap', () => {
  const s = fresh();
  s.hero.gold = 10_000_000;
  const it = { slot: 'chest', ilvl: 20, rarity: 'rare', atk: 0, def: 10, hp: 40, plus: 0 };
  s.equipment.chest = it;
  E.refreshMaxHp(s);

  assert.strictEqual(E.itemStat(it, 'def'), 10, '+0 is exactly what it rolled');
  const first = E.upgradeItem(s, it);
  assert.ok(first.ok);
  assert.strictEqual(it.plus, 1);
  assert.strictEqual(first.cost, B.upgradeCost(20, 0));
  assert.strictEqual(s.hero.gold, 10_000_000 - first.cost);
  assert.strictEqual(it.def, 10, 'the rolled stat is preserved, not overwritten');
  // A single +1 is deliberately a sub-integer change at 3% — it shows up in the
  // summed total, not in one slot's rounded display. What must hold is that the
  // raw contribution moved, so twelve slots of it are not silently discarded.
  assert.ok(E.itemStatRaw(it, 'def') > 10, 'the raw contribution rose');

  // Cost must escalate, or the sink has no appetite.
  for (let p = 1; p < B.UPGRADE_MAX; p++) {
    assert.ok(B.upgradeCost(20, p) > B.upgradeCost(20, p - 1), `+${p + 1} must cost more than +${p}`);
  }

  while (E.upgradeItem(s, it).ok) { /* to the cap */ }
  assert.strictEqual(it.plus, B.UPGRADE_MAX);
  assert.strictEqual(E.upgradeItem(s, it).why, 'maxed');
  assert.strictEqual(E.itemStat(it, 'def'), Math.round(10 * (1 + B.UPGRADE_STAT_PER_PLUS * B.UPGRADE_MAX)));
});

test('upgrading refuses rather than going into debt', () => {
  const s = fresh();
  const it = { slot: 'chest', ilvl: 40, rarity: 'rare', atk: 0, def: 10, hp: 40, plus: 0 };
  s.equipment.chest = it;
  s.hero.gold = B.upgradeCost(40, 0) - 1;
  const res = E.upgradeItem(s, it);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.why, 'gold');
  assert.strictEqual(it.plus, 0, 'nothing changed');
  assert.strictEqual(s.hero.gold, B.upgradeCost(40, 0) - 1, 'no gold moved');
});

test('the sink does not leak: sell price ignores upgrades', () => {
  // If a merchant paid for `plus`, every upgrade would be a 25%-refundable
  // deposit and gold would never actually leave the economy.
  const raw = { slot: 'chest', ilvl: 30, rarity: 'rare', atk: 0, def: 10, hp: 40, plus: 0 };
  const maxed = Object.assign({}, raw, { plus: B.UPGRADE_MAX });
  assert.strictEqual(E.sellPrice(maxed), E.sellPrice(raw), 'upgrades are worth nothing at resale');
  // …but they do count toward which item the hero would rather wear.
  assert.ok(E.itemValue(maxed) > E.itemValue(raw), 'upgrades count toward what you keep');
});

test('upgraded gear is not displaced by a raw drop of equal roll', () => {
  // The trap this guards: pour gold into a weapon, find an identical one, and
  // have auto-equip bench the upgraded copy because it ranks them the same.
  const s = fresh();
  const worn = { slot: 'weapon', ilvl: 20, rarity: 'rare', atk: 16, def: 0, hp: 0, plus: 6 };
  const drop = { slot: 'weapon', ilvl: 20, rarity: 'rare', atk: 16, def: 0, hp: 0, plus: 0 };
  s.equipment.weapon = worn;
  s.inventory = [drop];
  E.autoEquip(s, { displace: true });
  assert.strictEqual(s.equipment.weapon, worn, 'the invested weapon stayed on');
  assert.strictEqual(s.inventory[0], drop, 'the raw drop stayed in the bag');
});

// The nudge in `status` and the swap `equip best` performs are the same call
// against different state. If they ever disagree the game starts telling you to
// run a command that then does nothing, so this pins both halves: the preview
// must not touch the save, and it must predict the real run exactly.
test('previewAutoEquip predicts the real run without touching the state', () => {
  const s = fresh();
  s.equipment.weapon = { slot: 'weapon', ilvl: 3, rarity: 'common', atk: 2, def: 0, hp: 0, plus: 0 };
  s.inventory = [
    { slot: 'weapon', ilvl: 20, rarity: 'rare', atk: 16, def: 0, hp: 0, plus: 0 },
    { slot: 'neck', ilvl: 12, rarity: 'uncommon', atk: 2, def: 0, hp: 6, plus: 0 },
  ];
  E.refreshMaxHp(s);

  const before = JSON.stringify({ eq: s.equipment, inv: s.inventory, hero: s.hero });
  const predicted = E.previewAutoEquip(s, { displace: true });
  assert.strictEqual(JSON.stringify({ eq: s.equipment, inv: s.inventory, hero: s.hero }), before,
    'the preview mutated the state it was previewing');
  assert.strictEqual(predicted.length, 2, 'preview missed a slot the bag wins');

  const actual = E.autoEquip(s, { displace: true });
  assert.deepStrictEqual(
    actual.map(c => [c.key, c.item.ilvl, c.replaced ? c.replaced.ilvl : null]),
    predicted.map(c => [c.key, c.item.ilvl, c.replaced ? c.replaced.ilvl : null]),
    'the run diverged from what the preview promised');

  // Idempotent: having taken the advice, there is no advice left to give.
  assert.strictEqual(E.previewAutoEquip(s, { displace: true }).length, 0);
});

test('displaced gear goes to the bag, never to the void', () => {
  const s = fresh();
  const worn = { slot: 'chest', ilvl: 4, rarity: 'common', atk: 0, def: 1, hp: 4, plus: 0 };
  const better = { slot: 'chest', ilvl: 20, rarity: 'epic', atk: 0, def: 9, hp: 40, plus: 0 };
  s.equipment.chest = worn;
  s.inventory = [better];
  E.autoEquip(s, { displace: true });
  assert.strictEqual(s.equipment.chest, better);
  assert.ok(s.inventory.includes(worn), 'the displaced chestpiece was destroyed, not benched');
  assert.strictEqual(s.inventory.length, 1, 'bag count drifted across the swap');
});

test('promoting one ring into a full set is one change, not four', () => {
  // The winner used to take ring1 and shove the other three survivors down a
  // slot each. Same gear worn, but four "changes" reported for one real swap —
  // which now reads as a wrong count in the status nudge and three phantom
  // "replaced" lines in the equip best report.
  const s = fresh();
  const rings = [1, 2, 3, 4].map(n => ({ id: 'r' + n, slot: 'ring', ilvl: 5, rarity: 'common', atk: 1, def: 0, hp: 1, plus: 0 }));
  rings.forEach((r, i) => { s.equipment['ring' + (i + 1)] = r; });
  const prize = { id: 'prize', slot: 'ring', ilvl: 20, rarity: 'epic', atk: 8, def: 0, hp: 20, plus: 0 };
  s.inventory = [prize];
  E.refreshMaxHp(s);

  const changes = E.autoEquip(s, { displace: true });
  assert.strictEqual(changes.length, 1, `one ring arrived, ${changes.length} slots reported`);
  assert.strictEqual(changes[0].replaced.ilvl, 5, 'displaced something other than a worn ring');

  const worn = C.slotKeys('ring').map(k => s.equipment[k].id);
  assert.ok(worn.includes('prize'), 'the prize is not worn');
  assert.strictEqual(new Set(worn).size, 4, 'a ring got worn twice');
  assert.strictEqual(s.inventory.length, 1, 'exactly one ring should have been benched');
});

test('gearLag counts an empty slot as the zero gear it is', () => {
  const s = fresh();                       // grove, max 9 → trash tops out at 8
  assert.strictEqual(E.gearLag(s).target, 8);
  assert.strictEqual(E.gearLag(s).mean, 0, 'a naked hero is not at ilvl NaN');
  assert.ok(E.gearLag(s).ratio < E.GEAR_LAG_NUDGE, 'a naked hero should be nudged');

  // One perfect item in twelve slots is still eleven-twelfths naked, and the
  // mean has to say so — averaging over filled slots only would read 8/8.
  s.equipment.weapon = { slot: 'weapon', ilvl: 8, rarity: 'rare', atk: 12, def: 0, hp: 0, plus: 0 };
  assert.ok(E.gearLag(s).mean < 1, 'the mean ignored the eleven empty slots');

  for (const k of C.EQUIP_KEYS) s.equipment[k] = { slot: C.keySlot(k), ilvl: 8, rarity: 'rare', atk: 1, def: 1, hp: 1, plus: 0 };
  assert.strictEqual(E.gearLag(s).ratio, 1, 'a hero at the zone\'s level should sit at ratio 1');
});

// ---------- paragon ----------

test('xp at the cap banks into Insight instead of being discarded', () => {
  const s = fresh();
  s.hero.level = B.LEVEL_CAP;
  E.refreshMaxHp(s);

  E.addXp(s, B.INSIGHT_XP * 3 + 100, T0);
  const mult = C.classes[s.hero.class].xpMult || 1;
  const expected = Math.floor(Math.round((B.INSIGHT_XP * 3 + 100) * mult) / B.INSIGHT_XP);
  assert.strictEqual(s.hero.insight, expected, 'banked the wrong number of points');
  assert.strictEqual(s.hero.level, B.LEVEL_CAP, 'the cap moved');
  assert.strictEqual(s.hero.xp, 0, 'the xp bar should stay empty at the cap');
  assert.ok(s.hero.capXp < B.INSIGHT_XP, 'leftover xp should be under one point, not a whole one');
  assert.strictEqual(s.counters.insightEarned, s.hero.insight, 'lifetime counter drifted from the purse');
});

test('the xp that carries you past the cap is not rounded off the end', () => {
  // Levelling into 60 used to set hero.xp = 0 outright, so whatever overflowed
  // the last level-up simply vanished. It banks now.
  const s = fresh();
  s.hero.level = B.LEVEL_CAP - 1;
  s.hero.xp = 0;
  E.refreshMaxHp(s);
  E.addXp(s, B.xpToNext(B.LEVEL_CAP - 1) + B.INSIGHT_XP * 2, T0);
  assert.strictEqual(s.hero.level, B.LEVEL_CAP);
  assert.ok((s.hero.insight || 0) >= 2, `overflow was discarded (insight ${s.hero.insight || 0})`);
});

test('a pre-paragon save reads as zero everywhere rather than NaN', () => {
  // Same call as `plus`: no migration, the read paths default. Every save
  // written before this feature has no insight, capXp or paragon field at all.
  const s = fresh();
  delete s.hero.insight; delete s.hero.capXp; delete s.hero.paragon;
  delete s.counters.insightEarned;
  assert.strictEqual(E.paragonPoints(s, 'atk'), 0);
  assert.strictEqual(E.insightMult(s, 'atk'), 1);
  assert.ok(Number.isFinite(E.heroAtk(s)), 'heroAtk went non-finite on a legacy save');
  const atk = E.heroAtk(s);
  s.hero.level = B.LEVEL_CAP; E.refreshMaxHp(s);
  E.addXp(s, B.INSIGHT_XP, T0);
  assert.strictEqual(s.hero.insight, 1, 'a legacy save could not bank its first point');
  assert.strictEqual(s.counters.insightEarned, 1, 'a missing counter should start at zero, not NaN');
  s.hero.level = 1; E.refreshMaxHp(s);
  assert.strictEqual(E.heroAtk(s), atk, 'unspent insight changed ATK on its own');
});

test('insight buys exactly what the board advertises, and no more', () => {
  const s = fresh();
  s.hero.insight = 500;
  const base = E.heroAtk(s);

  // Cost curve: three points per price tier, so the first three cost 1 each.
  assert.deepStrictEqual([0, 1, 2, 3, 24].map(B.insightCost), [1, 1, 1, 2, 9]);

  const r = E.spendInsight(s, 'atk');
  assert.ok(r.ok);
  assert.strictEqual(s.hero.insight, 499, 'charged the wrong amount');
  assert.ok(Math.abs(E.heroAtk(s) / base - 1.02) < 1e-9, 'one atk point is not +2%');

  // Tracks cap. An unbounded multiplier eventually deletes the difficulty curve.
  while (E.spendInsight(s, 'atk').ok) { /* pour it all in */ }
  assert.strictEqual(E.paragonPoints(s, 'atk'), B.INSIGHT_TRACK_MAX);
  assert.strictEqual(E.spendInsight(s, 'atk').why, 'maxed');
  assert.ok(Math.abs(E.heroAtk(s) / base - 1.5) < 1e-9, 'a maxed atk track is not +50%');

  assert.strictEqual(E.spendInsight(s, 'nonsense').why, 'track');
});

test('spending insight you do not have changes nothing', () => {
  const s = fresh();
  s.hero.insight = 0;
  const r = E.spendInsight(s, 'gold');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.why, 'insight');
  assert.strictEqual(E.paragonPoints(s, 'gold'), 0, 'a refused purchase still moved the track');
  assert.strictEqual(s.hero.insight, 0);
});

test('items missing `plus` behave as +0 everywhere', () => {
  // Every save written before upgrades existed has no `plus` field at all, and
  // there is no migration for it — the read paths default instead.
  const legacy = { slot: 'chest', ilvl: 12, rarity: 'rare', atk: 0, def: 4, hp: 20 };
  assert.strictEqual(E.itemStat(legacy, 'def'), 4);
  assert.strictEqual(B.plusMult(undefined), 1);
  assert.strictEqual(E.itemValue(legacy), E.sellPrice(legacy) / B.SELL_FRAC);
  const s = fresh();
  s.equipment.chest = legacy;
  E.refreshMaxHp(s);
  assert.strictEqual(E.heroDef(s), 4, 'a legacy item still contributes its stats');
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

test('a corrupt gear stat cannot NaN the hero into a permanent death spiral', () => {
  // A hand-edited or half-migrated save can carry a non-numeric stat. That used
  // to multiply to NaN, poison maxHp, and pin hp at NaN — and because NaN > 0 is
  // false, every later hit re-ran the death branch, draining gold with no way
  // back short of editing the save by hand.
  const s = E.newState('knight', 'Corrupt', T0);
  s.equipment.weapon = { name: 'Bad', slot: 'weapon', atk: 'notanumber', def: 0, hp: 0, plus: 'x' };
  E.refreshMaxHp(s);
  assert.ok(Number.isFinite(s.hero.maxHp) && s.hero.maxHp > 0, `maxHp ${s.hero.maxHp}`);
  assert.ok(Number.isFinite(s.hero.hp) && s.hero.hp > 0, `hp ${s.hero.hp}`);
  assert.ok(Number.isFinite(E.heroAtk(s)), 'atk stays finite');
  assert.ok(Number.isFinite(E.heroDef(s)), 'def stays finite');

  // and a corrupt paragon track must not NaN damage either
  s.hero.paragon = { atk: 'lots' };
  assert.ok(Number.isFinite(E.heroAtk(s)), 'atk finite with corrupt paragon');

  const deathsBefore = Number(s.hero.deaths) || 0;
  for (let i = 0; i < 5; i++) E.hurtHero(s, 1, T0 + i * 1000);
  const died = (Number(s.hero.deaths) || 0) - deathsBefore;
  assert.ok(died <= 1, `death spiral: ${died} deaths from 5 chip hits`);
  assert.ok(Number.isFinite(s.hero.hp) && s.hero.hp > 0, `hp survived chip damage: ${s.hero.hp}`);
});

// A kill replaces state.monster on the spot, but the animations describing that
// kill play *after* the swap — so they have to carry the monster they are about.
// Without this the HUD ran the scene out of order: the killing blow landed on
// the monster that had already replaced the target, then a death played for one
// that was no longer on screen, then the new one came back.
test('the kill animation carries the monster that died, not its replacement', () => {
  const s = fresh('knight');
  s.monster.hp = 1;
  const doomed = { id: s.monster.id, name: s.monster.name, level: s.monster.level };
  E.fold(s, [ev('commit', T0 + 1000)], T0 + 1000);

  assert.strictEqual(s.counters.kills, 1, 'the commit killed it');
  const kill = s.anim.find(a => a.type === 'kill');
  assert.ok(kill, 'a kill animation was queued');
  assert.ok(kill.data.mon, 'the kill animation carries its monster');
  assert.strictEqual(kill.data.mon.id, doomed.id);
  assert.strictEqual(kill.data.mon.name, doomed.name);
  assert.strictEqual(kill.data.mon.level, doomed.level);
  assert.strictEqual(kill.data.mon.hp, 0, 'and it is drawn dead');

  // The blow that landed it is queued *ahead* of the kill and is about the same
  // monster — this is the frame the bug was actually visible in.
  const blow = s.anim.find(a => a.type === 'hit');
  assert.ok(blow, 'the killing blow was queued');
  assert.ok(blow.at < kill.at, 'and plays before the death');
  assert.strictEqual(blow.data.mon && blow.data.mon.id, doomed.id,
    'the killing blow is tagged with the monster it killed');
});

test('a non-fatal hit is not tagged with a monster', () => {
  // Only the kill needs the copy; tagging every hit would bloat every save.
  const s = fresh('knight');
  s.monster.hp = 10_000;
  E.fold(s, [ev('attack_jab', T0 + 1000)], T0 + 1000);
  const blow = s.anim.find(a => a.type === 'hit');
  assert.ok(blow, 'a hit was queued');
  assert.strictEqual(blow.data.mon, undefined);
  assert.strictEqual(s.counters.kills, 0);
});

// ---------- automatic travel ----------

test('travel is automatic once the next zone is unlocked and its floor is met', () => {
  const s = fresh();
  s.hero.unlockedZones.push('caves');
  s.hero.level = C.zoneById('caves').min;
  E.fold(s, [], T0 + 1000);
  assert.strictEqual(s.hero.zone, 'caves');
  assert.ok(s.anim.some(a => a.type === 'travel'), 'the HUD is told about it');
});

test('clearing a boss unlocks the next zone but does not move an under-levelled hero', () => {
  // The shape of a real first clear: the boss gate opens at `boss.level - 1`
  // and the next zone starts one level above the boss, so you are always two
  // levels short of the place you just unlocked.
  const s = fresh('knight');
  const caves = C.zoneById('caves');
  s.hero.level = C.zoneById('grove').boss.level - 1;
  s.counters.killsSinceBoss = B.BOSS_KILLS_REQUIRED;
  E.spawnMonster(s, () => 0.5);
  assert.ok(s.monster.isBoss, 'the boss is up');

  s.monster.hp = 1;
  E.fold(s, [ev('commit', T0 + 1000)], T0 + 1000);
  assert.strictEqual(s.counters.bossKills, 1);
  assert.ok(s.hero.unlockedZones.includes('caves'), 'the next zone unlocked');
  assert.ok(s.hero.level < caves.min, 'and the hero is below its floor');
  assert.strictEqual(s.hero.zone, 'grove', 'so they stay put rather than being dropped in under-levelled');
});

test('travel never walks the hero out of a boss fight', () => {
  // Getting here means the zone is already cleared, so this is a re-armed boss
  // the hero chose to fight — the one case where automatic travel could cost
  // somebody something.
  const s = fresh();
  s.hero.unlockedZones.push('caves');
  s.hero.level = C.zoneById('caves').min;
  s.monster = { id: 'treant', name: 'Rootfang', level: 9, isBoss: true, sprite: '(T)', hp: 400, maxHp: 1200 };
  E.fold(s, [], T0 + 1000);
  assert.strictEqual(s.hero.zone, 'grove', 'still in the fight');

  // …and goes as soon as that fight is over.
  s.monster.isBoss = false;
  E.fold(s, [], T0 + 2000);
  assert.strictEqual(s.hero.zone, 'caves');
});

test('travel does not fire into a zone that is still locked', () => {
  const s = fresh();
  s.hero.level = 40;
  E.fold(s, [], T0 + 1000);
  assert.strictEqual(s.hero.zone, 'grove');
});

test('travel resets the boss counter, so a new zone starts at its floor', () => {
  // `killsSinceBoss` is one global counter meaning "kills toward the boss of
  // the zone I am in", and `monsterLevel` reads it to escalate trash across the
  // band. Carried across a border it would spawn an unseen zone's *top* tier on
  // the first step — the cliff the escalation curve exists to remove.
  const s = fresh();
  s.hero.unlockedZones.push('caves');
  s.hero.level = C.zoneById('caves').min;
  s.counters.killsSinceBoss = B.BOSS_KILLS_REQUIRED - 1;
  E.fold(s, [], T0 + 1000);
  assert.strictEqual(s.hero.zone, 'caves');
  assert.strictEqual(s.counters.killsSinceBoss, 0);
  assert.ok(s.monster.level <= C.zoneById('caves').min + 1,
    `arrived against bottom-tier trash, got Lv${s.monster.level}`);
});

test('typed travel and automatic travel are the same operation', () => {
  // `/hero zone go` used to set `hero.zone` and respawn by hand, so the two
  // paths could drift — and did, on the boss counter.
  const s = fresh();
  s.hero.unlockedZones.push('caves');
  s.counters.killsSinceBoss = 9;
  assert.strictEqual(E.travelTo(s, 'caves', () => 0.5, T0), true);
  assert.strictEqual(s.hero.zone, 'caves');
  assert.strictEqual(s.counters.killsSinceBoss, 0);
  assert.strictEqual(E.travelTo(s, 'caves', () => 0.5, T0), false, 'travelling where you already are is a no-op');
});

// ---------- the loot goblin ----------
//
// A sub-boss that turns up in place of trash. The three things that can go
// wrong with it are all invisible in normal play: it can pre-empt a boss, it
// can quietly stretch the boss cycle, and it can hand a low-level hero gear
// from a zone they have never seen. One test each.

const { mulberry32 } = require('../lib/rng');

// The spawn roll reads B.GOBLIN_CHANCE at call time, so pinning it to 0 or 1
// makes "a goblin appeared" a fact rather than a 1-in-20 flake.
function goblinState(chance) {
  const s = fresh();
  s.hero.level = 9;
  const saved = B.GOBLIN_CHANCE;
  B.GOBLIN_CHANCE = chance;
  return { s, restore: () => { B.GOBLIN_CHANCE = saved; } };
}

test('a ready boss always beats the goblin roll', () => {
  const { s, restore } = goblinState(1);            // goblin on every spawn…
  try {
    const zone = C.zoneById(s.hero.zone);
    s.hero.level = zone.boss.level - 1;
    s.counters.killsSinceBoss = B.BOSS_KILLS_REQUIRED;
    E.spawnMonster(s, mulberry32(1));
    assert.ok(s.monster.isBoss, 'the goblin pre-empted a ready boss');
    assert.ok(!s.monster.isGoblin);
  } finally { restore(); }
});

test('the goblin consumes the same rand() calls as the trash it replaces', () => {
  // The fold has to replay identically whether or not a goblin turned up, so
  // the two branches must draw the same number of rolls off the stream.
  // Sequential, not both-then-spawn: the two helpers share one global knob.
  const spawnWith = (chance) => {
    const { s, restore } = goblinState(chance);
    try { E.spawnMonster(s, mulberry32(99)); return s.monster; } finally { restore(); }
  };
  const goblin = spawnWith(1);
  const trash = spawnWith(0);
  assert.ok(goblin.isGoblin, 'chance 1 did not produce a goblin');
  assert.ok(!trash.isGoblin, 'chance 0 produced a goblin');
  assert.strictEqual(goblin.level, trash.level, 'the goblin shifted the level roll');
  assert.strictEqual(goblin.maxHp, trash.maxHp * B.GOBLIN_HP_MULT, 'the goblin shifted the hp roll');
});

// Kill whatever is standing, through the public combat path rather than an
// exported internal — a goblin that only dies when a test reaches into the
// engine is a goblin no player ever kills.
function slay(s, seed, now) {
  s.monster.hp = 1;
  E.dealDamage(s, 50, {}, mulberry32(seed), now || T0);
}
function standUpGoblin(s) {
  s.monster = {
    id: C.GOBLIN.id, name: C.GOBLIN.name, level: 5, isBoss: false, isGoblin: true,
    sprite: C.GOBLIN.sprite, maxHp: 10, hp: 10,
  };
}

test('killing a goblin credits the boss cycle for the time it took', () => {
  // Crediting one kill for a x3-HP fight is a 14% cut to boss cadence — the
  // sim measured it. It has to pay back what it cost.
  const { s, restore } = goblinState(0);
  try {
    standUpGoblin(s);
    const before = s.counters.killsSinceBoss;
    slay(s, 3);
    assert.strictEqual(s.counters.killsSinceBoss - before, B.GOBLIN_HP_MULT,
      'the goblin did not pay back the boss progress it consumed');
    assert.strictEqual(s.counters.goblinKills, 1);
  } finally { restore(); }
});

test('the goblin pays exactly one of its two arms, never both', () => {
  const { s, restore } = goblinState(0);
  try {
    let epicArms = 0, goldArms = 0;
    for (let i = 0; i < 40; i++) {
      standUpGoblin(s);
      s.anim.length = 0;
      slay(s, i, T0 + i * 100000);
      const payout = s.anim.filter(a => a.type === 'goblinloot');
      assert.strictEqual(payout.length, 1, `roll ${i}: expected exactly one payout`);
      const d = payout[0].data;
      // The gold arm names no item; the epic arm names one and reports whether
      // the drop filter sold it. Both at once would make the second the
      // expected outcome instead of a coin-flip.
      if (d.item) { epicArms++; assert.ok(d.vendored || d.gold == null, `roll ${i}: paid both arms`); }
      else { goldArms++; assert.ok(d.gold > 0, `roll ${i}: gold arm paid nothing`); }
    }
    assert.ok(epicArms > 0 && goldArms > 0,
      `40 goblins produced ${epicArms} epic and ${goldArms} gold arms — one arm is unreachable`);
  } finally { restore(); }
});

test("a goblin's epic rolls at its own level, not the hero's ceiling", () => {
  // The dangerous version of this feature hands a level-8 Grove hero Null
  // Expanse gear. The prize is a *rarity* windfall, never an ilvl one.
  const { s, restore } = goblinState(0);
  try {
    const zone = C.zoneById(s.hero.zone);
    const item = E.rollLoot(s, 5, { guaranteed: true, floorEpic: true, from: 'goblin:test' }, mulberry32(11), T0);
    assert.ok(item, 'the guaranteed prize produced nothing');
    assert.strictEqual(item.ilvl, 5, 'the prize rolled off a level other than the goblin\'s');
    assert.ok(item.ilvl <= zone.max, 'the prize out-scaled the zone');
    const idx = B.RARITIES.findIndex(r => r.id === item.rarity);
    assert.ok(idx >= B.GOBLIN_RARITY_FLOOR, `prize rolled ${item.rarity}, below the epic floor`);
  } finally { restore(); }
});

test('the goblin hits harder than trash and softer than a boss', () => {
  assert.ok(B.GOBLIN_RETALIATE_CHANCE > B.RETALIATE_CHANCE
    && B.GOBLIN_RETALIATE_CHANCE < B.RETALIATE_CHANCE_BOSS, 'retaliate chance is out of band');
  assert.ok(B.GOBLIN_RETALIATE_MULT > B.RETALIATE_MULT
    && B.GOBLIN_RETALIATE_MULT < B.RETALIATE_MULT_BOSS, 'retaliate damage is out of band');
  assert.ok(B.GOBLIN_HP_MULT < 10, 'the goblin is as tanky as a boss');
});

// ---------- the goblin runs ----------
//
// The deadline is counted in folded events, never in wall-clock, so that a
// replay of the same events lands where the live run did. These pin that, and
// the off-by-one that would let a freshly spawned goblin inherit the previous
// monster's spent patience.

function feed(s, n, at) {
  const evs = Array.from({ length: n }, (_, i) => ({ t: (at || T0) + i * 1000, e: 'rest', m: {} }));
  E.fold(s, evs, (at || T0) + n * 1000);
}

test('the goblin leaves after GOBLIN_FLEE_EVENTS events, not before', () => {
  const { s, restore } = goblinState(0);
  try {
    standUpGoblin(s);
    s.monster.patience = B.GOBLIN_FLEE_EVENTS;
    // `rest` deals no damage, so the only thing that can end this fight is the
    // deadline — which is exactly what is under test.
    feed(s, B.GOBLIN_FLEE_EVENTS - 1);
    assert.ok(s.monster.isGoblin, `it left after ${B.GOBLIN_FLEE_EVENTS - 1} events`);
    assert.strictEqual(s.counters.goblinFled || 0, 0);

    feed(s, 1, T0 + 100000);
    assert.ok(!s.monster.isGoblin, 'it was still there past its deadline');
    assert.strictEqual(s.counters.goblinFled, 1);
  } finally { restore(); }
});

test('a fled goblin still credits the boss cycle for the time it ate', () => {
  // Otherwise a goblin that gets away is strictly worse than the trash mob it
  // displaced, which is the boss-delay tax this whole feature avoids.
  const { s, restore } = goblinState(0);
  try {
    standUpGoblin(s);
    s.monster.patience = 1;
    const before = s.counters.killsSinceBoss;
    feed(s, 1);
    assert.strictEqual(s.counters.goblinFled, 1, 'it did not flee');
    assert.strictEqual(s.counters.killsSinceBoss - before, B.GOBLIN_HP_MULT,
      'a fled goblin taxed the boss cycle');
  } finally { restore(); }
});

test('fleeing pays nothing — the prize is the whole penalty', () => {
  const { s, restore } = goblinState(0);
  try {
    standUpGoblin(s);
    s.monster.patience = 1;
    const gold = s.hero.gold, bag = s.inventory.length;
    feed(s, 1);
    assert.strictEqual(s.hero.gold, gold, 'a fled goblin paid out gold');
    assert.strictEqual(s.inventory.length, bag, 'a fled goblin dropped an item');
    assert.ok(s.anim.some(a => a.type === 'goblinflee'), 'the escape drew nothing');
    assert.ok(!s.anim.some(a => a.type === 'goblinloot'), 'it paid out on the way out');
  } finally { restore(); }
});

test('a kill inside the deadline still pays', () => {
  const { s, restore } = goblinState(0);
  try {
    standUpGoblin(s);
    s.monster.patience = B.GOBLIN_FLEE_EVENTS;
    slay(s, 7);
    assert.strictEqual(s.counters.goblinKills, 1, 'the kill did not register');
    assert.strictEqual(s.counters.goblinFled || 0, 0, 'a killed goblin also fled');
    assert.ok(s.anim.some(a => a.type === 'goblinloot'), 'a kill inside the deadline paid nothing');
  } finally { restore(); }
});

test('a goblin that spawns mid-fold starts with full patience', () => {
  // dealDamage can kill and respawn inside one event, swapping state.monster
  // underneath the fold loop. Billing that event to the newcomer would start
  // every mid-fold goblin a tick short — and with GOBLIN_CHANCE at 1, every
  // spawn here is a goblin, so the newcomer is always one.
  const { s, restore } = goblinState(1);
  try {
    E.spawnMonster(s, mulberry32(5));
    assert.ok(s.monster.isGoblin);
    s.monster.hp = 1;
    const doomed = s.monster;
    E.fold(s, [{ t: T0, e: 'attack_build', m: {} }], T0);
    assert.notStrictEqual(s.monster, doomed, 'the killing blow did not respawn');
    assert.strictEqual(s.monster.patience, B.GOBLIN_FLEE_EVENTS,
      'the replacement was billed for the event that killed its predecessor');
  } finally { restore(); }
});

test('an old save with no patience field does not flee instantly', () => {
  // `patience` is new. A goblin mid-fight in a save written before this landed
  // has no such field, and `undefined - 1` is NaN, which is not > 0.
  const { s, restore } = goblinState(0);
  try {
    standUpGoblin(s);
    delete s.monster.patience;
    feed(s, 1);
    assert.ok(s.monster.isGoblin, 'a pre-flee save lost its goblin on the first event');
    assert.strictEqual(s.monster.patience, B.GOBLIN_FLEE_EVENTS - 1,
      'the missing field did not default');
  } finally { restore(); }
});

// ---------- the goblin does not wait behind a closed laptop ----------
//
// Away kills are the away window's unit of work, so they spend a goblin's
// patience the way folded events do. Without this, closing the lid mid-goblin
// froze the deadline and "get it before it runs" stopped being true the moment
// you stopped looking.

function awayFor(s, hours) {
  const now = T0 + hours * 3600000;
  s.lastTickAt = T0;
  E.fold(s, [], now);
  return now;
}

test('a long absence loses the goblin, and the summary says so', () => {
  const { s, restore } = goblinState(0);
  try {
    standUpGoblin(s);
    s.monster.patience = B.GOBLIN_FLEE_EVENTS;
    awayFor(s, B.OFFLINE_MAX_HOURS);

    assert.strictEqual(s.counters.goblinFled, 1, 'it waited out the whole absence');
    assert.ok(!s.monster.isGoblin, 'it is somehow still standing there');
    const idle = s.anim.find(a => a.type === 'idle');
    assert.ok(idle, 'no away summary was drawn');
    assert.strictEqual(idle.data.goblinFled, 1, 'the summary did not mention the escape');
    // One piece of news, not two: nobody was here to watch either happen.
    assert.ok(!s.anim.some(a => a.type === 'goblinflee'),
      'the escape drew its own banner on top of the away summary');
  } finally { restore(); }
});

test('a short absence costs patience but not the goblin', () => {
  const { s, restore } = goblinState(0);
  try {
    standUpGoblin(s);
    s.monster.patience = B.GOBLIN_FLEE_EVENTS;
    awayFor(s, 1);

    assert.ok(s.monster.isGoblin, 'an hour away lost the goblin outright');
    assert.ok(s.monster.patience < B.GOBLIN_FLEE_EVENTS, 'the hour cost it nothing');
    assert.strictEqual(s.counters.goblinFled || 0, 0);
    const idle = s.anim.find(a => a.type === 'idle');
    assert.strictEqual(idle && idle.data.goblinFled, 0, 'the summary cried wolf');
  } finally { restore(); }
});

test('an away escape grants no boss progress, matching the away window', () => {
  // OFFLINE_REWARD_FRAC is documented as "no loot, no boss progress". A goblin
  // fleeing inside that window has nothing to pay back, so crediting it would
  // hand out progress the window is defined not to give.
  const { s, restore } = goblinState(0);
  try {
    standUpGoblin(s);
    s.monster.patience = 1;
    const before = s.counters.killsSinceBoss;
    awayFor(s, B.OFFLINE_MAX_HOURS);
    assert.strictEqual(s.counters.goblinFled, 1);
    assert.strictEqual(s.counters.killsSinceBoss, before,
      'an away escape smuggled boss progress out of an away window');
  } finally { restore(); }
});

test('a trash monster is untouched by the away window', () => {
  const { s, restore } = goblinState(0);
  try {
    const before = s.monster;
    awayFor(s, B.OFFLINE_MAX_HOURS);
    assert.strictEqual(s.monster, before, 'the away window respawned a live monster');
    assert.strictEqual(s.counters.goblinFled || 0, 0);
  } finally { restore(); }
});

// ---------- the sitting ----------
//
// The property that matters is that the sitting and the lifetime counters can
// never disagree, because the sitting is a delta rather than a second tally.
// So the tests are about the *boundary*: when a sitting ends, what it keeps,
// and what the away window is allowed to put in it.

test('a fresh hero opens a sitting at zero', () => {
  const s = fresh();
  const sess = E.sessionStats(s, T0);
  assert.ok(sess, 'newState left no sitting to report');
  assert.strictEqual(sess.kills, 0);
  assert.strictEqual(sess.ms, 0);
  assert.strictEqual(sess.fromLevel, 1);
  assert.ok(E.sessionIsQuiet(sess), 'a hero who has done nothing is not quiet');
});

test('the sitting tracks the lifetime counters exactly, as a delta', () => {
  const s = fresh();
  s.counters.kills = 40;
  s.counters.commits = 9;
  s.counters.goldEarned = 500;
  E.openSession(s, T0);                      // baseline taken here
  s.counters.kills += 3;
  s.counters.commits += 1;
  s.counters.goldEarned += 120;

  const sess = E.sessionStats(s, T0 + 60_000);
  assert.strictEqual(sess.kills, 3);
  assert.strictEqual(sess.commits, 1);
  assert.strictEqual(sess.goldEarned, 120);
  assert.strictEqual(sess.ms, 60_000);
  assert.ok(!E.sessionIsQuiet(sess));
  // and the lifetime totals are untouched by any of it
  assert.strictEqual(s.counters.kills, 43);
});

test('a sitting reports levels gained, which hero.xp cannot', () => {
  const s = fresh();
  E.openSession(s, T0);
  E.addXp(s, B.xpToNext(1) + B.xpToNext(2), T0);
  const sess = E.sessionStats(s, T0);
  assert.strictEqual(sess.fromLevel, 1);
  assert.ok(sess.levels >= 2, `want 2+ levels, got ${sess.levels}`);
  assert.ok(sess.xpEarned > 0, 'xp earned was not counted');
  assert.ok(!E.sessionIsQuiet(sess));
});

test('a hand-edited save cannot make a sitting run backwards', () => {
  const s = fresh();
  s.counters.kills = 50;
  E.openSession(s, T0);
  s.counters.kills = 10;                     // someone edited state.json
  assert.strictEqual(E.sessionStats(s, T0).kills, 0);
});

test('an away gap closes the sitting and opens a new one', () => {
  const s = fresh();
  s.counters.kills = 12;
  s.counters.commits = 4;
  E.openSession(s, T0);
  s.counters.kills += 30;
  s.counters.commits += 6;
  s.lastTickAt = T0 + 3600_000;              // an hour of work

  const back = s.lastTickAt + 5 * 3600_000;  // then five hours away
  E.fold(s, [], back);

  const last = s.lastSession;
  assert.ok(last, 'the away gap threw the sitting away instead of keeping it');
  assert.strictEqual(last.kills, 30);
  assert.strictEqual(last.commits, 6);
  assert.strictEqual(last.ms, 3600_000, 'the sitting was billed for the absence');
  assert.strictEqual(last.endedAt, T0 + 3600_000,
    'the sitting ended when you came back rather than when you left');

  const now = E.sessionStats(s, back);
  assert.strictEqual(now.startedAt, back);
  assert.strictEqual(now.commits, 0, 'the new sitting inherited the old one');
});

test('the away window\'s take lands in neither sitting', () => {
  // It is reported by the away summary and it is not keyboard work, so charging
  // it to the sitting on either side of the gap would overstate that one.
  const s = fresh();
  E.openSession(s, T0);
  s.lastTickAt = T0 + 60_000;
  const back = s.lastTickAt + 4 * 3600_000;
  E.fold(s, [], back);

  const awayKills = Math.floor(4 * B.OFFLINE_KILLS_PER_HOUR);
  assert.ok(awayKills > 0, 'the fixture granted no away progress to misplace');
  assert.strictEqual(s.counters.kills, awayKills, 'the away window paid nothing');
  assert.strictEqual(s.lastSession.kills, 0, 'the closed sitting was paid for the absence');
  assert.strictEqual(E.sessionStats(s, back).kills, 0, 'the new sitting was paid for the absence');
});

test('a short gap leaves the sitting alone', () => {
  const s = fresh();
  E.openSession(s, T0);
  s.counters.kills += 5;
  s.lastTickAt = T0 + 60_000;
  E.fold(s, [], s.lastTickAt + B.OFFLINE_MIN_GAP_MS - 1000);
  assert.strictEqual(s.lastSession, undefined, 'a coffee break ended the sitting');
  assert.strictEqual(E.sessionStats(s, T0).kills, 5);
});

test('a save from before sittings existed grows one on its next fold', () => {
  // The field is pure derived bookkeeping — there is nothing in an old save to
  // migrate *from*, so the fold opens one rather than the loader inventing one.
  const s = fresh();
  delete s.session;
  assert.strictEqual(E.sessionStats(s, T0), null, 'a missing sitting reported fabricated zeroes');
  E.fold(s, [], T0 + 61_000);
  assert.ok(E.sessionStats(s, T0 + 61_000), 'the fold left the old save without a sitting');
});

// ---------- the end of the game ----------
//
// Until `finalBossDown` existed, killing The Root Cause drew the same banner as
// the fifth Rootfang: `nextZone('prod')` is null, so the unlock line was skipped
// and the generic `bossdown` played. These pin the difference.

// A hero standing in the last zone with its boss up and one hit left in it.
function atTheEnd(mutate) {
  const s = fresh();
  const last = C.zones[C.zones.length - 1];
  s.hero.level = B.LEVEL_CAP;
  s.hero.zone = last.id;
  s.hero.unlockedZones = C.zones.map(z => z.id);
  E.refreshMaxHp(s);
  s.counters.killsSinceBoss = B.BOSS_KILLS_REQUIRED;
  E.spawnMonster(s, () => 0.5);
  assert.ok(s.monster.isBoss, 'the last zone did not put its boss up');
  assert.strictEqual(C.nextZone(s.hero.zone), null, 'this is not the last zone');
  if (mutate) mutate(s);
  return { s, last };
}

test('beating the last boss is an ending, not another bossdown', () => {
  const { s, last } = atTheEnd();
  const boss = s.monster;
  E.resolveKill(s, {}, () => 0.5, T0 + 1000);

  assert.strictEqual(s.counters.finalBossKills, 1);
  assert.strictEqual(s.hero.clearedAt, T0 + 1000, 'the clear was not dated');

  const banner = s.anim.find(a => a.type === 'cleared');
  assert.ok(banner, 'the end of the game drew no banner of its own');
  assert.strictEqual(banner.data.name, boss.name);
  assert.strictEqual(banner.data.clears, 1);
  assert.ok(!s.anim.some(a => a.type === 'bossdown'),
    'the ending drew the ordinary boss banner as well');
  assert.ok(banner.data.mon && banner.data.mon.hp === 0,
    'the banner carries no corpse, so the scene would flip to a live monster under it');

  // …and the trophy is the zone's named legendary, not whatever the table rolled.
  const trophy = s.inventory.find(i => i.name === last.legendary);
  assert.ok(trophy, `no ${last.legendary} in the bag after the clear`);
  assert.strictEqual(trophy.rarity, 'legendary');
});

test('the trophy survives a hero already wearing better', () => {
  // At level 60 with a +10 set on, the drop filter would vendor the Postmortem
  // at the door. Selling someone their own trophy under the credits is the one
  // frame this branch exists to prevent.
  const { s, last } = atTheEnd(st => {
    for (const k of C.EQUIP_KEYS) {
      st.equipment[k] = { id: 'god-' + k, slot: C.keySlot(k), name: 'Godly ' + k,
        rarity: 'legendary', ilvl: 999, atk: 9999, def: 9999, hp: 9999, plus: 10 };
    }
    E.refreshMaxHp(st);
  });
  E.resolveKill(s, {}, () => 0.5, T0 + 1000);

  assert.ok(s.inventory.some(i => i.name === last.legendary),
    'the drop filter vendored the trophy');
  assert.ok(!/vendored/.test((s.ticker || []).join(' ')), 'the trophy was sold on the spot');
});

test('a second clear is a victory lap, not a second ending', () => {
  const { s } = atTheEnd();
  E.resolveKill(s, {}, () => 0.5, T0 + 1000);
  const clearedAt = s.hero.clearedAt;

  s.counters.killsSinceBoss = B.BOSS_KILLS_REQUIRED;
  E.spawnMonster(s, () => 0.5);
  assert.ok(s.monster.isBoss, 'the last boss did not come back to be farmed');
  s.anim = [];
  E.resolveKill(s, {}, () => 0.5, T0 + 2000);

  assert.strictEqual(s.counters.finalBossKills, 2);
  assert.strictEqual(s.hero.clearedAt, clearedAt, 'the second clear re-dated the first');
  assert.ok(!s.anim.some(a => a.type === 'cleared'), 'the ending played twice');
  const down = s.anim.find(a => a.type === 'bossdown');
  assert.ok(down, 'a repeat clear drew no banner at all');
  assert.strictEqual(down.data.clears, 2);
});

test('the ending does not skip the xp, the gold or the next monster', () => {
  // finalBossDown returns into resolveKill rather than out of it — an early
  // return here would have silently dropped the kill's xp and left no monster up.
  const { s } = atTheEnd();
  const xp = s.counters.xpEarned, gold = s.hero.gold, kills = s.counters.kills;
  E.resolveKill(s, {}, () => 0.5, T0 + 1000);

  assert.ok(s.counters.xpEarned > xp, 'the last kill paid no xp');
  assert.ok(s.hero.gold > gold, 'the last kill paid no gold');
  assert.strictEqual(s.counters.kills, kills + 1);
  assert.strictEqual(s.counters.bossKills, 1);
  assert.ok(s.monster && s.monster.hp > 0, 'nothing spawned after the final boss');
});

test('an ordinary boss still unlocks the next zone, unchanged', () => {
  const s = fresh();
  s.hero.level = 9;
  E.refreshMaxHp(s);
  s.counters.killsSinceBoss = B.BOSS_KILLS_REQUIRED;
  E.spawnMonster(s, () => 0.5);
  E.resolveKill(s, {}, () => 0.5, T0 + 1000);

  const down = s.anim.find(a => a.type === 'bossdown');
  assert.ok(down && down.data.unlocked, 'the unlock line went missing');
  assert.ok(s.hero.unlockedZones.includes(C.nextZone('grove').id));
  assert.strictEqual(s.hero.clearedAt, undefined, 'an ordinary boss ended the game');
  assert.strictEqual(s.counters.finalBossKills, undefined);
});

test('floorLegendary outranks the floors below it', () => {
  const s = fresh();
  const zone = C.zoneById(s.hero.zone);
  // rand() at 0 picks the first rarity in the table; the floor has to lift it.
  const item = E.rollLoot(s, 5, { guaranteed: true, floorLegendary: true, floorRare: true }, () => 0, T0);
  assert.strictEqual(item.rarity, 'legendary');
  assert.strictEqual(item.name, zone.legendary);
});
