#!/usr/bin/env node
'use strict';

// Statusline HUD. Reads Claude Code's statusline stdin JSON (unused except as
// a trigger), folds pending events, renders 1-3 lines by $COLUMNS.
// Never throws: worst case prints a minimal fallback and exits 0.

const fs = require('fs');

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

  // ---- active animation ----
  const anim = (state.anim || []).find(a => now >= a.at && now < a.at + a.dur);
  const frame = anim ? Math.floor((now - anim.at) / sprites.FRAME_MS) : 0;

  // ---- line 2: battle scene (or banner) + line 3: zone/ticker ----
  const tickerLine = () => {
    const parts = [R.c('dim', zone.name)];
    for (const t of (state.ticker || [])) parts.push(t);
    if (h.level > zone.max + 2) parts.push(R.c('brightYellow', 'zone cleared — /hero zone'));
    return '  ' + parts.join(R.c('dim', ' · '));
  };

  let line2, line3 = tickerLine();
  const banner = (txt, color) => R.c(color, txt);

  if (anim && anim.type === 'levelup') {
    const flash = frame % 2 === 0 ? 'brightYellow' : 'yellow';
    line2 = banner(`  ★★★ LEVEL UP — ${anim.data.level} ★★★`, flash);
  } else if (anim && anim.type === 'bossintro') {
    const flash = frame % 2 === 0 ? 'brightRed' : 'red';
    line2 = banner(`  ▓▓▓ ☠ BOSS: ${String(anim.data.name || '').toUpperCase()} ☠ ▓▓▓`, flash);
  } else if (anim && anim.type === 'bossdown') {
    line2 = banner(`  ☠ ${anim.data.name} DEFEATED${anim.data.unlocked ? ' — ' + anim.data.unlocked + ' unlocked' : ''} ☠`, 'brightYellow');
  } else if (anim && anim.type === 'death') {
    line2 = banner(`  ✝ you died… -${anim.data.lost}g (respawned)`, 'brightRed');
  } else if (anim && anim.type === 'idle') {
    line2 = banner(`  ⌛ while you were away: ${anim.data.kills} kills +${anim.data.xp}xp +${anim.data.gold}g`, 'cyan');
  } else {
    // battle scene: hero left, monster right, projectile mid-flight on hits
    const mName = m.name || '???';
    const mHp = `HP [${R.bar(m.hp || 0, m.maxHp || 1, 5)}] ${R.fmt(m.hp || 0)}/${R.fmt(m.maxHp || 0)}`;
    const mSide = `${m.isBoss ? R.c('brightRed', '☠ ') : ''}${m.sprite || '(?)'} ${R.c('bold', mName)}  ${R.c('red', mHp)}`;
    let mid = '';
    if (anim && anim.type === 'hit') {
      const gap = 12;
      const pos = Math.min(gap - 1, frame * 3);
      mid = ' '.repeat(pos) + heroArt.trail.repeat(Math.min(3, pos + 1)) + heroArt.proj;
      if (frame >= 3) {
        const d = anim.data;
        mid += ' ' + R.c(d.crit ? 'brightRed' : 'brightYellow', `✦-${d.dmg}${d.crit ? '!' : ''}`);
      }
      mid = mid.slice(0, 24);
    } else if (anim && anim.type === 'kill') {
      line3 = '  ' + R.c('green', `${sprites.DEAD_MONSTER} ${anim.data.name} slain  +${anim.data.xp}xp +${anim.data.gold}g`);
    } else if (anim && anim.type === 'loot') {
      line3 = '  ' + R.rarityColored(anim.data.rarity, `≡ [${anim.data.rarity}] ${anim.data.name} dropped!`);
    }
    line2 = `  ${heroArt.idle}${mid ? ' ' + mid : ''}`;
    const padTo = Math.max(2, cols - R.visible(line2).length - R.visible(mSide).length - 2);
    line2 += ' '.repeat(padTo) + mSide;
  }

  // ---- assemble by width ----
  let out;
  if (cols >= 80) {
    out = [line1, line2, line3];
  } else if (cols >= 50) {
    out = [line1, line2];
  } else {
    const hpS = `♥${h.hp}`;
    out = [`Lv${h.level} ${cls.name.slice(0, 3)} ${hpS} ${m.name ? m.name.replace(/ /g, '') : ''} ${R.fmt(m.hp || 0)}/${R.fmt(m.maxHp || 0)}`];
  }
  console.log(out.map(l => R.fit(l, cols)).join('\n'));
}

// stdin may or may not arrive; render on end, but don't hang waiting forever.
let done = false;
function go() { if (!done) { done = true; try { main(); } catch (_) { console.log('⚔ …'); } process.exit(0); } }
process.stdin.on('data', () => {});
process.stdin.on('end', go);
process.stdin.on('error', go);
setTimeout(go, 200);
