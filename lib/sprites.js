'use strict';

// Hero sprites + projectile styling per class, and the 5-line "big" art used by
// the tall HUD. One-line sprites for monsters live in content.js; their big art
// is keyed by the same id here so content.js stays pure name/level data.
//
// Every big sprite is exactly BIG_ROWS lines. Rows are centred individually at
// render time, so ragged line widths are fine — but ragged *row counts* are not.
//
// Every sprite in the game — big art and one-line alike — is drawn from
// single-cell glyphs only (box drawing, block elements, geometric shapes).
// Kaomoji characters like ｀皿ᴥ are two cells wide in most terminals, which
// silently skews every centred column in the scene. That rule used to hold for
// the big art only, with the one-liners left as the kaomoji the game shipped
// with, and the two modes drew visibly different creatures: an Ash Wraith was a
// nine-glyph revenant at 80 columns and `(◣_◢)` at 70. The one-liners are now
// each monster's own big art at its waist, compressed to a fixed width — the
// same creature, seen from further away. Heroes face right, monsters face left.
//
// Widths are uniform by tier: trash and the goblin at ONE_LINE_W, bosses at
// ONE_LINE_BOSS_W. The compact HUD centres the monster and hangs the hero a
// fixed gap off it, so a ragged set moves the *hero* every time one monster
// replaces another — the scene twitched sideways on every kill, which read as
// the layout settling rather than as anything in the game. Uniform widths make
// the geometry constant within a tier, so the only thing that changes when a
// monster dies is the art. A boss is still allowed to be wider, because a scene
// that shifts once when something big arrives is telling the truth.

const BIG_ROWS = 5;

// Cells a one-line sprite occupies, by tier. Eight is what the compressions
// wanted: below it the block vocabulary loses the face — an eye, a maw and a
// body is three glyphs before any of the creature is drawn — and above it the
// compact HUD's fourteen-cell gap starts closing at the widths compact exists
// to serve. Bosses get two more, spent on the thing that makes each of them a
// boss (the Unindexed's hole, Aurelia's mirrors, the Pyrelord's crown).
const ONE_LINE_W = 8;
const ONE_LINE_BOSS_W = 10;

