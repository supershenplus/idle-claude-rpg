'use strict';

// Hero sprites + projectile styling per class, and the 5-line "big" art used by
// the tall HUD. One-line sprites for monsters live in content.js; their big art
// is keyed by the same id here so content.js stays pure name/level data.
//
// Every big sprite is exactly BIG_ROWS lines. Rows are centred individually at
// render time, so ragged line widths are fine — but ragged *row counts* are not.
//
// Big art is drawn from single-cell glyphs only (box drawing, block elements,
// geometric shapes). Kaomoji characters like ｀皿ᴥ are two cells wide in most
// terminals, which silently skews every centred column in the scene, so they
// stay confined to the one-line sprites. Heroes face right, monsters face left.

const BIG_ROWS = 5;

const heroes = {
  wizard: { idle: '(∩｀-´)⊃', proj: '☆ﾟ.*', trail: '━' },
  knight: { idle: '[è_é]o', proj: '≫', trail: '=' },
  rogue:  { idle: '(¬‿¬)⌐', proj: '╫', trail: '─' },
  ranger: { idle: '(๑•̀ᴗ•́)', proj: '➳', trail: '-' },
};

const heroesBig = {
  wizard: [
    '   ▲    ·★°',
    ' ▟███▙  ┃',
    '  ▐◉▌───┃',
    ' ░▒██▓  ┃',
    '◢▒███▓◣',
  ],
  // Shield forward, sword wound back over the left shoulder: the blade traces
  // ╪ ╱ ╱ up and away from the fist, so the swing reads as about to come down.
  knight: [
    ' ╱   ◢▄◣ ▗▄▖',
    ' ╱  ▟█◉▙▐█▓',
    '  ╪░▒██▓█◆█',
    '   ░▒██▓▜█▛',
    '  ▗█▌▐█▙▀',
  ],
  // Hooded, one lit eye under the hood, cloak edge down the left, dagger held
  // high on the guard side — fist ▙, crossguard ╪, blade ╱ ╱ up to the right.
  rogue: [
    '    ▗▄▄▖   ╱',
    '  ▖▟█◕▙ ╱',
    '▚░▒█▓▙╪',
    '▚░▒██▓',
    '▝▜▛ ▜▙',
  ],
  // Plumed cap and an arrow poking up out of the quiver on the back. The bow
  // keeps the geometry statusline.test.js pins: string straight down one column,
  // limbs bulging past it toward the target, arrow crossing the string at ┼.
  ranger: [
    '╱▗▄▄▖  │╲',
    '▲▟█▓◔▙ │ ╲',
    '  ▚░▒██▓▬┼──▶',
    ' ░▒█▓▚ │ ╱',
    '▜▛ ▜▙ │╱',
  ],
};

