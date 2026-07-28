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
    const state = migrate(JSON.parse(raw));
    if (state) return state;
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

// ---------- lock ----------

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
        stale = now - (info.at || 0) > LOCK_STALE_MS;
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
    return true;
  } catch (_) {
    return false;
  } finally {
    releaseLock();
  }
}

module.exports = {
  loadState, saveState, hasSave, appendEvent, tryFold,
  acquireLock, releaseLock, drainInbox, CURRENT_VERSION,
};
