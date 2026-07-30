'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');

// The install root. Global: one of these per machine, shared by every repo and
// every open window, which is why three windows triple your tick rate.
const STATE_DIR = process.env.IDLE_RPG_HOME
  || path.join(os.homedir(), '.config', 'idle-claude-rpg');

// One directory per hero, with the save's filenames unchanged inside it —
// `state.json`, `state.bak.1.json`, `state.corrupt-*.json` and the rest all move
// down one level and keep their names. That is the whole reason for the extra
// directory: the flat alternative (`state.<slug>.bak.2.json`) would make every
// filename regex in state.js ambiguous, for the sake of a shallower tree.
const CHARS_DIR = path.join(STATE_DIR, 'characters');
// Which hero the machine is playing. One line, rewritten by `/hero switch`.
const ACTIVE_FILE = path.join(STATE_DIR, 'active');
// Where a pre-roster install keeps its only hero, and the only thing that
// triggers adoption below.
const LEGACY_STATE = path.join(STATE_DIR, 'state.json');

// Slugs are generated, never derived from the hero's name. Names are user input
// — sanitizeName deliberately protects `勇者` and `Eva 🗡` — and a path built
// from one hits filesystem-unsafe characters, macOS case-insensitive collisions
// and length limits. The display name stays inside the save, where it already
// is. This pattern is also the path-traversal guard on $IDLE_RPG_HERO.
const SLUG_RE = /^[A-Za-z0-9_-]{1,32}$/;
const FIRST_SLUG = 'hero_1';

const charDir = slug => path.join(CHARS_DIR, slug);
const stateFileFor = slug => path.join(charDir(slug), 'state.json');

// Every hero on the machine, oldest number first. A directory without a
// `state.json` in it is not a character: that is a half-finished `init`, an
// interrupted adoption, or the empty dir a raced adoption can leave behind.
function listSlugs() {
  let names = [];
  try { names = fs.readdirSync(CHARS_DIR); } catch (_) { return []; }
  return names
    .filter(n => SLUG_RE.test(n) && fs.existsSync(stateFileFor(n)))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

// The lowest `hero_<n>` no directory has claimed. Deliberately blind to whether
// the directory holds a save — a half-made one is still taken.
function freeSlug() {
  let taken = [];
  try { taken = fs.readdirSync(CHARS_DIR); } catch (_) { /* none yet */ }
  const set = new Set(taken);
  for (let n = 1; ; n++) if (!set.has(`hero_${n}`)) return `hero_${n}`;
}

function writeActive(slug) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = path.join(STATE_DIR, `active.tmp.${process.pid}`);
    fs.writeFileSync(tmp, slug + '\n');
    fs.renameSync(tmp, ACTIVE_FILE);
  } catch (_) { /* best effort — a missing pointer falls back below */ }
}

// A pre-roster install has `state.json` at the top level and must not notice
// the change. Move the save and everything it spilled into down one level and
// write the pointer.
//
// `state.json` goes **last**. Interrupted the other way round, the hero would
// land in the character directory while its backup generations stayed stranded
// at the top level with nothing left to trigger a second attempt — and the
// backups are the whole recovery story. Interrupted this way round, the top
// level still has `state.json`, so the next process finishes the job.
//
// The target is `hero_1` unless something already lives there, which is what
// makes a resumed adoption land where the interrupted one was going.
function adoptLegacy() {
  if (!fs.existsSync(LEGACY_STATE)) return;
  const slug = fs.existsSync(stateFileFor(FIRST_SLUG)) ? freeSlug() : FIRST_SLUG;
  const dir = charDir(slug);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { return; }

  let names = [];
  try { names = fs.readdirSync(STATE_DIR); } catch (_) { return; }
  const belongs = n => /^state\.(bak|bak\.\d+|corrupt-\d+|v\d+|tmp\.\d+)\.json$/.test(n);
  for (const n of names.filter(belongs)) {
    try { fs.renameSync(path.join(STATE_DIR, n), path.join(dir, n)); } catch (_) { /* raced */ }
  }
  try {
    fs.renameSync(LEGACY_STATE, stateFileFor(slug));
  } catch (_) {
    // Another process adopted it out from under us between the existsSync and
    // here. Theirs is a complete adoption, so leave it alone and drop the empty
    // directory we staged; resolve() below finds their work either way.
    try { fs.rmdirSync(dir); } catch (_) { /* not empty: leave it */ }
    return;
  }
  writeActive(slug);
}

