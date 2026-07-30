#!/usr/bin/env node
'use strict';

// idle-claude-rpg CLI. Plain text, non-interactive: every command works via
// the /hero skill or a raw `! node bin/rpg.js <cmd>`.

const fs = require('fs');
const P = require('../lib/paths');
const S = require('../lib/state');
const E = require('../lib/engine');
const B = require('../lib/balance');
const C = require('../lib/content');
const SHOP = require('../lib/shop');
const R = require('../lib/render');
const sprites = require('../lib/sprites');
const { mulberry32 } = require('../lib/rng');

const [, , cmd, ...args] = process.argv;

function flag(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null;
}

function requireSave() {
  S.tryFold(Date.now(), { cwd: process.cwd() });
  const state = S.loadState();
  if (!state) {
    // "No hero yet" is a lie on a machine with three of them — which is what a
    // window pinned by $IDLE_RPG_HERO at an empty slug sees, and the one way
    // this message can send you to `init` when you wanted `switch`.
    const others = P.listSlugs();
    console.log(others.length
      ? `No hero at ${P.activeSlug()}, but you have ${others.length} character${others.length === 1 ? '' : 's'}`
        + ' — /hero roster · /hero switch <n>'
      : 'No hero yet. Run: /hero init   (or: rpg.js init --class wizard --name You)');
    process.exit(1);
  }
  return state;
}

const HUD_BLURB = {
  big: '8 lines, 5-line sprites',
  compact: '4 lines, one-line sprites',
};

// The terminal's width, or 0 when there is none to read. Guessing 80 the way
// the statusline does would be wrong here: this command *warns* about width,
// and a guess would either invent a warning or suppress a real one. Zero means
// "say nothing about width", which is the honest answer when run through a
// tool's captured stdout rather than in front of a person.
function termCols() {
  return process.stdout.columns || parseInt(process.env.COLUMNS, 10) || 0;
}

// $RPG_HUD sits above the saved pin, so a player who set it once in settings.json
// and forgot would otherwise watch `/hero hud` change nothing, twice.
function envNote() {
  const env = (process.env.RPG_HUD || '').toLowerCase();
  if (env) console.log(R.c('dim', `  Note: $RPG_HUD=${env} is set, and overrides this.`));
}

function itemLine(it, i) {
  // Upgraded stats, since those are the ones actually fighting for you. The
  // rolled numbers stay on the item and show up in `/hero upgrade`.
  const a = E.itemStat(it, 'atk'), d = E.itemStat(it, 'def'), h = E.itemStat(it, 'hp');
  const stats = [a && `ATK+${a}`, d && `DEF+${d}`, h && `HP+${h}`].filter(Boolean).join(' ');
  const idx = i != null ? `${String(i + 1).padStart(2)}. ` : '';
  const plus = it.plus ? R.c('brightYellow', ` +${it.plus}`) : '';
  return `${idx}${R.rarityColored(it.rarity, `[${it.rarity}]`)} ${it.name}${plus} (${it.slot} i${it.ilvl}) ${stats}`;
}

// What an item is worth, and so which of two is "better" — shared with the
// engine so the CLI, `equip all` and the balance sim all rank items alike.
const itemValue = E.itemValue;

// `equip all`: fill every empty slot with the best thing in the bag that fits.
// Strictly additive — it never unequips, never displaces, and never touches a
// slot you already filled, so there is nothing to preview and nothing to undo.
// That is the whole point: kitting out a fresh set of twelve slots one index at
// a time is the same chore bulk selling already fixed at the other end.
function equipEmpty(st) {
  const empty = C.EQUIP_KEYS.filter(k => !st.equipment[k]);
  if (!empty.length) {
    const better = E.previewAutoEquip(st, { displace: true }).length;
    console.log(better
      ? `Every slot is already filled, but the bag beats ${better} of them. /hero equip best`
      : 'Every slot is already filled and nothing in the bag beats what you wear.');
    return;
  }
  if (!st.inventory.length) { console.log('Bag is empty — nothing to equip. Monsters drop loot as you code.'); return; }

  const filled = E.autoEquip(st, { displace: false });

  if (!filled.length) {
    // The dead end this command is most likely to hit, and the one that taught
    // the lesson: empty slots the bag can't fill, holding gear that beats what
    // you already wear. Saying only "nothing fits" is true and useless.
    const better = E.previewAutoEquip(st, { displace: true }).length;
    console.log(`Nothing in the bag fits your ${empty.length} empty slot${empty.length === 1 ? '' : 's'}`
      + ` (${empty.join(', ')}).`
      + (better ? ` It does beat ${better} slot${better === 1 ? '' : 's'} you're wearing — /hero equip best` : ''));
    return;
  }

  E.tick(st, `kitted out — ${filled.length} slot${filled.length === 1 ? '' : 's'} filled`);
  S.saveState(st);

  console.log(`\n  Equipped ${filled.length} item${filled.length === 1 ? '' : 's'} into empty slots:\n`);
  for (const f of filled) console.log(`  ${f.key.padEnd(8)} ${itemLine(f.item)}`);
  const left = C.EQUIP_KEYS.filter(k => !st.equipment[k]);
  console.log(`\n  ATK ${Math.round(E.heroAtk(st))}  DEF ${E.heroDef(st)}  HP ${st.hero.hp}/${st.hero.maxHp}`
    + ` · ${left.length ? `still empty: ${left.join(', ')}` : 'all twelve slots filled'}`);
  console.log(`  Bag ${st.inventory.length}/${B.INVENTORY_CAP}.`);
}