const monstersBig = {
  // Not from any zone — it turns up wherever you are. Pointy ears and a grin on
  // the left, a sack it is very much not putting down on the right.
  lootgoblin: [
    '╲▖  ▗╱  ▄▄▄▖',
    ' ◢▀▀▀◣ ▟▓▒▓█▙',
    ' ▐$ $▌▐▒$▒▓█▌',
    ' ▝▄▄▄▟ ▜▓▒▓█▛',
    '  ▐▌▐▌  ▝▀▘',
  ],
  // Whispering Grove
  slime: [
    ' ▄▄▄▄▄▖',
    ' ░░░░░░▒▒▓▚',
    '░░ ● ● ░▒▓▖',
    '░░░░ ▄▄ ░▒▒▓▓',
    '▀▀▀▀▀▀▀▀▀▀▀',
  ],
  gremlin: [
    ' ╲▖   ▗╱',
    ' ◀▄▄███▄▄▶',
    ' ▐ ● ● ▒▓▌',
    ' ▐█▌',
    ' ▟▘ ▝▙',
  ],
  direrat: [
    '    ▂▄▄▄▖',
    ' ▗▄▟▒▒▒▓▓█▙',
    ' ◢▀ ● ░▒▓███▙',
    '◀▀▄▄▄▄▄▄▓▓██▛',
    '  ▐▖ ▝▌ ▝▌╰─╮',
  ],
  rootfang: [
    '░▄▄▓▓▓▓▄▄░',
    ' ▄▓███▓▒▒▓█████▄',
    '  ▀▜█ ◉ ◉ ▒▓████▛',
    '▐█▓ ▼▼▼ ▒▓█▌',
    ' ◢▄╱ ▐██▌ ╲▄▄◣',
  ],
  // Cobalt Caves
  batswarm: [
    '  ▚▄▞     ╲▪╱',
    '   ▚▄▞',
    ' ▚●▄▄▞   ▚▄▞',
    '  ╲▪╱    ▚▄▞',
    '▚▄▞    ╲▪╱',
  ],
  crawler: [
    '  ╱ ╱ ╱ ╱ ╱',
    ' ◤▄▟▒█▓▒█▓▒█▙',
    '◀● ▓█▒▓█▒▓██▛',
    ' ◣▀▜▒█▓▒█▓▒█▛',
    '╲ ╲ ╲ ╲ ╲',
  ],
  kobold: [
    '◣▄▄▄◢  ▄▄▄▄▄▖',
    '  ▐   ◉██▓▒▓█',
    '  ▐▄▄ ▐ ● ▒▓▌',
    '       ▟▓███▙',
    '      ▐▌ ▐▌',
  ],
  echowyrm: [
    '  ▄▄▄▖       ░░░░',
    '◀●████▙   ▒▒▒▒░░░',
    ' ▜████▓▓▓▓▒▒▒  ░░',
    ' ▝▜███▓▓▓ ▒▒  ░',
    '  ▀▀▀▀▀  ·  ·',
  ],
  // Sunken Archives
  librarian: [
    '        ┌───┐',
    '      ▄▄│▫▫▓│',
    '╒═══╕▄▄▟▓▓▓▓▙',
    '╞═══╡══┤▓▓▓▓│',
    '╘═══╛   ▐▌ ▐▙',
  ],
  inkelem: [
    '  ░▒▒▒░    ·°',
    ' ░▒○▓○▓▓▒░  ·',
    '░▒▓▓▓▓▓▓▓▓▒░·',
    ' ░▒▓▓▒░ ░▒░ ·',
    '░▒▒▒░▒░ ░▒▒░░',
  ],
  tome: [
    '┌────┐▄┌────┐',
    '│▬▬▬▬├█┤▬▬▬▬│',
    '│ ◉ ▬│█│● ▬ │',
    '│▬▬▬▬├█┤▬▬▬▬│',
    '└────┘▀└────┘',
  ],
  unindexed: [
    '╔═╤═══╗   ╔═══╤═╗',
    '║·│▬▬╣     ╠▬▬│·║',
    '╟─┼─╢       ╟─┼─╢',
    '║·│▬╢       ╟▬│·║',
    '╚═╧═╝     ╚═╤═╧═╝',
  ],
  // Ember Wastes
  cinderhound: [
    '    ▲▲▲    ◢▲',
    ' ◢▙ ▟▒▒▓▓███▛',
    '◀●▓▓▟▓▓█████▛',
    ' ╱▌ ▐▌  ▐▌ ▐▌',
    '╱▘  ▝▘  ▝▘ ▝▘',
  ],
  magmaimp: [
    ' ◤▄▄▄◥   ╱▚',
    '▐◉ ◉▒▓▌▟██▛',
    '▐▚▞▚▞▞▌▝▀▀▘',
    ' ◣▐▓█▌◢   ·',
    '  ▝▘ ▝▘  ·°',
  ],
  ashwraith: [
    '    ◢▓▓▓◣   ·',
    '   ◢◆ ◆▓▓◣ ░·',
    '  ◢▓▓▓▓▓▓▓◣ ░',
    ' ▚▓▞▒▚▞░▚▞ ·',
    '  ░ ▒░  ░ ▒ ·',
  ],
  pyrelord: [
    '◥▙    ▲ ▲ ▲    ▟◤',
    '◥▙ ◢█████◣ ▟◤',
    '◢███▙◤●▄●◥▄▄▟███◣',
    '◣██▙ ▐▓╳▓╳▓▌  ▜█▛',
    '▲   ▐█▌ ▐█▌   ▲',
  ],
  // Glass Peaks
  harpy: [
    '▚▚▄▖     ▗▄▞▞',
    '▜███▙ ▟███▛',
    ' ◀◆▟███▙   ▚',
    '▜███▛',
    '╱╲ ╱╲',
  ],
  golem: [
    '◢◤◥◣   ◢▙',
    '◢█◆ █▙ ▟██▙',
    '◢█▙▜███◤◥██▙',
    '▜█▛ ▜██◣◢██▛',
    '  ▐██▌ ▐██▌',
  ],
  shade: [
    '↯  ▄▄▄▄',
    '╲ ▟██████▙',
    '↯ █◉ ◉ ███▌',
    ' ▒▓████▓▒↯',
    '  ░ ▒░ ▒ ░',
  ],
  aurelia: [
    '☆ ◇ ▲◈▲ ◇ ☆',
    '◇▟◆██▙◇',
    '◢◤ ▐███▌ ◥◣',
    '◢██◤▐█◇█▌◥██◣',
    '◢███◤▐█████▌◥███◣',
  ],
  // The Null Expanse
  leech: [
    '▗▄▄▄▖',
    '◎█▓██▓█▙',
    '◥▀▜█▓█▓█',
    '   ▜█▓▙',
    ' ▟█▓▛',
  ],
  segfault: [
    '▟▀█◆▙',
    '░▒███████▒',
    '░▒     ▐█▚▞█▌',
    '▒▓█▚▞█▌     ░',
    '  ▐█▌  ▐█▌ ░',
  ],
  dangling: [
    '◢██▙    ·',
    '◢█◆██▙    ╌',
    '◀██████▙══╌ ↛',
    '◥█████▛   ·',
    '◥███▛    ·',
  ],
  gc: [
    '   ▗▄▄▄▄▄██▓████',
    '▪⇢ ◥▼▼▼▼▼▼███╪███',
    '◇⇢ ·▪ ░▒▓◉██╪████',
    '▫⇢  ◢▲▲▲▲▲███▓███',
    '   ▝▀▀▀▀▀██▓████',
  ],
  // Production
  heisenbug: [
    ' ╲▄▄▄▄ ╌╌ ╌╌╮',
    '  ▟███▙▓▒░ ?╎',
    ' ▐◉████▓▒░  ╎',
    '  ▜███▛▒░ ╌ ╯',
    '  ╹ ╹ · · ·',
  ],
  racecond: [
    '▄▄▄   ░▒░',
    '▟█◉█▙⇄░▒○▒░',
    '▐█████▚▞▒▒▒▒░',
    '▜████▛↙░▒▒░',
    ' ╹  ╹  ·  ·',
  ],
  memleak: [
    ' ▗▄▄▄▄▖',
    ' ▗▟███████▙',
    ' ▐█▬  ▂ ▓███▌',
    ' ▜█████████▛╷',
    '▁▃▆████████▅▂',
  ],
  daemon: [
    '╱╲  ╱',
    '┏━━━━━━━┓',
    ' ◀┫◉ ▪▫▪ ▓┃╭╮',
    '  ┃▒▒ ═══ ┃╰╮',
    '  ┗┳┻━┻━┳┻┛╰╌',
  ],
  rootcause: [
    '╲▪╱  ╲?╱  ╲▪╱',
    '╲▄▟███████▙▄╱',
    '◢███▛▀  ◉  ▀▜███◣',
    '▜█▛ ▜█████▛ ▜█▛',
    '╲▞╱╲▟███████▙╱╲▞╱',
  ],
};

