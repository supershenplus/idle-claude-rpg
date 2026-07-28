'use strict';

const fs = require('fs');
const path = require('path');
const P = require('./paths');

const LOCK_STALE_MS = 10 * 1000;
const BAK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CORRUPT_FILES = 3;
const INBOX_MAX_BYTES = 512 * 1024;
const CURRENT_VERSION = 2;

// ---------- load / save ----------

// Keyed by the version being upgraded *from*; each returns the state one
// version newer. loadState runs the chain, so a v1 save reaching v2 costs the
// player nothing.
const migrations = {
  // v1 wore one weapon, one armor and one trinket. v2 has twelve slots, so
  // every item is re-slotted by the noun in its name — a Cloak was always a
  // cloak, it just had nowhere else to go — falling back to the old slot's
  // closest v2 equivalent for legendaries, which are named things with no noun.
  1(s) {
    const C = require('./content');
    const B = require('./balance');
    const FALLBACK = { weapon: 'weapon', armor: 'chest', trinket: 'ring' };
    const reslot = (it) => {
      if (!it) return it;
      it.slot = C.slotFromNoun(it.name) || FALLBACK[it.slot] || 'ring';
      // v1 rolled stats on a three-slot curve, where one "armor" carried the
      // hp of a whole modern set. Left alone, every legacy item would outclass
      // every new drop for its slot permanently, so re-roll onto the v2 curve.
      const mult = (B.RARITIES.find(r => r.id === it.rarity) || { mult: 1 }).mult;
      Object.assign(it, B.itemStats(it.slot, Math.max(1, it.ilvl || 1), mult));
      return it;
    };

    const worn = [s.equipment?.weapon, s.equipment?.armor, s.equipment?.trinket].filter(Boolean);
    s.equipment = C.emptyEquipment();
    s.inventory = Array.isArray(s.inventory) ? s.inventory : [];
    for (const it of worn) {
      reslot(it);
      const key = C.slotKeys(it.slot).find(k => !s.equipment[k]);
      if (key) s.equipment[key] = it;
      else s.inventory.push(it);          // slot already taken: back to the bag
    }
    s.inventory.forEach(reslot);

    require('./engine').refreshMaxHp(s);  // hp totals moved under it
    s.version = 2;
    return s;
  },
};

function migrate(state) {
  if (!state || typeof state !== 'object') return null;
  let s = state;
  while (s.version !== CURRENT_VERSION) {
    const step = migrations[s.version];
    if (!step) return null;             // unknown or future version
    try { s = step(s); } catch (_) { return null; }
  }
  return s;
}

// A migration is the one load path that can hand back a *structurally valid*
// save with the wrong contents in it: a bad reslot silently loses gear, and the
// game then plays on quite happily without it. `state.bak` is no help there —
// it is refreshed by the first save more than BAK_MAX_AGE_MS after the last
// one, so the pre-migration snapshot can be gone within a day of the upgrade,
// and the player finds out later than that. So keep the original bytes under
// the version they were written at, exactly once, and never write them again.
function snapshotPreMigration(raw, from) {
  if (!Number.isInteger(from)) return;
  try {
    const dest = path.join(P.STATE_DIR, `state.v${from}.json`);
    if (fs.existsSync(dest)) return;      // the first one is the one worth having
    fs.writeFileSync(dest, raw);
  } catch (_) { /* best effort — never block a load over it */ }
}

function quarantineCorrupt() {
  try {
    const dest = path.join(P.STATE_DIR, `state.corrupt-${Date.now()}.json`);
    fs.renameSync(P.stateFile, dest);
    const corrupts = fs.readdirSync(P.STATE_DIR)
      .filter(f => f.startsWith('state.corrupt-')).sort();
    while (corrupts.length > MAX_CORRUPT_FILES) {
      fs.unlinkSync(path.join(P.STATE_DIR, corrupts.shift()));
    }
  } catch (_) { /* best effort */ }
}

