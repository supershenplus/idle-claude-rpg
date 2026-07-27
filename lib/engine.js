'use strict';

const B = require('./balance');
const C = require('./content');
const { mulberry32, weightedPick, pick } = require('./rng');

// ---------- derived hero stats ----------

function classDef(state) { return C.classes[state.hero.class] || C.classes.wizard; }

function gearSum(state, key) {
  let n = 0;
  for (const slot of ['weapon', 'armor', 'trinket']) {
    const it = state.equipment[slot];
    if (it) n += it[key] || 0;
  }
  return n;
}
function heroAtk(state) {
  const c = classDef(state);
  return c.atkBase + c.atkPerLvl * state.hero.level + gearSum(state, 'atk');
}
function heroDef(state) { return gearSum(state, 'def'); }
function heroMaxHp(state) {
  const c = classDef(state);
  return Math.round(c.hpBase + c.hpPerLvl * state.hero.level + gearSum(state, 'hp'));
}
function refreshMaxHp(state) {
  const max = heroMaxHp(state);
  state.hero.maxHp = max;
  state.hero.hp = Math.min(state.hero.hp, max);
}

// ---------- state creation ----------

function newState(clsId, name, now) {
  const state = {
    version: 1,
    createdAt: now, updatedAt: now, lastEventAt: now, lastTickAt: now,
    hero: {
      name: name || 'Hero', class: clsId, level: 1, xp: 0,
      hp: 0, maxHp: 0, gold: 0,
      zone: 'grove', unlockedZones: ['grove'],
    },
    equipment: { weapon: null, armor: null, trinket: null },
    inventory: [],
    monster: null,
    counters: {
      kills: 0, bossKills: 0, killsSinceBoss: 0, zoneKills: {},
      commits: 0, pushes: 0, testsPassed: 0, testsFailed: 0,
      linesWritten: 0, goldEarned: 0, deaths: 0, lastTestXpAt: 0,
    },
    anim: [], ticker: [], eventsFolded: 0,
  };
  refreshMaxHp(state);
  state.hero.hp = state.hero.maxHp;
  spawnMonster(state, mulberry32(now >>> 0));
  return state;
}

// ---------- anims + ticker ----------

function enqueue(state, type, dur, data, now) {
  const q = state.anim;
  const last = q[q.length - 1];
  if (type === 'hit' && last && last.type === 'hit' && last.at + last.dur > now) {
    last.data.dmg += data.dmg;                      // coalesce rapid hits
    last.data.crit = last.data.crit || data.crit;
    return;
  }
  const at = Math.max(now, last ? last.at + last.dur : now);
  if (at > now + B.ANIM_MAX_AHEAD_MS) return;
  if (q.length >= B.ANIM_CAP) return;
  q.push({ type, at, dur, data: data || {} });
}
function pruneAnims(state, now) {
  const before = state.anim.length;
  state.anim = state.anim.filter(a => a.at + a.dur > now);
  return state.anim.length !== before;
}
function tick(state, msg) {
  state.ticker.unshift(msg);
  state.ticker.length = Math.min(state.ticker.length, 3);
}

// ---------- monsters ----------

function spawnMonster(state, rand) {
  const zone = C.zoneById(state.hero.zone);
  const bossReady = state.counters.killsSinceBoss >= B.BOSS_KILLS_REQUIRED
    && state.hero.level >= zone.boss.level - 1;
  if (bossReady) {
    state.monster = {
      id: zone.boss.id, name: zone.boss.name, level: zone.boss.level,
      isBoss: true, sprite: zone.boss.sprite,
      maxHp: B.monsterMaxHp(zone.boss.level, rand(), true), hp: 0,
    };
  } else {
    const m = pick(zone.monsters, rand);
    const mLvl = Math.min(zone.max, zone.min + Math.floor(rand() * 4));
    state.monster = {
      id: m.id, name: m.name, level: mLvl, isBoss: false, sprite: m.sprite,
      maxHp: B.monsterMaxHp(mLvl, rand(), false), hp: 0,
    };
  }
  state.monster.hp = state.monster.maxHp;
  if (state.monster.isBoss) enqueue(state, 'bossintro', 6000, { name: state.monster.name }, state.updatedAt || Date.now());
}

