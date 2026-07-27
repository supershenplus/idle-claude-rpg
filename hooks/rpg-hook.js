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
    if (!ev) process.exit(0);
    const now = Date.now();
    state.appendEvent({ t: now, e: ev.e, sid: input.session_id || '', m: ev.m || {} });
    try { state.tryFold(now); } catch (_) { /* statusline folds within 1s */ }
  } catch (_) { /* fail open */ }
  process.exit(0);
});