// null = no save (or unrecoverable); never throws
function loadState() {
  let raw;
  try { raw = fs.readFileSync(P.stateFile, 'utf8'); } catch (_) { return null; }
  try {
    const parsed = JSON.parse(raw);
    // `migrate` upgrades in place, so the version it came in at has to be read
    // off it first.
    const from = parsed && parsed.version;
    const state = migrate(parsed);
    if (state) {
      if (from !== CURRENT_VERSION) snapshotPreMigration(raw, from);
      return state;
    }
  } catch (_) { /* corrupt */ }
  quarantineCorrupt();
  try {
    const bak = migrate(JSON.parse(fs.readFileSync(P.bakFile, 'utf8')));
    if (bak) { saveState(bak); return bak; }
  } catch (_) { /* no usable backup */ }
  return null;
}

function saveState(state) {
  P.ensureDir();
  fs.writeFileSync(P.tmpFile, JSON.stringify(state));
  fs.renameSync(P.tmpFile, P.stateFile);
  // backup after the write so it exists from the very first save; refreshed
  // at most daily, so it lags up to 24h behind — that's the recovery point
  try {
    const st = fs.statSync(P.bakFile);
    if (Date.now() - st.mtimeMs > BAK_MAX_AGE_MS) fs.copyFileSync(P.stateFile, P.bakFile);
  } catch (_) {
    try { fs.copyFileSync(P.stateFile, P.bakFile); } catch (_) { /* best effort */ }
  }
}

function hasSave() { return fs.existsSync(P.stateFile); }

// Everything on disk that belongs to the hero. `reset` deletes them, and it
// promises "forever", so the list has to cover the files a save spills into as
// well as the five fixed ones — a quarantined corrupt copy and a pre-migration
// snapshot are both whole save files with a playable hero inside them. Live
// `state.tmp.<pid>` staging files are left alone: another process owns those.
function saveFiles() {
  const fixed = [P.stateFile, P.bakFile, P.eventsFile, P.processingFile, P.lockFile];
  let spilled = [];
  try {
    spilled = fs.readdirSync(P.STATE_DIR)
      .filter(f => /^state\.(corrupt-\d+|v\d+)\.json$/.test(f))
      .map(f => path.join(P.STATE_DIR, f));
  } catch (_) { /* no state dir: the fixed names are answer enough */ }
  return [...fixed, ...spilled];
}

// A `state.tmp.<pid>.json` is published by rename, so one still sitting on disk
// means its writer died between staging and publishing. Nothing collected them
// before: `reset` deliberately spares them (another process may own that one),
// which left crash leftovers to accumulate for the life of the save.
//
// The pid in the name is the owner, and `ownerGone` reports our own pid and
// every live stranger as present — so this only ever deletes a file whose
// writer is provably gone, and the "don't touch a live writer's staging file"
// rule saveFiles() follows still holds.
function reapOrphanTmp() {
  let names = [];
  try { names = fs.readdirSync(P.STATE_DIR); } catch (_) { return; }
  for (const f of names) {
    const m = /^state\.tmp\.(\d+)\.json$/.exec(f);
    if (!m || !ownerGone(Number(m[1]))) continue;
    try { fs.unlinkSync(path.join(P.STATE_DIR, f)); } catch (_) { /* raced: fine */ }
  }
}

// ---------- lock ----------

// Is the process that wrote this pid gone? `kill(pid, 0)` sends no signal; it
// throws ESRCH when nothing owns the pid and EPERM when something does but we
// may not signal it — so EPERM means alive. Our own pid reports alive, which
// keeps a live writer from reaping its own staging file. Pid reuse can report
// a stranger as alive, and every caller treats that as "not gone yet" and
// falls back to a timeout, so the worst case is a delay rather than a race.
function ownerGone(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try { process.kill(pid, 0); return false; } catch (err) { return err.code === 'ESRCH'; }
}

