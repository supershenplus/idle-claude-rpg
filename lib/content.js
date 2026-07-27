'use strict';

// Pure game data: classes, zones, monsters, bosses, item naming.

const classes = {
  wizard: {
    id: 'wizard', name: 'Wizard',
    atkBase: 9, atkPerLvl: 2.2, hpBase: 40, hpPerLvl: 6,
    critChance: 0.15, critMult: 2,
    blurb: '15% chance any attack crits for double damage.',
  },
  knight: {
    id: 'knight', name: 'Knight',
    atkBase: 7, atkPerLvl: 1.8, hpBase: 50, hpPerLvl: 7.5,
    damageTakenMult: 0.5, commitMult: 1.25,
    blurb: 'Takes half damage, +25% HP; commits shield-slam for x1.25.',
  },
  rogue: {
    id: 'rogue', name: 'Rogue',
    atkBase: 8, atkPerLvl: 2.0, hpBase: 44, hpPerLvl: 6.5,
    goldMult: 1.25, dropMult: 1.5,
    blurb: 'Gold x1.25 and loot drops 1.5x as often.',
  },
  ranger: {
    id: 'ranger', name: 'Ranger',
    atkBase: 8, atkPerLvl: 2.0, hpBase: 44, hpPerLvl: 6.5,
    editMult: 1.15, xpMult: 1.10,
    blurb: 'Lines-of-code damage x1.15, all XP x1.10.',
  },
};

const zones = [
  {
    id: 'grove', name: 'Whispering Grove', min: 1, max: 9, flavor: 'Grove',
    monsters: [
      { id: 'slime', name: 'Slime', sprite: '(⊙▂⊙)' },
      { id: 'gremlin', name: 'Gremlin', sprite: 'ヽ(`Д´)ﾉ' },
      { id: 'direrat', name: 'Dire Rat', sprite: '~(¬,¬)~' },
    ],
    boss: { id: 'rootfang', name: 'Rootfang the Ancient Treant', level: 9, sprite: '⺤ꙨᴥꙨ⺤' },
    legendary: "Rootfang's Splinter",
  },
  {
    id: 'caves', name: 'Cobalt Caves', min: 10, max: 18, flavor: 'Cobalt',
    monsters: [
      { id: 'batswarm', name: 'Bat Swarm', sprite: '^⋀,,⋀^' },
      { id: 'crawler', name: 'Cave Crawler', sprite: '(》○《)' },
      { id: 'kobold', name: 'Kobold Miner', sprite: '(⌐■_■)⛏' },
    ],
    boss: { id: 'echowyrm', name: 'The Echo Wyrm', level: 18, sprite: '≋≋(°○°)≋≋' },
    legendary: 'Echo of the Deep',
  },
  {
    id: 'archives', name: 'Sunken Archives', min: 19, max: 27, flavor: 'Inkbound',
    monsters: [
      { id: 'librarian', name: 'Zombie Librarian', sprite: '[¬º-°]¬' },
      { id: 'inkelem', name: 'Ink Elemental', sprite: '{~˷~}' },
      { id: 'tome', name: 'Cursed Tome', sprite: '/|◉‿◉|\\' },
    ],
    boss: { id: 'unindexed', name: 'The Unindexed', level: 27, sprite: '⟦ ∅ ⟧' },
    legendary: 'The Card Catalog of Ruin',
  },
  {
    id: 'embers', name: 'Ember Wastes', min: 28, max: 36, flavor: 'Ember',
    monsters: [
      { id: 'cinderhound', name: 'Cinder Hound', sprite: '(`▲´)ノ~' },
      { id: 'magmaimp', name: 'Magma Imp', sprite: '(≖‿≖)~°' },
      { id: 'ashwraith', name: 'Ash Wraith', sprite: '(◣_◢)' },
    ],
    boss: { id: 'pyrelord', name: 'Pyrelord Kzz', level: 36, sprite: 'Ψ(▼皿▼)Ψ' },
    legendary: "Kzz's Smolder",
  },
  {
    id: 'peaks', name: 'Glass Peaks', min: 37, max: 45, flavor: 'Glass',
    monsters: [
      { id: 'harpy', name: 'Frost Harpy', sprite: '≪(⊙∆⊙)≫' },
      { id: 'golem', name: 'Crystal Golem', sprite: '[▣_▣]' },
      { id: 'shade', name: 'Storm Shade', sprite: '(≖_≖ )' },
    ],
    boss: { id: 'aurelia', name: 'Aurelia, Mirror Queen', level: 45, sprite: '◇(¯▽¯)◇' },
    legendary: 'Shard of Aurelia',
  },
  {
    id: 'null', name: 'The Null Expanse', min: 46, max: 54, flavor: 'Void',
    monsters: [
      { id: 'leech', name: 'Void Leech', sprite: '(∵)' },
      { id: 'segfault', name: 'Segfault Stalker', sprite: '(0x00_0x00)' },
      { id: 'dangling', name: 'Dangling Pointer', sprite: '*(&_&)' },
    ],
    boss: { id: 'gc', name: 'The Garbage Collector', level: 54, sprite: '♻(◉Δ◉)♻' },
    legendary: 'Mark-and-Sweep',
  },
  {
    id: 'prod', name: 'Production', min: 55, max: 60, flavor: 'Prod',
    monsters: [
      { id: 'heisenbug', name: 'Heisenbug', sprite: '¿(ō_ō)?' },
      { id: 'racecond', name: 'Race Condition', sprite: '(⇆_⇆)' },
      { id: 'memleak', name: 'Memory Leak', sprite: '(´д`)…' },
      { id: 'daemon', name: 'Legacy Daemon', sprite: '(☎_☎)' },
    ],
    boss: { id: 'rootcause', name: 'The Root Cause', level: 60, sprite: '▓▒(●̀_●́)▒▓' },
    legendary: 'The Postmortem',
  },
];

function zoneById(id) { return zones.find(z => z.id === id) || zones[0]; }
function zoneIndex(id) { return Math.max(0, zones.findIndex(z => z.id === id)); }
function nextZone(id) { return zones[zoneIndex(id) + 1] || null; }

// Item naming: "<rarity adj> <zone flavor> <slot noun>", legendaries use the zone's named item.
const RARITY_ADJ = {
  common: 'Plain', uncommon: 'Fine', rare: 'Runed', epic: 'Mythic', legendary: '',
};
const SLOT_NOUNS = {
  weapon: ['Sword', 'Wand', 'Dagger', 'Bow', 'Maul'],
  armor: ['Vest', 'Plate', 'Cloak', 'Helm'],
  trinket: ['Ring', 'Charm', 'Idol', 'Band'],
};

module.exports = { classes, zones, zoneById, zoneIndex, nextZone, RARITY_ADJ, SLOT_NOUNS };
