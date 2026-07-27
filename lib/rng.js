'use strict';

// mulberry32 — tiny seeded PRNG, deterministic for tests/sim.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// items: [{w: weight, ...}] → picked item
function weightedPick(items, rand) {
  let total = 0;
  for (const it of items) total += it.w;
  let roll = rand() * total;
  for (const it of items) {
    roll -= it.w;
    if (roll <= 0) return it;
  }
  return items[items.length - 1];
}

function pick(arr, rand) { return arr[Math.floor(rand() * arr.length) % arr.length]; }

module.exports = { mulberry32, weightedPick, pick };