// Which hero this process is playing, in priority order:
//
//   $IDLE_RPG_HERO   this window only, overriding everything
//   the `active` file  the machine-wide answer, rewritten by /hero switch
//   the first hero on disk   when the pointer is missing or dangles
//
// The env var is exactly the escape hatch $RPG_HUD already is over the saved
// HUD pin: switching is machine-wide by default because the save is, and anyone
// who wants two heroes in two windows opts in without anyone else paying.
//
// An unparseable $IDLE_RPG_HERO is ignored rather than obeyed — it is the one
// input here that can come from outside the game, and a slug is a path segment.
function resolveSlug() {
  const env = (process.env.IDLE_RPG_HERO || '').trim();
  if (env && SLUG_RE.test(env)) return env;
  let pinned = '';
  try { pinned = fs.readFileSync(ACTIVE_FILE, 'utf8').trim(); } catch (_) { /* none */ }
  const valid = pinned && SLUG_RE.test(pinned);
  if (valid && fs.existsSync(stateFileFor(pinned))) return pinned;
  // A dangling pointer must never cost you access to a hero that is right
  // there on disk, so fall through to one — and when there is genuinely
  // nothing, name the slug `init` will create.
  return listSlugs()[0] || (valid ? pinned : FIRST_SLUG);
}

// Resolved once per process. Every process here is short-lived — the hook, the
// statusline and each CLI command are all a fresh one — so caching costs
// nothing and a switch in one window still reaches every other HUD on its next
// frame, mid-animation.
//
// Adoption hangs off this rather than off an explicit init() call because it
// has to run before the first read of a save path, and a call site that can be
// forgotten is a call site that will be. It costs one existsSync per process.
let cached = null;
function slug() {
  if (!cached) { adoptLegacy(); cached = resolveSlug(); }
  return cached;
}

module.exports = {
  STATE_DIR,
  CHARS_DIR,
  activeFile: ACTIVE_FILE,
  legacyStateFile: LEGACY_STATE,
  SLUG_RE,
  isSlug: s => typeof s === 'string' && SLUG_RE.test(s),
  listSlugs,
  freeSlug,
  charDir,
  stateFileFor,
  // Point *this process* at a hero, without telling anyone else. `init` needs
  // this on its own so it can write the save before it publishes the pointer:
  // announcing first and then failing to save would leave every other window
  // following a slug with no hero in it.
  useSlug(s) { cached = s; },
  // …and then tell the machine.
  setActive(s) { cached = s; writeActive(s); },
  activeSlug: slug,

  // ---- per-character, resolved through the active slug ----
  get CHAR_DIR() { return charDir(slug()); },
  get stateFile() { return stateFileFor(slug()); },
  // Per-process tmp name. A single shared tmp path lets two writers (a CLI
  // command and the hook's fold) clobber each other's staging file: the first
  // rename publishes the second's bytes, the second throws ENOENT. The hook's
  // lock can't fix this — tryFold already holds it across its own save, so
  // locking here would deadlock. Unique names make the writers independent and
  // leave rename as the atomic last-writer-wins step it's meant to be.
  get tmpFile() { return path.join(charDir(slug()), `state.tmp.${process.pid}.json`); },
  tmpGlobPrefix: 'state.tmp.',
  // The backup a save rolls into, newest first: `state.bak.1.json` is at most
  // BAK_INTERVAL_MS old and each one behind it another interval back, so the
  // most a single bad write can cost is one interval rather than the whole
  // window. Four of them because the failure this replaced was not corruption
  // but a *valid* save written over a good one — which the game cannot detect,
  // so the only defence is more than one step back.
  BAK_GENERATIONS: 4,
  bakGen: n => path.join(charDir(slug()), `state.bak.${n}.json`),
  bakGenFor: (s, n) => path.join(charDir(s), `state.bak.${n}.json`),
  // The single pre-generational backup. Kept as a name so an existing install
  // can have it adopted as generation 1 instead of dropped, and so `reset` still
  // knows to delete it.
  get bakFile() { return path.join(charDir(slug()), 'state.bak.json'); },
  bakFileFor: s => path.join(charDir(s), 'state.bak.json'),

  // ---- global, and deliberately so ----
  //
  // The inbox does not move. The hook appends work events without knowing which
  // hero is active and must stay that way — it runs on every tool call and
  // cannot afford a load. Per-character inboxes would strand events on whoever
  // happened to be active when they were written; the events mean "work
  // happened", and whoever is on the clock gets paid for it.
  eventsFile: path.join(STATE_DIR, 'events.ndjson'),
  processingFile: path.join(STATE_DIR, 'events.processing'),
  // The lock does not move either. It serializes *folds*, and a fold now reads
  // the active pointer before it writes, so two folds for different characters
  // would still race on that read. One lock for the whole install.
  lockFile: path.join(STATE_DIR, 'state.lock'),
  bigmodeFlag: path.join(os.homedir(), '.claude', '.bigmode-active'),

  ensureDir() { fs.mkdirSync(STATE_DIR, { recursive: true }); },
  // Separate from ensureDir so that appending an event or taking the lock never
  // conjures a directory for a hero who does not exist — an empty one would
  // read as a character in the roster.
  ensureCharDir() { fs.mkdirSync(charDir(slug()), { recursive: true }); },
};
