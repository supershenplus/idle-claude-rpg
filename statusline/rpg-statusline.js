#!/usr/bin/env node
'use strict';

// Statusline HUD. Reads Claude Code's statusline stdin JSON (unused except as
// a trigger), folds pending events, renders a battle scene sized to $COLUMNS.
// Never throws: worst case prints a minimal fallback and exits 0.
//
// Three layouts, picked by width (override with RPG_HUD=big|compact|mini):
//   big     8 lines — 5-line sprites, monster centred, name/level/HP beneath
//   compact 3 lines — one-line sprites, monster centred
//   mini    1 line  — level, HP, monster name
//
// The monster sits on the terminal's midpoint and the hero is placed a fixed
// gap to its left, so the pair reads as a centred scene rather than two
// combatants shouting at each other from opposite edges.

const fs = require('fs');

const HERO_GAP = 14;   // cells between hero art and monster art
const LEFT_MIN = 2;

function main(stdin) {
  const now = Date.now();
  const cols = parseInt(process.env.COLUMNS, 10) || 80;

  const P = require('../lib/paths');
  const S = require('../lib/state');
  const R = require('../lib/render');
  const C = require('../lib/content');
  const sprites = require('../lib/sprites');
  const B = require('../lib/balance');

  // stdin was previously ignored entirely. It carries the working directory,
  // which is what makes this the poller for pushes made outside Claude's tools
  // — with `!`, in another terminal, or from an IDE. This process runs about
  // once a second, so a push shows up within a frame of happening.
  let cwd = process.cwd();
  try {
    const j = JSON.parse(stdin);
    cwd = (j.workspace && (j.workspace.current_dir || j.workspace.project_dir)) || j.cwd || cwd;
  } catch (_) { /* no payload, or not JSON: our own cwd is a fair guess */ }

  try { S.tryFold(now, { cwd }); } catch (_) { /* render last saved state */ }

  const state = S.loadState();
  if (!state) {
    console.log(R.c('dim', '⚔ idle-claude-rpg — no hero yet · run /hero init to begin'));
    return;
  }

  const h = state.hero;
  const m = state.monster || {};
  const cls = C.classes[h.class] || C.classes.wizard;
  const zone = C.zoneById(h.zone);
  const heroArt = sprites.heroes[h.class] || sprites.heroes.wizard;

  const mode = (process.env.RPG_HUD || '').toLowerCase()
    || (cols >= 76 ? 'big' : cols >= 50 ? 'compact' : 'mini');

  // ---- line 1: identity / vitals ----
  const xpNeed = h.level >= B.LEVEL_CAP ? 0 : B.xpToNext(h.level);
  // At the cap this used to read a flat `MAX` forever. The same XP now banks
  // Insight, so the bar keeps filling and the number keeps climbing — which is
  // the entire point of the paragon track. Still narrower than the pre-cap
  // `[bar] 1,234/4,567` it replaces, so no line gets longer than it already was.
  const xpStr = h.level >= B.LEVEL_CAP
    ? `${R.c('cyan', `[${R.bar(h.capXp || 0, B.INSIGHT_XP, 10)}]`)} ${R.c('brightYellow', `✦${h.insight || 0}`)}`
    : `${R.c('cyan', `[${R.bar(h.xp, xpNeed, 10)}]`)} ${R.fmt(h.xp)}/${R.fmt(xpNeed)}`;
  let badge = '';
  try { if (fs.existsSync(P.bigmodeFlag)) badge = ' ' + R.c('brightMagenta', '◆BM'); } catch (_) {}
  const hpCol = h.hp / h.maxHp < 0.3 ? 'brightRed' : 'green';
  const line1 = `⚔ ${R.c('bold', `${h.name} the ${cls.name}`)}  Lv ${h.level}  XP ${xpStr}   `
    + R.c(hpCol, `♥ ${h.hp}/${h.maxHp}`) + `   ${R.c('yellow', '⛁ ' + R.fmtGold(h.gold))}${badge}`;

  if (mode === 'mini') {
    const line = `Lv${h.level} ${cls.name.slice(0, 3)} ♥${h.hp} `
      + `${m.name ? m.name.replace(/ /g, '') : ''} Lv${m.level || '?'} `
      + `${R.fmt(m.hp || 0)}/${R.fmt(m.maxHp || 0)}`;
    console.log(R.keepIndent(R.fit(line, cols)));
    return;
  }

  // ---- active animation ----
  const anim = (state.anim || []).find(a => now >= a.at && now < a.at + a.dur);
  const frame = anim ? Math.floor((now - anim.at) / sprites.FRAME_MS) : 0;

  // A kill swaps `state.monster` immediately, but the animations about that kill
  // play afterwards, so they carry their own copy of the monster they concern
  // (`engine.resolveKill`). Rendering that copy is what keeps the scene in order
  // — otherwise the killing blow lands on the monster that replaced the target.
  const mon = (anim && anim.data && anim.data.mon) || m;
  // The corpse stays on the field for the celebration too: flipping back to a
  // live sprite under a "DEFEATED" banner reads as the wrong monster dying.
  const dead = !!anim && (anim.type === 'kill' || anim.type === 'bossdown');

  const tickerLine = () => {
    const parts = [R.c('dim', zone.name)];
    for (const t of (state.ticker || [])) parts.push(t);
    if (h.level > zone.max + 2) parts.push(R.c('brightYellow', 'zone cleared — /hero zone'));
    return '  ' + parts.join(R.c('dim', ' · '));
  };

  // A banner replaces the monster's info row for its duration rather than
  // blanking the scene, so the sprites never disappear mid-fight.
  function bannerText() {
    if (!anim) return null;
    const flash2 = (a, b) => (frame % 2 === 0 ? a : b);
    switch (anim.type) {
      case 'levelup':
        return R.c(flash2('brightYellow', 'yellow'), `★★★ LEVEL UP — ${anim.data.level} ★★★`);
      case 'bossintro':
        return R.c(flash2('brightRed', 'red'), `▓▓▓ ☠ BOSS: ${String(anim.data.name || '').toUpperCase()} ☠ ▓▓▓`);
      case 'bossdown':
        return R.c('brightYellow', `☠ ${anim.data.name} DEFEATED`
          + (anim.data.unlocked ? ` — ${anim.data.unlocked} unlocked` : '') + ' ☠');
      // The goblin gets a flashing banner like a boss because it is the same
      // kind of moment — something turned up that is not the usual trash — and
      // a 5% spawn nobody notices is just a monster with odd numbers.
      case 'goblin':
        return R.c(flash2('brightYellow', 'yellow'), `≡$≡ ${String(anim.data.name || '').toUpperCase()} — get it before it runs ≡$≡`);
      case 'goblinflee':
        return R.c(flash2('brightRed', 'red'), `≡$≡ ${anim.data.name} got away with the sack ≡$≡`);
      case 'goblinloot':
        if (anim.data.gold != null && !anim.data.item) {
          return R.c('brightYellow', `≡$≡ the sack bursts — +${R.fmtGold(anim.data.gold)} ≡$≡`);
        }
        return anim.data.vendored
          ? R.c('brightYellow', `≡$≡ [${anim.data.rarity}] ${anim.data.item} — you wear better, sold for ${R.fmtGold(anim.data.gold)}`)
          : R.rarityColored(anim.data.rarity, `≡$≡ [${anim.data.rarity}] ${anim.data.item} — the goblin's prize!`);
      // Gold goes through fmtGold everywhere it appears, banners included — a
      // death at level 58 costs five figures, and `-21594g` next to a vitals
      // line reading `⛁ 410,300g` reads as a different currency.
      case 'death':
        return R.c('brightRed', anim.data.drovenOffBy
          ? `✝ ${anim.data.drovenOffBy} drove you off… -${R.fmtGold(anim.data.lost)} · the approach resets`
          : `✝ you died… -${R.fmtGold(anim.data.lost)} (respawned)`);
      case 'idle':
        return R.c('cyan', `⌛ while away: ${anim.data.kills} kills +${R.fmt(anim.data.xp)}xp +${R.fmtGold(anim.data.gold)}`);
      case 'kill':
        return R.c('green', `${anim.data.name} slain  +${R.fmt(anim.data.xp)}xp +${R.fmtGold(anim.data.gold)}`);
      case 'travel':
        return R.c('brightGreen', `⇒ ${anim.data.name} — you have outgrown the last zone`);
      case 'loot':
        return R.rarityColored(anim.data.rarity, `≡ [${anim.data.rarity}] ${anim.data.name} dropped!`);
      default:
        return null;
    }
  }

  // Monster identity + health, the row that sits under the sprite.
  function infoText() {
    const lvl = R.c('dim', `Lv ${mon.level != null ? mon.level : '?'}`);
    const nm = `${mon.isBoss ? R.c('brightRed', '☠ ') : ''}${R.c('bold', mon.name || '???')}`;
    const hpc = (mon.hp || 0) / (mon.maxHp || 1) < 0.25 ? 'brightRed' : 'red';
    const hp = R.c(hpc, `HP [${R.bar(mon.hp || 0, mon.maxHp || 1, 10)}] ${R.fmt(mon.hp || 0)}/${R.fmt(mon.maxHp || 0)}`);
    return `${lvl}  ${nm}   ${hp}`;
  }

  // A class may script its attack (see sprites.attacks): a pose to hold, a
  // recoil, and where its projectile has got to this frame. Classes without one
  // get `null` here and keep the generic mark that grows out of the gap.
  const atk = anim && anim.type === 'hit' ? sprites.attackFrame(h.class, frame) : null;
  const recoil = atk ? atk.back : 0;

  // Projectile + damage numbers that live in the gap between the combatants.
  //
  // `cells` is how much room the gap actually has. It matters because a burst of
  // hits coalesces into a single anim — `engine.enqueue` sums `dmg` onto the one
  // already playing, and a counter sums onto that same record — so neither
  // number has a ceiling, and a catch-up fold can make a mark wider than the gap
  // it lives in. `row.put` then butts the monster art on one column late; only
  // the two rows carrying marks move, so the sprite *shears* rather than
  // shifting, and at the extreme the far edge falls off the end of R.fit.
  // Digits stay exact while they fit — damage is the one number you watch tick —
  // and drop to `fmt` when they don't, rather than truncating to `✦-1234567…`,
  // which reads as a broken renderer instead of a big hit. R.fit sits under both
  // so no future format can reach past the gap either.
  //
  // A scripted attack additionally moves the projectile: `flightCol` is how far
  // into the gap the mark starts, so the arrow crosses the gap over the shot
  // instead of stalling three cells out of the bow. The trail follows the head
  // rather than reaching back to the bow, and the whole mark still ends inside
  // `cells`, so the monster stays in column either way.
  function gapMarks(cells) {
    if (!anim || anim.type !== 'hit') return { flight: '', flightCol: 0, dmg: '', counter: '' };
    const d = anim.data;
    let flightCol = 0;
    let flight = '';
    if (!atk) {
      const travel = Math.min(HERO_GAP - 4, frame * 3);
      flight = R.fit(heroArt.trail.repeat(Math.min(3, travel + 1)) + heroArt.proj, cells);
    } else if (atk.fly != null) {
      const head = Math.round(atk.fly * Math.max(0, cells - 1));
      const tail = Math.min(3, head);
      flightCol = head - tail;
      flight = R.fit(heroArt.trail.repeat(tail) + heroArt.proj, cells - flightCol);
    }
    const num = (n, room) => {
      const exact = String(Math.max(0, Math.round(n || 0)));
      return exact.length <= room ? exact : R.fmt(Math.max(0, n || 0));
    };
    const landed = frame >= sprites.hitFrame(h.class);
    const dmg = landed
      ? R.c(d.crit ? 'brightRed' : 'brightYellow',
        R.fit(`✦-${num(d.dmg, cells - (d.crit ? 3 : 2))}${d.crit ? '!' : ''}`, cells))
      : '';
    // The counter waits for the same frame the damage does. It used to draw from
    // frame 0 — so on a blow that was answered, the monster's `↩-N` was on screen
    // a full beat before the arrow left the bow, and the scene read as the mob
    // striking first with the ranger's shot answering it. Nothing about the
    // engine was wrong: `retaliate` only ever runs off the back of a hero blow,
    // so a counter with no attack behind it isn't a state it can reach. The
    // false causality was drawing order alone. Both numbers belong to the moment
    // of impact, so both wait for it.
    const counter = landed && d.counter
      ? R.c('brightRed', R.fit(`↩-${num(d.counter, cells - 2)}`, cells))
      : '';
    return { flight, flightCol, dmg, counter };
  }

  let out;

  if (mode === 'compact') {
    const monster = dead ? sprites.DEAD_MONSTER : (mon.sprite || '(?)');
    const mid = Math.floor(cols / 2);
    const monLeft = R.centerAt(monster, mid);
    // Compact puts flight and damage on one line, so they share the gap: the
    // marks start a column in from the hero and stop a column short of the
    // monster.
    const g = gapMarks(HERO_GAP - 2);
    // Compact has one row and no pose art, so the recoil is all it takes from a
    // scripted attack. It ignores `flightCol` deliberately — the projectile and
    // the damage number share this row, so a head that crossed the gap would
    // shove the number off the end of it — and the lengthening trail carries the
    // shot instead.
    const scene = R.row()
      .put(heroArt.idle,
        Math.max(0, Math.max(LEFT_MIN, monLeft - HERO_GAP - R.width(heroArt.idle)) - recoil))
      .put(R.fit(g.flight + (g.dmg ? ' ' + g.dmg : ''), HERO_GAP - 2),
        Math.max(LEFT_MIN, monLeft - HERO_GAP + 1))
      .put(monster, monLeft)
      .toString();
    const info = R.row().put(bannerText() || infoText(), 2).toString();
    out = [line1, scene, info, tickerLine()];
  } else {
    const monArt = dead
      ? sprites.DEAD_MONSTER_BIG
      : sprites.bigMonster(mon.id, mon.sprite);
    const heroBig = (atk && atk.art) || sprites.bigHero(h.class);
    const monW = Math.max(...monArt.map(R.width));
    // The block the hero is centred in is the *idle* art's, not this frame's:
    // a pose that happened to be a cell narrower would otherwise re-centre every
    // row and make the whole sprite twitch on the frame it was held.
    const heroW = Math.max(...sprites.bigHero(h.class).map(R.width));
    const mid = Math.floor(cols / 2);
    // MAX_RECOIL is reserved to the hero's left at every width. Clamping the
    // flinch instead would make it fade out as the terminal narrowed — and the
    // clamp binds exactly at the widths where the scene is already tightest.
    const monLeft = Math.max(LEFT_MIN + sprites.MAX_RECOIL + heroW + HERO_GAP,
      Math.round(mid - monW / 2));
    const heroHome = Math.max(LEFT_MIN, monLeft - HERO_GAP - heroW);
    const heroLeft = Math.max(0, heroHome - recoil);
    // Anchored to where the hero stands, not to where it has been shoved: the
    // arrow has already left the bow, and marks that slid back with the recoil
    // would drag the damage number along with them.
    const gapLeft = heroHome + heroW + 2;
    // Derived from the layout rather than written down: the widest mark starts
    // at gapLeft + 1 and has to stop a column short of the monster art.
    const g = gapMarks(monLeft - gapLeft - 2);

    // Each art row is centred inside its own block, so ragged sprite lines
    // (a 3-cell hat over a 9-cell body) still stack straight.
    // The projectile flies along the sprites' waistline with the counter-hit
    // above it and the damage number below, so the trio stays centred in the
    // gap however tall the art gets.
    const waist = Math.floor(sprites.BIG_ROWS / 2);
    const art = [];
    for (let i = 0; i < sprites.BIG_ROWS; i++) {
      const hLine = heroBig[i] || '';
      const mLine = monArt[i] || '';
      const r = R.row().put(hLine, heroLeft + Math.round((heroW - R.width(hLine)) / 2));
      if (i === waist - 1 && g.counter) r.put(g.counter, gapLeft + 2);
      if (i === waist && g.flight) r.put(g.flight, gapLeft + g.flightCol);
      if (i === waist + 1 && g.dmg) r.put(g.dmg, gapLeft + 1);
      r.put(mLine, monLeft + Math.round((monW - R.width(mLine)) / 2));
      art.push(r.toString());
    }

    // The banner is scene-wide so it centres on the terminal; the info row is
    // the monster's nameplate, so it centres on the monster rather than drifting
    // left with the hero when a narrow terminal clamps the layout.
    const monMid = monLeft + monW / 2;
    const banner = bannerText();
    const infoRow = banner
      ? R.row().put(banner, R.centerAt(banner, mid)).toString()
      : R.row().put(infoText(), Math.max(LEFT_MIN, R.centerAt(infoText(), monMid))).toString();

    out = [line1, ...art, infoRow, tickerLine()];
  }

  console.log(out.map(l => R.keepIndent(R.fit(l, cols))).join('\n'));
}

// stdin may or may not arrive; render on end, but don't hang waiting forever.
let done = false;
const chunks = [];
function go() {
  if (done) return;
  done = true;
  try { main(Buffer.concat(chunks).toString()); } catch (_) { console.log('⚔ …'); }
  process.exit(0);
}
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', go);
process.stdin.on('error', go);
setTimeout(go, 200);
