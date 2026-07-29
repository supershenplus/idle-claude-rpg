'use strict';

// ANSI + text layout helpers for the statusline and CLI.

const CODES = {
  reset: 0, bold: 1, dim: 2,
  red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  gray: 90, brightRed: 91, brightGreen: 92, brightYellow: 93, brightMagenta: 95,
};
// NO_COLOR (no-color.org): set and non-empty means emit no escapes at all, so
// piping the HUD into a file or an issue report gives text rather than noise.
//
// Read per call rather than once at require: the statusline is a fresh process
// per frame, but the CLI and the demo are not, and a cached flag would make
// `NO_COLOR=1 node bin/demo.js` depend on module load order.
//
// Explicitly NOT auto-detected from isTTY. The status line's stdout is a pipe
// by construction — Claude Code captures it — so a TTY check would silently
// strip the colour from the one place that most needs it.
const noColor = () => !!process.env.NO_COLOR;
function c(name, s) { return noColor() ? String(s) : `\x1b[${CODES[name]}m${s}\x1b[0m`; }

const RARITY_COLOR = {
  common: 'white', uncommon: 'green', rare: 'blue', epic: 'magenta', legendary: 'brightYellow',
};
function rarityColored(rarity, s) { return c(RARITY_COLOR[rarity] || 'white', s); }

function bar(cur, max, width) {
  const w = Math.max(3, width);
  const frac = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  const filled = Math.round(frac * w);
  return '█'.repeat(filled) + '░'.repeat(w - filled);
}

function fmt(n) {
  n = Math.round(n);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
function fmtGold(n) { return Math.round(n).toLocaleString('en-US') + 'g'; }

// Strip ANSI for length math
function visible(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }

// Terminal cells occupied by one code point. Code-point counts are not cell
// counts: ｀ and 皿 eat two columns, and combining accents eat none. Getting
// this wrong visibly skews every centred column in the HUD.
//
// The sprites used to be the reason this existed — they were kaomoji, and are
// now single-cell block art that a test pins. It is still load-bearing, and for
// a better reason: the hero's name is whatever the player typed at `/hero init`,
// so the widest-measured thing on the vitals line is the one piece of text this
// game does not control. A CJK name would silently push the line past `cols`
// without it.
function charWidth(cp) {
  if (cp === 0) return 0;
  if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x200b && cp <= 0x200f)
    || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if (cp < 0x1100) return 1;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0x303e)
    || (cp >= 0x3041 && cp <= 0x33ff) || (cp >= 0x3400 && cp <= 0x4dbf)
    || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xa000 && cp <= 0xa4cf)
    || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f)
    || (cp >= 0x1f900 && cp <= 0x1f9ff)) return 2;
  return 1;
}
function width(s) {
  let w = 0;
  for (const ch of visible(s)) w += charWidth(ch.codePointAt(0));
  return w;
}

// Truncate to `w` terminal cells.
function fit(s, w) {
  if (width(s) <= w) return s;
  const plain = visible(s);
  let out = '', used = 0;
  for (const ch of plain) {
    const cw = charWidth(ch.codePointAt(0));
    if (used + cw > w - 1) break;
    out += ch; used += cw;
  }
  return out + '…';
}

// left + right aligned within width
function spread(left, right, w) {
  const pad = w - width(left) - width(right);
  return left + ' '.repeat(Math.max(1, pad)) + right;
}

// Row builder for the battle scene: absolute cell columns, ANSI-safe. Placing
// at a column already passed just butts the text on with a single space.
function row() {
  let s = '';
  return {
    put(text, col) {
      if (text == null || text === '') return this;
      s += ' '.repeat(Math.max(s === '' ? 0 : 1, col - width(s))) + text;
      return this;
    },
    width() { return width(s); },
    toString() { return s; },
  };
}

// Left column at which `text` starts so it is centred on cell `mid`.
function centerAt(text, mid) { return Math.max(0, Math.round(mid - width(text) / 2)); }

// Claude Code renders a status line as
//   stdout.trim().split('\n').flatMap(l => l.trim() || []).join('\n')
// so every line is trimmed and blank ones are dropped. The battle scene places
// each row with leading spaces, and losing them collapses the art flush-left a
// different amount per row — the sprite still looks plausible, which is what
// makes it so confusing to debug. U+2800 BRAILLE PATTERN BLANK draws nothing,
// is one cell wide, and is not whitespace to String.prototype.trim, so one of
// them in the leading run pins the whole line in place.
const BLANK = '⠀';
function keepIndent(s) {
  const line = s.replace(/\s+$/, '');
  if (line === '') return BLANK;
  return line.startsWith(' ') ? BLANK + line.slice(1) : line;
}

function relTime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 36) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ---------- HUD layouts ----------

// The two HUD layouts and the terminal width each one needs. These used to be
// inline ternaries in the statusline, which was fine while width was the only
// thing choosing a layout. Now that a save can pin one, the CLI has to know the
// same numbers to tell a player their terminal is too narrow for the pin —
// so both sides read them from here.
//
// There was a third, `mini`: one line of "Lv3 Wiz ♥40 Goblin Lv2 12/30" for
// terminals under 50 columns. It went because compact already degrades to
// exactly that on its own — every line is cut to `cols` before it is printed,
// so compact at 30 columns is a truncated scene rather than a broken one, and
// it keeps the sprites, which is the entire point of the HUD. mini spent a
// whole layout to render the one thing nobody opens a game for.
const HUD_MODES = ['big', 'compact'];
const HUD_MIN_COLS = { big: 76, compact: 0 };

// The layout a given width picks on its own, absent any preference.
function hudFor(cols) {
  return cols >= HUD_MIN_COLS.big ? 'big' : 'compact';
}

module.exports = {
  c, RARITY_COLOR, rarityColored, bar, fmt, fmtGold,
  visible, charWidth, width, fit, spread, row, centerAt, keepIndent, relTime,
  HUD_MODES, HUD_MIN_COLS, hudFor,
};
