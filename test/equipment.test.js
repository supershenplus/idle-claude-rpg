'use strict';
// The slot layout is data (content.SLOT_TYPES) that three other modules read:
// balance rolls stats per slot, engine sums worn gear and picks drop slots, and
// the CLI equips into slot *instances* (ring1…ring4). Adding a slot without its
// stat profile, or a noun that no slot claims, breaks quietly — a drop simply
// rolls someone else's stats. These tests keep the four in step, and pin the
// v1→v2 save migration, which is the one piece that can lose a player's gear.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-equip-test-'));
process.env.IDLE_RPG_HOME = HOME;

const C = require('../lib/content');
const B = require('../lib/balance');
const E = require('../lib/engine');
const S = require('../lib/state');
const { mulberry32 } = require('../lib/rng');

const T0 = 1_700_000_000_000;

test('every slot type has a stat profile and unique nouns', () => {
  const seen = new Map();
  for (const s of C.SLOT_TYPES) {
    assert.ok(B.SLOT_STATS[s.id], `${s.id}: no stat profile in balance.SLOT_STATS`);
    assert.ok(s.nouns.length > 0, `${s.id}: no nouns to name drops with`);
    assert.ok(s.count >= 1, `${s.id}: count must be at least 1`);
    for (const n of s.nouns) {
      assert.ok(!seen.has(n), `noun "${n}" claimed by both ${seen.get(n)} and ${s.id}`);
      seen.set(n, s.id);
      assert.strictEqual(C.slotFromNoun(`Runed Grove ${n}`), s.id, `"${n}" does not map back to ${s.id}`);
    }
  }
});

test("a slot's primary stat never rounds away", () => {
  for (const s of C.SLOT_TYPES) {
    const st = B.itemStats(s.id, 1, 1);              // the weakest item possible
    const primary = B.SLOT_STATS[s.id].primary;
    assert.ok(st[primary] >= 1, `${s.id}: ${primary} rounded to ${st[primary]}`);
  }
});

test('equipment keys cover every slot instance, four of them rings', () => {
  assert.deepStrictEqual(C.slotKeys('ring'), ['ring1', 'ring2', 'ring3', 'ring4']);
  assert.deepStrictEqual(C.slotKeys('chest'), ['chest']);
  assert.strictEqual(C.keySlot('ring3'), 'ring');
  const empty = C.emptyEquipment();
  assert.deepStrictEqual(Object.keys(empty), C.EQUIP_KEYS);
  assert.ok(Object.values(empty).every(v => v === null));
});

test('worn gear from every slot counts toward hero stats', () => {
  const s = E.newState('knight', 'Statue', T0);
  const before = { atk: E.heroAtk(s), def: E.heroDef(s), hp: E.heroMaxHp(s) };
  for (const key of C.EQUIP_KEYS) {
    s.equipment[key] = { id: key, slot: C.keySlot(key), name: key, rarity: 'common', ilvl: 1, atk: 1, def: 1, hp: 1 };
  }
  const n = C.EQUIP_KEYS.length;
  assert.strictEqual(E.heroAtk(s) - before.atk, n, 'atk missed a slot');
  assert.strictEqual(E.heroDef(s) - before.def, n, 'def missed a slot');
  assert.strictEqual(E.heroMaxHp(s) - before.hp, n, 'hp missed a slot');
});

test('drops land in real slots, and rings drop more often than helms', () => {
  const s = E.newState('rogue', 'Looter', T0);
  const rand = mulberry32(42);
  const counts = {};
  for (let i = 0; i < 600; i++) {
    const item = E.rollLoot(s, 5, { guaranteed: true, from: 'test' }, rand, T0);
    counts[item.slot] = (counts[item.slot] || 0) + 1;
    s.inventory.length = 0;                          // keep the bag from auto-selling
    assert.ok(C.slotType(item.slot), `drop with unknown slot ${item.slot}`);
  }
  for (const st of C.SLOT_TYPES) assert.ok(counts[st.id] > 0, `${st.id} never dropped in 600 rolls`);
  assert.ok(counts.ring > counts.head, `rings (${counts.ring}) should outdrop helms (${counts.head})`);
});

