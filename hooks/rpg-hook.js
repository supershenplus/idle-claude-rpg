#!/usr/bin/env node
'use strict';

// PostToolUse + Stop entry point. Zero tokens: nothing is ever written to
// stdout. Fail-open: any error → exit 0 silently. Budget: <100ms.

const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const state = require('../lib/state');
    if (!state.hasSave()) process.exit(0); // not initialized: no ledger, no growth
    const ev = require('../lib/classify').classify(input);
    const now = Date.now();
    // The fold still runs when nothing classified, because it is also what
    // polls git for a push made outside Claude's tools.
    const cwd = input.cwd || (input.workspace && input.workspace.current_dir) || process.cwd();
    if (ev) state.appendEvent({ t: now, e: ev.e, sid: input.session_id || '', m: ev.m || {} });
    try { state.tryFold(now, { cwd }); } catch (_) { /* statusline folds within 1s */ }
  } catch (_) { /* fail open */ }
  process.exit(0);
});
