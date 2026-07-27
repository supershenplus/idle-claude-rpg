---
name: hero
description: idle-claude-rpg controls — init, status, shop, zone, inventory, equip, sell, stats. Use when the user types /hero or asks about their idle RPG hero, their loot, or the monster in the statusline.
allowed-tools: Bash(node /Users/eva0012/Projects/idle-claude-rpg/bin/rpg.js *)
---

# /hero — idle-claude-rpg control panel

The game CLI lives at `/Users/eva0012/Projects/idle-claude-rpg/bin/rpg.js`.
Map the user's arguments directly onto it:

- `/hero` (no args) → `node <cli> status`
- `/hero status | zone | shop | inventory | stats` → same subcommand verbatim
- `/hero zone go <id>`, `/hero shop buy <n>`, `/hero equip <n>`, `/hero sell <n>` → pass through as-is
- `/hero reset` → warn that this deletes the hero, and only run with `--confirm` after the user confirms

## First-run init

`/hero init` with no class: do NOT run the CLI menu. Instead use AskUserQuestion:

1. **Class** — options (label / description):
   - Wizard — `(∩｀-´)⊃━☆ﾟ.*` 15% chance any attack crits for double damage
   - Knight — `[è_é]o=====>` takes half damage, +25% HP, commits hit harder
   - Rogue — `(¬‿¬)⌐╦╦═─` gold ×1.25, loot drops 1.5× as often
   - Ranger — `(๑•̀ᴗ•́)︻┳═一` lines-of-code damage ×1.15, all XP ×1.10
2. **Hero name** — 2-4 fun suggestions; free text via "Other".

Then run: `node <cli> init --class <id> --name "<name>"`.

If the user already gave a class (e.g. `/hero init wizard`), skip the question
and run it directly.

## Output rules (keep token cost minimal)

- Relay the CLI output **verbatim in a code fence**. Never paraphrase, re-format,
  or recompute its numbers.
- Add at most one short sentence of color commentary after the fence. No headers,
  no summaries, no advice unless asked.
- If the CLI errors, show its message verbatim and stop.
