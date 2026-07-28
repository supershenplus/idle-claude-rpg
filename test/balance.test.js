'use strict';
// The balance sim's assertions, run as part of the suite.
//
// `test/sim.js` has always carried the checks that decide whether the game is
// playable at all — does a heavy day reach the cap in a sane number of days, do
// all three equip profiles finish, does the gold sink actually absorb the gold —
// but it only ran them when someone typed `node test/sim.js --assert` by hand.
// Nothing invoked it, so the one thing in the repo that can tell you a tuning
// change made the game unwinnable was the one thing not gating a commit. The
// numbers in `lib/balance.js` are exactly the kind that get nudged casually.
//
// Cheap enough to be unconditional: the whole sweep is ~0.25s, because it runs
// in memory against the real engine with no fs and no subprocess. And it is
// deterministic — `run` seeds mulberry32 with a fixed constant and starts from a
// fixed epoch — so a failure here is a real balance change, never a flake.
const { test } = require('node:test');
const assert = require('node:assert');
const { assertBalance } = require('./sim');

// One sweep, reused: each check is its own test case so a failure names the
// property that broke rather than reporting "balance" as a single red line.
const results = assertBalance();

test('the balance sweep actually ran its checks', () => {
  assert.ok(results.length >= 10,
    `only ${results.length} balance checks ran — the sweep was cut short`);
});

for (const [i, r] of results.entries()) {
  // The message carries the measured value, so the test name is the finding.
  test(`balance ${i + 1}: ${r.msg}`, () => {
    assert.ok(r.ok, r.msg);
  });
}
