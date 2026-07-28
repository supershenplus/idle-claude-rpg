'use strict';

// Balance sim: replays N synthetic days through the real engine (in memory,
// no fs). Usage: node test/sim.js --days 90 --events 300
// Asserts (exit 1 on failure): L60 in 55-120 days @300/day; never <25 days @500.

const E = require('../lib/engine');
const B = require('../lib/balance');
const { mulberry32 } = require('../lib/rng');

// Event mix for a heavy Claude Code day
const MIX = [
  ['attack_jab', 0.58],
  ['attack_lines', 0.25],
  ['test', 0.08],       // 80% pass / 20% fail
  ['attack_build', 0.04],
  ['commit', 0.03],
  ['push', 0.02],
];

function pickEvent(rand) {
  let r = rand();
  for (const [e, w] of MIX) { r -= w; if (r <= 0) return e; }
  return 'attack_jab';
}

function lognormalLines(rand) {
  // ~e^N(3,1): median ~20 lines, occasionally large
  const n = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  return Math.max(1, Math.min(B.LINE_CAP, Math.round(Math.exp(3 + n))));
}

// How diligently the simulated player manages their gear. Balance that only
// holds for one of these is balance that only holds for one kind of player:
//   upgrade — equips every drop that beats what's worn (the attentive player)
//   fill    — only fills empty slots, never upgrades (`/hero equip all`, rarely)
//   none    — never opens the inventory at all (the floor)
const EQUIP_PROFILES = ['upgrade', 'fill', 'none'];

function run(days, perDay, print, opts) {
  const equip = (opts && opts.equip) || 'upgrade';
  const T0 = 1_700_000_000_000;
  const rand = mulberry32(0xC0FFEE);
  const state = E.newState('wizard', 'Sim', T0);
  let capDay = null;
  const zonesSeen = new Set(['grove']);
  let bossKillDays = [];

  for (let day = 1; day <= days; day++) {
    const dayStart = T0 + day * 86400000;
    const events = [];
    for (let i = 0; i < perDay; i++) {
      const t = dayStart + Math.floor((i / perDay) * 8 * 3600000); // spread over 8h
      const e = pickEvent(rand);
      if (e === 'test') events.push({ t, e: rand() < 0.8 ? 'test_pass' : 'test_fail', m: {} });
      else if (e === 'attack_lines') events.push({ t, e, m: { lines: lognormalLines(rand) } });
      else events.push({ t, e, m: {} });
    }
    const bossKillsBefore = state.counters.bossKills;

    // auto-travel like a player would: move up when the zone is outleveled
    const C = require('../lib/content');
    const zone = C.zoneById(state.hero.zone);
    const next = C.nextZone(state.hero.zone);
    if (next && state.hero.unlockedZones.includes(next.id) && state.hero.level >= next.min) {
      state.hero.zone = next.id;
      zonesSeen.add(next.id);
      E.spawnMonster(state, rand);
    }

    // …and wear what it finds. Without this the sim folded 83 days of combat
    // with all twelve slots empty, so every number it reported — deaths above
    // all, since mitigation was `mLvl − def` and def stayed 0 — described a hero
    // who never once opened their inventory.
    if (equip !== 'none') E.autoEquip(state, { displace: equip === 'upgrade' });

    // fold in hour-sized chunks (closer to reality than one mega-fold)
    for (let h = 0; h < 8; h++) {
      const chunk = events.filter(ev => ev.t >= dayStart + h * 3600000 && ev.t < dayStart + (h + 1) * 3600000);
      E.fold(state, chunk, dayStart + (h + 1) * 3600000);
    }
    if (state.counters.bossKills > bossKillsBefore) bossKillDays.push(day);
    if (state.hero.level >= B.LEVEL_CAP && capDay === null) capDay = day;

    if (print && (day % 7 === 0 || day === 1 || capDay === day)) {
      console.log(`day ${String(day).padStart(3)}  Lv${String(state.hero.level).padStart(2)}  ` +
        `zone ${state.hero.zone.padEnd(8)}  kills ${state.counters.kills}  ` +
        `bosses ${state.counters.bossKills}  gold ${state.hero.gold}  deaths ${state.counters.deaths}`);
    }
    if (capDay) break;
  }

  if (print) {
    console.log(capDay
      ? `\nreached level ${B.LEVEL_CAP} on day ${capDay} at ${perDay} events/day`
      : `\nended day ${days} at level ${state.hero.level} (${perDay} events/day)`);
  }
  return { capDay, level: state.hero.level, state, bossKillDays, equip };
}

function assertBalance() {
  let failed = false;
  const check = (cond, msg) => {
    console.log((cond ? 'ok:   ' : 'FAIL: ') + msg);
    if (!cond) failed = true;
  };

  const at300 = run(150, 300, false);
  check(at300.capDay !== null && at300.capDay >= 40 && at300.capDay <= 120,
    `@300/day capped on day ${at300.capDay} (want 40-120)`);

  const at500 = run(150, 500, false);
  check(at500.capDay === null || at500.capDay >= 25,
    `@500/day capped on day ${at500.capDay} (want >=25)`);

  const week500 = run(7, 500, false);
  check(week500.level < B.LEVEL_CAP,
    `one heavy week ends at Lv${week500.level} (must be < cap)`);

  const gaps = at300.bossKillDays.slice(0, 12).map((d, i, a) => i ? d - a[i - 1] : d);
  const avgGap = gaps.length > 1 ? gaps.slice(1).reduce((x, y) => x + y, 0) / (gaps.length - 1) : 99;
  check(avgGap >= 0.5 && avgGap <= 4,
    `early boss cadence ≈ every ${avgGap.toFixed(1)} days (want 0.5-4)`);

  // Death is meant to be punctuation: rare enough that losing a fight is an
  // event, common enough that the HP bar is not decoration. Measured against the
  // attentive player, since that is who the pacing is written for.
  const deaths = at300.state.counters.deaths;
  const perDeath = deaths ? (at300.capDay || 150) / deaths : Infinity;
  check(deaths >= 1 && perDeath >= 4 && perDeath <= 30,
    `attentive player dies every ${perDeath === Infinity ? '∞' : perDeath.toFixed(0)} days `
    + `(${deaths} total, want one per 4-30 days)`);

  // No profile may be walled. A boss used to reset to full HP on death, so a
  // hero who could not win one could never progress past that zone at all —
  // the `fill` player died ~2000 times and never reached the cap. Whatever the
  // tuning, every way of playing has to finish.
  for (const equip of EQUIP_PROFILES) {
    const r = run(200, 300, false, { equip });
    check(r.capDay !== null,
      `equip:${equip} reaches the cap (day ${r.capDay || 'never'}, ${r.state.counters.deaths} deaths)`);
  }

  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--assert')) assertBalance();
  else {
    const get = (name, dflt) => {
      const i = argv.indexOf('--' + name);
      return i >= 0 ? parseInt(argv[i + 1], 10) : dflt;
    };
    run(get('days', 90), get('events', 300), true);
  }
}

module.exports = { run, assertBalance };