test('v1 saves migrate by noun, keeping every item', () => {
  const v1 = {
    version: 1,
    createdAt: T0, updatedAt: T0, lastEventAt: T0, lastTickAt: T0,
    hero: { name: 'Legacy', class: 'ranger', level: 5, xp: 0, hp: 40, maxHp: 40, gold: 10, zone: 'grove', unlockedZones: ['grove'] },
    equipment: {
      weapon: { id: 'a', slot: 'weapon', name: 'Plain Grove Dagger', rarity: 'common', ilvl: 4, atk: 3, def: 0, hp: 0 },
      armor: { id: 'b', slot: 'armor', name: 'Fine Grove Cloak', rarity: 'uncommon', ilvl: 4, atk: 0, def: 2, hp: 11 },
      trinket: { id: 'c', slot: 'trinket', name: 'Mythic Grove Band', rarity: 'epic', ilvl: 4, atk: 5, def: 0, hp: 12 },
    },
    inventory: [
      { id: 'd', slot: 'armor', name: 'Plain Grove Helm', rarity: 'common', ilvl: 2, atk: 0, def: 1, hp: 4 },
      { id: 'e', slot: 'trinket', name: 'The Postmortem', rarity: 'legendary', ilvl: 9, atk: 7, def: 0, hp: 9 },
    ],
    monster: null,
    counters: { kills: 0, bossKills: 0, killsSinceBoss: 0, zoneKills: {}, commits: 0, pushes: 0, testsPassed: 0, testsFailed: 0, linesWritten: 0, goldEarned: 0, deaths: 0, lastTestXpAt: 0 },
    anim: [], ticker: [], eventsFolded: 0,
  };
  fs.writeFileSync(path.join(HOME, 'state.json'), JSON.stringify(v1));

  const s = S.loadState();
  assert.ok(s, 'v1 save was rejected instead of migrated');
  assert.strictEqual(s.version, S.CURRENT_VERSION);

  // read by noun, not by the old slot it was stuck in
  assert.strictEqual(s.equipment.weapon.id, 'a', 'dagger left the weapon slot');
  assert.strictEqual(s.equipment.back.id, 'b', 'cloak did not become a back item');
  assert.strictEqual(s.equipment.chest, null, 'cloak was dumped in chest');
  assert.strictEqual(s.equipment.ring1.id, 'c', 'band did not become a ring');

  const bagIds = s.inventory.map(i => i.id);
  assert.deepStrictEqual(bagIds.sort(), ['d', 'e'], 'migration lost or gained items');
  assert.strictEqual(s.inventory.find(i => i.id === 'd').slot, 'head', 'helm is head gear');
  // legendaries are named things with no noun, so they fall back on the old slot
  assert.strictEqual(s.inventory.find(i => i.id === 'e').slot, 'ring');

  // stats re-rolled onto the v2 curve, and maxHp recomputed to match
  const band = s.equipment.ring1;
  assert.deepStrictEqual(
    { atk: band.atk, def: band.def, hp: band.hp },
    B.itemStats('ring', 4, B.RARITIES.find(r => r.id === 'epic').mult));
  assert.strictEqual(s.hero.maxHp, E.heroMaxHp(s), 'maxHp not refreshed after re-slotting');
  assert.ok(s.hero.hp <= s.hero.maxHp, 'hp left above the new maximum');
});

test('a v1 save with two items for one v2 slot keeps the loser in the bag', () => {
  const v1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v1-slot-clash.json'), 'utf8'));
  fs.writeFileSync(path.join(HOME, 'state.json'), JSON.stringify(v1));
  const s = S.loadState();
  assert.ok(s.equipment.chest, 'nothing ended up in chest');
  assert.strictEqual(s.inventory.length, 1, 'the displaced item vanished');
  assert.strictEqual(s.inventory[0].slot, 'chest', 'displaced item kept its slot');
});
