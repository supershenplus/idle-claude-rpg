---
name: hero
description: idle-claude-rpg controls — init, status, shop, zone, inventory, equip, upgrade, sell, stats, hud. Use when the user types /hero or asks about their idle RPG hero, their loot, the monster in the statusline, or how the HUD is laid out.
allowed-tools: Bash(node {{REPO}}/bin/rpg.js *)
---

# /hero — idle-claude-rpg control panel

The game CLI lives at `{{REPO}}/bin/rpg.js`.
Map the user's arguments directly onto it:

- `/hero` (no args) → `node <cli> status`
- `/hero status | zone | shop | inventory | stats` → same subcommand verbatim
- `/hero zone go <id>`, `/hero shop buy <n>`, `/hero equip <n>`, `/hero sell <n>` → pass through as-is
- Bulk equipping: `/hero equip all` fills every *empty* slot with the best item in the bag
  that fits. Run it immediately, no `--confirm` and no preview — it only ever adds gear,
  so unlike bulk selling there is nothing to lose by getting it wrong.
- `/hero equip best` is `equip all` with the gloves off: it also **displaces** anything the
  bag beats, and fills empty slots too, so it is a superset. Also immediate, no `--confirm` —
  displaced gear goes to the bag, never sold, so the worst case is one `equip <n>` to undo.
  Prefer it whenever the player wants to "gear up" generally; `equip all` is only right when
  they specifically ask not to disturb what they're wearing.
- `/hero status` may end with a `↑` nudge line — either "N slots in your bag beat what you're
  wearing" or worn ilvl vs the zone's trash. Relay it with the rest of the output; it's the
  only thing in the game that catches a hero quietly rotting behind the zone.
- The shop restocks every 4 hours, so `/hero shop` is worth re-running. If a buy comes back
  saying the shelf restocked, nothing was bought — relay the new shelf and ask before re-buying,
  since the numbered offers have changed.
- Bulk selling: `/hero sell all`, or by rarity — `/hero sell commons`, `/hero sell common rare`.
  Pass the words through verbatim; the CLI does the matching. It touches the bag only,
  never equipped gear. **Two steps, always:** run it without `--confirm` first — that only
  prints what would go — relay the list, and re-run with `--confirm` appended once the user
  says yes. Never add `--confirm` yourself on the first call, even if the user sounded
  decisive: the point of the preview is that they see which items match before the gold is
  the only thing left. `/hero sell <n>` is a single named item and sells immediately.
- Upgrading: `/hero upgrade` lists every worn slot with the cost of its next `+`.
  `/hero upgrade <slot>` buys one level immediately — it is a single small purchase,
  so no preview. `/hero upgrade <slot> max` pours in everything affordable and is
  **two steps like bulk selling**: run it without `--confirm`, relay the preview
  (it shows the ATK/DEF/HP the spend would actually buy, and warns when the gain
  rounds to nothing), then re-run with `--confirm` once the user says yes.
  Upgrades apply to *worn* gear only and are never refunded when you sell.
- Insight (post-cap paragon, level 60+): `/hero insight` shows the board — three tracks,
  `atk` / `gold` / `drop`. `/hero insight <track>` buys one point immediately, no preview.
  `/hero insight <track> max` is **two steps like bulk selling**: run it without `--confirm`,
  relay the preview, then re-run with `--confirm`. Insight is never reset and never refunded,
  and nothing about paragon touches level, gear, gold or zone — say so if the user worries
  that hitting the cap costs them anything.
- HUD layout: `/hero hud` shows the current layout and both options; `/hero hud big|compact`
  pins one and `/hero hud auto` goes back to picking by terminal width. Immediate, no `--confirm` —
  it changes nothing but how the statusline draws, and `auto` undoes it. Pinning a layout wider than
  the terminal is allowed and warns; relay the warning with the rest of the output. Takes effect on
  the next statusline frame, so there is nothing to restart.
- `/hero reset` → warn that this deletes the hero, and only run with `--confirm` after the user confirms

## First-run init

`/hero init` with no class: do NOT run the CLI menu. Instead use AskUserQuestion:

1. **Class** — options (label / description):
   - Wizard — `▐◉▌───┃ ━━━★` 15% chance any attack crits for double damage
   - Knight — `╪░▟◉█▙◆ ===≫` takes half damage, +25% HP, commits hit harder
   - Rogue — `▚░▒█◕▙╪ ───╫` gold ×1.25, loot drops 1.5× as often
   - Ranger — `▚▒█◔▓┼▶ ---➳` lines-of-code damage ×1.15, all XP ×1.10
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
