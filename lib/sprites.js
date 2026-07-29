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

// `proj` is the head of the mark that crosses the gap and `trail` is the streak
// drawn behind it. Keep `proj` to a single cell: a scripted attack anchors the
// mark to the projectile's *position* in the gap, so a wide head is the first
// thing to run out of room at the far end of the flight. The wizard's used to
// be a 5-cell `☆ﾟ.*` sparkle, which fitted only because nothing was moving it.
// It is now the same ★ that sits on the staff tip in the idle art and leaves it
// on the cast — the mark in the gap is meant to be that exact star.
const heroes = {
  wizard: { idle: '(∩｀-´)⊃', proj: '★', trail: '━' },
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
  // Not from any zone — it turns up wherever you are. Caught mid-scamper: ears
  // up, both eyes on the money, legs splayed, and a sack clamped under one arm
  // that it is very much not putting down.
  //
  // Every row is exactly 13 cells on purpose. The big HUD centres each row of a
  // sprite *independently*, so rows of unequal width shear apart — the first
  // draft had a 3-cell ear row that floated off the face below it, and padding
  // it with leading spaces only moves a row half their width. Equal widths make
  // the centring a no-op and the art renders exactly as it is typed here.
  lootgoblin: [
    '  ▖ ▗ ▗▄▄▄▄▄▖',
    ' ◢$█$◣▟▓⛁▒▓█▙',
    '◀▝▄██▄▟▒▓▒▓█▌',
    '  ▟██▛▐▓▒⛁▓█▌',
    ' ▐▘ ▝▙●▝▀▀▀▀▘',
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

// Each class gives up something to make its attack, and that loss is what the
// pose has to show: the ranger's arrow, the rogue's dagger and the wizard's orb
// all leave the sprite and turn into the projectile crossing the gap. The knight
// is the exception — the sword stays in its hands, so its swing is drawn as the
// blade sweeping through an arc instead.
const heroPoses = {
  // The ranger's bow, loosed. The idle art is a *drawn* bow — string hauled back
  // to column 9, limb tips bulging forward past it — so the release is its
  // mirror: the arrow is gone, and the string has snapped forward into a shallow
  // bulge of its own (column 10 through the middle rows, still anchored at 9 by
  // the tips) and is drawn dashed because it is still humming.
  ranger: {
    release: padPose([
      '  ╱▗▄▄▖  ╎╲',
      '  ▲▟█▓◔▙  ╎╲',
      '  ▚░▒██▓▬ ╎',
      '   ░▒█▓▚  ╎╱',
      '   ▜▛ ▜▙ ╎╱',
    ], 13),
  },
  // The wizard's staff never moves — it is a clean vertical in column 9 with the
  // star resting on its tip. The orb is what travels: `charge` hauls it up into
  // a full ◇◆◇, and `blast` has spent it, leaving the tip crackling and the arm
  // heavy with the surge still going through it. The star is the projectile now.
  wizard: {
    charge: padPose([
      '   ▲    ◇◆◇',
      '  ▟███▙  ┃',
      '   ▐◉▌───┃',
      '  ░▒██▓  ┃',
      '  ◢▒███▓◣',
    ], 11),
    blast: padPose([
      '   ▲     ↯',
      '  ▟███▙  ┃',
      '   ▐◉▌━━━┫',
      '  ░▒██▓  ┃',
      '  ◢▒███▓◣',
    ], 11),
  },
  // The knight's blade sweeps a 90° arc, one pose per 45°: idle holds it wound
  // back up-left over the shoulder (tip in column 1), `raise` brings it upright
  // above the fist (column 3), `strike` carries it past vertical and forward
  // (column 5), where the tip crosses in front of the helm's near slope — which
  // is what a blade coming over your own head looks like. The crossguard stays
  // in the fist at column 3 throughout, so only the tip travels and the three
  // frames read as one motion rather than three postures.
  knight: {
    raise: padPose([
      '   ▲ ◢▄◣ ▗▄▖',
      '   ┃ ▟█◉▙▐█▓',
      '   ╪░▒██▓█◆█',
      '    ░▒██▓▜█▛',
      '    ▗█▌▐█▙▀',
    ], 12),
    strike: padPose([
      '     ╱▄◣ ▗▄▖',
      '    ╱▟█◉▙▐█▓',
      '   ╪░▒██▓█◆█',
      '    ░▒██▓▜█▛',
      '    ▗█▌▐█▙▀',
    ], 12),
  },
  // The rogue throws its dagger. Idle holds it out on a clean 45° from the fist
  // (columns 9, 10, 11); `coil` lifts it a row, cocked tight beside the head;
  // `throw` has nothing left in the hand but the line the hand snapped through,
  // dashed because it is still moving. That line runs along row 2 — the same row
  // the renderer flies the projectile down — so the dagger leaves along the
  // track it then crosses the gap on.
  rogue: {
    coil: padPose([
      '    ▗▄▄▖  ╱',
      '    ▖▟█◕▙╪',
      '   ▚░▒█▓▙',
      '   ▚░▒██▓',
      '   ▝▜▛ ▜▙',
    ], 12),
    throw: padPose([
      '    ▗▄▄▖',
      '    ▖▟█◕▙',
      '   ▚░▒█▓▙╌╌╌',
      '   ▚░▒██▓',
      '   ▝▜▛ ▜▙',
    ], 12),
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
//
// Every script opens and closes on the idle art at the hero's own mark, so a
// hit that starts while another is still fading never teleports the sprite, and
// a class is always standing where the layout says it is between blows.
//
// The recoil is where the classes differ. The two that throw something are
// thrown backwards by it and spend the middle of the animation at full
// extension. The two that swing use `back` the other way round — the wind-up
// step is the deep frame and the blow itself brings them back to their mark, so
// the same field that reads as a flinch for the ranger reads as a lunge for the
// knight.
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
  // A beat of gathering with no recoil — nothing has left yet — and then the
  // discharge shoves the wizard back further than anything else does. Spending a
  // frame on the charge leaves the star only two frames to cross, so it crosses
  // in one jump: at the near edge of the gap the moment the staff empties, and
  // home on the next. Which is what a bolt of light should look like, and beats
  // stealing the frame back from the flash — at one redraw a second a viewer
  // catches one frame of a hit, so how many *positions* the star has matters far
  // less than how many frames read as a complete blow when caught alone.
  wizard: {
    hitFrame: 3,
    frames: [
      { pose: null,     back: 0, fly: null },
      { pose: 'charge', back: 0, fly: null },
      { pose: 'blast',  back: 3, fly: 0 },
      { pose: 'blast',  back: 3, fly: 1 },
      { pose: 'blast',  back: 2, fly: 1 },
      { pose: null,     back: 0, fly: null },
    ],
  },
  // Step back onto the raised sword, then come off it: the swing frames sit at
  // the mark, so against the wind-up the knight gains two cells on the monster
  // exactly as the blade comes over.
  knight: {
    hitFrame: 3,
    frames: [
      { pose: null,     back: 0, fly: null },
      { pose: 'raise',  back: 2, fly: null },
      { pose: 'strike', back: 0, fly: 0.45 },
      { pose: 'strike', back: 0, fly: 1 },
      { pose: 'strike', back: 1, fly: 1 },
      { pose: null,     back: 0, fly: null },
    ],
  },
  // Same shape as the knight's, one cell shallower and released a frame earlier:
  // the dagger is gone by the time the rogue has finished coming forward.
  rogue: {
    hitFrame: 3,
    frames: [
      { pose: null,    back: 0, fly: null },
      { pose: 'coil',  back: 2, fly: null },
      { pose: 'throw', back: 1, fly: 0.45 },
      { pose: 'throw', back: 0, fly: 1 },
      { pose: 'throw', back: 0, fly: 1 },
      { pose: null,    back: 0, fly: null },
    ],
  },
};

// ---------- the dodge ----------
//
// A swing that missed is drawn by bending the hero away from it rather than by
// posing: one displacement per art row, deepest at the head and nothing at the
// feet, so the sprite leans out of the blow with its stance still planted.
//
// Per-row displacement is exactly the shear the big HUD's centring can inflict
// by accident, and which every sprite in this file is drawn to avoid. Here it is
// the point: the rows are meant to come apart, on a gradient that reads as one
// body bending rather than as art falling over. Which is also why it is a lean
// and not a pose — it applies to whatever frame of whatever attack script the
// class was already holding when the blow arrived, so a dodge costs no art at
// all, and adding a fifth class cannot forget to draw one.
const DODGE_LEAN = [2, 2, 1, 0, 0];

// Cells the layout must keep to the hero's left so no displacement is ever
// clipped by the edge of the terminal. Derived from the scripts rather than
// written down beside them, so a deeper flinch cannot outgrow the room reserved
// for it. A dodge stacks its lean on top of whatever the attack script is
// already holding, but only from the frame the blow lands — so the two are
// summed over exactly the frames on which they can coincide, and no further.
const MAX_RECOIL = Math.max(0, ...Object.values(attacks).flatMap(a =>
  a.frames.map((f, i) => f.back + (i >= a.hitFrame ? Math.max(...DODGE_LEAN) : 0))));

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
  attackFrame, hitFrame, MAX_RECOIL, DODGE_LEAN,
  DEAD_MONSTER, DEAD_MONSTER_BIG, FRAME_MS,
};
