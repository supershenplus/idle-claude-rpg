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
  knight: [
    '  ◢██◣',
    '  ▒█▬█  ▟███▙',
    '░▒█████▬██◆█▓',
    ' ░▓███   ▜█▛',
    '▗██ ██▖   ▀',
  ],
  rogue: [
    '  ○   ·',
    ' ▟███▙',
    '░▒█▪▙▄▄',
    '░▒███▓ ╲',
    ' ▜▛ ▜▙   ▼',
  ],
  ranger: [
    '   ▄▄     ╮',
    '   ▐●▌   ╱ │',
    '  ░▒██▙▄───┼▶',
    '  ░▒█▓   ╲ │',
    ' ◣█ █▄    ╯',
  ],
};

const monstersBig = {
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
  heroes, heroesBig, monstersBig,
  bigHero, bigMonster, BIG_ROWS,
  DEAD_MONSTER, DEAD_MONSTER_BIG, FRAME_MS,
};
