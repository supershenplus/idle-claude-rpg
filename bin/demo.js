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
//   node bin/demo.js --mode compact     the one-line-sprite layout
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
// mid-swing rather than on frame 0. Every class lands its blow on frame 3
// (`sprites.attacks`), and the damage number, the counter-hit and the red hurt
// flash all wait for that frame — so this is the earliest one where a hit scene
// shows everything a hit does.
const FRAME = 3;
// Off the weighted grid, not a multiple of the flat tick: the frames of a blow
// are no longer the same length as each other (`sprites.BLOW_MS`), so the only
// way to name frame 3 is to ask where it starts.
const AGO = sprites.beatMs(FRAME);

function monster(zoneId, monsterId, level, hpFrac) {
  const zone = C.zoneById(zoneId);
  const boss = zone.boss.id === monsterId ? zone.boss : null;
  // The goblin belongs to no zone — it turns up wherever you are — so it is
  // looked up outside the roster rather than being absent from every one.
  const goblin = C.GOBLIN.id === monsterId ? C.GOBLIN : null;
  const m = boss || goblin || zone.monsters.find(x => x.id === monsterId);
  if (!m) throw new Error(`no monster ${monsterId} in ${zoneId}`);
  const maxHp = B.monsterMaxHp(level, 0.5, !!boss) * (goblin ? B.GOBLIN_HP_MULT : 1);
  return {
    id: m.id, name: m.name, level, isBoss: !!boss, isGoblin: !!goblin, sprite: m.sprite,
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
  // The four attack scenes below are one per class, because that is the axis
  // they differ on: each class scripts its own poses, recoil and projectile
  // (`sprites.attacks`), so a change that breaks one can leave the other three
  // looking perfect. Each carries a counter-hit as well, which is what puts the
  // hero in its red hurt flash on this frame.
  hit: {
    blurb: 'the wizard spends its orb — a crit landing, monster countering',
    build: now => {
      const st = hero(now, { cls: 'wizard', name: 'Eva', level: 31, zone: 'embers', gold: 12480, hpFrac: 0.86 });
      st.monster = monster('embers', 'ashwraith', 31, 0.39);
      st.anim = [anim('hit', 1500, { dmg: 38, crit: true, counter: 7 }, now)];
      st.ticker = [R.c('brightYellow', '+38 crit!'), R.c('dim', 'Magma Imp slain +162xp')];
      return st;
    },
  },
  // The same wizard blow, but off a commit. `big` is the only difference in the
  // save — the pose, the recoil and the frame are identical — so this scene is
  // side by side with `hit` on purpose: what a volley changes is exactly the
  // mark in the gap and nothing else.
  volley: {
    blurb: 'a commit lands — the big blow throws three stars, not one',
    build: now => {
      const st = hero(now, { cls: 'wizard', name: 'Eva', level: 31, zone: 'embers', gold: 12480, hpFrac: 0.86 });
      st.monster = monster('embers', 'ashwraith', 31, 0.39);
      st.anim = [anim('hit', 1500, { dmg: 114, crit: true, big: true, counter: 7 }, now)];
      st.ticker = [R.c('brightYellow', '+114 commit!'), R.c('dim', 'Ash Wraith — 114')];
      return st;
    },
  },
  // A recoil is the only thing in the HUD that moves a sprite rather than a
  // mark, and it is on screen for a few hundred ms of a 1500ms hit — so "run it
  // and wait" almost never catches one.
  loose: {
    blurb: 'the ranger mid-shot — bow loosed, arrow crossing, hero shoved back',
    build: now => {
      const st = hero(now, { cls: 'ranger', name: 'Nullpointer', level: 27, zone: 'archives', gold: 9400, hpFrac: 0.78 });
      st.monster = monster('archives', 'inkelem', 27, 0.46);
      st.anim = [anim('hit', 1500, { dmg: 64, crit: false, counter: 11 }, now)];
      st.ticker = [R.c('dim', 'Ink Elemental — 64')];
      return st;
    },
  },
  throw: {
    blurb: 'the rogue mid-throw — empty hand, dagger crossing the gap',
    build: now => {
      const st = hero(now, { cls: 'rogue', name: 'Sable', level: 34, zone: 'embers', gold: 41800, hpFrac: 0.66 });
      st.monster = monster('embers', 'cinderhound', 34, 0.58);
      st.anim = [anim('hit', 1500, { dmg: 121, crit: false, counter: 19 }, now)];
      st.ticker = [R.c('dim', 'Cinderhound — 121')];
      return st;
    },
  },
  dodge: {
    blurb: 'a counter-swing slipped — the hero leans out of it and ghosts',
    build: now => {
      const st = hero(now, { cls: 'ranger', name: 'Nullpointer', level: 29, zone: 'archives', gold: 11200, hpFrac: 0.91 });
      st.monster = monster('archives', 'unindexed', 30, 0.44);
      st.anim = [anim('hit', 1500, { dmg: 88, crit: false, dodged: true }, now)];
      st.ticker = [R.c('dim', 'The Unindexed swung and missed')];
      return st;
    },
  },
  swing: {
    blurb: 'the knight mid-swing — blade come over, cleave crossing the gap',
    build: now => {
      const st = hero(now, { cls: 'knight', name: 'Bastion', level: 22, zone: 'archives', gold: 18600, hpFrac: 0.72 });
      st.monster = monster('archives', 'tome', 22, 0.5);
      st.anim = [anim('hit', 1500, { dmg: 77, crit: true, counter: 14 }, now)];
      st.ticker = [R.c('brightYellow', '+77 crit!')];
      return st;
    },
  },
  // The other direction. Every scene above is the hero swinging; this is the
  // half the HUD never drew at all — a failing test taking HP off you, which
  // used to move the bar and put nothing on screen. The monster is mid-lunge
  // with its mark most of the way across, so the frame shows the blow, the
  // hero driven back and washed red, and the HP it cost.
  struck: {
    blurb: 'a failing test lands — the monster lunges, the hero is driven back',
    build: now => {
      const st = hero(now, { cls: 'rogue', name: 'Sable', level: 19, zone: 'caves', gold: 7300, hpFrac: 0.41 });
      st.monster = monster('caves', 'echowyrm', 20, 0.71);
      st.anim = [anim('mhit', 1500, { dmg: 46, name: 'Echo Wyrm' }, now)];
      st.ticker = [R.c('dim', '2 tests failing')];
      return st;
    },
  },
  // The same blow again, from the deepest thing that throws one. Worth its own
  // scene only next to `struck` above: the wyrm and the treant are the same
  // animation and the same reach, and what separates them on screen is that the
  // treant stands further off and is still leaning in a frame later. Read them
  // as a pair or the depth is invisible.
  heave: {
    blurb: 'a boss swings deeper than the trash does — Rootfang at full extension',
    build: now => {
      const st = hero(now, { cls: 'knight', name: 'Bastion', level: 10, zone: 'grove', gold: 2100, hpFrac: 0.38 });
      st.monster = monster('grove', 'rootfang', 9, 0.55);
      st.anim = [anim('mhit', 1500, { dmg: 61, name: 'Rootfang the Ancient Treant' }, now)];
      st.ticker = [R.c('dim', 'the build broke')];
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
  goblin: {
    blurb: 'a loot goblin turns up in place of the trash (flashes)',
    build: now => {
      const st = hero(now, { cls: 'rogue', name: 'Gavin', level: 15, zone: 'caves', gold: 12400, hpFrac: 0.71 });
      st.monster = monster('caves', C.GOBLIN.id, 14, 0.62);
      st.anim = [anim('goblin', 4000, { name: C.GOBLIN.name }, now)];
      st.ticker = [R.c('dim', 'it is not from around here')];
      return st;
    },
  },
  goblinflee: {
    blurb: 'the goblin gives up on you and leaves with the sack (flashes)',
    build: now => {
      const st = hero(now, { cls: 'rogue', name: 'Gavin', level: 15, zone: 'caves', gold: 12400, hpFrac: 0.55 });
      st.monster = monster('caves', C.GOBLIN.id, 14, 0.34);
      st.anim = [anim('goblinflee', 4000, { name: C.GOBLIN.name }, now)];
      st.ticker = [R.c('dim', 'it slipped away with the sack')];
      return st;
    },
  },
  goblinloot: {
    blurb: "the goblin's sack bursts — the gold arm of the payout",
    build: now => {
      const st = hero(now, { cls: 'rogue', name: 'Gavin', level: 15, zone: 'caves', gold: 21750, hpFrac: 0.64 });
      st.monster = monster('caves', C.GOBLIN.id, 14, 0.01);
      st.anim = [anim('goblinloot', 5000, { name: C.GOBLIN.name, gold: 9350 }, now)];
      st.ticker = [R.c('dim', 'the goblin drops its sack +9,350g')];
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
  cleared: {
    blurb: 'the end of the game — the last boss down for the first time',
    build: now => {
      const st = hero(now, { cls: 'wizard', name: 'Gavin', level: 60, zone: 'prod', gold: 812400, hpFrac: 0.31 });
      st.monster = monster('prod', 'rootcause', 60, 0.001);
      st.anim = [anim('cleared', 9000, { name: 'The Root Cause', clears: 1 }, now)];
      st.ticker = [R.c('brightYellow', 'The Root Cause FOUND — the Postmortem is yours')];
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
    blurb: 'a kill — the monster flips to the corpse',
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
  awaygoblin: {
    blurb: 'coming back to find a goblin gave up waiting',
    build: now => {
      const st = hero(now, { cls: 'ranger', name: 'Nullpointer', level: 12, zone: 'caves', gold: 3080, hpFrac: 1 });
      st.monster = monster('caves', 'kobold', 13, 0.83);
      st.anim = [anim('idle', 5000, { kills: 46, xp: 2130, gold: 890, goblinFled: 1 }, now)];
      st.ticker = [R.c('dim', 'while away: 46 kills +2,130xp +890g · a goblin got away')];
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
  // long enough that a frame can expire between build and draw. That closed the
  // gap up to the spawn and no further — starting node costs another ~90ms of
  // the 250ms frame, so on a busy machine a scene could still be drawn a frame
  // past FRAME. Handing the child the same clock makes the offset exact, which
  // matters here because the whole point of FRAME is showing a specific one.
  for (const a of state.anim) a.at = now - AGO;
  fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify(state));
  return execFileSync('node', [LINE_JS], {
    env: {
      ...process.env, IDLE_RPG_HOME: home, COLUMNS: String(cols),
      RPG_HUD: mode, RPG_NOW: String(now),
    },
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
  const cols = parseInt(opt('cols', mode === 'compact' ? 60 : 100), 10);
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