// ---------- loot ----------

let itemSeq = 0;
function makeItem(state, rarity, ilvl, from, rand) {
  const slot = pick(['weapon', 'armor', 'trinket'], rand);
  const zone = C.zoneById(state.hero.zone);
  const stats = B.itemStats(slot, Math.max(1, ilvl), rarity.mult);
  let name;
  if (rarity.id === 'legendary') name = zone.legendary;
  else name = `${C.RARITY_ADJ[rarity.id]} ${zone.flavor} ${pick(C.SLOT_NOUNS[slot], rand)}`.trim();
  itemSeq = (itemSeq + 1) % 1296;
  return {
    id: 'itm_' + (state.counters.kills * 1296 + itemSeq).toString(36),
    slot, name, rarity: rarity.id, ilvl: Math.max(1, ilvl),
    atk: stats.atk, def: stats.def, hp: stats.hp,
    from, at: state.updatedAt,
  };
}

function addToInventory(state, item) {
  if (state.inventory.length >= B.INVENTORY_CAP) {
    // auto-sell the oldest, lowest-rarity item to make room
    const order = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
    let idx = 0;
    for (let i = 1; i < state.inventory.length; i++) {
      if (order[state.inventory[i].rarity] < order[state.inventory[idx].rarity]) idx = i;
    }
    const sold = state.inventory.splice(idx, 1)[0];
    const gold = Math.round(B.shopPrice(sold.ilvl, B.RARITIES.find(r => r.id === sold.rarity).mult) * B.SELL_FRAC);
    state.hero.gold += gold;
    tick(state, `bag full — sold ${sold.name} +${gold}g`);
  }
  state.inventory.push(item);
}

function rollLoot(state, mLvl, opts, rand, now) {
  const c = classDef(state);
  const chance = B.DROP_CHANCE * (c.dropMult || 1);
  if (!opts.guaranteed && rand() > chance) return null;
  let rarity = weightedPick(B.RARITIES, rand);
  if (opts.floorRare) {
    const idx = B.RARITIES.findIndex(r => r.id === rarity.id);
    if (idx < B.BOSS_RARITY_FLOOR) rarity = B.rarityByIndex(B.BOSS_RARITY_FLOOR);
  }
  const item = makeItem(state, rarity, mLvl, opts.from, rand);
  addToInventory(state, item);
  enqueue(state, 'loot', 2500, { name: item.name, rarity: item.rarity }, now);
  tick(state, `[${item.rarity}] ${item.name} dropped`);
  return item;
}

// ---------- xp / levels ----------

function addXp(state, xp, now) {
  const c = classDef(state);
  xp = Math.round(xp * (c.xpMult || 1));
  if (state.hero.level >= B.LEVEL_CAP) return;
  state.hero.xp += xp;
  while (state.hero.level < B.LEVEL_CAP && state.hero.xp >= B.xpToNext(state.hero.level)) {
    state.hero.xp -= B.xpToNext(state.hero.level);
    state.hero.level += 1;
    refreshMaxHp(state);
    state.hero.hp = state.hero.maxHp; // level-up full heal
    enqueue(state, 'levelup', 5000, { level: state.hero.level }, now);
    tick(state, `LEVEL UP — ${state.hero.level}`);
  }
  if (state.hero.level >= B.LEVEL_CAP) state.hero.xp = 0;
}

// ---------- combat ----------

