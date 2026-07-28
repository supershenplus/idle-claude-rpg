#!/usr/bin/env node
'use strict';

// Wiring the game into Claude Code's settings.json, and diagnosing it when the
// hero stops ticking.
//
// The installer's default has always been to *print* this snippet and let you
// paste it: settings.json is the file that decides what runs on every tool call
// in every session, and a game installer is not entitled to it. That stays the
// default. `merge` exists because "paste this JSON into the right nesting level
// of a file you may not have" is where a first-time install actually fails, and
// a careful merge behind an explicit flag is safer than the hand-edit it
// replaces — it backs the file up first, and it is idempotent.
//
// Everything here keys off two script paths rather than off exact command
// strings, so a re-run after moving the clone repairs the wiring instead of
// adding a second copy of it. That matters: absolute paths into a directory the
// user is free to move is this design's one real fragility, and it fails
// *silently* — a stale path means the hooks no-op and the hero quietly stops.

const fs = require('fs');
const os = require('os');
const path = require('path');
const SKILL = require('../lib/skill');

const REPO = path.resolve(__dirname, '..');
const HOOK_JS = path.join(REPO, 'hooks', 'rpg-hook.js');
const LINE_JS = path.join(REPO, 'statusline', 'rpg-statusline.js');
const MATCHER = 'Bash|Edit|Write|MultiEdit|NotebookEdit';

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const SKILL_DST = path.join(CLAUDE_DIR, 'skills', 'hero', 'SKILL.md');

const cmd = s => `node "${s}"`;
const hookEntry = () => ({ type: 'command', command: cmd(HOOK_JS), timeout: 5 });

// A command belongs to this game if it mentions one of our script basenames —
// regardless of which clone it points at. `mine` then narrows that to *this*
// clone. The gap between the two is exactly the moved-directory failure.
const isOurs = (c, base) => typeof c === 'string' && c.includes(base);
const isMine = (c, abs) => typeof c === 'string' && c.includes(abs);

function readSettings() {
  if (!fs.existsSync(SETTINGS)) return { exists: false, data: {} };
  const raw = fs.readFileSync(SETTINGS, 'utf8');
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { exists: true, raw, error: 'settings.json is not a JSON object' };
    }
    return { exists: true, raw, data };
  } catch (e) {
    return { exists: true, raw, error: `settings.json is not valid JSON: ${e.message}` };
  }
}

function writeSettings(data, { backup = true } = {}) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  let bak = null;
  if (backup && fs.existsSync(SETTINGS)) {
    // Timestamped rather than a single .bak, so a second run never eats the
    // copy of the file as it was before this tool ever touched it. The suffix
    // matters because merge-then-uninstall lands inside the same second, and
    // that is exactly the pair you would want both halves of.
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
    bak = `${SETTINGS}.bak-${stamp}`;
    for (let n = 2; fs.existsSync(bak); n++) bak = `${SETTINGS}.bak-${stamp}-${n}`;
    fs.copyFileSync(SETTINGS, bak);
  }
  const tmp = `${SETTINGS}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, SETTINGS);
  return bak;
}

// Walk every hook group in every event, so we can report and strip our entries
// without caring how the user nested the rest of their config.
function eachHook(data, fn) {
  const hooks = data.hooks;
  if (!hooks || typeof hooks !== 'object') return;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) continue;
      for (const h of group.hooks) fn(event, group, h);
    }
  }
}

function inspect(data) {
  const found = { PostToolUse: [], Stop: [], other: [] };
  eachHook(data, (event, group, h) => {
    if (!isOurs(h.command, 'rpg-hook.js')) return;
    const rec = { event, matcher: group.matcher, command: h.command, mine: isMine(h.command, HOOK_JS) };
    (found[event] || found.other).push(rec);
  });
  const sl = data.statusLine;
  const slCommand = sl && typeof sl === 'object' ? sl.command : null;
  return {
    hooks: found,
    statusLine: {
      present: !!sl,
      ours: isOurs(slCommand, 'rpg-statusline.js'),
      mine: isMine(slCommand, LINE_JS),
      command: slCommand || null,
      refreshInterval: sl && sl.refreshInterval,
      padding: sl && sl.padding,
    },
  };
}

function snippet() {
  return `Merge the two hook groups into the EXISTING "hooks" object in
