'use strict';

const fs = require('fs');
const path = require('path');
const P = require('./paths');

const LOCK_STALE_MS = 10 * 1000;
const BAK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CORRUPT_FILES = 3;
const INBOX_MAX_BYTES = 512 * 1024;
const CURRENT_VERSION = 1;

// ---------- load / save ----------

function migrate(state) {
  if (!state || typeof state !== 'object') return null;
  if (state.version === CURRENT_VERSION) return state;
  // future: migrations[oldVersion](state) chain lives here
  return null;
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
function tryFold(now) {
  if (!hasSave()) return false;
  if (!acquireLock(now)) return false;
  try {
    const state = loadState();
    if (!state) return false;
    const events = drainInbox();
    const engine = require('./engine'); // lazy: hook append path skips this cost on lock-miss
    const dirty = engine.fold(state, events, now);
    if (dirty || events.length > 0) saveState(state);
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