function resolveKill(state, opts, rand, now) {
  const m = state.monster;
  const c = classDef(state);
  const xp = B.killXp(m.level, m.isBoss);
  let gold = B.killGold(m.level, m.isBoss, rand()) * (c.goldMult || 1);
  if (opts.viaPush) gold *= 1.5;
  gold = Math.round(gold);
  state.hero.gold += gold;
  state.counters.goldEarned += gold;
  state.counters.kills += 1;

  const zoneId = state.hero.zone;
  state.counters.zoneKills[zoneId] = (state.counters.zoneKills[zoneId] || 0) + 1;

  enqueue(state, 'kill', 2500, { name: m.name, xp, gold, sprite: m.sprite }, now);
  tick(state, `${m.name} slain +${xp}xp +${gold}g`);

  if (m.isBoss) {
    state.counters.bossKills += 1;
    state.counters.killsSinceBoss = 0;
    rollLoot(state, m.level, { guaranteed: true, floorRare: true, from: 'boss:' + m.id }, rand, now);
    const nz = C.nextZone(zoneId);
    if (nz && !state.hero.unlockedZones.includes(nz.id)) {
      state.hero.unlockedZones.push(nz.id);
      enqueue(state, 'bossdown', 6000, { name: m.name, unlocked: nz.name }, now);
      tick(state, `${m.name} defeated — ${nz.name} unlocked`);
    } else {
      enqueue(state, 'bossdown', 6000, { name: m.name }, now);
    }
  } else {
    state.counters.killsSinceBoss += 1;
    rollLoot(state, m.level, {
      guaranteed: !!opts.viaPush, from: (opts.viaPush ? 'push:' : 'kill:') + m.id,
    }, rand, now);
  }

  addXp(state, xp, now);
  spawnMonster(state, rand);
}

function dealDamage(state, mult, opts, rand, now) {
  const c = classDef(state);
  let dmg = heroAtk(state) * mult;
  let crit = false;
  if (c.critChance && rand() < c.critChance) { dmg *= c.critMult; crit = true; }
  dmg = Math.max(1, Math.round(dmg));
  state.monster.hp -= dmg;
  enqueue(state, 'hit', 1500, { dmg, crit: crit || !!opts.big }, now);
  if (crit) tick(state, `+${dmg} crit!`);
  if (state.monster.hp <= 0) { resolveKill(state, opts, rand, now); return; }
  retaliate(state, rand, now);
}

// The monster hits back. Folded into the hero's own hit anim rather than queued
// as a separate frame: a burst of 50 attacks would otherwise saturate the anim
// queue with counters and push real events past ANIM_MAX_AHEAD_MS.
function retaliate(state, rand, now) {
  const m = state.monster;
  if (!m || m.hp <= 0) return;
  if (rand() >= (m.isBoss ? B.RETALIATE_CHANCE_BOSS : B.RETALIATE_CHANCE)) return;
  const mult = m.isBoss ? B.RETALIATE_MULT_BOSS : B.RETALIATE_MULT;
  const before = state.hero.hp;
  hurtHero(state, B.monsterHitDamage(m.level, heroDef(state), false) * mult, now);
  const dealt = before - state.hero.hp;   // ≤0 if that blow killed and respawned
  const last = state.anim[state.anim.length - 1];
  if (dealt > 0 && last && last.type === 'hit') {
    last.data.counter = (last.data.counter || 0) + dealt;
  }
}

function hurtHero(state, amount, now) {
  const c = classDef(state);
  const dmg = Math.max(1, Math.round(amount * (c.damageTakenMult || 1)));
  state.hero.hp -= dmg;
  if (state.hero.hp <= 0) {
    const lost = Math.round(state.hero.gold * B.DEATH_GOLD_LOSS);
    state.hero.gold -= lost;
    state.counters.deaths += 1;
    state.hero.hp = state.hero.maxHp;
    state.monster.hp = state.monster.maxHp;
    enqueue(state, 'death', 5000, { lost }, now);
    tick(state, `you died… -${lost}g`);
  }
}

// ---------- time effects (regen, offline) ----------