${SETTINGS} (your PreToolUse/SessionStart guardrails stay as
they are — hook groups merge), and add "statusLine" as a new top-level key:

  "hooks": {
    ...your existing PreToolUse / SessionStart entries...,
    "PostToolUse": [
      { "matcher": "${MATCHER}",
        "hooks": [{ "type": "command",
          "command": ${JSON.stringify(cmd(HOOK_JS))},
          "timeout": 5 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command",
          "command": ${JSON.stringify(cmd(HOOK_JS))},
          "timeout": 5 }] }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": ${JSON.stringify(cmd(LINE_JS))},
    "refreshInterval": 1,
    "padding": 0
  }

Then restart Claude Code and run /hero init.

Or let the installer do it for you, with a backup:  ./install.sh --write-settings`;
}

function doMerge(force) {
  const s = readSettings();
  if (s.error) {
    console.error(`error: ${s.error}`);
    console.error(`Fix or move ${SETTINGS}, or paste the snippet by hand:\n  ./install.sh --print-settings`);
    return 1;
  }
  const data = s.data;
  const changes = [];

  data.hooks = data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks)
    ? data.hooks : {};

  for (const [event, matcher] of [['PostToolUse', MATCHER], ['Stop', null]]) {
    if (!Array.isArray(data.hooks[event])) data.hooks[event] = [];
    const groups = data.hooks[event];

    // Repair before adding: an entry of ours pointing at another clone is the
    // moved-directory case, and rewriting it in place is the whole repair.
    let repaired = false, present = false;
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) continue;
      for (const h of group.hooks) {
        if (!isOurs(h.command, 'rpg-hook.js')) continue;
        if (isMine(h.command, HOOK_JS)) { present = true; continue; }
        changes.push(`${event}: repointed a stale hook at this clone (was ${h.command})`);
        h.command = cmd(HOOK_JS);
        h.type = 'command';
        if (h.timeout == null) h.timeout = 5;
        repaired = present = true;
      }
    }
    if (present || repaired) {
      if (!repaired) changes.push(`${event}: already wired, left alone`);
      continue;
    }
    groups.push(matcher ? { matcher, hooks: [hookEntry()] } : { hooks: [hookEntry()] });
    changes.push(`${event}: added the game hook`);
  }

  const sl = data.statusLine;
  const slCmd = sl && typeof sl === 'object' ? sl.command : null;
  const HUD = () => ({ type: 'command', command: cmd(LINE_JS), refreshInterval: 1, padding: 0 });
  let kept = false;
  if (!sl) {
    data.statusLine = HUD();
    changes.push('statusLine: added the HUD');
  } else if (isMine(slCmd, LINE_JS)) {
    changes.push('statusLine: already wired, left alone');
  } else if (isOurs(slCmd, 'rpg-statusline.js')) {
    data.statusLine = HUD();
    changes.push(`statusLine: repointed a stale HUD at this clone (was ${slCmd})`);
  } else if (force) {
    data.statusLine = HUD();
    changes.push(`statusLine: REPLACED your existing status line (was ${slCmd || JSON.stringify(sl)})`);
  } else {
    // You only get one status line, and yours is already doing a job. Taking it
    // silently is the one move here that would lose work rather than add to it.
    // The hooks still go in — a half-install that ticks is worth more than an
    // aborted one, and the HUD is the part with a token-free fallback.
    kept = true;
    changes.push(`statusLine: left as yours, not replaced (${slCmd || JSON.stringify(sl)})`);
  }

  const bak = writeSettings(data);
  console.log(`ok: wrote ${SETTINGS}`);
  for (const c of changes) console.log(`  ${c}`);
  if (bak) console.log(`backup: ${bak}`);
  if (kept) {
    console.log('\nYour status line was kept. To hand it to the game instead, re-run with');
    console.log('--force. To keep both, play token-free via `! node bin/rpg.js status`.');
  }
  console.log('\nRestart Claude Code, then run /hero init.');
  return 0;
}

function doRemove() {
  const s = readSettings();
  if (!s.exists) { console.log(`nothing to remove: ${SETTINGS} does not exist`); return 0; }
  if (s.error) { console.error(`error: ${s.error}`); return 1; }
  const data = s.data;
  const removed = [];

  const hooks = data.hooks;
  if (hooks && typeof hooks === 'object') {
    for (const event of Object.keys(hooks)) {
      if (!Array.isArray(hooks[event])) continue;
      for (const group of hooks[event]) {
        if (!group || !Array.isArray(group.hooks)) continue;
        const before = group.hooks.length;
        group.hooks = group.hooks.filter(h => !isOurs(h.command, 'rpg-hook.js'));
        if (group.hooks.length !== before) removed.push(`${event}: removed the game hook`);
      }
      // Drop the shells we would have created, but never a group that still
      // holds someone else's hook.
      hooks[event] = hooks[event].filter(g => !g || !Array.isArray(g.hooks) || g.hooks.length);
      if (!hooks[event].length) delete hooks[event];
    }
    if (!Object.keys(hooks).length) delete data.hooks;
  }

  const slCmd = data.statusLine && data.statusLine.command;
  if (isOurs(slCmd, 'rpg-statusline.js')) {
    delete data.statusLine;
    removed.push('statusLine: removed the HUD');
  } else if (data.statusLine) {
    removed.push('statusLine: left alone (not ours)');
  }

  if (!removed.length) { console.log('nothing of ours found in settings.json'); return 0; }
  const bak = writeSettings(data);
  console.log(`ok: wrote ${SETTINGS}`);
  for (const r of removed) console.log(`  ${r}`);
  if (bak) console.log(`backup: ${bak}`);
  console.log('\nYour save in ~/.config/idle-claude-rpg/ is untouched — delete it by hand');
  console.log('if you want the hero gone too. Restart Claude Code to drop the HUD.');
  return 0;
}

// The doctor. Ordered so the first ✗ is the thing to fix: a stale hook path
// explains a dead HUD, and a missing save explains an empty one.
function doCheck() {
  const P = require('../lib/paths');
  const out = [];
  let bad = 0, warn = 0;
  const ok = m => out.push(`  ok   ${m}`);
  const no = m => { bad++; out.push(`  FAIL ${m}`); };
  const hm = m => { warn++; out.push(`  warn ${m}`); };

  console.log(`idle-claude-rpg check\n  repo: ${REPO}\n  claude dir: ${CLAUDE_DIR}\n`);

  const major = Number(process.versions.node.split('.')[0]);
  major >= 18 ? ok(`node ${process.version}`) : no(`node ${process.version} — need >= 18`);

  // Compared against the *rendered* skill, not the template: the checked-in
  // file still has {{REPO}} in it, so comparing raw would report every correct
  // install as stale.
  if (!fs.existsSync(SKILL_DST)) no(`/hero skill missing — run ./install.sh`);
  else {
    const live = fs.readFileSync(SKILL_DST, 'utf8');
    if (live.includes('{{REPO}}')) no(`/hero skill at ${SKILL_DST} was copied unrendered — re-run ./install.sh`);
    else if (live !== SKILL.render()) hm(`/hero skill at ${SKILL_DST} points at a different clone or is out of date — re-run ./install.sh`);
    else ok('/hero skill installed');
  }

  const s = readSettings();
  if (!s.exists) {
    no(`${SETTINGS} does not exist — run ./install.sh --write-settings`);
  } else if (s.error) {
    no(s.error);
  } else {
    const i = inspect(s.data);
    for (const event of ['PostToolUse', 'Stop']) {
      const hits = i.hooks[event];
      if (!hits.length) no(`${event} hook not wired — the hero never ticks. ./install.sh --write-settings`);
      else if (!hits.some(h => h.mine)) no(`${event} hook points at a different clone (${hits[0].command}) — ./install.sh --write-settings repoints it`);
      else if (hits.length > 1) hm(`${event} has ${hits.length} game hooks — the hero ticks more than once per event`);
      else ok(`${event} hook wired`);
    }
    if (i.hooks.other.length) hm(`game hook also wired to ${i.hooks.other.map(h => h.event).join(', ')} — unexpected`);
    if (!i.statusLine.present) no('no statusLine — the HUD cannot draw. ./install.sh --write-settings');
    else if (i.statusLine.mine) {
      ok('statusLine wired');
      if (i.statusLine.refreshInterval !== 1) hm(`statusLine.refreshInterval is ${i.statusLine.refreshInterval} — animations want 1`);
      if (i.statusLine.padding !== 0) hm(`statusLine.padding is ${i.statusLine.padding} — the art wants 0`);
    } else if (i.statusLine.ours) no(`statusLine points at a different clone (${i.statusLine.command})`);
    else hm(`statusLine is someone else's (${i.statusLine.command}) — the game will not draw a HUD`);
  }

  if (!fs.existsSync(P.stateFile)) hm(`no hero yet at ${P.stateFile} — run /hero init`);
  else {
    try {
      const h = (JSON.parse(fs.readFileSync(P.stateFile, 'utf8')) || {}).hero;
      if (!h || !h.name) no(`save at ${P.stateFile} has no hero in it — run /hero init`);
      else ok(`hero: ${h.name} the ${h.class}, level ${h.level} in ${h.zone}, ${h.gold}g`);
    } catch (e) { no(`save at ${P.stateFile} is unreadable: ${e.message}`); }
  }
  if (fs.existsSync(P.eventsFile)) {
    const pending = fs.readFileSync(P.eventsFile, 'utf8').split('\n').filter(Boolean).length;
    if (pending > 500) hm(`${pending} unfolded events queued — the statusline folds them, so this drains as you use Claude Code`);
    else ok(`${pending} event(s) queued`);
  }

  console.log(out.join('\n'));
  console.log(bad ? `\n${bad} problem(s) found.` : warn ? `\nWired up. ${warn} note(s) above.` : '\nAll good.');
  return bad ? 1 : 0;
}