// `proj` is the head of the mark that crosses the gap and `trail` is the streak
// drawn behind it. Keep `proj` to a single cell: a scripted attack anchors the
// mark to the projectile's *position* in the gap, so a wide head is the first
// thing to run out of room at the far end of the flight. The wizard's used to
// be a 5-cell `☆ﾟ.*` sparkle, which fitted only because nothing was moving it.
// It is now the same ★ that sits on the staff tip in the idle art and leaves it
// on the cast — the mark in the gap is meant to be that exact star.
//
// `idle` is the compact HUD's whole hero, and it is the big art's *waist row*
// rather than a separate drawing — the row the projectile already flies along.
// The wizard's and the rogue's are that row verbatim; the knight's and the
// ranger's fold the eye down a row into it, because a face is most of what
// makes seven cells read as a person. Every one ends on the thing it fights
// with, so the weapon sits against the gap the mark crosses, and a wizard whose
// staff tip is empty in the idle is a wizard whose star is the one in flight.
const heroes = {
  wizard: { idle: '▐◉▌───┃', proj: '★', trail: '━' },
  knight: { idle: '╪░▟◉█▙◆', proj: '≫', trail: '=' },
  rogue:  { idle: '▚░▒█◕▙╪', proj: '╫', trail: '─' },
  ranger: { idle: '▚▒█◔▓┼▶', proj: '➳', trail: '-' },
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
  // Redrawn to a uniform 13 cells, which is what fixed the long-standing nit:
  // a `▚` sat alone three columns off the right wing, and it was there because
  // the row it lived on was 12 cells against a 13-cell sprite, so the centring
  // nudged it half a column away from everything else. Equal rows make that
  // centring a no-op — the same reason the loot goblin above is drawn this way
  // — and the wing edge now runs ▞▞ / ▟██▛ / ▚▞▞ as one continuous sweep. Every
  // row has to *end* on a glyph for the widths to be equal, which is what the
  // frost motes on the bottom two rows are: real content at the right edge.
  harpy: [
    '▚▚▖       ▗▞▞',
    '▜███▙▄▄▄▟███▛',
    ' ◀◆▟████▙ ▚▞▞',
    '▝▚  ▜███▛  ▞▘',
    '  ·  ╱╲ ╱╲  ·',
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
  // Grown from 8 cells to 11. It was the smallest thing in the game by three
  // cells and it is the trash of the *Null Expanse*, so it read as a Grove mob
  // that had wandered in — the size of a sprite is the only thing the scene says
  // about a monster before you read its nameplate. The body is longer rather
  // than fatter, which is what a leech is, and the voids fill the columns the
  // curl leaves empty instead of the art being padded out to look bigger.
  leech: [
    '  ▗▄▄▄▄▖  ·',
    '◎█▓███▓█▙ ·',
    '◥▀▜█▓█▓██▙·',
    '    ▜█▓██▛░',
    '   ▟█▓▛   ·',
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
// Every script **closes** on the idle art at the hero's own mark, so the sprite
// is standing where the layout says it is by the time the anim expires and the
// renderer goes back to drawing the idle art itself. Nothing snaps.
//
// It used to open at rest too, and that symmetry was the bug. Nothing needed it:
// anims are serialised (`engine.enqueue` starts each one where the last ended),
// so an opening frame of idle art was not protecting the scene from anything —
// it was one frame of standing still at the front of every blow. What made it
// expensive is that frame 0 is not just *a* sample, it is the sample the player
// is most likely to get. A blow is queued by whichever process folds the events,
// and when that process is the statusline itself — which is the case for every
// push detected by `gitwatch` polling, and for any event the hook could not fold
// because the lock was busy — the fold and the render are the same process, so
// the very first frame drawn is at `elapsed = 0`. A War Horn would land, take a
// monster's health bar off, and draw a hero standing perfectly still.
//
// So the scripts open on their wind-up instead, and `elapsed = 0` is a pose.
//
// The recoil is where the classes differ. The two that throw something are
// thrown backwards by it and spend the middle of the animation at full
// extension. The two that swing use `back` the other way round — the wind-up
// step is the deep frame and the blow itself brings them back to their mark, so
// the same field that reads as a flinch for the ranger reads as a lunge for the
// knight.
const attacks = {
  ranger: {
    hitFrame: 2,
    frames: [
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
    hitFrame: 2,
    frames: [
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
    hitFrame: 2,
    frames: [
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
    hitFrame: 2,
    frames: [
      { pose: 'coil',  back: 2, fly: null },
      { pose: 'throw', back: 1, fly: 0.45 },
      { pose: 'throw', back: 0, fly: 1 },
      { pose: 'throw', back: 0, fly: 1 },
      { pose: null,    back: 0, fly: null },
    ],
  },
};

// ---------- how long each frame of a blow is on screen ----------
//
// Every script above used to be six frames over a 1500ms anim, so each frame was
// a flat 1500/6 = 250ms. That grid was measured on 2026-07-31 against the thing
// it actually has to survive — how often the statusline is redrawn — and it was
// spending its budget in the wrong place.
//
// The redraw rate is not the ~1fps this file used to assume, and it is not one
// number either: logging `Date.now()` at the top of the statusline gave ~12
// redraws a second while a tool was streaming output, and a steady 1.0s tick
// (in pairs about 40ms apart) the rest of the time. The quiet cadence is the one
// that matters, because that is when a hit anim is alone on screen — and at 1
// redraw per second a 1500ms blow is sampled **once or twice**, never more.
//
// Which is what made the flat grid expensive. The first and last frames of every
// script were the at-rest frame — `pose: null`, `back: 0`, `fly: null` — so on a
// flat grid they were 500ms of a 1500ms blow, and **a third of the samples
// landed on art identical to standing still**. With one or two samples per blow,
// a third of the time the animation genuinely did not render.
//
// Worse, the miss was biased rather than random, in two ways that both point at
// the opening frame:
//
//   * Redraws are not only on the 1s tick. A tool finishing triggers one, and
//     that is the same event that makes the hook fold and queue the blow. Those
//     event-driven redraws were logged at 155, 174, 205, 212, 289, 328 and 385ms
//     after the anim's own timestamp — every one inside a 250ms opening frame.
//   * And when the *statusline* is the process that folds, there is no gap at
//     all: it queues the blow and renders it in the same pass, at `elapsed = 0`.
//     That is every push found by `gitwatch` polling — the War Horn, the biggest
//     blow in the game — and any event the hook handed over on a busy lock.
//
// So the opening rest frame is gone entirely (see `attacks` for why nothing
// needed it) and the four that remain are weighted rather than flat. A blow now
// *starts* on its wind-up, which is what makes `elapsed = 0` a pose. Dead art
// falls from 500ms to the 50ms of closing rest, and `hitFrame` still lands at
// 800ms — the same instant it landed at under the six-frame weighting, so the
// damage number has not moved.
const BLOW_MS = [400, 400, 350, 300, 50];

// Weights are per *position* rather than per script, because all five scripts —
// the four classes and the monster's — are the same five frames with the same
// `hitFrame`. One table keeps them in step by construction: a class cannot be
// given a slower wind-up than the blow it is trading with, and there is no
// per-script timing to forget to fill in when a fifth class is added.
const BEATS = BLOW_MS.length;

// Where frame `i` of a blow begins, in ms from the anim's timestamp. The last
// entry is where the blow ends, which is what the test compares against the
// 1500ms the engine actually queues.
const BEAT_STARTS = BLOW_MS.reduce((acc, ms) => (acc.push(acc[acc.length - 1] + ms), acc), [0]);

// Which frame is on screen `elapsed` ms in. Clamped at both ends the way
// `attackFrame` and `monsterAttackFrame` already clamp their index, so a blow
// drawn past its own end holds its last frame rather than vanishing.
//
// Callers hold an elapsed time (`now - anim.at`) and want a frame index; tests
// hold a frame index and want an elapsed time that lands inside it, which is
// `beatMs`. Frame indices themselves are unchanged by any of this, so everything
// keyed off one — `hitFrame`, `MONSTER_HIT_FRAME`, the flinch's age — is too.
function beatAt(elapsed) {
  for (let i = BEATS - 1; i >= 0; i--) {
    if (elapsed >= BEAT_STARTS[i]) return i;
  }
  return 0;
}
function beatMs(i) { return BEAT_STARTS[Math.min(Math.max(0, i), BEATS)]; }

// ---------- the volley ----------
//
// A big blow throws more than one mark. Only two things in the game set
// `opts.big` — a commit, and a push against a boss — and until now the whole of
// their weight was the colour of the damage number, which they had to borrow
// from `crit` to get. They are the hardest hits the game has and they looked
// exactly like a jab.
//
// Three marks rather than two, because two reads as one shot that stuttered, and
// rather than four, because the gap is ~14 cells at the default standoff and
// `VOLLEY_GAP` cells between heads has to leave the hindmost room to still be on
// screen when the leader lands. Spaced with the class's own trail between them,
// so the wizard's blast arrives as `★━━★━━★` and the ranger's as `➳--➳--➳` — one
// weapon fired three times, not three different weapons.
//
// The count is deliberately not scaled by damage. A commit and a push against a
// boss differ by 5.0/3.0, which is not a difference three marks can show without
// becoming four and running out of gap; what the volley says is "this was one of
// the big ones", and the number beside it already says how big.
const VOLLEY = 3;
const VOLLEY_GAP = 3;

// Where each mark of a volley sits, given the head's column. Hindmost first, and
// only the ones that have actually cleared the hero: a volley that drew all
// three from frame one would appear whole out of a staff that has not finished
// emptying, so the marks arrive one at a time as the leader gets far enough out
// to make room behind it.
function volleyCols(head, n) {
  const cols = [];
  for (let k = n - 1; k >= 0; k--) {
    const c = head - k * VOLLEY_GAP;
    if (c >= 0) cols.push(c);
  }
  return cols;
}

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

// ---------- the monster's half ----------
//
// Everything above is what the hero does. The monster had nothing. A failing
// test or a failing command took HP off you with no frame on screen at all, and
// the only monster blow the scene ever drew — the counter — borrows the hero's
// animation to put a number in the gap. So one combatant was scripted frame by
// frame and the other stood still through its own blows and through yours.
//
// Both halves below are displacement rather than art, because there are 28
// monsters and hand-drawing two poses each is a different project (the bosses
// are that project — see todo.md). One number per frame, applied to the whole
// sprite, covers every monster in content.js including any added tomorrow.
//
// Sign convention for `shove`: positive is *toward* the hero, the direction a
// blow travels; negative is away from it, which is both the wind-up and the
// knockback. The renderer subtracts it from the monster's column, so one field
// covers a lunge, a recoil and a flinch.

// The monster swings: rocks back onto its heel, comes forward through the gap,
// and returns to its mark. Opening and closing on the mark is the same rule the
// hero's scripts follow, so a blow that starts while another is fading never
// teleports the sprite. `fly` mirrors `attacks[cls].frames[].fly` — how far the
// mark has crossed the gap, 0 at the monster and 1 against the hero — and
// `hero` is how far the hero is driven back, the only thing this animation does
// on the hero's side besides the red wash the counter already had.
const monsterAttack = {
  hitFrame: 2,
  frames: [
    { shove: -2, fly: null, hero: 0 },
    { shove: 2, fly: 0, hero: 0 },
    { shove: 3, fly: 1, hero: 2 },
    { shove: 2, fly: 1, hero: 2 },
    { shove: 0, fly: null, hero: 0 },
  ],
};

// ---------- what a boss swing costs, in one number ----------
//
// One script for 28 monsters is the right trade for the 22 that are trash, and
// the wrong one for the bosses: six of them, met once each, on the frames you
// are actually watching. Rootfang heaving a limb across the gap should not read
// like a leech's jab.
//
// The expensive answer is six hand-drawn sequences — still open in todo.md, and
// still a real art budget. This is the cheap one: keep the single script and
// give each boss a *depth*. `reach` is how far forward it comes at full
// extension, in cells, against the shared script's 3; every forward frame scales
// in proportion, so the shape of the blow — heel, cross, home — survives and
// only its size changes. `hold` is how many frames it sits at that extension.
//
// Two things deliberately do not scale:
//
//   * The wind-up. Rocking back onto the heel is the same movement whatever the
//     boss weighs, and it is the frame that spends MAX_MONSTER_BACK — scaling it
//     would buy right-edge reserve for something nobody reads as weight.
//   * The mark's flight, because `fly` is a fraction of the gap rather than a
//     count of cells. It already crosses whatever distance the boss left itself.
//
// `hold` is capped at the frames between impact and the last one, because every
// script has to close on its own mark — the rule the hero's four follow. A
// 1500ms blow at 250ms a frame leaves exactly one frame to spare, so hold is 1
// or 2 and there is no third setting to pick: the ceiling is the animation's,
// and buying another frame would mean lengthening the blow for all 28 monsters.
const BOSS_SWING = {
  // The treant. Heaves across and leans on it — the deepest thing in the game
  // apart from the two that are deliberately worse than it.
  rootfang: { reach: 5, hold: 2 },
  // A wyrm's strike: as far as Rootfang goes and back off it immediately, so the
  // same depth reads as speed rather than as weight. This is the pair that shows
  // `hold` is doing work independent of `reach`.
  echowyrm: { reach: 5, hold: 1 },
  // The one that goes the other way. A hole in the index does not travel to
  // reach you; it holds two frames barely off its mark, and the blow lands
  // anyway. Shallower than the trash it is a boss over, on purpose.
  unindexed: { reach: 2, hold: 2 },
  // Hot and quick — out and back inside the frame, no follow-through.
  pyrelord: { reach: 4, hold: 1 },
  // Unhurried. Comes most of the way and stays there, which is the closest this
  // vocabulary gets to contempt.
  aurelia: { reach: 4, hold: 2 },
  // The sweep that collects you: the longest reach on the roster, held.
  gc: { reach: 6, hold: 2 },
  // The last one gets the same depth as the collector and none of the pause —
  // it is the only boss that has somewhere else to be.
  rootcause: { reach: 6, hold: 1 },
};

// The shared script's own depth, so `reach` is read against the thing it scales
// rather than against a number written twice.
const BASE_REACH = Math.max(...monsterAttack.frames.map(f => f.shove));
const MAX_HOLD = monsterAttack.frames.length - 1 - monsterAttack.hitFrame;

function buildSwing(style) {
  const hold = Math.min(Math.max(1, style.hold || 1), MAX_HOLD);
  const k = style.reach / BASE_REACH;
  return monsterAttack.frames.map((f, i) => {
    const held = i > monsterAttack.hitFrame && i < monsterAttack.hitFrame + hold;
    return {
      shove: f.shove < 0 ? f.shove : (held ? style.reach : Math.round(f.shove * k)),
      fly: f.fly,
      hero: Math.round(f.hero * k),
    };
  });
}

const swings = new Map(Object.entries(BOSS_SWING).map(([id, s]) => [id, buildSwing(s)]));
// The shared script counts as one of these everywhere a maximum is derived, so
// the margins below cover the 22 monsters that have no entry as well.
const ALL_SWINGS = [monsterAttack.frames, ...swings.values()];

// How much further back than the default a monster stands, so that its lunge
// closes to the *same* gap every other monster's does. Without this the depth
// would be paid for out of the gap the damage figure lives in — the number
// appears on the impact frame, which is exactly the frame the boss has eaten it
// — and a four-digit hit off the Garbage Collector would arrive truncated. The
// reach is a distance the boss covers, so the scene reserves it rather than
// spending the mark's room on it. Shallow bosses stand correspondingly closer,
// which keeps the invariant in both directions.
function monsterStandoff(id) {
  const fs = swings.get(id);
  return fs ? Math.max(...fs.map(f => f.shove)) - BASE_REACH : 0;
}

// The head of the monster's mark and the streak behind it. Deliberately not
// per-monster: `heroes[cls].proj` differs by class because there are four of
// them and you pick one, whereas a per-monster projectile is 28 decisions no
// player would ever see side by side.
//
// Both glyphs are ones nothing else in the game draws — no hero's projectile,
// and no sprite's art. That rules out the obvious pair: monsters face left, so
// half the roster already wears a ◀ as its maw and four of them have ═ in their
// bodies, and a mark made of those reads as a piece of the monster that came
// loose. `sprites.test.js` holds the whole set apart.
const MONSTER_PROJ = '◄';
const MONSTER_TRAIL = '╍';

// What being hit looks like, indexed by frames *since* the blow landed — so it
// stays in step with a class that lands on a different frame.
//
// Two frames at full knockback and then home, rather than a decay: the hero's
// recoil can afford a curve because it starts on frame 1, and this starts on the
// impact frame with three frames left in the animation. At about one terminal
// redraw a second a viewer catches one frame of any given hit, so the real
// choice is how many of those three read as *struck* — and two of three at full
// extension beats a graceful 2-1-0 that is unambiguous on only one.
//
// `flash` is the sprite lighting up in the colour of the number hitting it, and
// it is the half that survives the compact HUD: one row of monster can move
// sideways, but two cells of shift on a 3-cell sprite is not legibly movement,
// and colour needs no room at all.
const MONSTER_FLINCH = [
  { shove: -2, flash: true },
  { shove: -2, flash: true },
  { shove: 0, flash: false },
];

// Cells the layout must keep to the hero's left so no displacement is ever
// clipped by the edge of the terminal. Derived from the scripts rather than
// written down beside them, so a deeper flinch cannot outgrow the room reserved
// for it. A dodge stacks its lean on top of whatever the attack script is
// already holding, but only from the frame the blow lands — so the two are
// summed over exactly the frames on which they can coincide, and no further.
const MAX_RECOIL = Math.max(0,
  ...Object.values(attacks).flatMap(a =>
    a.frames.map((f, i) => f.back + (i >= a.hitFrame ? Math.max(...DODGE_LEAN) : 0))),
  // A blow the hero never threw drives it back into the same margin. It cannot
  // stack with a dodge or a recoil: those belong to the hero's own hit anim and
  // this is a different animation, and only one plays at a time. Taken over
  // every boss depth as well as the shared script, because a deeper lunge drives
  // the hero further and the margin is the thing that has to have known.
  ...ALL_SWINGS.flatMap(fs => fs.map(f => f.hero)));

// The right-edge counterpart, and a constraint this scene has never had — until
// now nothing on the monster's side of it moved. The hero's margin is a clamp
// against column 0; this one is a clamp against `R.fit` quietly eating the end
// of the line, which is what a wind-up or a knockback runs into.
// No boss deepens it — `buildSwing` leaves the wind-up alone on purpose — but it
// is derived over the depths anyway, so that changing that rule cannot quietly
// outgrow the reserve instead of loudly widening it.
const MAX_MONSTER_BACK = Math.max(0,
  ...ALL_SWINGS.flatMap(fs => fs.map(f => -f.shove)),
  ...MONSTER_FLINCH.map(f => -f.shove));

// Frame the monster's blow lands on, and the frame its damage figure may appear.
const MONSTER_HIT_FRAME = monsterAttack.hitFrame;

// The monster's displacement and mark for `frame` of its own attack. `id` picks
// the boss depth if there is one; anything without an entry — which is every
// monster in the game but seven — gets the shared script unchanged, the same way
// `attackFrame` falls back for a class with no script of its own.
function monsterAttackFrame(frame, id) {
  const fs = swings.get(id) || monsterAttack.frames;
  const f = fs[Math.min(Math.max(0, frame), fs.length - 1)];
  return { shove: f.shove, fly: f.fly, hero: f.hero };
}

// What the monster is doing `age` frames after a blow of the hero's landed.
// Past the end of the script it is back on its mark and its own colour.
function monsterFlinchFrame(age) {
  return MONSTER_FLINCH[age] || { shove: 0, flash: false };
}

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

const DEAD_MONSTER = '░▄▐╳╳▌▄░';
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
  bigHero, bigMonster, BIG_ROWS, ONE_LINE_W, ONE_LINE_BOSS_W,
  attackFrame, hitFrame, MAX_RECOIL, DODGE_LEAN,
  BLOW_MS, BEATS, BEAT_STARTS, beatAt, beatMs,
  VOLLEY, VOLLEY_GAP, volleyCols,
  monsterAttack, monsterAttackFrame, MONSTER_FLINCH, monsterFlinchFrame,
  BOSS_SWING, BASE_REACH, MAX_HOLD, monsterStandoff,
  MONSTER_PROJ, MONSTER_TRAIL, MONSTER_HIT_FRAME, MAX_MONSTER_BACK,
  DEAD_MONSTER, DEAD_MONSTER_BIG, FRAME_MS,
};
