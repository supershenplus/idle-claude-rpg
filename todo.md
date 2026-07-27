# idle-claude-rpg

An idle hero RPG that lives **inside Claude Code**, implemented as a JS hook.
Your hero grinds while you code: hook events are the game tick. Full design in
`docs/PLAN.md`.

---

## v1 — built 2026-07-27 ✅

- [x] Engine: fold reducer, combat, XP curve (cap 60), loot (5 rarities), classes, 7 zones + bosses
- [x] PostToolUse/Stop hook (zero tokens, fail-open, <100ms) + event classifier
- [x] Statusline HUD: 3/2/1-line responsive, hit/kill/loot/level-up/boss/death/away animations at 1fps
- [x] Concurrency-safe state: ndjson inbox + lock + atomic rename, daily backup, corrupt quarantine
- [x] CLI (`bin/rpg.js`) + `/hero` skill (init via AskUserQuestion class picker)
- [x] `install.sh` (skill copy + self-test + settings snippet; never edits settings.json)
- [x] 29 unit tests incl. 8-process concurrency stress; balance sim gates pass
  (cap on day 81 @300 events/day; heavy week → Lv17)

## Wiring (user action)

- [ ] Merge staged settings (see scratchpad `settings-with-rpg.json`) via `!` cp, restart, `/hero init`

## Backlog (v1.1+)

- [ ] Prestige / post-cap system (currently: loot chase only)
- [ ] Cosmetic titles from the shop; trinket special affixes
- [ ] Shop daily rotation (seeded by date+zone) + "Boss Drum" consumable to arm the boss early
- [ ] Heisenbug gag: sprite renders in a different spot each frame (it moves when observed)
- [ ] Per-session stats view; death-penalty tuning after real-world data
- [ ] Edit/Write `tool_response` schema is undocumented — revisit if a future
  Claude Code version documents per-tool line counts (we count from `tool_input`)
