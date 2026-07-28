'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolated state dir per run — must be set before requiring lib/paths
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-state-test-'));
process.env.IDLE_RPG_HOME = HOME;

const P = require('../lib/paths');
const S = require('../lib/state');
const E = require('../lib/engine');
const C = require('../lib/content');

const T0 = 1_700_000_000_000;

beforeEach(() => {
  for (const f of fs.readdirSync(HOME)) fs.unlinkSync(path.join(HOME, f));
});

test('save + load round-trips atomically (no tmp left behind)', () => {
  const s = E.newState('rogue', 'Atomic', T0);
  S.saveState(s);
  assert.ok(!fs.existsSync(P.tmpFile), 'tmp renamed away');
  const leftovers = fs.readdirSync(HOME).filter(f => f.startsWith(P.tmpGlobPrefix));
  assert.deepStrictEqual(leftovers, [], 'no staging file left behind');
  const loaded = S.loadState();
  assert.strictEqual(loaded.hero.name, 'Atomic');
  assert.strictEqual(loaded.version, S.CURRENT_VERSION);
});

test('corrupt state falls back to backup, quarantines the bad file', () => {
  const s = E.newState('wizard', 'Backup', T0);
  S.saveState(s);          // also creates bak on first save
  assert.ok(fs.existsSync(P.bakFile), 'backup exists');
  fs.writeFileSync(P.stateFile, '{"version":1,"hero":{TRUNCATED');
  const loaded = S.loadState();
  assert.ok(loaded, 'recovered from bak');
  assert.strictEqual(loaded.hero.name, 'Backup');
  assert.ok(fs.readdirSync(HOME).some(f => f.startsWith('state.corrupt-')), 'quarantined');
});

test('unknown version is rejected (no backup → null)', () => {
  fs.writeFileSync(P.stateFile, JSON.stringify({ version: 999, hero: {} }));
  assert.strictEqual(S.loadState(), null);
});

test('lock: second acquire fails, stale lock is stolen', () => {
  assert.ok(S.acquireLock(T0));
  assert.ok(!S.acquireLock(T0 + 1000), 'busy lock refused');
  assert.ok(S.acquireLock(T0 + 20_000), 'stale (>10s) lock stolen');
  S.releaseLock();
});

test('tryFold drains the inbox into state', () => {
  S.saveState(E.newState('wizard', 'Fold', T0));
  S.appendEvent({ t: T0 + 1000, e: 'attack_jab', sid: 't', m: {} });
  S.appendEvent({ t: T0 + 2000, e: 'attack_jab', sid: 't', m: {} });
  assert.ok(S.tryFold(T0 + 3000));
  const st = S.loadState();
  assert.strictEqual(st.eventsFolded, 2);
  assert.ok(!fs.existsSync(P.eventsFile), 'inbox drained');
  assert.ok(!fs.existsSync(P.processingFile), 'processing cleaned');
});

test('tryFold with lock held is a silent no-op', () => {
  S.saveState(E.newState('wizard', 'Locked', T0));
  S.appendEvent({ t: T0 + 1000, e: 'attack_jab', sid: 't', m: {} });
  assert.ok(S.acquireLock(T0 + 2000));
  assert.strictEqual(S.tryFold(T0 + 2000), false);
  S.releaseLock();
  assert.ok(S.tryFold(T0 + 2500), 'works after release');
});

test('torn ndjson lines are skipped', () => {
  S.saveState(E.newState('wizard', 'Torn', T0));
  fs.appendFileSync(P.eventsFile, JSON.stringify({ t: T0 + 1, e: 'attack_jab', m: {} }) + '\n{"t":123,"e":"attack_j');
  assert.ok(S.tryFold(T0 + 1000));
  assert.strictEqual(S.loadState().eventsFolded, 1);
});

