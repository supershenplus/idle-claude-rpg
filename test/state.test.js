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