// Render the /hero skill into place, diff-printing when it changes an existing
// install. Lives here rather than as a `cp` in install.sh because the file has
// to be templated, and a bash sed pipeline is a worse place to get that wrong.
function doSkill() {
  const rendered = SKILL.render();
  fs.mkdirSync(path.dirname(SKILL_DST), { recursive: true });
  if (fs.existsSync(SKILL_DST)) {
    const live = fs.readFileSync(SKILL_DST, 'utf8');
    if (live === rendered) { console.log(`ok: /hero skill already current at ${SKILL_DST}`); return 0; }
    console.log(`updating ${SKILL_DST} (was ${live.includes('{{REPO}}') ? 'unrendered' : 'a different clone or version'})`);
  }
  fs.writeFileSync(SKILL_DST, rendered);
  console.log(`ok: /hero skill installed at ${SKILL_DST}`);
  return 0;
}

const [, , sub, ...rest] = process.argv;
const force = rest.includes('--force');
let code = 0;
switch (sub) {
  case 'print': console.log(snippet()); break;
  case 'skill': code = doSkill(); break;
  case 'merge': code = doMerge(force); break;
  case 'remove': code = doRemove(); break;
  case 'check': code = doCheck(); break;
  default:
    console.error('usage: settings.js print | merge [--force] | remove | check | skill');
    code = 2;
}
process.exit(code);
