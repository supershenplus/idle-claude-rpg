'use strict';

// ANSI + text layout helpers for the statusline and CLI.

const CODES = {
  reset: 0, bold: 1, dim: 2,
  red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  gray: 90, brightRed: 91, brightGreen: 92, brightYellow: 93, brightMagenta: 95,
};
function c(name, s) { return `\x1b[${CODES[name]}m${s}\x1b[0m`; }

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

// Truncate to width (approximate: counts code points, not terminal cells)
function fit(s, w) {
  const plain = visible(s);
  if (plain.length <= w) return s;
  // fall back to truncating the plain string to keep ANSI state sane
  return plain.slice(0, Math.max(0, w - 1)) + '…';
}

// left + right aligned within width
function spread(left, right, width) {
  const pad = width - visible(left).length - visible(right).length;
  return left + ' '.repeat(Math.max(1, pad)) + right;
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

module.exports = { c, RARITY_COLOR, rarityColored, bar, fmt, fmtGold, visible, fit, spread, relTime };
