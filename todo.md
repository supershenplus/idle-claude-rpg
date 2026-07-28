# idle-claude-rpg

An idle hero RPG that lives **inside Claude Code**, implemented as a JS hook.
Your hero grinds while you code: hook events are the game tick. Full design in
`docs/PLAN.md`.

---

## v1.3 — 2026-07-28 ✅

- [x] Zones use their whole band. `spawnMonster` rolled `zone.min + rand()*4`
      clamped to `zone.max`, so `zone.max` was dead data: every zone spawned only
      its bottom 4 levels of 9 while its boss sat at the top. The Grove
      advertised "1-9" and never spawned above Lv4, then asked for a Lv9 boss.
      Trash now walks `min → max-1` as the boss cycle fills, so a zone escalates
      and the boss is one step up rather than a five-level cliff
- [x] Boss progress is driven by kills, not hero level — a hero held by the level
      gate meets tougher trash, earns more XP, and clears the gate. The stall is
      self-correcting instead of a flat grind
- [x] `engine.bossGate()` is one source of truth for the spawner *and* the
      readout. The status line used to say "Boss in 0 more kills (need Lv8+)" —
      true and useless, because the kill counter had been satisfied for 43 kills
      while the level gate silently held. It now names whichever gate is actually
      binding: "Rootfang the Ancient Treant stirs — 3 levels away"
- [x] 4 regression tests (band coverage, escalation, gate/spawner agreement,
      readout honesty). Cap holds at day 83 @300/day; boss cadence ~3.0 days

## v1.2 — 2026-07-27 ✅

- [x] Sprite art rewrite: 5-row drawn silhouettes for all 4 classes + 29
      monsters/bosses, replacing the 3-row kaomoji-with-a-hat art. Big HUD is
      now 8 lines. Heroes face right, monsters face left; each zone has its own
      shape language (Archives rectilinear, Embers diagonal, Null corrupted)
- [x] Big art restricted to single-cell glyphs (box drawing / blocks /
      geometric). The old art mixed two-cell kaomoji like `皿ᴥ`, which silently
      skewed every centred column in the battle scene
- [x] Projectile/damage/counter marks anchor to the sprites' waistline derived
      from `BIG_ROWS` instead of hardcoded rows 0/1/2
- [x] `test/sprites.test.js` — 6 invariant tests (exact row count, single-cell
      glyphs, width caps at the 76-col threshold, no trailing whitespace, full
      coverage of every monster in `content.js`)

## v1 — built 2026-07-27 ✅

- [x] Engine: fold reducer, combat, XP curve (cap 60), loot (5 rarities), classes, 7 zones + bosses
- [x] PostToolUse/Stop hook (zero tokens, fail-open, <100ms) + event classifier
- [x] Statusline HUD: 3/2/1-line responsive, hit/kill/loot/level-up/boss/death/away animations at 1fps
- [x] Concurrency-safe state: ndjson inbox + lock + atomic rename, daily backup, corrupt quarantine
- [x] CLI (`bin/rpg.js`) + `/hero` skill (init via AskUserQuestion class picker)
- [x] `install.sh` (skill copy + self-test + settings snippet; never edits settings.json)
- [x] 29 unit tests incl. 8-process concurrency stress; balance sim gates pass
  (cap on day 81 @300 events/day; heavy week → Lv17)

## v1.1 — 2026-07-27 ✅

- [x] Monster retaliation (~30% counter per hero attack; bosses rarer but harder)
      — before this, damage only ever came from *your* failed commands
- [x] 3-line sprite art for all 4 classes + 29 monsters/bosses; monster centred
      on the terminal midpoint instead of pinned to the right edge
- [x] Monster level shown in HUD and `/hero status`
- [x] Width-aware layout (`R.width`) — kaomoji are full-width, combining accents
      are zero-width; code-point counts skewed every centred column
- [x] 3 regression tests + boss-survivability gate

## Wiring (user action)

- [x] Merged into `~/.claude/settings.json` — PostToolUse + Stop hooks and the
      `statusLine` key (refreshInterval 1, padding 0). Verified live 2026-07-27.
      Guardrail/secret-grep PreToolUse hooks were preserved alongside.

## Backlog (v1.1+)

- [ ] Prestige / post-cap system (currently: loot chase only)
- [ ] Cosmetic titles from the shop; trinket special affixes
- [ ] Shop daily rotation (seeded by date+zone) + "Boss Drum" consumable to arm the boss early
- [ ] Heisenbug gag: sprite renders in a different spot each frame (it moves when observed)
- [ ] Per-session stats view
- [ ] Death-penalty / retaliation tuning. Now measured rather than guessed:
      `balance.js` says the retaliation constants were tuned so a kill costs
      ~5% of max HP, but for a naked hero at each zone's gate level that figure
      runs **1.1% in the Grove → 10.8% in Production**. It drifts because
      incoming damage (`mLvl − def`) and attacks-per-kill (monster HP grows
      10/level vs hero ATK ~2.2/level) both rise with level while max HP rises
      linearly — so the cost compounds. Gear flattens it in practice, and the
      v1.3 band fix moved it only ~+0.7pp, so this drift predates v1.3 and was
      left alone rather than silently re-tuned inside a pacing change.
      Sim @300/day: 198 deaths to cap (was 145 pre-v1.3), ~2.4/day late game.
      Decide whether death should be punctuation or pressure, then tune.
- [ ] Edit/Write `tool_response` schema is undocumented — revisit if a future
  Claude Code version documents per-tool line counts (we count from `tool_input`)
