'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');

const STATE_DIR = process.env.IDLE_RPG_HOME
  || path.join(os.homedir(), '.config', 'idle-claude-rpg');

module.exports = {
  STATE_DIR,
  stateFile: path.join(STATE_DIR, 'state.json'),
  tmpFile: path.join(STATE_DIR, 'state.tmp.json'),
  bakFile: path.join(STATE_DIR, 'state.bak.json'),
  eventsFile: path.join(STATE_DIR, 'events.ndjson'),
  processingFile: path.join(STATE_DIR, 'events.processing'),
  lockFile: path.join(STATE_DIR, 'state.lock'),
  bigmodeFlag: path.join(os.homedir(), '.claude', '.bigmode-active'),
  ensureDir() { fs.mkdirSync(STATE_DIR, { recursive: true }); },
};
