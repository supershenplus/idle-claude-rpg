'use strict';

// Balance sim: replays N synthetic days through the real engine (in memory,
// no fs). Usage: node test/sim.js --days 90 --events 300
// Asserts (exit 1 on failure): L60 in 40-120 days @300/day; never <25 days @500.

const E = require('../lib/engine');
const B = require('../lib/balance');
const C_ = require('../lib/content');
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
  // Days to keep playing *after* the cap. The sim used to stop dead at level 60,
  // which was fine while the cap was a wall — but Insight only exists above it,
  // so leaving this at 0 means the whole paragon curve goes untested.
  const pastCap = (opts && opts.pastCap) || 0;
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

    // Travel is the engine's job now (`E.maybeTravel`, folded once per batch).
    // The sim used to carry its own copy of the rule at the day boundary, which
    // meant the numbers below described a travel policy no player ever ran.
    // Same reasoning as `E.autoEquip` in v1.4: the sim plays the real game.
    zonesSeen.add(state.hero.zone);
    const C = C_;

    // …and wear what it finds. Without this the sim folded 83 days of combat
    // with all twelve slots empty, so every number it reported — deaths above
    // all, since mitigation was `mLvl − def` and def stayed 0 — described a hero
    // who never once opened their inventory.
    if (equip !== 'none') E.autoEquip(state, { displace: equip === 'upgrade' });

    // …and pours gold into what it's wearing, because upgrades are the only
    // thing gold is for. Cheapest-first with half the purse held back, which is
    // roughly how anyone spends: top up the affordable things, keep a cushion.
    if (equip === 'upgrade') {
      for (let guard = 0; guard < 500; guard++) {
        let best = null;
        for (const k of C.EQUIP_KEYS) {
          const it = state.equipment[k];
          if (!it || (it.plus || 0) >= B.UPGRADE_MAX) continue;
          const cost = B.upgradeCost(it.ilvl, it.plus || 0);
          if (!best || cost < best.cost) best = { it, cost };
        }
        if (!best || best.cost > state.hero.gold * 0.5) break;
        if (!E.upgradeItem(state, best.it).ok) break;
      }
    }

    // …and spends Insight as soon as it can afford anything, cheapest track
    // first — the same "top up whatever is affordable" instinct as the gold loop
    // above, and the behaviour the track costs are tuned against.
    if (equip === 'upgrade') {
      for (let guard = 0; guard < 500; guard++) {
        const open = B.INSIGHT_TRACKS
          .map(t => ({ id: t.id, pts: E.paragonPoints(state, t.id) }))
          .filter(x => x.pts < B.INSIGHT_TRACK_MAX)
          .sort((a, b) => B.insightCost(a.pts) - B.insightCost(b.pts));
        if (!open.length || !E.spendInsight(state, open[0].id).ok) break;
      }
    }

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
    if (capDay !== null && day >= capDay + pastCap) break;
  }

  if (print) {
    console.log(capDay
      ? `\nreached level ${B.LEVEL_CAP} on day ${capDay} at ${perDay} events/day`
      : `\nended day ${days} at level ${state.hero.level} (${perDay} events/day)`);
  }
  return {
    capDay, level: state.hero.level, state, bossKillDays, equip,
    insight: state.counters.insightEarned || 0,
    paragon: Object.fromEntries(B.INSIGHT_TRACKS.map(t => [t.id, E.paragonPoints(state, t.id)])),
  };
}

// Returns the checks rather than printing and exiting, so the same run can be
// a CLI report (`--assert`, below) and a set of `node --test` cases
// (`balance.test.js`). It used to do both inline, which meant the assertions
// only ever ran when someone remembered to invoke this file by hand — the whole
// balance curve sat outside the suite that gates every commit.
function assertBalance() {
  const results = [];
  const check = (cond, msg) => { results.push({ ok: !!cond, msg }); };

  const at300 = run(150, 300, false);
  check(at300.capDay !== null && at300.capDay >= 40 && at300.capDay <= 120,
    `@300/day capped on day ${at300.capDay} (want 40-120)`);

  const at500 = run(150, 500, false);
  check(at500.capDay === null || at500.capDay >= 25,
    `@500/day capped on day ${at500.capDay} (want >=25)`);

  const week500 = run(7, 500, false);
  check(week500.level < B.LEVEL_CAP,
    `one heavy week ends at Lv${week500.level} (must be < cap)`);

  // Paragon. The cap is no longer a wall, but the tail past it has to outlast the
  // climb to it or it is just a second, shorter game bolted on the end.
  const cap30 = run(400, 300, false, { pastCap: 30 });
  const cap150 = run(400, 300, false, { pastCap: 150 });
  const pts = r => Object.values(r.paragon).reduce((a, b) => a + b, 0);
  const allPts = B.INSIGHT_TRACKS.length * B.INSIGHT_TRACK_MAX;
  check(cap30.insight > 0,
    `xp past the cap banks instead of evaporating (${cap30.insight} insight in 30 days)`);
  check(pts(cap30) < allPts * 0.75,
    `30 days past the cap buys ${pts(cap30)}/${allPts} points (want under ${Math.round(allPts * 0.75)})`);
  check(pts(cap150) === allPts,
    `the board does finish eventually — ${pts(cap150)}/${allPts} by 150 days past the cap`);

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

  // The sink has to actually absorb. Before upgrading existed an attentive
  // player finished a run holding ~1.07M gold with nothing left to buy, and the
  // figure barely moved whatever the death penalty was set to.
  const goldAtCap = at300.state.hero.gold;
  const invested = C_.EQUIP_KEYS.reduce((sum, k) => {
    const it = at300.state.equipment[k];
    if (!it) return sum;
    let spent = 0;
    for (let p = 0; p < (it.plus || 0); p++) spent += B.upgradeCost(it.ilvl, p);
    return sum + spent;
  }, 0);
  check(goldAtCap < 250_000 && invested > goldAtCap,
    `sink absorbed ${invested}g into gear, leaving ${goldAtCap}g idle `
    + '(want idle < 250k and less than what was spent)');

  // No profile may be walled. A boss used to reset to full HP on death, so a
  // hero who could not win one could never progress past that zone at all —
  // the `fill` player died ~2000 times and never reached the cap. Whatever the
  // tuning, every way of playing has to finish.
  for (const equip of EQUIP_PROFILES) {
    const r = run(200, 300, false, { equip });
    check(r.capDay !== null,
      `equip:${equip} reaches the cap (day ${r.capDay || 'never'}, ${r.state.counters.deaths} deaths)`);
  }

  return results;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--assert')) {
    const results = assertBalance();
    for (const r of results) console.log((r.ok ? 'ok:   ' : 'FAIL: ') + r.msg);
    process.exit(results.some(r => !r.ok) ? 1 : 0);
  } else {
    const get = (name, dflt) => {
      const i = argv.indexOf('--' + name);
      return i >= 0 ? parseInt(argv[i + 1], 10) : dflt;
    };
    run(get('days', 90), get('events', 300), true);
  }
}

module.exports = { run, assertBalance };