// `equip best`: the same ranking, but allowed to displace. A superset of
// `equip all` — it fills empty slots too — and the fix for the trap `equip all`
// sets by being strictly additive: a player who kits out twelve slots once is
// "geared" forever while the zone climbs past them, which is the balance sim's
// `fill` profile and it dies ~240 times a run.
//
// No preview and no --confirm, unlike bulk selling or `upgrade max`. Those spend
// gold, which is gone; this only ever moves gear between your body and your bag,
// so the worst case is one `equip <n>` to put something back. What it does owe
// you is a full account of the swap, which the report below is.
function equipBest(st) {
  if (!st.inventory.length) { console.log('Bag is empty — nothing to equip. Monsters drop loot as you code.'); return; }

  const before = { atk: Math.round(E.heroAtk(st)), def: E.heroDef(st), hp: st.hero.maxHp };
  const changes = E.autoEquip(st, { displace: true });

  if (!changes.length) {
    console.log(`Nothing in the bag beats what you already wear. Bag ${st.inventory.length}/${B.INVENTORY_CAP}.`);
    return;
  }

  E.tick(st, `re-geared — ${changes.length} slot${changes.length === 1 ? '' : 's'} improved`);
  S.saveState(st);

  console.log(`\n  Equipped ${changes.length} item${changes.length === 1 ? '' : 's'}:\n`);
  for (const c of changes) {
    console.log(`  ${c.key.padEnd(8)} ${itemLine(c.item)}`);
    if (c.replaced) console.log(`  ${''.padEnd(8)} ${R.c('dim', `↳ replaced ${c.replaced.name} → bag`)}`);
  }
  const after = { atk: Math.round(E.heroAtk(st)), def: E.heroDef(st), hp: st.hero.maxHp };
  const delta = (a, b) => (b === a ? `${b}` : `${b} (${b > a ? '+' : ''}${b - a})`);
  console.log(`\n  ATK ${delta(before.atk, after.atk)}  DEF ${delta(before.def, after.def)}`
    + `  HP ${st.hero.hp}/${delta(before.hp, after.hp)}`);
  console.log(`  Bag ${st.inventory.length}/${B.INVENTORY_CAP} — displaced gear is in it, not sold.`);
}

// The cap line: what you have, and how close the next point is.
function insightLine(h) {
  const banked = h.capXp || 0;
  const togo = B.INSIGHT_XP - banked;
  return `MAX · Insight ${h.insight || 0} (+${togo.toLocaleString('en-US')} xp to next)`;
}

// `/hero insight` — the paragon board. Buying one point is a small, immediate
// purchase like `upgrade <slot>`; `max` pours in everything affordable and is
// two-step like bulk selling, because it can empty a currency you cannot farm
// back quickly.
function insightBoard(st) {
  const h = st.hero;
  if (h.level < B.LEVEL_CAP && !(h.insight || h.capXp)) {
    console.log(`Insight is earned past level ${B.LEVEL_CAP} — you're level ${h.level}.`
      + ` Every point of XP you earn at the cap banks toward it instead of being discarded.`);
    return;
  }

  const togo = (B.INSIGHT_XP - (h.capXp || 0)).toLocaleString('en-US');
  console.log(`\n  Insight ${h.insight || 0} unspent · +${togo} xp to the next`
    + ` · ${st.counters.insightEarned || 0} earned all told\n`);

  for (const t of B.INSIGHT_TRACKS) {
    const pts = E.paragonPoints(st, t.id);
    const pct = Math.round((B.insightMult(t.id, pts) - 1) * 100);
    const cost = B.insightCost(pts);
    const tail = pts >= B.INSIGHT_TRACK_MAX
      ? R.c('dim', 'maxed')
      : `next +1 costs ${cost}${(h.insight || 0) >= cost ? '' : R.c('dim', ' — not yet')}`;
    console.log(`  ${t.id.padEnd(6)} ${String(pts).padStart(2)}/${B.INSIGHT_TRACK_MAX}`
      + `  +${pct}% ${t.of.padEnd(14)} ${tail}`);
  }
  console.log(`\n  ${B.INSIGHT_XP.toLocaleString('en-US')} xp per point. Gear, level and zone are never reset.`);
  console.log('  /hero insight <track> · /hero insight <track> max');
}

function insightBuy(st, id, all) {
  const t = B.insightTrack(id);
  if (!t) {
    console.log(`Unknown track "${id}". One of: ${B.INSIGHT_TRACKS.map(x => x.id).join(', ')}.`);
    process.exit(1);
  }

  if (!all) {
    const r = E.spendInsight(st, id);
    if (!r.ok) {
      console.log(r.why === 'maxed'
        ? `${id} is already at ${B.INSIGHT_TRACK_MAX}/${B.INSIGHT_TRACK_MAX}.`
        : `Not enough Insight — ${id} costs ${r.cost}, you have ${r.have}.`);
      process.exit(1);
    }
    E.tick(st, `insight → ${id} ${r.points}`);
    S.saveState(st);
    console.log(`${id} ${r.points - 1} → ${r.points} for ${r.cost} Insight`
      + ` (+${Math.round((B.insightMult(id, r.points) - 1) * 100)}% ${t.of}).`
      + ` ${st.hero.insight} left.`);
    return;
  }

  // Count what the spend would buy without spending it, so the preview and the
  // purchase can't disagree — same reasoning as previewAutoEquip.
  let pts = E.paragonPoints(st, id), have = st.hero.insight || 0, spend = 0, bought = 0;
  while (pts < B.INSIGHT_TRACK_MAX && have >= B.insightCost(pts)) {
    const c = B.insightCost(pts);
    have -= c; spend += c; pts += 1; bought += 1;
  }
  if (!bought) {
    console.log(pts >= B.INSIGHT_TRACK_MAX
      ? `${id} is already at ${B.INSIGHT_TRACK_MAX}/${B.INSIGHT_TRACK_MAX}.`
      : `Not enough Insight — the next ${id} point costs ${B.insightCost(pts)}, you have ${st.hero.insight || 0}.`);
    return;
  }

  const from = E.paragonPoints(st, id);
  const gain = Math.round((B.insightMult(id, pts) - B.insightMult(id, from)) * 100);
  if (!flag('confirm')) {
    console.log(`\n  ${id}: ${from} → ${pts} for ${spend} Insight, leaving ${have}.`);
    console.log(`  That buys +${gain}% ${t.of} (now +${Math.round((B.insightMult(id, pts) - 1) * 100)}% total).`);
    console.log(`\n  Nothing spent yet — confirm with:  /hero insight ${id} max --confirm`);
    return;
  }
  for (let i = 0; i < bought; i++) E.spendInsight(st, id);
  E.tick(st, `insight → ${id} ${pts}`);
  S.saveState(st);
  console.log(`${id} ${from} → ${pts} for ${spend} Insight (+${gain}% ${t.of}). ${st.hero.insight} left.`);
}

// The permanent record of finishing the game, for `status` and `stats`.
//
// An ISO date rather than a locale one: it is written into a save that outlives
// the terminal it was printed in, and a test that pins it should not depend on
// which machine ran it.
function clearedLine(st) {
  const n = st.counters.finalBossKills || 0;
  const on = new Date(st.hero.clearedAt).toISOString().slice(0, 10);
  return R.c('brightYellow', `✦ CLEARED ${on}`)
    // The last zone, not a hardcoded 'prod' — the engine calls a boss final
    // when `nextZone` returns null, so "the end" is a position in the list and
    // adding an eighth zone should move both together.
    + (n > 1 ? R.c('dim', ` — ${C.zones[C.zones.length - 1].boss.name} down ×${n}`) : '');
}