function acquireLock(now) {
  P.ensureDir();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(P.lockFile, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: now }));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') return false;
      let stale = false;
      try {
        const info = JSON.parse(fs.readFileSync(P.lockFile, 'utf8'));
        // A dead owner is stale the instant we notice: it cannot be mid-write
        // if it does not exist, so there is nothing to wait out. The timeout
        // stays as the backstop for the *other* case — an owner that is alive
        // but wedged — because a lock nobody is willing to break freezes the
        // game outright, and everything else in this file fails open too.
        stale = ownerGone(info.pid) || now - (info.at || 0) > LOCK_STALE_MS;
      } catch (_) {
        try { stale = now - fs.statSync(P.lockFile).mtimeMs > LOCK_STALE_MS; }
        catch (_) { stale = true; } // vanished between checks — retry
      }
      if (!stale) return false;
      try { fs.unlinkSync(P.lockFile); } catch (_) { /* raced; retry anyway */ }
    }
  }
  return false;
}
function releaseLock() { try { fs.unlinkSync(P.lockFile); } catch (_) { /* already gone */ } }

// ---------- events ----------

function appendEvent(ev) {
  P.ensureDir();
  fs.appendFileSync(P.eventsFile, JSON.stringify(ev) + '\n');
}

function drainInbox() {
  // Crash leftover first; otherwise claim the live inbox by rename (new
  // appends recreate events.ndjson transparently — nothing blocks).
  if (!fs.existsSync(P.processingFile) && fs.existsSync(P.eventsFile)) {
    try { fs.renameSync(P.eventsFile, P.processingFile); } catch (_) { return []; }
  }
  let raw;
  try { raw = fs.readFileSync(P.processingFile, 'utf8'); } catch (_) { return []; }
  if (raw.length > INBOX_MAX_BYTES) {
    // pathological backlog: fold a chunk now, push the rest back for next fold
    const cut = raw.lastIndexOf('\n', INBOX_MAX_BYTES);
    if (cut > 0) {
      try { fs.appendFileSync(P.eventsFile, raw.slice(cut + 1)); } catch (_) { /* tail lost, game data */ }
      raw = raw.slice(0, cut);
    }
  }
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { events.push(JSON.parse(line)); } catch (_) { /* torn write: skip line */ }
  }
  return events;
}

// ---------- the shared fold entry point ----------

// Called from the hook, the statusline, and the CLI. Non-blocking: if the
// lock is busy someone else is folding; the statusline retries within 1s.
//
// `opts.cwd` enables git-state push detection. It lives here rather than in
// either caller because this is the one place that holds the lock, the loaded
// state and the write — and because putting it here means the hook and the
// statusline share a single record of what each remote pointed at, which is
// what stops a push from firing the War Horn twice.
function tryFold(now, opts = {}) {
  if (!hasSave()) return false;
  if (!acquireLock(now)) return false;
  try {
    const state = loadState();
    if (!state) return false;
    const events = drainInbox();

    let repoDirty = false;
    if (opts.cwd) {
      try {
        const r = require('./gitwatch').sync(state, opts.cwd);
        repoDirty = !!r.recorded;
        // Synthesised, then folded exactly like a hook-classified push, so the
        // War Horn is one code path however the push was made.
        //
        // Unless the classifier already caught it: when Claude runs the push
        // through the Bash tool, the hook queues a push event AND the ref moves,
        // which is one push arriving by two routes. Suppress on the batch rather
        // than on a time window — both land in the same fold by construction,
        // since the hook appends and then immediately folds.
        if (r.pushed && !events.some(e => e && e.e === 'push')) {
          events.push({ t: now, e: 'push', sid: '', m: { via: 'git' } });
        }
      } catch (_) { /* no repo here, or an unreadable one: not a game concern */ }
    }

    const engine = require('./engine'); // lazy: hook append path skips this cost on lock-miss
    const dirty = engine.fold(state, events, now);
    if (dirty || repoDirty || events.length > 0) saveState(state);
    try { fs.unlinkSync(P.processingFile); } catch (_) { /* none drained */ }
    // Under the lock, where the crashed writer's slot is provably free. One
    // readdir of a six-file directory per fold, against a JSON parse and a
    // whole engine tick already on this path.
    reapOrphanTmp();
    return true;
  } catch (_) {
    return false;
  } finally {
    releaseLock();
  }
}

module.exports = {
  loadState, saveState, hasSave, saveFiles, appendEvent, tryFold,
  acquireLock, releaseLock, drainInbox, reapOrphanTmp, ownerGone, CURRENT_VERSION,
};
