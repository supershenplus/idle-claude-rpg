'use strict';
// The /hero skill is the game's entire interface for most players — Claude
// reads it and nothing else to decide what `/hero <anything>` means.
//
// It drifted: `equip best`, the status nudge and the whole Insight board landed
// in v1.6 and v1.7, were written into the *installed* copy at
// ~/.claude/skills/hero/SKILL.md, and never made it back to the file in the
// repo. Everyone installing from a clone got a /hero that had never heard of
// half the game, and nothing failed — the skill is prose, so a missing section
// reads exactly like a section that was never needed.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SKILL = require('../lib/skill');
const CLI_SRC = fs.readFileSync(path.join(REPO, 'bin', 'rpg.js'), 'utf8');
const TEXT = SKILL.render();

// Dev-only entry points; the skill deliberately does not offer them.
const INTERNAL = new Set(['fold', 'sim']);

test('every player-facing CLI command is documented in the skill', () => {
  // Read from the CLI's own fallback usage line, so adding a command without
  // documenting it fails here rather than silently shipping.
  const m = /commands: ([a-z ]+)'/.exec(CLI_SRC);
  assert.ok(m, 'could not find the CLI usage line to read commands from');
  const commands = m[1].trim().split(/\s+/).filter(c => !INTERNAL.has(c));
  assert.ok(commands.length >= 10, `only found ${commands.length} commands`);

  // A plain word-boundary search rather than a `/hero <cmd>` prefix: the skill
  // legitimately documents several commands in one pipe-separated line
  // (`/hero status | zone | shop | inventory | stats`). The drift this is
  // guarding against was whole features going unmentioned anywhere at all.
  const missing = commands.filter(c => !new RegExp(`\\b${c}\\b`).test(TEXT));
  assert.deepEqual(missing, [], `undocumented in SKILL.md: ${missing.join(', ')}`);
});

test('the two-step confirm commands are all marked as two-step', () => {
  // Getting this wrong spends the player's gold or bins their loot without a
  // preview, which is the one class of mistake the CLI cannot undo.
  for (const phrase of ['sell all', 'upgrade <slot> max', 'insight <track> max']) {
    assert.ok(TEXT.includes(phrase), `SKILL.md never mentions \`${phrase}\``);
  }
  const confirms = (TEXT.match(/--confirm/g) || []).length;
  assert.ok(confirms >= 6, `only ${confirms} mentions of --confirm; the preview rule is under-stated`);
});

test('the skill names every class the game actually has', () => {
  const C = require('../lib/content');
  for (const id of Object.keys(C.classes)) {
    assert.match(TEXT, new RegExp(C.classes[id].name, 'i'), `class ${id} missing from the init picker`);
  }
});

test('the template carries no absolute path of its own', () => {
  // The source file must stay clone-agnostic; only the rendered copy is allowed
  // to name a directory.
  const raw = fs.readFileSync(SKILL.SRC, 'utf8');
  assert.doesNotMatch(raw, /\/Users\/|\/home\//, 'a real home directory is checked into the skill');
  assert.ok(raw.includes('{{REPO}}'), 'the placeholder is gone — rendering would be a no-op');
  assert.equal((raw.match(/\{\{REPO\}\}/g) || []).length, 2, 'expected the CLI path in exactly two places');
});

test('frontmatter stays valid after rendering', () => {
  const lines = TEXT.split('\n');
  assert.equal(lines[0], '---');
  const end = lines.indexOf('---', 1);
  assert.ok(end > 1, 'frontmatter is not closed');
  const fm = lines.slice(1, end).join('\n');
  assert.match(fm, /^name: hero$/m);
  assert.match(fm, /^description: .{20,}/m);
  assert.match(fm, /^allowed-tools: Bash\(node \/.*\/bin\/rpg\.js \*\)$/m,
    'allowed-tools must be an absolute path — it is a permission grant, not a hint');
});
