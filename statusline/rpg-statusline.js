#!/usr/bin/env node
'use strict';

// Statusline HUD. Reads Claude Code's statusline stdin JSON (unused except as
// a trigger), folds pending events, renders a battle scene sized to $COLUMNS.
// Never throws: worst case prints a minimal fallback and exits 0.
//
// Two layouts, picked by width unless the save pins one (`/hero hud <mode>`)
// or $RPG_HUD overrides both (RPG_HUD=big|compact):
//   big     8 lines — 5-line sprites, monster centred, name/level/HP beneath
//   compact 4 lines — one-line sprites, monster centred; every line is cut to
//                     `cols` on the way out, so this is also the narrow case
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

  // Three tiers, most explicit first: $RPG_HUD for a one-off override from the
  // shell, then the layout the save pins (`/hero hud <mode>`), then the width.
  // The saved value is validated rather than trusted — it is a field in a file
  // the player can edit, and an unknown mode would fall through every branch
  // below and render nothing at all.
  const pinned = R.HUD_MODES.includes(state.hud) ? state.hud : null;
  const mode = (process.env.RPG_HUD || '').toLowerCase()
    || pinned
    || R.hudFor(cols);

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
        return R.c('cyan', `⌛ while away: ${anim.data.kills} kills +${R.fmt(anim.data.xp)}xp +${R.fmtGold(anim.data.gold)}`)
          // Tacked on rather than given its own frame: you were not here for
          // either event, so they are one piece of news about the same absence.
          + (anim.data.goblinFled ? R.c('brightRed', ' · a goblin got away') : '');
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
  // The monster's own blow (`sprites.monsterAttack`), which has no class and no
  // pose art — one displacement per frame, applied to whichever of the 28
  // sprites happens to be standing there. It drives the hero back too, so the
  // recoil field is shared: on any given frame at most one of the two is live.
  const mAtk = anim && anim.type === 'mhit' ? sprites.monsterAttackFrame(frame, mon.id) : null;
  const recoil = atk ? atk.back : (mAtk ? mAtk.hero : 0);

  // Bosses swing deeper than the shared script (sprites.BOSS_SWING), and the
  // extra depth is bought with distance rather than out of the gap: a boss that
  // comes four cells further stands four cells further back, so the gap it has
  // closed on the impact frame is the same one every other monster closes to.
  // Everything below measures from `gap` instead of the constant for that
  // reason — the constant is now the *default* standoff, not the only one.
  const gap = HERO_GAP + sprites.monsterStandoff(mon.id);

  // And the other side of the same exchange: what the monster does when the
  // hero's blow lands on it. Reckoned in frames *since* impact so it stays in
  // step with a class that lands on a different one, and confined to `hit`
  // anims — the corpse the kill swaps in must not be seen flinching.
  const hitLandsOn = sprites.hitFrame(h.class);
  const struck = anim && anim.type === 'hit' && frame >= hitLandsOn
    ? sprites.monsterFlinchFrame(frame - hitLandsOn)
    : null;
  // Positive is toward the hero. A flinch belongs to the hero's hit anim and a
  // lunge to the monster's own, so this is a sum of one term either way — but
  // writing it as a sum is what makes the sign convention hold if that changes.
  const monShove = (mAtk ? mAtk.shove : 0) + (struck ? struck.shove : 0);
  // The sprite lights up in the colour of the number that is hitting it. Yellow
  // rather than red on purpose: in the big HUD both combatants are drawn on the
  // same physical lines, and red already means "the hero is taking damage"
  // there. A crit says so with `✦-N!` and does not need a second channel.
  //
  // Empty rows pass through untouched, exactly as `tint` does: `bigMonster` pads
  // a monster with no big art out to BIG_ROWS with blank strings, and colouring
  // one leaves a zero-width pair of escapes that `keepIndent` cannot trim off
  // the end of the line — the line then has trailing whitespace before them.
  const monTint = s => (s && struck && struck.flash ? R.c('brightYellow', s) : s);

  // Taking one is drawn as a colour rather than a pose. The hero has four
  // classes and every one of them is mid-attack when the blow arrives — a
  // flinch pose would have to be authored against each attack frame, and would
  // fight the recoil the script is already applying. Washing the sprite red
  // costs nothing per class and reads instantly, which is the whole job.
  //
  // It runs from the frame the counter-blow lands (the same frame its `↩-N`
  // appears — both are the moment of impact) to the end of the animation, and
  // for the whole of a death. Alternating two reds rather than holding one:
  // the HUD is redrawn about once a second, so a viewer sees isolated frames,
  // and a flat wash would be indistinguishable from a hero who simply is red.
  const landedOn = anim && anim.type === 'hit' && frame >= hitLandsOn;
  // The unprovoked blow reddens the hero on exactly the same terms: from the
  // frame it lands, which is also the frame its figure appears in the gap.
  const struckHero = !!anim && anim.type === 'mhit' && frame >= sprites.MONSTER_HIT_FRAME;
  const hurt = !!anim
    && (anim.type === 'death' || (landedOn && anim.data.counter > 0) || struckHero);

  // The other half of the same roll: the monster swung and missed. The engine
  // only ever tags this when nothing landed on that record (`engine.retaliate`),
  // so the two are mutually exclusive by construction — the ordering below just
  // makes that impossible to get wrong from here.
  const dodged = !!landedOn && !!anim.data.dodged;

  // Colour is the channel for what happened *to* the hero: red for a blow taken,
  // dimmed to an afterimage for one slipped. The sprite carries the motion (the
  // lean, below) and the gap carries the verdict, so neither has to do both.
  const tint = s => {
    if (!s) return s;
    if (hurt) return R.c(frame % 2 === 0 ? 'brightRed' : 'red', s);
    if (dodged) return R.c('dim', s);
    return s;
  };

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
  // Exact while it fits, `fmt` when it doesn't. Shared by both directions of the
  // gap because the ceiling problem is: `enqueue` coalesces either kind of blow.
  const num = (n, room) => {
    const exact = String(Math.max(0, Math.round(n || 0)));
    return exact.length <= room ? exact : R.fmt(Math.max(0, n || 0));
  };

  // The monster's blow crossing the gap: the same mark as the hero's, run
  // backwards. The head starts against the monster and arrives at the hero, so
  // the trail streams out to its *right*, and the figure underneath is what came
  // off the hero — `♥-N`, the glyph the vitals line already spends on HP, rather
  // than the counter's `↩-N`, which means "in answer to yours" and this is not.
  function monsterMarks(cells) {
    let flight = '';
    let flightCol = 0;
    if (mAtk && mAtk.fly != null) {
      // Mirror of the hero's flight: the head travels the gap less its own
      // width so it lands *against* the hero rather than half inside it, and
      // fly 1 is the hero's end, which is column 0.
      const span = Math.max(0, cells - R.width(sprites.MONSTER_PROJ));
      const head = Math.round((1 - mAtk.fly) * span);
      const tail = Math.max(0, Math.min(3, span - head));
      flightCol = head;
      flight = R.fit(sprites.MONSTER_PROJ + sprites.MONSTER_TRAIL.repeat(tail), cells - head);
    }
    const dmg = frame >= sprites.MONSTER_HIT_FRAME
      ? R.c('brightRed', R.fit(`♥-${num(anim.data.dmg, cells - 2)}`, cells))
      : '';
    return { flight, flightCol, dmg, counter: '' };
  }

  function gapMarks(cells) {
    if (anim && anim.type === 'mhit') return monsterMarks(cells);
    if (!anim || anim.type !== 'hit') return { flight: '', flightCol: 0, dmg: '', counter: '' };
    const d = anim.data;
    let flightCol = 0;
    let flight = '';
    if (!atk) {
      const travel = Math.min(gap - 4, frame * 3);
      flight = R.fit(heroArt.trail.repeat(Math.min(3, travel + 1)) + heroArt.proj, cells);
    } else if (atk.fly != null) {
      // The head travels the gap less its own width, so a projectile wider than
      // one cell lands *against* the monster rather than half inside it. The
      // unscripted branch above never had to care — nothing moved its mark, so
      // R.fit alone kept it in the gap — but here R.fit would silently eat the
      // projectile itself and leave a trail pointing at nothing.
      const span = Math.max(0, cells - R.width(heroArt.proj));
      const head = Math.round(atk.fly * span);
      const tail = Math.min(3, head);
      flightCol = head - tail;
      flight = R.fit(heroArt.trail.repeat(tail) + heroArt.proj, cells - flightCol);
    }
    const landed = frame >= hitLandsOn;
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
    // A dodge takes the counter's slot in the gap, because it is the same slot in
    // the exchange: what the monster did back. Green against the counter's red,
    // and worded rather than numbered — a miss has no quantity, and `↩-0` would
    // read as a counter that did nothing rather than as one that never landed.
    const counter = landed && d.counter
      ? R.c('brightRed', R.fit(`↩-${num(d.counter, cells - 2)}`, cells))
      : dodged ? R.c('brightGreen', R.fit('↩ dodge', cells)) : '';
    return { flight, flightCol, dmg, counter };
  }

  let out;

  if (mode === 'compact') {
    const monster = dead ? sprites.DEAD_MONSTER : (mon.sprite || '(?)');
    const mid = Math.floor(cols / 2);
    // Home is the mark the monster is centred on and returns to; `monDraw` is
    // where this frame actually puts it. Everything else in the scene — the
    // hero, the gap, the nameplate — is measured from home, so a lunge or a
    // knockback moves one sprite instead of shunting the whole layout.
    const monHome = Math.min(R.centerAt(monster, mid),
      Math.max(0, cols - R.width(monster) - sprites.MAX_MONSTER_BACK));
    const monDraw = Math.max(0, monHome - monShove);
    // Compact puts flight and damage on one line, so they share the gap: the
    // marks start a column in from the hero and stop a column short of the
    // monster — of where it is *drawn*, so a lunge forward is not met by the
    // mark it is carrying. `row.put` butts overlapping text on with a space
    // rather than overlapping it, so a collision here would slide the sprite
    // off the terminal midpoint rather than looking like a collision.
    const markLeft = Math.max(LEFT_MIN, monHome - gap + 1);
    const cells = Math.max(1, monDraw - markLeft - 1);
    const g = gapMarks(cells);
    // Compact has one row and no pose art, so the recoil is all it takes from a
    // scripted attack. It ignores `flightCol` deliberately — the projectile and
    // the damage number share this row, so a head that crossed the gap would
    // shove the number off the end of it — and the lengthening trail carries the
    // shot instead.
    //
    // Which end the trail lengthens *from* is then the only thing left saying
    // which way the blow is going, so the two directions hang from opposite
    // ends: the hero's mark grows out of the hero, and the monster's is pinned
    // against the monster so its head advances on the hero as it grows. Pinned
    // the other way it read as a blow that had already arrived on the frame
    // before it was thrown. The figure stays at the hero's end either way —
    // `♥-N` is the hero's HP wherever the blow came from.
    //
    // Pinning to `monDraw` rather than to the mark also rides the arm: the whole
    // reach gives a cell back as the lunge recovers. That is the thing being
    // drawn, so it stays.
    // One row of hero can't bend, so compact spends the whole lean on moving it:
    // the deepest row of DODGE_LEAN is how far the body got out of the way.
    const lean = dodged ? Math.max(...sprites.DODGE_LEAN) : 0;
    const marks = mAtk
      ? (g.flight ? R.spread(g.dmg, g.flight, cells) : g.dmg)
      : g.flight + (g.dmg ? ' ' + g.dmg : '');
    const scene = R.row()
      .put(tint(heroArt.idle),
        Math.max(0, Math.max(LEFT_MIN, monHome - gap - R.width(heroArt.idle)) - recoil - lean))
      .put(R.fit(marks, cells), markLeft)
      .put(monTint(monster), monDraw)
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
    //
    // MAX_MONSTER_BACK is the same reservation against the right-hand edge, and
    // it is a different kind of edge: nothing throws an error there, `R.fit`
    // just trims the line and a knocked-back boss silently loses its last two
    // columns. The reserve gives way to the hero's margin at widths too narrow
    // to honour both, because the left one is the one holding the scene up.
    const monHome = Math.max(LEFT_MIN + sprites.MAX_RECOIL + heroW + gap,
      Math.min(Math.round(mid - monW / 2), cols - monW - sprites.MAX_MONSTER_BACK));
    const monDraw = Math.max(0, monHome - monShove);
    const heroHome = Math.max(LEFT_MIN, monHome - gap - heroW);
    const heroLeft = Math.max(0, heroHome - recoil);
    // Anchored to where the hero stands, not to where it has been shoved: the
    // arrow has already left the bow, and marks that slid back with the recoil
    // would drag the damage number along with them.
    const gapLeft = heroHome + heroW + 2;
    // Derived from the layout rather than written down: the widest mark starts
    // at gapLeft + 1 and has to stop a column short of the monster art — of
    // where that art is *drawn* this frame, not of its mark. A monster lunging
    // forward closes the gap it is reaching across, and marks measured against
    // its home column would be butted aside by `row.put` on exactly the two art
    // rows that carry them, which is a shear rather than a collision.
    const g = gapMarks(Math.max(1, monDraw - gapLeft - 2));

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
      // The lean is per row, so it is the one displacement that is not shared by
      // the whole sprite — and it is applied to `heroLeft`, which already has the
      // script's recoil in it, so a hero shoved back mid-shot leans from wherever
      // that left it. MAX_RECOIL reserves room for the pair together.
      const lean = dodged ? (sprites.DODGE_LEAN[i] || 0) : 0;
      const r = R.row().put(tint(hLine),
        Math.max(0, heroLeft - lean + Math.round((heroW - R.width(hLine)) / 2)));
      if (i === waist - 1 && g.counter) r.put(g.counter, gapLeft + 2);
      if (i === waist && g.flight) r.put(g.flight, gapLeft + g.flightCol);
      if (i === waist + 1 && g.dmg) r.put(g.dmg, gapLeft + 1);
      r.put(monTint(mLine), monDraw + Math.round((monW - R.width(mLine)) / 2));
      art.push(r.toString());
    }

    // The banner is scene-wide so it centres on the terminal; the info row is
    // the monster's nameplate, so it centres on the monster rather than drifting
    // left with the hero when a narrow terminal clamps the layout.
    // Centred on the monster's mark, not on where this frame shoved it: a
    // nameplate that shuffled sideways under a flinching sprite would read as
    // the layout coming apart rather than as the monster moving.
    const monMid = monHome + monW / 2;
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
