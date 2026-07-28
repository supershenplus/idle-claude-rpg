# idle-claude-rpg

An idle hero RPG that lives **inside Claude Code**, implemented as a JS hook.
Your hero grinds while you code: hook events are the game tick. Full design in
`docs/PLAN.md`.

---

## v1.5 — 2026-07-28 ✅ — gold has somewhere to go

- [x] **`/hero upgrade`** — worn gear only, `+0…+10`, each `+` worth 2% of the
      item's rolled stats, costing `5·ilvl·(plus+1)²`. Quadratic on purpose: a
      full set at +10 runs ~1.16M, about a whole run's income, so you are always
      choosing which items to invest in. Sim: absorbs 515k, leaves 69k idle
      against the ~1.07M an attentive player used to finish holding
- [x] The sink doesn't leak — `engine.sellPrice` ignores `plus` entirely, so
      upgrade gold is destroyed rather than being a 25%-refundable deposit.
      `engine.itemValue` *does* count it, so auto-equip never benches an item
      you poured gold into in favour of an identical raw drop
- [x] `gearSum` totals all twelve slots **unrounded** and rounds once. At 2% a
      level a single upgrade is usually sub-integer (+2% of a def-11 chestpiece
      is 0.22), and rounding per-slot silently discarded nearly all of it — a
      set at +10 measured almost the same as a set at +0
- [x] Power had to come down twice: at 5%/+ and then 3%/+ the attentive player
      stopped dying (40 days/death, outside the punctuation band), because every
      point of def/atk/hp makes bosses safer. 2% keeps the 23-day cadence *and*
      still absorbs the gold — the sink's appetite comes from the cost curve,
      not the reward, so it works even at 0% power
- [x] Upgrading is deliberately poor value early (2% of a 3-point stat is a
      rounding error, and the same gold buys a whole rare off the shelf), so
      `upgrade <slot> max` previews the ATK/DEF/HP its spend would buy and says
      so outright when the gain rounds to nothing
- [x] 6 new tests + a sink gate in the sim (gold absorbed > gold idle)
- [x] No save migration: `plus` is absent on every pre-v1.5 item and every read
      path defaults it to 0, which is strictly safer than a migration that
      rewrites saves to add a zero

## v1.4 — 2026-07-28 ✅ — death is punctuation

- [x] **The balance sim never equipped anything.** It folded 83 days of combat
      with all twelve slots empty, so every figure it asserted — deaths above
      all, since mitigation keys off def — described a hero who fought
      Production naked. `E.autoEquip()` is now shared by `/hero equip all` and
      the sim, which replays three profiles: `upgrade` (attentive), `fill`
      (fills empty slots only, never upgrades), `none` (the old behaviour)
- [x] Armour is a **ratio**, not a subtraction. `mLvl − def` was a cliff: a full
      set rolls def ≈ 1.0–1.2× ilvl and ilvl tracks monster level, so def
      crossed mLvl and every blow clamped to the floor of 1 — a geared hero was
      literally immune (1 death per 90 days) while a naked one ate the whole
      curve (198). Now `raw · mLvl/(mLvl+def)`: def equal to monster level
      halves the blow, nothing reaches zero, and mitigation holds near 50% at
      every level, so the difficulty curve is flat by construction
- [x] **Losing to a boss drives it off** instead of restarting the fight. A boss
      reset to full HP on death, so a hero who couldn't win one could never do
      anything else either — the `fill` player died ~2000 times and never
      reached the cap. Forfeiting the approach costs the 15 kills that earned
      it, a setback you can work off
- [x] Bosses counter *more* often than trash now (0.45 / ×1.6, inverting the old
      rule, whose whole rationale was the boss-reset wall). Trash is attrition
      regen outpaces; bosses are where death lives. Attentive player: one death
      per ~12 days. Gold loss stays 5% — see the economy note below
- [x] 7 new tests (ratio-armour monotonicity, per-zone boss danger bounds, trash
      attrition ceiling, boss-despawn, trash-death isolation) + 2 new sim gates
      (death cadence, every profile reaches the cap)

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
- [ ] `equip all` is arguably a trap: it's strictly additive by design, so a
      player who runs it once is "geared" forever and silently rots — that's the
      sim's `fill` profile, which dies ~240 times a run. Consider a nudge when
      worn ilvl falls far behind the zone, or an `equip best` that displaces.
- [ ] Edit/Write `tool_response` schema is undocumented — revisit if a future
  Claude Code version documents per-tool line counts (we count from `tool_input`)
