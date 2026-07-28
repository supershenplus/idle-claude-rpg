#!/usr/bin/env node
'use strict';

// Renders the HUD in the states worth looking at, for screenshots and for
// eyeballing a layout change without waiting for a boss to actually spawn.
//
// Most of these frames are rare on purpose — a legendary drop, a boss intro, a
// death — so "run it and wait" is a bad way to check whether they still draw.
// Each scene is a synthetic save in a throwaway state dir, rendered by shelling
// out to the *real* statusline. Nothing here reimplements the layout: a demo
// that drew its own version of the scene would keep looking right long after
// the thing it is standing in for broke.
//
//   node bin/demo.js                    every scene at 100 cols, big HUD
//   node bin/demo.js boss loot          just those scenes
//   node bin/demo.js --mode compact     the 3-line layout (or mini)
//   node bin/demo.js --cols 76          at a specific width
//   node bin/demo.js --list             scene names

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const LINE_JS = path.join(REPO, 'statusline', 'rpg-statusline.js');
const E = require('../lib/engine');
const C = require('../lib/content');
const R = require('../lib/render');
const B = require('../lib/balance');
const sprites = require('../lib/sprites');

// Rendered at this offset into the animation, so multi-frame effects are caught
// mid-swing rather than on frame 0 — the projectile has left the hero and the
// damage number has appeared (it only shows from frame 2).
const FRAME = 2;
const AGO = FRAME * sprites.FRAME_MS;

function monster(zoneId, monsterId, level, hpFrac) {
  const zone = C.zoneById(zoneId);
  const boss = zone.boss.id === monsterId ? zone.boss : null;
  const m = boss || zone.monsters.find(x => x.id === monsterId);
  if (!m) throw new Error(`no monster ${monsterId} in ${zoneId}`);
  const maxHp = B.monsterMaxHp(level, 0.5, !!boss);
  return {
    id: m.id, name: m.name, level, isBoss: !!boss, sprite: m.sprite,
    maxHp, hp: Math.max(1, Math.round(maxHp * hpFrac)),
  };
}

// A hero posed at a given level, rather than one played up to it: the demo
// cares about what the line reads like, not about how it was earned.
function hero(now, { cls = 'wizard', name = 'Eva', level = 1, zone = 'grove',
  gold = 0, hpFrac = 1, xpFrac = 0.5, insight = null } = {}) {
  const st = E.newState(cls, name, now);
  Object.assign(st.hero, { level, zone, gold, unlockedZones: C.zones.map(z => z.id) });
  // The real derivation rather than a plausible-looking number: a screenshot
  // that quotes HP the engine would never produce is a screenshot that lies.
  E.refreshMaxHp(st);
  st.hero.hp = Math.max(1, Math.round(st.hero.maxHp * hpFrac));
  if (level >= B.LEVEL_CAP) {
    st.hero.xp = 0;
    st.hero.capXp = Math.round(B.INSIGHT_XP * xpFrac);
    st.hero.insight = insight == null ? 12 : insight;
  } else {
    st.hero.xp = Math.round(B.xpToNext(level) * xpFrac);
  }
  st.anim = [];
  st.ticker = [];
  return st;
}

const anim = (type, dur, data, now) => ({ type, at: now - AGO, dur, data });

