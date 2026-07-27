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
const R = require('../lib/render');
const sprites = require('../lib/sprites');
const { mulberry32 } = require('../lib/rng');

const [, , cmd, ...args] = process.argv;

function flag(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null;
}

function requireSave() {
  S.tryFold(Date.now());
  const state = S.loadState();
  if (!state) {
    console.log('No hero yet. Run: /hero init   (or: rpg.js init --class wizard --name You)');
    process.exit(1);
  }
  return state;
}

function itemLine(it, i) {
  const stats = [it.atk && `ATK+${it.atk}`, it.def && `DEF+${it.def}`, it.hp && `HP+${it.hp}`]
    .filter(Boolean).join(' ');
  const idx = i != null ? `${String(i + 1).padStart(2)}. ` : '';
  return `${idx}${R.rarityColored(it.rarity, `[${it.rarity}]`)} ${it.name} (${it.slot} i${it.ilvl}) ${stats}`;
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
      return;
    }
    if (!C.classes[clsId]) { console.log(`Unknown class "${clsId}". Options: ${Object.keys(C.classes).join(', ')}`); process.exit(1); }
    if (S.hasSave() && !flag('force')) {
      console.log('A save already exists. Use --force to overwrite it (this deletes your hero).');
      process.exit(1);
    }
    const name = typeof flag('name') === 'string' ? flag('name') : 'Hero';
    const state = E.newState(clsId, name, Date.now());
    S.saveState(state);
    const c = C.classes[clsId];
    console.log(`\n  ${sprites.heroes[clsId].idle}  ${name} the ${c.name} awakens in ${C.zoneById('grove').name}.`);
    console.log(`  A wild ${state.monster.name} ${state.monster.sprite} appears!\n`);
    console.log('  Every command you run in Claude Code is now an attack. Go build something.');
  },

  status() {
    const st = requireSave();
    const h = st.hero, m = st.monster, c = C.classes[h.class], zone = C.zoneById(h.zone);
    const xpNeed = h.level >= B.LEVEL_CAP ? 0 : B.xpToNext(h.level);
    console.log(`\n  ${sprites.heroes[h.class].idle}  ${h.name} the ${c.name} — Level ${h.level}`);
    console.log(`  XP    ${h.level >= B.LEVEL_CAP ? 'MAX' : `${h.xp}/${xpNeed} [${R.bar(h.xp, xpNeed, 20)}]`}`);
    console.log(`  HP    ${h.hp}/${h.maxHp}   ATK ${Math.round(E.heroAtk(st))}   DEF ${E.heroDef(st)}   Gold ${R.fmtGold(h.gold)}`);
    console.log(`  Zone  ${zone.name} (${zone.min}-${zone.max})`);

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
    if (!m.isBoss) {
      const left = Math.max(0, B.BOSS_KILLS_REQUIRED - st.counters.killsSinceBoss);
      console.log(`  Boss in ${left} more kills (need Lv${zone.boss.level - 1}+): ${zone.boss.name}`);
    }
    console.log('\n  Gear:');
    for (const slot of ['weapon', 'armor', 'trinket']) {
      const it = st.equipment[slot];
      console.log(`    ${slot.padEnd(8)} ${it ? itemLine(it) : R.c('dim', '(empty)')}`);
    }
    console.log(`  Bag: ${st.inventory.length}/${B.INVENTORY_CAP} items — /hero inventory`);
  },

  zone() {
    const st = requireSave();
    if (args[0] === 'go') {
      const id = args[1];
      const z = C.zones.find(z => z.id === id);
      if (!z) { console.log(`Unknown zone "${id}". /hero zone to list.`); process.exit(1); }
      if (!st.hero.unlockedZones.includes(id)) { console.log(`${z.name} is locked — beat the previous zone's boss first.`); process.exit(1); }
      st.hero.zone = id;
      E.spawnMonster(st, mulberry32(Date.now() >>> 0));
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

  shop() {
    const st = requireSave();
    const zone = C.zoneById(st.hero.zone);
    const ilvl = Math.min(zone.max, zone.min + 2);
    // fixed per-zone offers: one uncommon, one rare, one epic
    const offers = ['uncommon', 'rare', 'epic'].map((rid, i) => {
      const rarity = B.RARITIES.find(r => r.id === rid);
      const slot = ['weapon', 'armor', 'trinket'][i];
      const stats = B.itemStats(slot, ilvl, rarity.mult);
      return {
        slot, rarity: rid, ilvl, ...stats,
        name: `${C.RARITY_ADJ[rid]} ${zone.flavor} ${C.SLOT_NOUNS[slot][0]}`,
        price: B.shopPrice(ilvl, rarity.mult),
      };
    });
    if (args[0] === 'buy') {
      const n = parseInt(args[1], 10);
      const offer = offers[n - 1];
      if (!offer) { console.log('Usage: /hero shop buy <1-3>'); process.exit(1); }
      if (st.hero.gold < offer.price) { console.log(`Not enough gold (${R.fmtGold(st.hero.gold)} < ${R.fmtGold(offer.price)}).`); process.exit(1); }
      st.hero.gold -= offer.price;
      const item = {
        id: 'itm_shop' + Date.now().toString(36), slot: offer.slot, name: offer.name,
        rarity: offer.rarity, ilvl: offer.ilvl, atk: offer.atk, def: offer.def, hp: offer.hp,
        from: 'shop', at: Date.now(),
      };
      E.addToInventory(st, item);
      S.saveState(st);
      console.log(`Bought ${itemLine(item)} for ${R.fmtGold(offer.price)}. /hero equip to wear it.`);
      return;
    }
    console.log(`\n  ${zone.name} shop — you have ${R.fmtGold(st.hero.gold)}:\n`);
    offers.forEach((o, i) => console.log(`  ${i + 1}. ${itemLine(o)} — ${R.fmtGold(o.price)}`));
    console.log('\n  /hero shop buy <n>');
  },

  inventory() {
    const st = requireSave();
    if (!st.inventory.length) { console.log('Bag is empty. Monsters drop loot as you code.'); return; }
    console.log(`\n  Bag (${st.inventory.length}/${B.INVENTORY_CAP}):\n`);
    st.inventory.forEach((it, i) => console.log('  ' + itemLine(it, i)));
    console.log('\n  /hero equip <n> · /hero sell <n>');
  },

  equip() {
    const st = requireSave();
    const n = parseInt(args[0], 10);
    const item = st.inventory[n - 1];
    if (!item) { console.log('Usage: /hero equip <n> (see /hero inventory)'); process.exit(1); }
    st.inventory.splice(n - 1, 1);
    const old = st.equipment[item.slot];
    st.equipment[item.slot] = item;
    if (old) st.inventory.push(old);
    E.refreshMaxHp(st);
    E.tick(st, `equipped ${item.name}`);
    S.saveState(st);
    console.log(`Equipped ${itemLine(item)}${old ? ` (unequipped ${old.name} → bag)` : ''}.`);
  },

  sell() {
    const st = requireSave();
    const n = parseInt(args[0], 10);
    const item = st.inventory[n - 1];
    if (!item) { console.log('Usage: /hero sell <n> (see /hero inventory)'); process.exit(1); }
    const mult = B.RARITIES.find(r => r.id === item.rarity).mult;
    const gold = Math.round(B.shopPrice(item.ilvl, mult) * B.SELL_FRAC);
    st.inventory.splice(n - 1, 1);
    st.hero.gold += gold;
    S.saveState(st);
    console.log(`Sold ${item.name} for ${R.fmtGold(gold)}. You have ${R.fmtGold(st.hero.gold)}.`);
  },

  stats() {
    const st = requireSave();
    const c = st.counters;
    const days = Math.max(1, Math.round((Date.now() - st.createdAt) / 86400000));
    console.log(`\n  Lifetime (${days} days):`);
    console.log(`  kills ${c.kills} (${c.bossKills} bosses)  deaths ${c.deaths}`);
    console.log(`  commits ${c.commits}  pushes ${c.pushes}  tests ${c.testsPassed}✓/${c.testsFailed}✗`);
    console.log(`  lines of code ${c.linesWritten.toLocaleString('en-US')}  gold earned ${R.fmtGold(c.goldEarned)}`);
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

  reset() {
    if (!flag('confirm')) { console.log('This deletes your hero forever. Rerun with --confirm.'); process.exit(1); }
    for (const f of [P.stateFile, P.bakFile, P.eventsFile, P.processingFile, P.lockFile]) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
    console.log('Save deleted. /hero init to start over.');
  },
};

const fn = commands[cmd];
if (!fn) {
  console.log('idle-claude-rpg — commands: init status zone shop inventory equip sell stats fold sim reset');
  process.exit(cmd ? 1 : 0);
}
fn();