function applyTime(state, now) {
  let dirty = false;
  const gap = now - (state.lastTickAt || now);
  if (gap <= 0) return pruneAnims(state, now);

  // away progress: no folds for a while = Claude Code was closed / machine asleep
  if (gap >= B.OFFLINE_MIN_GAP_MS && state.monster) {
    const hours = Math.min(gap / 3600000, B.OFFLINE_MAX_HOURS);
    const kills = Math.floor(hours * B.OFFLINE_KILLS_PER_HOUR);
    if (kills > 0) {
      const mLvl = state.monster.level;
      const xp = Math.round(B.killXp(mLvl, false) * B.OFFLINE_REWARD_FRAC * kills);
      const gold = Math.round(B.killGold(mLvl, false, 0.5) * B.OFFLINE_REWARD_FRAC * kills);
      state.counters.kills += kills;
      state.hero.gold += gold;
      state.counters.goldEarned += gold;
      addXp(state, xp, now);
      enqueue(state, 'idle', 5000, { kills, xp, gold }, now);
      tick(state, `while away: ${kills} kills +${xp}xp +${gold}g`);
      dirty = true;
    }
  }

  // passive regen: 1% max HP per minute
  if (state.hero.hp < state.hero.maxHp) {
    const heal = Math.floor((gap / 60000) * B.REGEN_FRAC_PER_MIN * state.hero.maxHp);
    if (heal > 0) {
      state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + heal);
      dirty = true;
    }
  }

  if (pruneAnims(state, now)) dirty = true;
  state.lastTickAt = now;
  // Persist quiet ticks at most ~once a minute so the 1s statusline poll
  // doesn't rewrite state.json continuously, but lastTickAt never lags far
  // enough for idle-with-app-open to look like "away".
  return dirty || gap > 60000;
}

// ---------- the fold reducer ----------

function applyEvent(state, ev, rand, now) {
  const cnt = state.counters;
  switch (ev.e) {
    case 'attack_jab': dealDamage(state, B.DMG.jab, {}, rand, now); break;
    case 'attack_build': dealDamage(state, B.DMG.build, {}, rand, now); break;
    case 'attack_lines': {
      const lines = Math.max(1, (ev.m && ev.m.lines) || 1);
      cnt.linesWritten += lines;
      const c = classDef(state);
      dealDamage(state, B.lineDamageMult(lines) * (c.editMult || 1), {}, rand, now);
      break;
    }
    case 'commit': {
      cnt.commits += 1;
      const c = classDef(state);
      dealDamage(state, B.DMG.commit * (c.commitMult || 1), { big: true }, rand, now);
      break;
    }
    case 'push': {
      cnt.pushes += 1;
      if (state.monster.isBoss) {
        dealDamage(state, B.DMG.pushVsBoss, { big: true, viaPush: true }, rand, now);
      } else {
        tick(state, 'WAR HORN! git push');
        state.monster.hp = 0;
        resolveKill(state, { viaPush: true }, rand, now);
      }
      break;
    }
    case 'test_pass': {
      cnt.testsPassed += 1;
      if (ev.t - cnt.lastTestXpAt >= B.TEST_XP_COOLDOWN_MS) {
        cnt.lastTestXpAt = ev.t;
        addXp(state, B.testXp(state.hero.level), now);
      }
      dealDamage(state, B.DMG.test, {}, rand, now);
      break;
    }
    case 'test_fail':
      cnt.testsFailed += 1;
      hurtHero(state, B.monsterHitDamage(state.monster.level, heroDef(state), true), now);
      break;
    case 'bash_fail':
      hurtHero(state, B.monsterHitDamage(state.monster.level, heroDef(state), false), now);
      break;
    case 'rest': {
      const missing = state.hero.maxHp - state.hero.hp;
      if (missing > 0) state.hero.hp += Math.round(missing * B.STOP_REGEN_FRAC);
      break;
    }
    default: break;
  }
}

// events: [{t, e, m}] (sorted by caller or here). Returns true if state changed.
function fold(state, events, now) {
  const rand = mulberry32(((state.eventsFolded + 1) * 2654435761) ^ (now & 0xffffffff));
  let dirty = applyTime(state, now);
  events = (events || [])
    .filter(ev => ev && typeof ev.e === 'string')
    .sort((a, b) => (a.t || 0) - (b.t || 0));
  for (const ev of events) {
    try { applyEvent(state, ev, rand, now); dirty = true; } catch (_) { /* one bad event ≠ lost fold */ }
    state.eventsFolded += 1;
    if (ev.t) state.lastEventAt = ev.t;
  }
  state.updatedAt = now;
  return dirty;
}

module.exports = {
  newState, fold, applyTime, spawnMonster,
  heroAtk, heroDef, heroMaxHp, refreshMaxHp,
  addXp, dealDamage, hurtHero, retaliate, rollLoot, addToInventory, enqueue, tick,
};