const SCENES = {
  hit: {
    blurb: 'a crit landing, with the monster countering',
    build: now => {
      const st = hero(now, { cls: 'wizard', name: 'Eva', level: 31, zone: 'embers', gold: 12480, hpFrac: 0.86 });
      st.monster = monster('embers', 'ashwraith', 31, 0.39);
      st.anim = [anim('hit', 1500, { dmg: 38, crit: true, counter: 7 }, now)];
      st.ticker = [R.c('brightYellow', '+38 crit!'), R.c('dim', 'Magma Imp slain +162xp')];
      return st;
    },
  },
  boss: {
    blurb: 'the boss intro marquee (flashes between two reds)',
    build: now => {
      const st = hero(now, { cls: 'knight', name: 'Gavin', level: 44, zone: 'peaks', gold: 88300, hpFrac: 1 });
      st.monster = monster('peaks', 'aurelia', 45, 1);
      st.anim = [anim('bossintro', 6000, { name: 'Aurelia, Mirror Queen' }, now)];
      st.ticker = [R.c('dim', 'the approach is earned — 15 kills')];
      return st;
    },
  },
  bossfight: {
    blurb: 'a boss at a quarter health, hero nearly out',
    build: now => {
      const st = hero(now, { cls: 'knight', name: 'Gavin', level: 44, zone: 'peaks', gold: 88300, hpFrac: 0.17 });
      st.monster = monster('peaks', 'aurelia', 45, 0.22);
      st.anim = [anim('hit', 1500, { dmg: 96, crit: false, counter: 41 }, now)];
      st.ticker = [R.c('brightRed', '↩-41'), R.c('dim', 'git commit — smite ×3')];
      return st;
    },
  },
  bossdown: {
    blurb: 'boss defeated, next zone unlocked',
    build: now => {
      const st = hero(now, { cls: 'knight', name: 'Gavin', level: 45, zone: 'peaks', gold: 91020, hpFrac: 0.14 });
      st.monster = monster('peaks', 'aurelia', 45, 0.001);
      st.anim = [anim('bossdown', 6000, { name: 'Aurelia, Mirror Queen', unlocked: 'The Null Expanse' }, now)];
      st.ticker = [R.c('brightYellow', 'git push — WAR HORN')];
      return st;
    },
  },
  levelup: {
    blurb: 'the level-up banner',
    build: now => {
      const st = hero(now, { cls: 'ranger', name: 'Nullpointer', level: 24, zone: 'archives', gold: 6210, hpFrac: 1, xpFrac: 0.04 });
      st.monster = monster('archives', 'librarian', 23, 0.55);
      st.anim = [anim('levelup', 5000, { level: 24 }, now)];
      st.ticker = [R.c('green', 'tests pass +240xp')];
      return st;
    },
  },
  loot: {
    blurb: 'a legendary drop',
    build: now => {
      const st = hero(now, { cls: 'rogue', name: 'Sable', level: 52, zone: 'null', gold: 240500, hpFrac: 0.71 });
      st.monster = monster('null', 'segfault', 52, 0.02);
      st.anim = [anim('loot', 5000, { rarity: 'legendary', name: 'Mythic Void Signet' }, now)];
      st.ticker = [R.c('green', 'Segfault Stalker slain +980xp')];
      return st;
    },
  },
  travel: {
    blurb: 'outgrowing a zone — automatic travel',
    build: now => {
      const st = hero(now, { cls: 'knight', name: 'Bastion', level: 19, zone: 'archives', gold: 14200, hpFrac: 0.84 });
      st.monster = monster('archives', 'librarian', 19, 1);
      st.anim = [anim('travel', 5000, { name: 'Sunken Archives' }, now)];
      st.ticker = [R.c('dim', 'travelled to Sunken Archives')];
      return st;
    },
  },
  kill: {
    blurb: 'a kill — the monster flips to (x_x)',
    build: now => {
      const st = hero(now, { cls: 'rogue', name: 'Sable', level: 52, zone: 'null', gold: 240500, hpFrac: 0.71 });
      st.monster = monster('null', 'leech', 52, 0.001);
      st.anim = [anim('kill', 2500, { name: 'Void Leech', xp: 910, gold: 1340 }, now)];
      st.ticker = [R.c('dim', 'Void Leech slain')];
      return st;
    },
  },
  death: {
    blurb: 'driven off by a boss — the approach resets',
    build: now => {
      const st = hero(now, { cls: 'wizard', name: 'Eva', level: 58, zone: 'prod', gold: 410300, hpFrac: 0.02 });
      st.monster = monster('prod', 'rootcause', 60, 0.61);
      st.anim = [anim('death', 6000, { drovenOffBy: 'The Root Cause', lost: 21594 }, now)];
      st.ticker = [R.c('brightRed', 'tests fail — it hits back')];
      return st;
    },
  },
  away: {
    blurb: 'coming back after the laptop was shut',
    build: now => {
      const st = hero(now, { cls: 'ranger', name: 'Nullpointer', level: 12, zone: 'caves', gold: 3080, hpFrac: 1 });
      st.monster = monster('caves', 'kobold', 13, 0.83);
      st.anim = [anim('idle', 5000, { kills: 46, xp: 2130, gold: 890 }, now)];
      return st;
    },
  },
  insight: {
    blurb: 'a capped hero — the XP bar becomes the Insight bar',
    build: now => {
      const st = hero(now, { cls: 'wizard', name: 'Eva', level: B.LEVEL_CAP, zone: 'prod', gold: 640100, hpFrac: 0.93, xpFrac: 0.62, insight: 41 });
      st.monster = monster('prod', 'heisenbug', 59, 0.44);
      st.anim = [anim('hit', 1500, { dmg: 214, crit: true, counter: 0 }, now)];
      st.ticker = [R.c('brightYellow', '+214 crit!'), R.c('dim', '✦41 insight')];
      return st;
    },
  },
  fresh: {
    blurb: 'level 1, first monster, nothing earned yet',
    build: now => {
      const st = hero(now, { cls: 'knight', name: 'You', level: 1, zone: 'grove', gold: 0, hpFrac: 1, xpFrac: 0 });
      st.monster = monster('grove', 'slime', 1, 1);
      st.ticker = [R.c('dim', 'Rootfang the Ancient Treant stirs — 15 kills and 7 levels away')];
      return st;
    },
  },
};

