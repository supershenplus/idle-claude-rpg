# idle-claude-rpg

An idle hero RPG that lives **inside Claude Code**, implemented as a JS hook.
Your hero grinds while you code: hook events are the game tick. Full design in
`docs/PLAN.md`.

---

## v1.8 — 2026-07-28 ✅ — installable by a stranger

- [x] **MIT LICENSE.** The repo was unlicensed, which for anyone who isn't the
      author means no right to use it — the single hardest blocker to publishing
- [x] **`./install.sh --write-settings`** merges the hooks and statusLine into
      `settings.json` for you. Pasting JSON into the right nesting level of a
      file you may not have is where a first-time install actually fails, and
      the printed snippet asked every new player to do exactly that
- [x] Default is still print-only, and deliberately so: `settings.json` decides
      what runs on every tool call in every session. The merge is opt-in, backs
      the file up first (timestamped, with a collision suffix — merge and
      uninstall land in the same second), and is idempotent
- [x] **It refuses to take a status line you already have.** You only get one,
      and silently replacing a working one is the only move here that destroys
      work rather than adding to it. Hooks still go in; `--force` overrides.
      A half-install that ticks beats an aborted one
- [x] Everything keys off the two script *basenames*, not exact command strings,
      so a re-run after moving the clone **repoints** the stale paths instead of
      appending a second copy. Moving the directory is this design's one real
      fragility and it fails silently — fail-open means no error anywhere
- [x] **`--check`** is the doctor: node, skill, both hooks, statusLine, save,
      queue depth — ordered so the first `FAIL` is the thing to fix. Written
      against the support question a public release will actually get, which is
      "I merged the settings and nothing happens"
- [x] **`--uninstall`** removes only our entries, leaving co-tenant hooks in the
      same group and a foreign status line alone. Round-trip to the original
      file is a test. The save is never touched
- [x] The check's hero readout guessed `state.name`/`state.class` and printed
      "undefined the ?" against a healthy save — the fields live under
      `state.hero`. Pinned by a test that inits a real save and reads it back
- [x] 16 new tests (108 total). The settings tests also stopped inheriting the
      developer's real `IDLE_RPG_HOME`, which they were reading through
- [x] README: install/update/troubleshoot/uninstall rewritten, test count
      corrected 77 → 108, license section added. `HANDOFF.md` is now ignored

## v1.7 — 2026-07-28 ✅ — the cap stops being a wall

- [x] **Insight (paragon).** `engine.addXp` returned early above level 60, so
      every point earned at the cap was discarded and a capped hero had the loot
      chase and nothing else. XP past the cap now banks toward Insight, spent on
      three tracks: `atk` +2%/pt, `gold` +3%/pt, `drop` +2%/pt, 25 points each
- [x] Deliberately **not** a prestige reset — level, gear, gold and zone are
      never touched. This repo's line on setbacks is that they have a way back,
      and wiping twelve slots you spent weeks filling, while you were looking at
      a compiler rather than at the game, is the opposite of that
- [x] Rate is 40% of a cap-level per point (~3/day at the sim's 300 events/day):
      the first point lands within hours, and all 75 points take ~120 days past
      the cap against the 45 it took to reach it. A tenth of a cap-level was the
      first guess and maxed everything in 30 days — a tail no longer than the climb
- [x] Tracks cap at 25 rather than running forever. An unbounded ATK multiplier
      eventually deletes the difficulty curve `monsterHitDamage` exists to keep flat
- [x] **The sim now plays past the cap.** It used to `break` the moment it hit
      level 60, so the entire paragon curve would have gone untested. Three new
      gates: xp banks rather than evaporating, 30 days past the cap buys under
      three quarters of the board, and the board does finish by 150 days
- [x] Post-cap deaths are 0 with paragon *and* 0 without it (1,124 boss kills
      either way) — the flat curve at the cap is pre-existing, not something
      Insight introduced. What Insight measurably changes is throughput: 29,609
      kills against 24,715 over the same 150 days
- [x] The statusline read a flat `MAX` forever at the cap; it now shows the
      Insight bar filling and the count climbing, and is *narrower* than the
      pre-cap `[bar] 1,234/4,567` it replaces
- [x] No save migration, same call as `plus`: `insight`, `capXp` and `paragon`
      are absent on every pre-v1.7 save and every read path defaults them
- [x] 7 new tests + 3 sim gates

## v1.6 — 2026-07-28 ✅ — gear you'd actually wear

- [x] **Gear is named for the class that wears it.** Both the shelf and the drop
      table pulled their noun from one flat per-slot list, so a Ranger fired
      arrows out of a wand. Classes now carry a `nouns` override for the four
      slots where the name says something about how you fight — weapon, offhand,
      head, chest. Back, hands, feet, neck and rings stay generic
- [x] Flavour only, and pinned as such: both callers roll slot/rarity/ilvl/stats
      first and read the noun off the class afterwards, and the shop seed stays
      `(zone, window)` with no class in it. A test diffs all four classes'
      shelves with `name` stripped across 12 rotations of every zone, so the day
      class leaks into the seed the shop stops being one shared economy
- [x] Class nouns go into `NOUN_SLOT` alongside the generic ones — that map is
      what the v1→v2 migration reads an old item's slot off, and a noun a class
      can generate but the map doesn't know is unplaceable gear
- [x] **`/hero equip best`** — the way out of the `equip all` trap below. Same
      ranking, allowed to displace; a superset of `equip all` since it fills
      empty slots too. No `--confirm`: it only moves gear between body and bag,
      so the worst case is one `equip <n>` to put something back
- [x] `status` nudges, one line, in priority order: what the bag beats (exact,
      via `previewAutoEquip`), else worn ilvl against the zone's trash level
      (`gearLag`, empty slots counted as the zero gear they are). Both dead ends
      of `equip all` now point at `equip best` instead of shrugging — including
      "nothing fits your empty slots", which is the one that started this
- [x] The nudge runs the *real* `autoEquip` against a throwaway facade rather
      than reimplementing its ranking. A second copy of "best `keys.length` of
      (worn ∪ bag), ties keep the worn item" would drift, and a nudge that
      disagrees with the command it recommends is worse than no nudge
- [x] **Fixed a real bug the new count exposed:** promoting one ring into a full
      set of four reported *four* changes — the winner took `ring1` and shoved
      the three survivors down a slot each. Same gear worn, so it was invisible
      until a user-facing count depended on it. Survivors now keep their slot
      and newcomers take what's left
- [x] 6 new tests; sim gates unchanged (attentive still dies every 23 days, sink
      still absorbs 515k). `equip:fill` still dies 238 times a run — that number
      is the trap, and the nudge is now the only thing in the game that says so

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

- [ ] Cosmetic titles from the shop; trinket special affixes
- [ ] Shop daily rotation (seeded by date+zone) + "Boss Drum" consumable to arm the boss early
- [ ] Heisenbug gag: sprite renders in a different spot each frame (it moves when observed)
- [ ] Per-session stats view
- [ ] Edit/Write `tool_response` schema is undocumented — revisit if a future
  Claude Code version documents per-tool line counts (we count from `tool_input`)
