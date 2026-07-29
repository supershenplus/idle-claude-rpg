'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');

const STATE_DIR = process.env.IDLE_RPG_HOME
  || path.join(os.homedir(), '.config', 'idle-claude-rpg');

module.exports = {
  STATE_DIR,
  stateFile: path.join(STATE_DIR, 'state.json'),
  // Per-process tmp name. A single shared tmp path lets two writers (a CLI
  // command and the hook's fold) clobber each other's staging file: the first
  // rename publishes the second's bytes, the second throws ENOENT. The hook's
  // lock can't fix this — tryFold already holds it across its own save, so
  // locking here would deadlock. Unique names make the writers independent and
  // leave rename as the atomic last-writer-wins step it's meant to be.
  tmpFile: path.join(STATE_DIR, `state.tmp.${process.pid}.json`),
  tmpGlobPrefix: 'state.tmp.',
  // The backup a save rolls into, newest first: `state.bak.1.json` is at most
  // BAK_INTERVAL_MS old and each one behind it another interval back, so the
  // most a single bad write can cost is one interval rather than the whole
  // window. Four of them because the failure this replaced was not corruption
  // but a *valid* save written over a good one — which the game cannot detect,
  // so the only defence is more than one step back.
  BAK_GENERATIONS: 4,
  bakGen: n => path.join(STATE_DIR, `state.bak.${n}.json`),
  // The single pre-generational backup. Kept as a name so an existing install
  // can have it adopted as generation 1 instead of dropped, and so `reset` still
  // knows to delete it.
  bakFile: path.join(STATE_DIR, 'state.bak.json'),
  eventsFile: path.join(STATE_DIR, 'events.ndjson'),
  processingFile: path.join(STATE_DIR, 'events.processing'),
  lockFile: path.join(STATE_DIR, 'state.lock'),
  bigmodeFlag: path.join(os.homedir(), '.claude', '.bigmode-active'),
  ensureDir() { fs.mkdirSync(STATE_DIR, { recursive: true }); },
};