// ---------- the sitting, for `/hero stats` ----------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

// `/hero stats` opens on the sitting rather than the lifetime totals. The
// lifetime block answers "how far have I got", which the status line is already
// showing you all day; this one answers "what did this afternoon actually buy
// me", and nothing else in the game reports that.
function sittingBlock(st, now) {
  const s = E.sessionStats(st, now);
  if (!s) return;                     // pre-sitting save that hasn't folded yet

  console.log(`\n  This sitting — ${R.span(s.ms)}:`);
  if (E.sessionIsQuiet(s)) {
    console.log(R.c('dim', '  nothing yet — no kills, no commits, no code.'));
  } else {
    for (const line of sittingLines(s)) console.log(line);
  }

  // Which is the whole reason a closed sitting is kept: sit down, run
  // `/hero stats`, and the live one is thirty seconds old and empty. A quiet
  // previous sitting is skipped — "last sitting: 0 kills" is worse than silence.
  const last = st.lastSession;
  if (last && !E.sessionIsQuiet(last)) {
    const took = [`${plural(last.kills, 'kill')}`,
      last.goldEarned && `+${R.fmtGold(last.goldEarned)}`,
      last.commits && plural(last.commits, 'commit')].filter(Boolean).join(' · ');
    console.log(R.c('dim',
      `  before that — ${R.span(last.ms)}, ended ${R.relTime(Math.max(0, now - last.endedAt))} ago: ${took}`));
  }
}

function sittingLines(s) {
  const out = [];

  // Rate is the number an idle game is really being judged on, but it needs
  // enough clock under it to mean anything — three kills in the first minute is
  // 180/h and a lie. Below the floor the span is reported on its own and the
  // player can do the division if they care.
  const RATE_MIN_MS = 10 * 60 * 1000;
  const rate = s.ms >= RATE_MIN_MS && s.kills
    ? R.c('dim', ` (${(s.kills / (s.ms / 3600000)).toFixed(0)}/h)`) : '';
  const flavour = [
    s.bossKills && plural(s.bossKills, 'boss', 'bosses'),
    s.goblinKills && plural(s.goblinKills, 'goblin'),
  ].filter(Boolean).join(' · ');
  out.push(`  kills ${s.kills}${rate}${flavour ? ` — ${flavour}` : ''}`
    + (s.deaths ? `   deaths ${s.deaths}` : ''));

  const lvl = s.levels ? `  level ${s.fromLevel} → ${s.fromLevel + s.levels}` : '';
  out.push(`  gold +${R.fmtGold(s.goldEarned)}   xp +${s.xpEarned.toLocaleString('en-US')}${lvl}`);

  out.push(`  commits ${s.commits}  pushes ${s.pushes}  tests ${s.testsPassed}✓/${s.testsFailed}✗`
    + `  lines ${s.linesWritten.toLocaleString('en-US')}`);

  // Both halves of the drop filter, because "12 vendored" is what a run with no
  // upgrades in it looks like from the inside, and reporting only the kept side
  // makes a busy afternoon read as a dead one.
  if (s.drops || s.vendored) {
    out.push(`  loot ${s.drops} kept, ${s.vendored} vendored`
      + (s.goblinFled ? R.c('dim', `  ·  ${plural(s.goblinFled, 'goblin')} got away`) : ''));
  }
  if (s.insightEarned) out.push(`  insight +${s.insightEarned} — /hero insight`);
  return out;
}

// ---------- the roster ----------

// Pad by rendered width, not by code points: a name is user input and is
// legitimately CJK or emoji, both of which lie about their length.
const padTo = (s, n) => s + ' '.repeat(Math.max(1, n - R.width(s)));

function heroLabel(row) {
  if (!row.name) return R.c('dim', 'unreadable save');
  const cls = C.classes[row.class];
  return `${row.name} the ${cls ? cls.name : row.class || '?'}`;
}

function rosterRow(row, i, activeSlug, now) {
  const here = row.slug === activeSlug;
  const glyph = sprites.heroes[row.class] ? sprites.heroes[row.class].idle : '  ';
  const zone = row.zone && C.zoneById(row.zone) ? C.zoneById(row.zone).name : '—';
  const tail = row.clearedAt
    ? R.c('brightYellow', '✦ cleared')
    : R.c('dim', row.playedAt ? `${R.relTime(Math.max(0, now - row.playedAt))} ago` : '');
  // Padded by width rather than interpolated: every class sprite is 7 cells,
  // but the fallback for an unreadable save is not, and one short row shears
  // every column to its right.
  const line = `  ${here ? R.c('brightGreen', '▸') : ' '} ${i + 1}. `
    + padTo(glyph, 8)
    + padTo(heroLabel(row), 26)
    + padTo(row.level == null ? '' : `Lv ${row.level}`, 7)
    + padTo(zone, 18)
    + padTo(R.fmtGold(row.gold || 0), 10)
    + tail;
  return line.trimEnd();
}

// $IDLE_RPG_HERO sits above the `active` file exactly as $RPG_HUD sits above the
// saved HUD pin, so a window pinned by the environment has to say so — otherwise
// `switch` and `init` appear to do nothing here while quietly working everywhere
// else. Warn and obey, the same as `hud` does.
function heroEnvNote() {
  const env = (process.env.IDLE_RPG_HERO || '').trim();
  if (!env) return null;
  if (!P.isSlug(env)) {
    console.log(R.c('brightYellow', `  Note: $IDLE_RPG_HERO="${env}" is not a valid hero id, so it is ignored.`));
    return null;
  }
  console.log(R.c('dim', `  Note: $IDLE_RPG_HERO=${env} pins this window, and overrides the machine-wide choice.`));
  return env;
}

// A character named by roster number, by id, or by the start of the hero's name
// — because the number is what you just read, the id is what a script would
// hold, and the name is the only one of the three anybody remembers.
function pickCharacter(word, rows) {
  if (!word) return { why: 'missing' };
  if (/^\d+$/.test(word)) {
    const row = rows[parseInt(word, 10) - 1];
    return row ? { row } : { why: 'range' };
  }
  const exact = rows.find(r => r.slug === word);
  if (exact) return { row: exact };
  const lower = word.toLowerCase();
  const hits = rows.filter(r => (r.name || '').toLowerCase().startsWith(lower));
  if (hits.length === 1) return { row: hits[0] };
  if (hits.length > 1) return { why: 'ambiguous', hits };
  return { why: 'unknown' };
}