test('crash leftover events.processing is folded before new inbox', () => {
  S.saveState(E.newState('wizard', 'Crash', T0));
  fs.writeFileSync(P.processingFile, JSON.stringify({ t: T0 + 1, e: 'attack_jab', m: {} }) + '\n');
  S.appendEvent({ t: T0 + 2, e: 'attack_jab', sid: 't', m: {} });
  assert.ok(S.tryFold(T0 + 1000)); // folds leftover
  assert.ok(S.tryFold(T0 + 2000)); // folds the new inbox
  assert.strictEqual(S.loadState().eventsFolded, 2);
});

test('concurrency stress: parallel appenders + folders lose (almost) nothing', () => {
  const { execFileSync } = require('child_process');
  S.saveState(E.newState('wizard', 'Stress', Date.now()));
  const script = `
    const S = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'state.js'))});
    for (let i = 0; i < 50; i++) {
      S.appendEvent({ t: Date.now(), e: 'attack_jab', sid: 'p' + process.pid, m: {} });
      if (i % 10 === 0) S.tryFold(Date.now());
    }
    S.tryFold(Date.now());
  `;
  const procs = [];
  const { spawn } = require('child_process');
  for (let i = 0; i < 8; i++) {
    procs.push(new Promise((res, rej) => {
      const p = spawn(process.execPath, ['-e', script], { env: { ...process.env, IDLE_RPG_HOME: HOME } });
      p.on('exit', code => code === 0 ? res() : rej(new Error('worker exit ' + code)));
    }));
  }
  return Promise.all(procs).then(() => {
    // final sweep for anything left when workers raced the last fold
    S.tryFold(Date.now() + 20_000); // any stale lock is stolen
    const st = S.loadState();
    assert.ok(st, 'state still valid JSON');
    assert.ok(st.eventsFolded >= 8 * 50 * 0.98, `folded ${st.eventsFolded}/400 (≥98% required)`);
  });
});