// ---------- attack animation ----------
//
// A class may script its attack frame by frame: which pose it holds, how far
// the shot shoves it back, and where the projectile has got to. A class with no
// script keeps the generic mark that grows out of the gap, so adding one here is
// opt-in per class.
//
// Poses are drawn on the *rendered* grid of the idle art rather than as free
// ragged lines. Rows are centred individually at render time, so a pose row that
// lost three cells when the arrow left would re-centre and slide one column
// sideways — the bow would visibly jitter while the ranger stood still. Padding
// every row out to the block's full width makes that centring a no-op, and a
// leading space then means exactly one column. `padPose` does the padding so the
// columns are solved rather than hand-counted.
//
// The right-hand pad is plain spaces, and unlike the ragged art it is trailing
// whitespace on purpose: it exists only to be counted. The renderer reads the
// row's width when it places the monster beside it, which happens long before
// anything trims the composed line, so the pad has done its whole job by the
// time it disappears.
function padPose(rows, w) {
  const { width } = require('./render');
  return rows.map(r => r + ' '.repeat(Math.max(0, w - width(r))));
}

// The ranger's bow, loosed. The idle art is a *drawn* bow — string hauled back
// to column 9, limb tips bulging forward past it — so the release is its mirror:
// the arrow is gone, and the string has snapped forward into a shallow bulge of
// its own (column 10 through the middle rows, still anchored at 9 by the tips)
// and is drawn dashed because it is still humming.
const heroPoses = {
  ranger: {
    release: padPose([
      '  ╱▗▄▄▖  ╎╲',
      '  ▲▟█▓◔▙  ╎╲',
      '  ▚░▒██▓▬ ╎',
      '   ░▒█▓▚  ╎╱',
      '   ▜▛ ▜▙ ╎╱',
    ], 13),
  },
};

