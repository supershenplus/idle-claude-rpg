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

// A command belongs to this game if it *invokes* one of our scripts —
// regardless of which clone it points at. `mine` then narrows that to *this*
// clone. The gap between the two is exactly the moved-directory failure.
//
// This used to be a bare `c.includes('rpg-hook.js')`, which is a claim of
// ownership over any command that merely contains the string. Two commands that
// belong to somebody else and matched it: a wrapper at `.../my-rpg-hook.js`,
// and any tool naming ours in an argument (`lint.js --ignore hooks/rpg-hook.js`).
// `merge` rewrote both to point at us; `remove` deleted them outright.
//
// Same class of bug as the old `includes('idle-claude-rpg')` in `lib/classify.js`.
// Matching a path *token* fixes the first case but not the second — an argument
// is a perfectly good path token — so the question we actually have to answer is
// which script the command runs. `hooks/` and `statusline/` are then required
// alongside the basenames: they are part of this repo's layout, so they appear
// in every legitimate clone and rule out a same-named script somewhere else.
const INTERP = /^(?:.*\/)?(?:env|node|nodejs|bun|deno)$/;
const ASSIGN = /^[A-Za-z_]\w*=/;

// The script a shell command invokes — the first token of any segment that is
// neither an interpreter, one of its flags, nor a leading VAR=value.
function invokedScripts(c) {
  if (typeof c !== 'string') return [];
  const out = [];
  for (const seg of c.split(/[|;&\n]+/)) {
    const toks = (seg.match(/(?:"[^"]*"|'[^']*'|\S)+/g) || []).map(t => t.replace(/["']/g, ''));
    for (const t of toks) {
      if (!t || t.startsWith('-') || INTERP.test(t) || ASSIGN.test(t)) continue;
      out.push(t);
      break;
    }
  }
  return out;
}

const runs = (c, tail) => invokedScripts(c).some(s => s === tail || s.endsWith(`/${tail}`));
const isOurHook = c => runs(c, 'hooks/rpg-hook.js');
const isOurLine = c => runs(c, 'statusline/rpg-statusline.js');
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
  // Preserve whatever mode the live file had. The write is create-then-rename,
  // so without this a settings.json the user had hardened to 0600 comes back at
  // the umask default — we would silently widen permissions on the file that
  // names every executable Claude Code runs, as a side effect of an unrelated
  // merge. Nothing here *hardens* a file: a first write takes the umask default,
  // same as before, because picking a mode for a file we are creating on the
  // user's behalf is a different decision from not wrecking one they set.
  let mode = null;
  try { mode = fs.statSync(SETTINGS).mode & 0o777; } catch (_) { /* first write */ }
  const tmp = `${SETTINGS}.tmp`;
  // A tmp left behind by a crashed run would be reused as-is — `mode` below
  // applies only when the file is created — which would put the whole settings
  // body at a predictable path under that stale file's permissions for as long
  // as the rename takes.
  fs.rmSync(tmp, { force: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', mode == null ? {} : { mode });
  // umask can only take bits away from the create above, so re-assert the exact
  // mode now the content is down rather than settling for "no wider than".
  if (mode != null) fs.chmodSync(tmp, mode);
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
    if (!isOurHook(h.command)) return;
    const rec = { event, matcher: group.matcher, command: h.command, mine: isMine(h.command, HOOK_JS) };
    (found[event] || found.other).push(rec);
  });
  const sl = data.statusLine;
  const slCommand = sl && typeof sl === 'object' ? sl.command : null;
  return {
    hooks: found,
    statusLine: {
      present: !!sl,
      ours: isOurLine(slCommand),
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
    //
    // Collect every copy across every group *first*. Repointing them as we
    // walked was the bug: two pre-existing entries (two half-finished installs,
    // or a hand-edit plus a merge) became two byte-identical ones, so the hero
    // ticked twice per event — and since a double tick is just a faster hero,
    // nothing about it looks wrong until you read the file.
    const found = [];
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) continue;
      for (const h of group.hooks) if (isOurHook(h.command)) found.push({ group, h });
    }

    if (!found.length) {
      groups.push(matcher ? { matcher, hooks: [hookEntry()] } : { hooks: [hookEntry()] });
      changes.push(`${event}: added the game hook`);
      continue;
    }

    // Keep exactly one: an entry already pointing at this clone if there is
    // one, else the first stale entry, repointed. Every other copy goes.
    const keep = found.find(f => isMine(f.h.command, HOOK_JS)) || found[0];
    const emptied = new Set();
    for (const f of found) {
      if (f === keep) continue;
      f.group.hooks = f.group.hooks.filter(x => x !== f.h);
      if (!f.group.hooks.length) emptied.add(f.group);
      changes.push(`${event}: dropped a duplicate game hook (was ${f.h.command})`);
    }
    if (isMine(keep.h.command, HOOK_JS)) {
      changes.push(`${event}: already wired, left alone`);
    } else {
      changes.push(`${event}: repointed a stale hook at this clone (was ${keep.h.command})`);
      keep.h.command = cmd(HOOK_JS);
      keep.h.type = 'command';
      if (keep.h.timeout == null) keep.h.timeout = 5;
    }
    // Only the shells *we* just emptied — a group still holding a co-tenant's
    // hook stays, and so does one that arrived empty and is none of our business.
    if (emptied.size) data.hooks[event] = groups.filter(g => !emptied.has(g));
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
  } else if (isOurLine(slCmd)) {
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
        group.hooks = group.hooks.filter(h => !isOurHook(h.command));
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
  if (isOurLine(slCmd)) {
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

  // The active character, and how many others there are — a doctor that reports
  // one hero on a machine with four is describing the wrong save.
  const others = P.listSlugs().length - 1;
  const also = others > 0 ? ` (+${others} other character${others === 1 ? '' : 's'} — /hero roster)` : '';
  if (!fs.existsSync(P.stateFile)) hm(`no hero yet at ${P.stateFile} — run /hero init`);
  else {
    try {
      const h = (JSON.parse(fs.readFileSync(P.stateFile, 'utf8')) || {}).hero;
      if (!h || !h.name) no(`save at ${P.stateFile} has no hero in it — run /hero init`);
      else ok(`hero: ${h.name} the ${h.class}, level ${h.level} in ${h.zone}, ${h.gold}g${also}`);
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