function render(state, { cols, mode, home }) {
  const now = Date.now();
  state.updatedAt = state.lastEventAt = state.lastTickAt = now;
  // Re-anchor every anim to *this* render, since building the scenes takes
  // long enough that a frame can expire between build and draw.
  for (const a of state.anim) a.at = now - AGO;
  fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify(state));
  return execFileSync('node', [LINE_JS], {
    env: { ...process.env, IDLE_RPG_HOME: home, COLUMNS: String(cols), RPG_HUD: mode },
    input: '{}', encoding: 'utf8',
  }).replace(/\n$/, '');
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = argv.indexOf('--' + name);
    if (i < 0) return dflt;
    const v = argv[i + 1];
    argv.splice(i, v && !v.startsWith('--') ? 2 : 1);
    return v && !v.startsWith('--') ? v : true;
  };

  if (argv.includes('--list')) {
    for (const [k, s] of Object.entries(SCENES)) console.log(`  ${k.padEnd(10)} ${s.blurb}`);
    return 0;
  }
  const mode = String(opt('mode', 'big'));
  const cols = parseInt(opt('cols', mode === 'mini' ? 40 : mode === 'compact' ? 60 : 100), 10);
  const names = argv.filter(a => !a.startsWith('--'));
  const bad = names.filter(n => !SCENES[n]);
  if (bad.length) {
    console.error(`unknown scene(s): ${bad.join(', ')}\ntry: node bin/demo.js --list`);
    return 2;
  }
  const chosen = names.length ? names : Object.keys(SCENES);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-demo-'));
  try {
    const rule = '─'.repeat(Math.min(cols, 100));
    for (const name of chosen) {
      const s = SCENES[name];
      console.log(`\n${R.c('dim', rule)}\n${R.c('bold', name)}  ${R.c('dim', '· ' + s.blurb)}\n`);
      console.log(render(s.build(Date.now()), { cols, mode, home }));
    }
    console.log(`\n${R.c('dim', rule)}`);
    console.log(R.c('dim', `  ${chosen.length} scene(s) · ${mode} HUD at ${cols} cols · --list for the rest`));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
  return 0;
}

process.exit(main());