// One entry per frame of the `hit` animation; the last entry holds for the rest
// of it. `back` is how many cells the recoil shoves the hero left of where it
// stands, `fly` is how far the projectile has crossed the gap (0 at the bow, 1
// against the monster) or null while the shot is still nocked, and `hitFrame` is
// the frame the blow lands on — the damage number waits for it rather than
// appearing while the arrow is still in the air.
//
// The statusline is redrawn about once a second and a hit lasts 1500ms, so a
// viewer catches only a frame or two of any given shot. That is why the recoil
// sits at full extension for three of them: a one-frame flinch would almost
// never be on screen at the moment the terminal happened to redraw.
const attacks = {
  ranger: {
    hitFrame: 3,
    frames: [
      { pose: null,      back: 0, fly: null },
      { pose: 'release', back: 3, fly: 0 },
      { pose: 'release', back: 3, fly: 0.5 },
      { pose: 'release', back: 2, fly: 1 },
      { pose: 'release', back: 1, fly: 1 },
      { pose: null,      back: 0, fly: null },
    ],
  },
};

// Cells the layout must keep to the hero's left so a recoil is never clipped by
// the edge of the terminal. Derived from the scripts rather than written down
// beside them, so a deeper flinch cannot outgrow the room reserved for it.
const MAX_RECOIL = Math.max(0, ...Object.values(attacks)
  .flatMap(a => a.frames.map(f => f.back)));

// The pose and offsets for `frame` of a class's attack, or null if the class has
// no script and should fall back to the generic gap mark.
function attackFrame(clsId, frame) {
  const a = attacks[clsId];
  if (!a) return null;
  const f = a.frames[Math.min(Math.max(0, frame), a.frames.length - 1)];
  const art = f.pose && heroPoses[clsId] && heroPoses[clsId][f.pose];
  return { back: f.back, fly: f.fly, art: art || heroesBig[clsId] };
}

// Frame the damage number is allowed to appear on.
function hitFrame(clsId) {
  const a = attacks[clsId];
  return a ? a.hitFrame : 2;
}

const DEAD_MONSTER = '(x_x)';
const DEAD_MONSTER_BIG = [
  '  °   ·    °',
  '   ▗▄▄▄▖',
  '  ·▐╳ ╳▌·',
  '   ▝▀▄▀▘',
  ' ░▒▓▄▄▄▓▒░',
];

// Fall back to padding the one-line sprite so a monster added to content.js
// without big art still renders at the right height instead of collapsing.
function bigMonster(id, oneLine) {
  const art = monstersBig[id];
  if (art && art.length === BIG_ROWS) return art;
  const pad = new Array(BIG_ROWS).fill('');
  pad[Math.floor(BIG_ROWS / 2)] = oneLine || '(?)';
  return pad;
}
function bigHero(clsId) { return heroesBig[clsId] || heroesBig.wizard; }

// Frame period for all animations (ms per frame)
const FRAME_MS = 250;

module.exports = {
  heroes, heroesBig, monstersBig, heroPoses, attacks,
  bigHero, bigMonster, BIG_ROWS,
  attackFrame, hitFrame, MAX_RECOIL,
  DEAD_MONSTER, DEAD_MONSTER_BIG, FRAME_MS,
};
