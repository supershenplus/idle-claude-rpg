'use strict';

// Hero sprites + projectile styling per class, and the 3-line "big" art used by
// the tall HUD. One-line sprites for monsters live in content.js; their big art
// is keyed by the same id here so content.js stays pure name/level data.
//
// Every big sprite is exactly BIG_ROWS lines. Rows are centred individually at
// render time, so ragged line widths are fine — but ragged *row counts* are not.

const BIG_ROWS = 3;

const heroes = {
  wizard: { idle: '(∩｀-´)⊃', proj: '☆ﾟ.*', trail: '━' },
  knight: { idle: '[è_é]o', proj: '≫', trail: '=' },
  rogue:  { idle: '(¬‿¬)⌐', proj: '╫', trail: '─' },
  ranger: { idle: '(๑•̀ᴗ•́)', proj: '➳', trail: '-' },
};

const heroesBig = {
  wizard: ['◢◣', '(∩｀-´)⊃', '╱▓▓╲'],
  knight: ['▄▟▙▄', '[è_é]o', '▛▀▀▜'],
  rogue:  ['╭──╮', '(¬‿¬)⌐', '╱╲╱╲'],
  ranger: ['⇈ ⇈', '(๑•̀ᴗ•́)', '╱▐▌╲'],
};

const monstersBig = {
  // Whispering Grove
  slime:       ['╭───╮', '(⊙▂⊙)', '╰~~~╯'],
  gremlin:     ['^   ^', 'ヽ(`Д´)ﾉ', '╯   ╰'],
  direrat:     ['ᐧᐧ  ᐧᐧ', '~(¬,¬)~', '╰┬─┬╯'],
  rootfang:    ['▓╱▔▔▔╲▓', '⺤ꙨᴥꙨ⺤', '╱╱│││╲╲'],
  // Cobalt Caves
  batswarm:    ['╲╲   ╱╱', '^⋀,,⋀^', '╰╯ ╰╯'],
  crawler:     ['╱╲ ╱╲', '(》○《)', '╱ ╲╱ ╲'],
  kobold:      ['╭┳╮', '(⌐■_■)⛏', '╱▮╲'],
  echowyrm:    ['≋≋≋≋≋≋≋≋≋', '≋≋(°○°)≋≋', '╰≋≋≋≋≋╯'],
  // Sunken Archives
  librarian:   ['▄▄▄▄', '[¬º-°]¬', '▐▓▓▌'],
  inkelem:     ['░▒▓▒░', '{~˷~}', '▒░ ░▒'],
  tome:        ['┌─────┐', '/|◉‿◉|\\', '└─╫─╫─┘'],
  unindexed:   ['▒▒▒▒▒▒▒', '⟦  ∅  ⟧', '▒▒▒▒▒▒▒'],
  // Ember Wastes
  cinderhound: ['╱╲ ╱╲', '(`▲´)ノ~', '╰╯ ╰╯'],
  magmaimp:    ['◣ ◢', '(≖‿≖)~°', '╱ ╲'],
  ashwraith:   ['░▒▓▓▓▒░', '(◣_◢)', '╲░░░╱'],
  pyrelord:    ['◢▓▓▓▓▓◣', 'Ψ(▼皿▼)Ψ', '╱╱▮▮▮╲╲'],
  // Glass Peaks
  harpy:       ['╲╲╲ ╱╱╱', '≪(⊙∆⊙)≫', '╰╯ ╰╯'],
  golem:       ['▛▀▀▀▀▀▜', '[▣_▣]', '▙▄▄▄▄▄▟'],
  shade:       ['░░▒▒▒░░', '(≖_≖ )', '╲▒▒▒╱'],
  aurelia:     ['◇◆◇◆◇◆◇', '◇(¯▽¯)◇', '╱◆◇◆◇◆╲'],
  // The Null Expanse
  leech:       ['╭─╮', '(∵)', '╰⌇╯'],
  segfault:    ['▚▚▚▚▚▚▚', '(0x00_0x00)', '▞▞▞▞▞▞▞'],
  dangling:    ['⟶  ⟶', '*(&_&)', '╱  ╲'],
  gc:          ['♻♻♻♻♻♻♻', '♻(◉Δ◉)♻', '╲▓▓▓▓▓╱'],
  // Production
  heisenbug:   ['?  ¿  ?', '¿(ō_ō)?', '¿  ?  ¿'],
  racecond:    ['⇉⇇⇉⇇⇉', '(⇆_⇆)', '⇇⇉⇇⇉⇇'],
  memleak:     ['░ ░ ░ ░', '(´д`)…', '▒▒▒▒▒▒▒'],
  daemon:      ['╔═════╗', '(☎_☎)', '╚═╤═╤═╝'],
  rootcause:   ['▓▓▓▒▒▒▓▓▓', '▓▒(●̀_●́)▒▓', '╱▓▒▒▒▒▒▓╲'],
};

const DEAD_MONSTER = '(x_x)';
const DEAD_MONSTER_BIG = ['╲   ╱', '(x_x)', '╱   ╲'];

// Fall back to padding the one-line sprite so a monster added to content.js
// without big art still renders at the right height instead of collapsing.
function bigMonster(id, oneLine) {
  const art = monstersBig[id];
  if (art && art.length === BIG_ROWS) return art;
  return ['', oneLine || '(?)', ''];
}
function bigHero(clsId) { return heroesBig[clsId] || heroesBig.wizard; }

// Frame period for all animations (ms per frame)
const FRAME_MS = 250;

module.exports = {
  heroes, heroesBig, monstersBig,
  bigHero, bigMonster, BIG_ROWS,
  DEAD_MONSTER, DEAD_MONSTER_BIG, FRAME_MS,
};
