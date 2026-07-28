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

function main() {
  const now = Date.now();
  const cols = parseInt(process.env.COLUMNS, 10) || 80;

  const P = require('../lib/paths');
  const S = require('../lib/state');
  const R = require('../lib/render');
  const C = require('../lib/content');
  const sprites = require('../lib/sprites');
  const B = require('../lib/balance');

  try { S.tryFold(now); } catch (_) { /* render last saved state */ }

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
  const xpStr = h.level >= B.LEVEL_CAP
    ? R.c('brightYellow', 'MAX')
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
  const dead = anim && anim.type === 'kill';

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
      case 'death':
        return R.c('brightRed', `✝ you died… -${anim.data.lost}g (respawned)`);
      case 'idle':
        return R.c('cyan', `⌛ while away: ${anim.data.kills} kills +${anim.data.xp}xp +${anim.data.gold}g`);
      case 'kill':
        return R.c('green', `${anim.data.name} slain  +${anim.data.xp}xp +${anim.data.gold}g`);
      case 'loot':
        return R.rarityColored(anim.data.rarity, `≡ [${anim.data.rarity}] ${anim.data.name} dropped!`);
      default:
        return null;
    }
  }

  // Monster identity + health, the row that sits under the sprite.
  function infoText() {
    const lvl = R.c('dim', `Lv ${m.level != null ? m.level : '?'}`);
    const nm = `${m.isBoss ? R.c('brightRed', '☠ ') : ''}${R.c('bold', m.name || '???')}`;
    const hpc = (m.hp || 0) / (m.maxHp || 1) < 0.25 ? 'brightRed' : 'red';
    const hp = R.c(hpc, `HP [${R.bar(m.hp || 0, m.maxHp || 1, 10)}] ${R.fmt(m.hp || 0)}/${R.fmt(m.maxHp || 0)}`);
    return `${lvl}  ${nm}   ${hp}`;
  }

  // Projectile + damage numbers that live in the gap between the combatants.
  function gapMarks() {
    if (!anim || anim.type !== 'hit') return { flight: '', dmg: '', counter: '' };
    const d = anim.data;
    const travel = Math.min(HERO_GAP - 4, frame * 3);
    const flight = heroArt.trail.repeat(Math.min(3, travel + 1)) + heroArt.proj;
    const dmg = frame >= 2
      ? R.c(d.crit ? 'brightRed' : 'brightYellow', `✦-${d.dmg}${d.crit ? '!' : ''}`)
      : '';
    const counter = d.counter
      ? R.c('brightRed', `↩-${d.counter}`)
      : '';
    return { flight, dmg, counter, travel };
  }

  let out;

  if (mode === 'compact') {
    const monster = dead ? sprites.DEAD_MONSTER : (m.sprite || '(?)');
    const mid = Math.floor(cols / 2);
    const monLeft = R.centerAt(monster, mid);
    const g = gapMarks();
    const scene = R.row()
      .put(heroArt.idle, Math.max(LEFT_MIN, monLeft - HERO_GAP - R.width(heroArt.idle)))
      .put(g.flight + (g.dmg ? ' ' + g.dmg : ''), Math.max(LEFT_MIN, monLeft - HERO_GAP + 1))
      .put(monster, monLeft)
      .toString();
    const info = R.row().put(bannerText() || infoText(), 2).toString();
    out = [line1, scene, info, tickerLine()];
  } else {
    const monArt = dead
      ? sprites.DEAD_MONSTER_BIG
      : sprites.bigMonster(m.id, m.sprite);
    const heroBig = sprites.bigHero(h.class);
    const monW = Math.max(...monArt.map(R.width));
    const heroW = Math.max(...heroBig.map(R.width));
    const mid = Math.floor(cols / 2);
    const monLeft = Math.max(LEFT_MIN + heroW + HERO_GAP, Math.round(mid - monW / 2));
    const heroLeft = Math.max(LEFT_MIN, monLeft - HERO_GAP - heroW);
    const gapLeft = heroLeft + heroW + 2;
    const g = gapMarks();

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
      if (i === waist && g.flight) r.put(g.flight, gapLeft);
      if (i === waist + 1 && g.dmg) r.put(g.dmg, gapLeft + 1);
      r.put(mLine, monLeft + Math.round((monW - R.width(mLine)) / 2));
      art.push(r.toString());
    }

    const banner = bannerText();
    const infoRow = banner
      ? R.row().put(banner, R.centerAt(banner, mid)).toString()
      : R.row().put(infoText(), Math.max(LEFT_MIN, R.centerAt(infoText(), mid))).toString();

    out = [line1, ...art, infoRow, tickerLine()];
  }

  console.log(out.map(l => R.keepIndent(R.fit(l, cols))).join('\n'));
}

// stdin may or may not arrive; render on end, but don't hang waiting forever.
let done = false;
function go() { if (!done) { done = true; try { main(); } catch (_) { console.log('⚔ …'); } process.exit(0); } }
process.stdin.on('data', () => {});
process.stdin.on('end', go);
process.stdin.on('error', go);
setTimeout(go, 200);