// Shared by `switch` and `delete`: resolve or explain, and never guess.
function resolveTarget(word, rows, usage) {
  const pick = pickCharacter(word, rows);
  if (pick.row) return pick.row;
  if (pick.why === 'ambiguous') {
    console.log(`"${word}" matches ${pick.hits.length} heroes: `
      + pick.hits.map(r => `${r.name} (${r.slug})`).join(', ') + '. Use the number or the id.');
  } else if (pick.why === 'range') {
    console.log(`There ${rows.length === 1 ? 'is' : 'are'} ${rows.length} character${rows.length === 1 ? '' : 's'} — /hero roster to list them.`);
  } else if (pick.why === 'missing') {
    console.log(usage);
  } else {
    console.log(`No character called "${word}". /hero roster to list them.`);
  }
  process.exit(1);
}

const commands = {

  init() {
    const clsId = typeof flag('class') === 'string' ? flag('class') : null;
    if (!clsId) {
      console.log('Choose your class — rerun with --class <id> [--name "YourName"]:\n');
      for (const c of Object.values(C.classes)) {
        console.log(`  ${c.id.padEnd(8)} ${sprites.heroes[c.id].idle.padEnd(12)} ${c.blurb}`);
      }
      console.log('\n  e.g.  node bin/rpg.js init --class wizard --name "Eva"');
      if (P.listSlugs().length) console.log('  Your existing heroes are safe — this adds one. /hero roster');
      return;
    }
    if (!C.classes[clsId]) { console.log(`Unknown class "${clsId}". Options: ${Object.keys(C.classes).join(', ')}`); process.exit(1); }

    // Nothing here is destructive any more, so there is no --force and no
    // refusal: `init` makes a *new* character and points the machine at it. The
    // flag used to mean "delete the hero I am about to stop using", which is
    // what `/hero delete` is for now.
    const before = P.listSlugs();
    const env = (process.env.IDLE_RPG_HERO || '').trim();
    // A window pinned at a slug that has no hero in it is asking for that hero
    // to exist, so build it there rather than somewhere the window can't see.
    const slug = P.isSlug(env) && !before.includes(env) ? env : P.freeSlug();

    const name = typeof flag('name') === 'string' ? flag('name') : 'Hero';
    const state = E.newState(clsId, name, Date.now());
    P.useSlug(slug);        // write the save…
    S.saveState(state);
    P.setActive(slug);      // …and only then send everyone else to it
    const c = C.classes[clsId];
    // The saved name, not the flag: newState sanitizes, and echoing the raw
    // argument would print the one string we just decided not to print.
    console.log(`\n  ${sprites.heroes[clsId].idle}  ${state.hero.name} the ${c.name} awakens in ${C.zoneById('grove').name}.`);
    console.log(`  A wild ${state.monster.name} ${state.monster.sprite} appears!\n`);
    console.log('  Every command you run in Claude Code is now an attack. Go build something.');
    if (before.length) {
      console.log(R.c('dim', `\n  ${before.length} other character${before.length === 1 ? '' : 's'} untouched`
        + ` — /hero roster · /hero switch <n>`));
    }
    if (P.isSlug(env) && env !== slug) {
      console.log(R.c('brightYellow',
        `\n  ⚠ this window is pinned to ${env} by $IDLE_RPG_HERO, so it keeps showing that hero.`));
    }
  },

  // The roster exists because there are four classes and you only ever play
  // one. Knight makes commits hit harder, Ranger turns lines of code into
  // damage — those genuinely change how your work maps to the game, and trying
  // a second one used to cost you the first.
  roster() {
    const rows = S.roster();
    const now = Date.now();
    if (!rows.length) {
      console.log('No heroes yet. Run: /hero init   (or: rpg.js init --class wizard --name You)');
      return;
    }
    const active = P.activeSlug();
    console.log(`\n  Characters (${rows.length}):\n`);
    rows.forEach((row, i) => console.log(rosterRow(row, i, active, now)));
    console.log('\n  /hero switch <n> · /hero init --class <id> --name "…" · /hero delete <n> --confirm');
    heroEnvNote();
  },

  // Switching is machine-wide, which is the direct cost of the property worth
  // keeping: one save behind every repo and every window is why three windows
  // triple your tick rate. $IDLE_RPG_HERO is the opt-out for anyone who wants
  // two heroes in two windows, and nobody else pays for it.
  switch() {
    const rows = S.roster();
    if (!rows.length) { console.log('No heroes yet. /hero init to make one.'); process.exit(1); }
    const row = resolveTarget(String(args[0] || ''), rows, 'Usage: /hero switch <n|id|name>  (see /hero roster)');

    if (row.slug === P.activeSlug()) {
      console.log(`Already playing ${heroLabel(row)}.`);
      heroEnvNote();
      return;
    }
    P.setActive(row.slug);
    console.log(`\n  ${sprites.heroes[row.class] ? sprites.heroes[row.class].idle : ''}  Now playing ${heroLabel(row)}`
      + `${row.level == null ? '' : `, level ${row.level}`}.`);
    console.log('  Every window on this machine follows, from its next frame.');
    const env = heroEnvNote();
    if (env && env !== row.slug) {
      console.log(R.c('brightYellow', `  ⚠ except this one — it stays on ${env} until you unset it.`));
    }
  },

  // One character, gone. `reset` is still the nuclear option; this is the one
  // you actually want, and the difference has to be visible in the wording
  // before the confirm rather than after it.
  delete() {
    const rows = S.roster();
    if (!rows.length) { console.log('No heroes to delete.'); process.exit(1); }
    const word = String(args.find(a => !a.startsWith('--')) || '');
    const row = word
      ? resolveTarget(word, rows, 'Usage: /hero delete <n|id|name> --confirm')
      : rows.find(r => r.slug === P.activeSlug()) || rows[0];

    if (!flag('confirm')) {
      console.log(`\n  This deletes ${heroLabel(row)}${row.level == null ? '' : `, level ${row.level}`}`
        + ` (${row.slug}) and every backup of them, forever.`);
      const left = rows.length - 1;
      console.log(`  ${left ? `${left} other character${left === 1 ? '' : 's'} would be untouched.` : 'It is your only character.'}`);
      console.log(`\n  Nothing deleted yet — confirm with:  /hero delete ${word || row.slug} --confirm`);
      return;
    }

    for (const f of S.saveFilesFor(row.slug)) {
      try { fs.unlinkSync(f); } catch (_) { /* not there */ }
    }
    // Only if it emptied: a live `state.tmp.<pid>.json` belongs to another
    // process, and saveFilesFor deliberately spares it.
    try { fs.rmdirSync(P.charDir(row.slug)); } catch (_) { /* something of theirs is still in it */ }

    // The pointer has to move or the next fold reads a hero who isn't there.
    // Fail-open would land on the first character anyway; doing it here means
    // the answer is written down rather than re-derived every process.
    const left = P.listSlugs();
    if (row.slug === P.activeSlug()) {
      if (left.length) P.setActive(left[0]);
      else try { fs.unlinkSync(P.activeFile); } catch (_) { /* never written */ }
    }
    console.log(`Deleted ${heroLabel(row)} (${row.slug}).`
      + (left.length ? ` Now playing ${heroLabel(S.describe(P.activeSlug()))}.` : ' /hero init to start over.'));
  },

  status() {
    const st = requireSave();
    const h = st.hero, m = st.monster, c = C.classes[h.class], zone = C.zoneById(h.zone);
    const xpNeed = h.level >= B.LEVEL_CAP ? 0 : B.xpToNext(h.level);
    // Which of your heroes this is, but only once there is more than one to
    // confuse it with — a roster of one is the game as it always was.
    const kin = P.listSlugs();
    const which = kin.length > 1
      ? R.c('dim', `   (${kin.indexOf(P.activeSlug()) + 1} of ${kin.length} — /hero roster)`) : '';
    console.log(`\n  ${sprites.heroes[h.class].idle}  ${h.name} the ${c.name} — Level ${h.level}${which}`);
    // At the cap the XP bar has nothing left to fill, so the line reports the
    // Insight the same XP is now banking instead — otherwise a capped hero reads
    // as a hero whose numbers have stopped moving.
    console.log(`  XP    ${h.level >= B.LEVEL_CAP ? insightLine(h) : `${h.xp}/${xpNeed} [${R.bar(h.xp, xpNeed, 20)}]`}`);
    console.log(`  HP    ${h.hp}/${h.maxHp}   ATK ${Math.round(E.heroAtk(st))}   DEF ${E.heroDef(st)}   Gold ${R.fmtGold(h.gold)}`);
    console.log(`  Zone  ${zone.name} (${zone.min}-${zone.max})`);
    if (h.clearedAt) console.log(`  ${clearedLine(st)}`);

    // Same battle scene as the statusline, minus the animation frames.
    const heroBig = sprites.bigHero(h.class);
    const monBig = sprites.bigMonster(m.id, m.sprite);
    const heroW = Math.max(...heroBig.map(R.width));
    const monW = Math.max(...monBig.map(R.width));
    console.log('');
    for (let i = 0; i < sprites.BIG_ROWS; i++) {
      const hl = heroBig[i] || '', ml = monBig[i] || '';
      console.log(R.row()
        .put(hl, 4 + Math.round((heroW - R.width(hl)) / 2))
        .put(ml, 4 + heroW + 14 + Math.round((monW - R.width(ml)) / 2))
        .toString());
    }
    console.log(`\n  Fighting: ${m.isBoss ? '☠ BOSS ' : ''}Lv${m.level} ${m.name}  HP ${m.hp}/${m.maxHp} [${R.bar(m.hp, m.maxHp, 20)}]`);
    if (!m.isBoss) console.log(`  ${E.bossGateText(st)}`);
    const worn = C.EQUIP_KEYS.filter(k => st.equipment[k]).length;
    console.log(`\n  Gear (${worn}/${C.EQUIP_KEYS.length} slots):`);
    for (const key of C.EQUIP_KEYS) {
      const it = st.equipment[key];
      console.log(`    ${key.padEnd(8)} ${it ? itemLine(it) : R.c('dim', '(empty)')}`);
    }
    console.log(`  Bag: ${st.inventory.length}/${B.INVENTORY_CAP} items — /hero inventory`);

    // One nudge, in priority order, or none. `equip all` is strictly additive by
    // design, so a player who runs it once reads as "geared" forever while the
    // zone climbs past them — the balance sim's `fill` profile, which dies ~240
    // times a run. Nothing in the game said so out loud until here.
    const better = E.previewAutoEquip(st, { displace: true }).length;
    const lag = E.gearLag(st);
    if (better) {
      console.log(R.c('yellow', `  ↑ ${better} slot${better === 1 ? '' : 's'} in your bag beat${better === 1 ? 's' : ''} what you're wearing — /hero equip best`));
    } else if (lag.ratio < E.GEAR_LAG_NUDGE) {
      console.log(R.c('yellow', `  ↑ your gear averages ilvl ${lag.mean.toFixed(1)} against level-${lag.target} trash — /hero shop`));
    }
  },

  zone() {
    const st = requireSave();
    if (args[0] === 'go') {
      const id = args[1];
      const z = C.zones.find(z => z.id === id);
      if (!z) { console.log(`Unknown zone "${id}". /hero zone to list.`); process.exit(1); }
      if (!st.hero.unlockedZones.includes(id)) { console.log(`${z.name} is locked — beat the previous zone's boss first.`); process.exit(1); }
      E.travelTo(st, id, mulberry32(Date.now() >>> 0), Date.now());
      E.tick(st, `travelled to ${z.name}`);
      S.saveState(st);
      console.log(`Travelled to ${z.name}. A ${st.monster.name} ${st.monster.sprite} blocks the path!`);
      return;
    }
    console.log('\n  Zones:');
    for (const z of C.zones) {
      const unlocked = st.hero.unlockedZones.includes(z.id);
      const here = st.hero.zone === z.id ? ' ◀ you' : '';
      const mark = unlocked ? ' ' : '🔒';
      console.log(`  ${mark} ${z.id.padEnd(9)} ${z.name.padEnd(20)} Lv${z.min}-${z.max}  boss: ${z.boss.name}${here}`);
    }
    console.log('\n  /hero zone go <id> to travel.');
  },

  // The shelf is rolled per zone per 4-hour window (see lib/shop.js), so it is
  // stable for as long as you're looking at it and different next time.
  shop() {
    const st = requireSave();
    const now = Date.now();
    const zone = C.zoneById(st.hero.zone);
    const { stock, rotated } = SHOP.refresh(st, now);
    const offers = SHOP.appraise(st, stock.offers);

    // A dominated offer is still buyable — the shelf is a roll, not a
    // recommendation, and someone stockpiling for a slot they're about to empty
    // is entitled to it. It just no longer looks like an opportunity.
    const VERDICT_NOTE = {
      same: ['dim', ' · you are wearing this'],
      worse: ['dim', ' · worse than worn'],
    };

    const listShelf = (lead) => {
      console.log(`\n  ${lead}\n`);
      offers.forEach((o, i) => {
        const note = VERDICT_NOTE[o.verdict];
        console.log(`  ${i + 1}. ${itemLine(o)} — ${R.fmtGold(o.price)}`
          + (o.sale ? R.c('brightGreen', ` SALE (was ${R.fmtGold(o.listPrice)})`) : '')
          + (note ? R.c(note[0], note[1]) : ''));
      });
      // Banking the gold is a real move, and a shelf where every line is dead
      // reads as "you can't afford anything" unless something says otherwise.
      if (!offers.some(o => o.verdict === 'upgrade')) {
        console.log(R.c('dim', '\n  Nothing here beats what you wear — the shelf rerolls every 4h.'));
      }
      console.log(`\n  /hero shop buy <1-${offers.length}>`);
    };

    if (args[0] === 'buy') {
      const n = parseInt(args[1], 10);
      // A rotation between reading the shelf and buying off it would spend the
      // player's gold on an item they never saw, so it cancels the buy and
      // shows the new shelf instead.
      if (rotated) {
        S.saveState(st);
        listShelf(`${zone.name} restocked before that went through — nothing bought.`
          + ` You have ${R.fmtGold(st.hero.gold)}:`);
        return;
      }
      const offer = offers[n - 1];
      if (!offer) { console.log(`Usage: /hero shop buy <1-${offers.length}>`); process.exit(1); }
      if (st.hero.gold < offer.price) { console.log(`Not enough gold (${R.fmtGold(st.hero.gold)} < ${R.fmtGold(offer.price)}).`); process.exit(1); }
      st.hero.gold -= offer.price;
      const item = {
        id: 'itm_shop' + now.toString(36), slot: offer.slot, name: offer.name,
        rarity: offer.rarity, ilvl: offer.ilvl, atk: offer.atk, def: offer.def, hp: offer.hp,
        plus: 0, from: 'shop', at: now,
      };
      E.addToInventory(st, item);
      S.saveState(st);
      // "/hero equip to wear it" is false for a dominated buy — `equip best`
      // ranks it below what's already on and would leave it in the bag, so the
      // player would run the command, see nothing happen, and wonder which of
      // the two was broken.
      console.log(`Bought ${itemLine(item)} for ${R.fmtGold(offer.price)}.`
        + (offer.verdict === 'upgrade'
          ? ' /hero equip to wear it.'
          : R.c('dim', ' It stays in your bag — what you wear already beats it.')));
      return;
    }

    S.saveState(st);
    listShelf(`${zone.name} shop — you have ${R.fmtGold(st.hero.gold)}`
      + ` · restocks in ${SHOP.fmtRestock(now)}:`);
  },

  inventory() {
    const st = requireSave();
    if (!st.inventory.length) { console.log('Bag is empty. Monsters drop loot as you code.'); return; }
    console.log(`\n  Bag (${st.inventory.length}/${B.INVENTORY_CAP}):\n`);
    st.inventory.forEach((it, i) => console.log('  ' + itemLine(it, i)));
    console.log('\n  /hero equip <n> · /hero equip all · /hero equip best · /hero upgrade · /hero sell <n> · /hero sell commons rares · /hero sell all');
  },

  // `equip <n>` fills the first free slot of the item's kind and only displaces
  // something when they're all full — and then the cheapest one, so putting on a
  // fourth ring never quietly bins your best. `equip all` fills every *empty*
  // slot at once and displaces nothing at all. `equip best` is `equip all` with
  // the gloves off: it also swaps out anything the bag beats.
  equip() {
    const st = requireSave();
    const word = String(args[0] || '').toLowerCase();
    if (word === 'all' || word === 'empty') return equipEmpty(st);
    if (word === 'best' || word === 'upgrade') return equipBest(st);

    const n = parseInt(args[0], 10);
    const item = st.inventory[n - 1];
    if (!item) { console.log('Usage: /hero equip <n> [slot] | all | best  (see /hero inventory)'); process.exit(1); }

    const keys = C.slotKeys(item.slot);
    if (!keys.length) { console.log(`${item.name} has an unknown slot "${item.slot}".`); process.exit(1); }
    let target;
    if (args[1]) {
      target = args[1].toLowerCase();
      if (!keys.includes(target)) {
        console.log(`${item.name} is a ${item.slot} — it goes in ${keys.join(', ')}, not "${args[1]}".`);
        process.exit(1);
      }
    } else {
      target = keys.find(k => !st.equipment[k])
        || keys.slice(1).reduce((worst, k) =>
          itemValue(st.equipment[k]) < itemValue(st.equipment[worst]) ? k : worst, keys[0]);
    }

    st.inventory.splice(n - 1, 1);
    const old = st.equipment[target];
    st.equipment[target] = item;
    if (old) st.inventory.push(old);
    E.refreshMaxHp(st);
    E.tick(st, `equipped ${item.name}`);
    S.saveState(st);
    console.log(`Equipped ${itemLine(item)} in ${target}`
      + `${old ? ` (unequipped ${old.name} → bag)` : ''}.`);
  },

  // Clearing a bag of grey junk one index at a time is the worst part of an
  // idle game, so `sell` also takes `all` or any list of rarities:
  //   sell 3 · sell all · sell commons · sell common, rare
  // Anything unrecognised sells nothing rather than guessing — a wrong guess
  // here is unrecoverable.
  sell() {
    const st = requireSave();
    const rarityIds = B.RARITIES.map(r => r.id);
    const usage = `Usage: /hero sell <n> | all | <rarity…>  (rarities: ${rarityIds.join(', ')})`;
    const words = args.filter(a => !a.startsWith('--'))
      .join(' ').toLowerCase().split(/[\s,+]+/).filter(Boolean);
    if (!words.length) { console.log(usage); process.exit(1); }
    if (!st.inventory.length) { console.log('Bag is empty. Monsters drop loot as you code.'); return; }

    // A number names exactly one item you just read off `/hero inventory`, so it
    // sells outright. `all` and rarity words match a set you can't see from the
    // command, so they preview first and only fire with --confirm.
    let picked;
    let bulk = true;
    if (words.length === 1 && /^\d+$/.test(words[0])) {
      const i = parseInt(words[0], 10) - 1;
      if (!st.inventory[i]) { console.log(`No item ${words[0]} in the bag (see /hero inventory).`); process.exit(1); }
      picked = [i];
      bulk = false;
    } else if (words.length === 1 && words[0] === 'all') {
      picked = st.inventory.map((_, i) => i);
    } else {
      const want = new Set();
      for (const w of words) {
        const id = rarityIds.find(r => r === w || `${r}s` === w);
        if (!id) { console.log(`Unknown rarity "${w}".\n${usage}`); process.exit(1); }
        want.add(id);
      }
      picked = st.inventory.flatMap((it, i) => (want.has(it.rarity) ? [i] : []));
    }
    if (!picked.length) { console.log(`Nothing in the bag matches "${words.join(' ')}".`); return; }

    const sold = picked.map(i => st.inventory[i]);
    const value = E.sellPrice;   // blind to `plus` — upgrade gold never comes back
    const gold = sold.reduce((sum, it) => sum + value(it), 0);

    if (bulk && !flag('confirm')) {
      const keep = st.inventory.length - sold.length;
      console.log(`\n  This would sell ${sold.length} of ${st.inventory.length} items for ${R.fmtGold(gold)}:\n`);
      sold.forEach(it => console.log(`  ${itemLine(it)} — ${R.fmtGold(value(it))}`));
      console.log(`\n  ${keep} item${keep === 1 ? '' : 's'} would stay in the bag. Nothing sold yet —`);
      console.log(`  confirm with:  /hero sell ${words.join(' ')} --confirm`);
      return;
    }

    for (const i of [...picked].reverse()) st.inventory.splice(i, 1);  // descending: earlier indices stay valid
    st.hero.gold += gold;
    S.saveState(st);

    if (sold.length === 1) {
      console.log(`Sold ${sold[0].name} for ${R.fmtGold(gold)}. You have ${R.fmtGold(st.hero.gold)}.`);
      return;
    }
    console.log(`\n  Sold ${sold.length} items for ${R.fmtGold(gold)}:\n`);
    sold.forEach(it => console.log(`  ${itemLine(it)} — ${R.fmtGold(value(it))}`));
    console.log(`\n  Bag ${st.inventory.length}/${B.INVENTORY_CAP} · you have ${R.fmtGold(st.hero.gold)}.`);
  },

  // Gold's only permanent home. Restricted to *worn* gear on purpose: those are
  // the stats actually fighting, and pouring gold into a bagged item you then
  // displace is a mistake the game shouldn't sell you.
  upgrade() {
    const st = requireSave();
    const word = (args[0] || '').toLowerCase();

    const shelf = () => {
      console.log(`\n  Upgrades — you have ${R.fmtGold(st.hero.gold)}:\n`);
      let cheapest = null;
      for (const key of C.EQUIP_KEYS) {
        const it = st.equipment[key];
        if (!it) { console.log(`  ${key.padEnd(8)} ${R.c('dim', '(empty)')}`); continue; }
        const plus = it.plus || 0;
        if (plus >= B.UPGRADE_MAX) {
          console.log(`  ${key.padEnd(8)} ${itemLine(it)} — ${R.c('brightYellow', 'MAX')}`);
          continue;
        }
        const cost = B.upgradeCost(it.ilvl, plus);
        const afford = st.hero.gold >= cost;
        if (afford && (!cheapest || cost < cheapest.cost)) cheapest = { key, cost };
        console.log(`  ${key.padEnd(8)} ${itemLine(it)} — +${plus + 1} costs `
          + `${afford ? R.fmtGold(cost) : R.c('dim', R.fmtGold(cost))}`);
      }
      console.log(`\n  Each + adds ${Math.round(B.UPGRADE_STAT_PER_PLUS * 100)}% of what the item rolled,`
        + ` up to +${B.UPGRADE_MAX}. Upgrades are not refunded when you sell.`);
      console.log(cheapest
        ? `  /hero upgrade <slot> · /hero upgrade <slot> max   (cheapest: ${cheapest.key}, ${R.fmtGold(cheapest.cost)})`
        : '  /hero upgrade <slot> — nothing is affordable yet.');
    };

    if (!word) return shelf();

    const it = st.equipment[word];
    if (!it) {
      console.log(C.EQUIP_KEYS.includes(word)
        ? `Nothing equipped in ${word}. /hero equip all`
        : `Unknown slot "${word}". One of: ${C.EQUIP_KEYS.join(', ')}`);
      process.exit(1);
    }

    // `max` pours gold in until it runs out, so it previews like bulk selling.
    if ((args[1] || '').toLowerCase() === 'max') {
      const before = it.plus || 0;
      let steps = 0, spend = 0, p = before;
      while (p < B.UPGRADE_MAX && spend + B.upgradeCost(it.ilvl, p) <= st.hero.gold) {
        spend += B.upgradeCost(it.ilvl, p); p += 1; steps += 1;
      }
      if (!steps) {
        console.log(`Cannot afford +${before + 1} on ${it.name} `
          + `(${R.fmtGold(B.upgradeCost(it.ilvl, before))}, you have ${R.fmtGold(st.hero.gold)}).`);
        return;
      }
      if (!flag('confirm')) {
        // Show the totals it would actually buy. At 2% a level, upgrading a
        // small early item can round to no visible change at all, and the
        // player deserves to see that before the gold is gone rather than after.
        const was = { atk: Math.round(E.heroAtk(st)), def: E.heroDef(st), hp: E.heroMaxHp(st) };
        const restore = it.plus || 0;
        it.plus = p;
        const now2 = { atk: Math.round(E.heroAtk(st)), def: E.heroDef(st), hp: E.heroMaxHp(st) };
        it.plus = restore;
        const arrow = (a, b) => (a === b ? R.c('dim', `${a} → ${b}`) : `${a} → ${b}`);
        console.log(`\n  This would take ${itemLine(it)}`);
        console.log(`  from +${before} to +${p} for ${R.fmtGold(spend)}, leaving ${R.fmtGold(st.hero.gold - spend)}.`);
        console.log(`  ATK ${arrow(was.atk, now2.atk)}   DEF ${arrow(was.def, now2.def)}   max HP ${arrow(was.hp, now2.hp)}`);
        if (was.atk === now2.atk && was.def === now2.def && was.hp === now2.hp) {
          console.log(R.c('dim', '  (rounds to no change — this item is too small to be worth it yet)'));
        }
        console.log(`\n  Nothing spent yet — confirm with:  /hero upgrade ${word} max --confirm`);
        return;
      }
      for (let i = 0; i < steps; i++) E.upgradeItem(st, it);
      E.tick(st, `${it.name} +${it.plus}`);
      S.saveState(st);
      console.log(`\n  ${itemLine(it)}`);
      console.log(`  +${before} → +${it.plus} for ${R.fmtGold(spend)}. `
        + `ATK ${Math.round(E.heroAtk(st))}  DEF ${E.heroDef(st)}  HP ${st.hero.hp}/${st.hero.maxHp} · ${R.fmtGold(st.hero.gold)} left.`);
      return;
    }

    const res = E.upgradeItem(st, it);
    if (!res.ok) {
      console.log(res.why === 'maxed'
        ? `${it.name} is already at +${B.UPGRADE_MAX}, the maximum.`
        : `Not enough gold: +${(it.plus || 0) + 1} on ${it.name} costs ${R.fmtGold(res.cost)}, you have ${R.fmtGold(st.hero.gold)}.`);
      process.exit(1);
    }
    E.tick(st, `${it.name} +${it.plus}`);
    S.saveState(st);
    console.log(`\n  ${itemLine(it)}`);
    console.log(`  +${res.plus - 1} → +${res.plus} for ${R.fmtGold(res.cost)}. `
      + `ATK ${Math.round(E.heroAtk(st))}  DEF ${E.heroDef(st)}  HP ${st.hero.hp}/${st.hero.maxHp} · ${R.fmtGold(st.hero.gold)} left.`);
  },

  insight() {
    const st = requireSave();
    const word = String(args[0] || '').toLowerCase();
    if (!word) return insightBoard(st);
    return insightBuy(st, word, String(args[1] || '').toLowerCase() === 'max');
  },

  stats() {
    const st = requireSave();
    const c = st.counters;
    const now = Date.now();
    sittingBlock(st, now);
    const days = Math.max(1, Math.round((now - st.createdAt) / 86400000));
    console.log(`\n  Lifetime (${days} days):`);
    if (st.hero.clearedAt) console.log(`  ${clearedLine(st)}`);
    console.log(`  kills ${c.kills} (${c.bossKills} bosses)  deaths ${c.deaths}`);
    console.log(`  commits ${c.commits}  pushes ${c.pushes}  tests ${c.testsPassed}✓/${c.testsFailed}✗`);
    console.log(`  lines of code ${c.linesWritten.toLocaleString('en-US')}  gold earned ${R.fmtGold(c.goldEarned)}`);
    if (c.insightEarned) console.log(`  insight earned ${c.insightEarned} (${st.hero.insight || 0} unspent) — /hero insight`);
  },

  hud() {
    const st = requireSave();
    const cols = termCols();
    const cur = R.HUD_MODES.includes(st.hud) ? st.hud : 'auto';
    const want = (args[0] || '').toLowerCase();

    // Reporting the *effective* layout matters more than reporting the setting:
    // "auto" alone doesn't tell a player which of the three they are looking at.
    const effective = m => m === 'auto' ? (cols ? R.hudFor(cols) : null) : m;

    if (!want) {
      const eff = effective(cur);
      console.log(`\n  HUD   ${cur === 'auto' ? 'auto — follows terminal width' : `pinned to ${cur}`}`);
      console.log(`  Now   ${eff ? `${eff} — ${HUD_BLURB[eff]}` : 'unknown here (no terminal width to read)'}`);
      if (cols) console.log(`  Width ${cols} cols` + (cur === 'auto' ? '' : `, which auto would draw as ${R.hudFor(cols)}`));
      const need = m => R.HUD_MIN_COLS[m] ? `≥${R.HUD_MIN_COLS[m]} cols` : 'any width';
      console.log('\n  ' + R.HUD_MODES.map(m => `${m.padEnd(7)} ${need(m).padEnd(10)} ${HUD_BLURB[m]}`).join('\n  '));
      console.log(`\n  Set it: /hero hud ${[...R.HUD_MODES, 'auto'].join(' | ')}`);
      envNote();
      return;
    }

    if (want !== 'auto' && !R.HUD_MODES.includes(want)) {
      console.log(`Unknown HUD mode "${want}". Options: ${[...R.HUD_MODES, 'auto'].join(', ')}`);
      process.exit(1);
    }

    if (want === 'auto') delete st.hud; else st.hud = want;
    S.saveState(st);

    // Warn and obey. A pin too wide for the terminal shears the sprite rows
    // rather than failing, so the player has to be told — but it is their
    // terminal, and `auto` is one word away.
    if (want !== 'auto' && cols && cols < R.HUD_MIN_COLS[want]) {
      console.log(`\n  ${R.c('brightYellow', '⚠')} ${want} wants ≥${R.HUD_MIN_COLS[want]} cols and this terminal is ${cols} —`);
      console.log('    the sprite rows will wrap and shear. Pinned anyway.');
    }
    console.log(want === 'auto'
      ? `\n  HUD back to auto — the layout follows terminal width again${cols ? ` (${R.hudFor(cols)} at ${cols} cols)` : ''}.`
      : `\n  HUD pinned to ${want} — ${HUD_BLURB[want]}.`);
    console.log('  Takes effect on the next statusline frame.');
    envNote();
  },

  fold() {
    const ok = S.tryFold(Date.now());
    console.log(ok ? 'Folded.' : 'Nothing to fold (no save, or another fold is running).');
  },

  sim() {
    const days = parseInt(flag('days') || args[0], 10) || 90;
    const perDay = parseInt(flag('events') || args[1], 10) || 300;
    require('../test/sim').run(days, perDay, true);
  },

  // The nuclear option: every character, not just the one you are playing.
  // `/hero delete` is the scalpel. The wording changed at the same commit as
  // the behaviour, because "this deletes your hero forever" is now true of a
  // different, smaller command.
  reset() {
    const slugs = P.listSlugs();
    if (!flag('confirm')) {
      console.log(slugs.length > 1
        ? `This deletes all ${slugs.length} of your characters forever — not just the one you are playing.`
          + '\n  For one of them: /hero delete <n> --confirm   (see /hero roster)'
          + '\n  Rerun with --confirm to wipe every hero on this machine.'
        : 'This deletes your hero forever. Rerun with --confirm.');
      process.exit(1);
    }
    // S.saveFilesFor rather than a list written out here: a save spills into
    // quarantined and pre-migration copies, and "forever" has to mean them too.
    for (const slug of slugs) {
      for (const f of S.saveFilesFor(slug)) {
        try { fs.unlinkSync(f); } catch (_) {}
      }
      try { fs.rmdirSync(P.charDir(slug)); } catch (_) {}
    }
    for (const f of S.globalFiles()) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
    console.log(slugs.length > 1
      ? `${slugs.length} characters deleted. /hero init to start over.`
      : 'Save deleted. /hero init to start over.');
  },
};

const fn = commands[cmd];
if (!fn) {
  // One string literal, deliberately: test/skill.test.js reads the command list
  // straight out of this line to prove every command is documented, and a
  // concatenation would quietly hand it half the list.
  console.log('idle-claude-rpg — commands: init status zone shop inventory equip upgrade insight sell stats hud roster switch delete fold sim reset');
  process.exit(cmd ? 1 : 0);
}
fn();