test('unlocked saveState racing a locked fold never crashes or corrupts', () => {
  // The stress test above only races tryFold, which serialises on the lock.
  // bin/rpg.js calls saveState directly with no lock (~14 sites), so a CLI
  // command can write the staging file while the hook's fold is mid-save.
  // With a shared tmp path that meant one rename published the other's bytes
  // and the loser threw ENOENT. Workers must all exit 0 and leave valid JSON.
  S.saveState(E.newState('wizard', 'Racer', Date.now()));
  const script = `
    const S = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'state.js'))});
    for (let i = 0; i < 40; i++) {
      const st = S.loadState();
      if (st) { st.hero.gold = (st.hero.gold || 0) + 1; S.saveState(st); }
    }
  `;
  const { spawn } = require('child_process');
  const procs = [];
  for (let i = 0; i < 8; i++) {
    procs.push(new Promise((res, rej) => {
      const p = spawn(process.execPath, ['-e', script], {
        env: { ...process.env, IDLE_RPG_HOME: HOME },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let err = '';
      p.stderr.on('data', d => { err += d; });
      p.on('exit', code => code === 0 ? res() : rej(new Error('writer exit ' + code + ': ' + err)));
    }));
  }
  return Promise.all(procs).then(() => {
    const st = S.loadState();
    assert.ok(st, 'state survived concurrent unlocked writers');
    assert.strictEqual(st.hero.name, 'Racer');
    const leftovers = fs.readdirSync(HOME).filter(f => f.startsWith(P.tmpGlobPrefix));
    assert.deepStrictEqual(leftovers, [], 'no staging files left behind');
  });
});

// ---------------------------------------------------------------------------
// The v1 → v2 migration. Every other load failure is loud: a truncated file
// throws, an unknown version returns null, and both end up at the backup. This
// one is the opposite — it returns a structurally valid save with the wrong
// contents in it, so a bad reslot loses a player's gear and the game plays on
// without ever mentioning it. Coverage used to stop at "fresh v2 round-trips".

function v1Save(over) {
  return {
    version: 1,
    createdAt: T0, updatedAt: T0, lastEventAt: T0, lastTickAt: T0,
    hero: {
      name: 'Legacy', class: 'knight', level: 20, xp: 40, hp: 90, maxHp: 90,
      gold: 500, zone: 'grove', unlockedZones: ['grove', 'caves'],
    },
    equipment: { weapon: null, armor: null, trinket: null },
    inventory: [],
    monster: null,
    counters: {
      kills: 12, bossKills: 1, killsSinceBoss: 3, zoneKills: { grove: 12 },
      commits: 4, pushes: 2, testsPassed: 0, testsFailed: 0,
      linesWritten: 0, goldEarned: 900, deaths: 1, lastTestXpAt: 0,
    },
    anim: [], ticker: [], eventsFolded: 7,
    ...over,
  };
}

// v1's item shape: one of three slots, and stats rolled on a three-slot curve.
function v1Item(slot, name, ilvl, stats) {
  return {
    id: `v1-${name.replace(/\W+/g, '')}`, slot, name, rarity: 'rare', ilvl,
    atk: 0, def: 0, hp: 0, from: 'kill', at: T0, ...stats,
  };
}

function loadV1(save) {
  fs.writeFileSync(P.stateFile, JSON.stringify(save));
  return S.loadState();
}

test('migration re-slots worn v1 gear by the noun in its name', () => {
  const st = loadV1(v1Save({
    equipment: {
      weapon: v1Item('weapon', 'Runed Grove Wand', 8),
      armor: v1Item('armor', 'Fine Grove Cloak', 7),
      trinket: v1Item('trinket', 'Runed Grove Charm', 6),
    },
  }));

  assert.strictEqual(st.version, 2);
  assert.strictEqual(st.equipment.weapon.name, 'Runed Grove Wand');
  assert.strictEqual(st.equipment.back.name, 'Fine Grove Cloak', 'a Cloak was always a cloak');
  assert.strictEqual(st.equipment.neck.name, 'Runed Grove Charm');
  assert.strictEqual(st.equipment.chest, null, 'gear landed in a slot its noun does not name');
  // The v1 keys are gone, and nothing was left behind in the bag.
  assert.deepStrictEqual(Object.keys(st.equipment).sort(), [...C.EQUIP_KEYS].sort());
  assert.deepStrictEqual(st.inventory, []);
  // Everything that is not gear survives untouched.
  assert.strictEqual(st.hero.gold, 500);
  assert.strictEqual(st.counters.kills, 12);
  assert.strictEqual(st.hero.unlockedZones.length, 2);
});

test('migration falls back to the old slot for a legendary with no noun', () => {
  // Legendaries are named things — "Rootfang's Splinter" says nothing about
  // where it is worn — so the v1 slot is all there is to go on.
  const st = loadV1(v1Save({
    equipment: {
      weapon: v1Item('weapon', "Rootfang's Splinter", 9),
      armor: v1Item('armor', "Rootfang's Bark", 9),
      trinket: v1Item('trinket', "Rootfang's Seed", 9),
    },
  }));

  assert.strictEqual(st.equipment.weapon.name, "Rootfang's Splinter");
  assert.strictEqual(st.equipment.chest.name, "Rootfang's Bark", 'armor should fall back to chest');
  assert.strictEqual(st.equipment.ring1.name, "Rootfang's Seed", 'trinket should fall back to ring1');
});

test('migration re-rolls v1 stats onto the v2 curve', () => {
  // v1 had three slots, so one "armor" carried the hp of a whole modern set.
  // Left alone, every legacy item would outclass every new drop for its slot
  // permanently — the migration has to re-roll rather than carry the numbers.
  const inflated = { atk: 0, def: 80, hp: 400 };
  const st = loadV1(v1Save({
    equipment: { weapon: null, armor: v1Item('armor', 'Fine Grove Vest', 7, inflated), trinket: null },
  }));

  const worn = st.equipment.chest;
  const B = require('../lib/balance');
  const mult = B.RARITIES.find(r => r.id === 'rare').mult;
  assert.deepStrictEqual(
    { atk: worn.atk, def: worn.def, hp: worn.hp },
    { ...B.itemStats('chest', 7, mult) },
    'the v1 numbers were carried across instead of re-rolled');
  assert.ok(worn.hp < inflated.hp, 'a v1 armor roll still outclasses the whole v2 curve');
  // hp totals move under the hero when its gear does.
  assert.strictEqual(st.hero.maxHp, E.heroMaxHp(st), 'maxHp was not refreshed after the reslot');
});

test('migration re-slots the bag as well as what is worn', () => {
  const st = loadV1(v1Save({
    inventory: [
      v1Item('armor', 'Fine Grove Helm', 5),
      v1Item('trinket', 'Runed Grove Band', 4),
      v1Item('weapon', 'Runed Grove Dagger', 6),
    ],
  }));

  assert.deepStrictEqual(st.inventory.map(i => i.slot), ['head', 'ring', 'weapon']);
  assert.ok(st.inventory.every(i => C.EQUIP_KEYS.includes(C.slotKeys(i.slot)[0])),
    'a bagged item ended up in a slot the game has no key for');
});

test('migration bags a worn item whose noun collides with one already placed', () => {
  // Two v1 slots can resolve to the same v2 slot — the loser has to go to the
  // bag rather than overwrite the winner, which would delete gear outright.
  const st = loadV1(v1Save({
    equipment: {
      weapon: v1Item('weapon', 'Runed Grove Sword', 9),
      armor: v1Item('armor', 'Fine Grove Maul', 3),   // also a weapon by noun
      trinket: null,
    },
  }));

  assert.strictEqual(st.equipment.weapon.name, 'Runed Grove Sword', 'the first item lost its slot');
  assert.deepStrictEqual(st.inventory.map(i => i.name), ['Fine Grove Maul'],
    'the displaced item was dropped instead of bagged');
  assert.strictEqual(st.inventory[0].slot, 'weapon');
});

test('a migrated save keeps the original bytes under its old version', () => {
  // state.bak refreshes on the first save more than a day after the last one,
  // so it cannot be the pre-migration recovery point: a migration that mangles
  // gear silently is exactly the case where you want yesterday's file back.
  const original = v1Save({ equipment: { weapon: v1Item('weapon', 'Runed Grove Wand', 8), armor: null, trinket: null } });
  const raw = JSON.stringify(original);
  fs.writeFileSync(P.stateFile, raw);
  const snapshot = path.join(HOME, 'state.v1.json');

  const st = S.loadState();
  assert.strictEqual(st.version, 2);
  assert.strictEqual(fs.readFileSync(snapshot, 'utf8'), raw, 'the pre-migration bytes were not kept');

  // The scenario from the finding: bak is a day stale, so the next save
  // overwrites it with post-migration contents. The snapshot must not move.
  S.saveState(st);
  const old = Date.now() - 48 * 60 * 60 * 1000;
  fs.utimesSync(P.bakFile, old / 1000, old / 1000);
  S.saveState(st);
  assert.strictEqual(JSON.parse(fs.readFileSync(P.bakFile, 'utf8')).version, 2,
    'the stale backup should have been refreshed — the test is not exercising the case');
  assert.strictEqual(fs.readFileSync(snapshot, 'utf8'), raw, 'the snapshot followed the backup');

  // And a second load of an already-migrated save neither rewrites it nor
  // adds one for the version it is already at.
  S.loadState();
  assert.strictEqual(fs.readFileSync(snapshot, 'utf8'), raw);
  assert.ok(!fs.existsSync(path.join(HOME, 'state.v2.json')), 'snapshotted a save that was never migrated');
});

test('a save that is already current is loaded without a snapshot', () => {
  S.saveState(E.newState('wizard', 'Current', T0));
  assert.ok(S.loadState());
  assert.deepStrictEqual(fs.readdirSync(HOME).filter(f => /^state\.v\d+\.json$/.test(f)), []);
});
