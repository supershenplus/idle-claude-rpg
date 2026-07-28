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

// What an item is worth, and so which of two is "better". Shop price rolls ilvl
// and rarity together, which is exactly the comparison both the displacement
// rule and `equip all` want.
function itemValue(it) {
  return B.shopPrice(it.ilvl, (B.RARITIES.find(r => r.id === it.rarity) || { mult: 1 }).mult);
}

// `equip all`: fill every empty slot with the best thing in the bag that fits.
// Strictly additive — it never unequips, never displaces, and never touches a
// slot you already filled, so there is nothing to preview and nothing to undo.
// That is the whole point: kitting out a fresh set of twelve slots one index at
// a time is the same chore bulk selling already fixed at the other end.
function equipEmpty(st) {
  const empty = C.EQUIP_KEYS.filter(k => !st.equipment[k]);
  if (!empty.length) { console.log('Every slot is already filled. /hero equip <n> to swap something out.'); return; }
  if (!st.inventory.length) { console.log('Bag is empty — nothing to equip. Monsters drop loot as you code.'); return; }

  // Best-first within a slot type, and rings are interchangeable, so taking the
  // best remaining candidate for each key in turn is optimal.
  const taken = new Set();
  const filled = [];
  for (const key of empty) {
    const slot = C.keySlot(key);
    let bestIdx = -1;
    st.inventory.forEach((it, i) => {
      if (taken.has(i) || it.slot !== slot) return;
      if (bestIdx < 0 || itemValue(it) > itemValue(st.inventory[bestIdx])) bestIdx = i;
    });
    if (bestIdx < 0) continue;
    taken.add(bestIdx);
    filled.push({ key, item: st.inventory[bestIdx] });
  }

  if (!filled.length) {
    console.log(`Nothing in the bag fits your ${empty.length} empty slot${empty.length === 1 ? '' : 's'}`
      + ` (${empty.join(', ')}).`);
    return;
  }

  st.inventory = st.inventory.filter((_, i) => !taken.has(i));
  for (const f of filled) st.equipment[f.key] = f.item;
  E.refreshMaxHp(st);
  E.tick(st, `kitted out — ${filled.length} slot${filled.length === 1 ? '' : 's'} filled`);
  S.saveState(st);

  console.log(`\n  Equipped ${filled.length} item${filled.length === 1 ? '' : 's'} into empty slots:\n`);
  for (const f of filled) console.log(`  ${f.key.padEnd(8)} ${itemLine(f.item)}`);
  const left = C.EQUIP_KEYS.filter(k => !st.equipment[k]);
  console.log(`\n  ATK ${Math.round(E.heroAtk(st))}  DEF ${E.heroDef(st)}  HP ${st.hero.hp}/${st.hero.maxHp}`
    + ` · ${left.length ? `still empty: ${left.join(', ')}` : 'all twelve slots filled'}`);
  console.log(`  Bag ${st.inventory.length}/${B.INVENTORY_CAP}.`);
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
    const worn = C.EQUIP_KEYS.filter(k => st.equipment[k]).length;
    console.log(`\n  Gear (${worn}/${C.EQUIP_KEYS.length} slots):`);
    for (const key of C.EQUIP_KEYS) {
      const it = st.equipment[key];
      console.log(`    ${key.padEnd(8)} ${it ? itemLine(it) : R.c('dim', '(empty)')}`);
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

  // The shelf is rolled per zone per 4-hour window (see lib/shop.js), so it is
  // stable for as long as you're looking at it and different next time.
  shop() {
    const st = requireSave();
    const now = Date.now();
    const zone = C.zoneById(st.hero.zone);
    const { stock, rotated } = SHOP.refresh(st, now);
    const offers = stock.offers;

    const listShelf = (lead) => {
      console.log(`\n  ${lead}\n`);
      offers.forEach((o, i) => console.log(
        `  ${i + 1}. ${itemLine(o)} — ${R.fmtGold(o.price)}`
        + (o.sale ? R.c('brightGreen', ` SALE (was ${R.fmtGold(o.listPrice)})`) : '')));
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
        from: 'shop', at: now,
      };
      E.addToInventory(st, item);
      S.saveState(st);
      console.log(`Bought ${itemLine(item)} for ${R.fmtGold(offer.price)}. /hero equip to wear it.`);
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
    console.log('\n  /hero equip <n> · /hero equip all · /hero sell <n> · /hero sell commons rares · /hero sell all');
  },

  // `equip <n>` fills the first free slot of the item's kind and only displaces
  // something when they're all full — and then the cheapest one, so putting on a
  // fourth ring never quietly bins your best. `equip all` fills every *empty*
  // slot at once and displaces nothing at all.
  equip() {
    const st = requireSave();
    const word = String(args[0] || '').toLowerCase();
    if (word === 'all' || word === 'empty') return equipEmpty(st);

    const n = parseInt(args[0], 10);
    const item = st.inventory[n - 1];
    if (!item) { console.log('Usage: /hero equip <n> [slot] | all  (see /hero inventory)'); process.exit(1); }

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
    const value = it => Math.round(itemValue(it) * B.SELL_FRAC);
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
