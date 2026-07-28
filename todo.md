# idle-claude-rpg

An idle hero RPG that lives **inside Claude Code**, implemented as a JS hook.
Your hero grinds while you code: hook events are the game tick. Full design in
`docs/PLAN.md`.

---

## Found in play — 2026-07-28

- [x] **Travel is automatic now.** Beating a zone's boss unlocked the next zone
      and then said nothing that lasted: a 6s banner and a ticker line that
      scrolls off in three events. The standing nudge (`statusline:99`) waits for
      `level > zone.max + 2`, so after a first clear at level 8 the game knew the
      Caves were open and stayed quiet for four levels — while the Grove re-armed
      Rootfang, making "farm a boss you already beat" the default path
- [x] The trigger is **unlocked *and* at the new zone's level floor**, not the
      boss kill. The boss gate opens at `boss.level - 1` and the next zone starts
      one above the boss, so on a first clear you are *always* two levels short —
      switching on the kill would drop every hero into a zone under-levelled,
      every time. Never fires mid-boss either: past the first clear that is a
      re-armed boss the player chose to fight
- [x] This is the rule `test/sim.js` had been playing by all along, in its own
      copy at the day boundary — so every number the sim asserts already
      described it. Moved into the engine and the sim now plays the real one,
      same call as `E.autoEquip` in v1.4. Twelve gates hold: cap day 45 → 44,
      deaths one per 23 → 22 days, boss cadence 3.3 → 2.4 days (bosses arrive
      sooner because zones do), sink 515k → 455k
- [x] `E.travelTo` is now the single path for typed *and* automatic travel, which
      surfaced a real divergence: `killsSinceBoss` is one global counter meaning
      "kills toward the boss of the zone I'm in", and `/hero zone go` carried it
      across the border. Since `monsterLevel` reads it to escalate trash, walking
      into an unseen zone with a full counter spawned its *top* tier on the first
      step — precisely the cliff the v1.3 escalation curve exists to remove
- [x] 6 new tests + a `travel` demo scene (161 total), since a banner branch that
      fires once per zone is exactly what the demo exists to cover

- [x] **The kill scene ran in the wrong order.** Reported from the statusline:
      killing a monster showed the *next* one first, then the death of the last
      one, then back. `resolveKill` spawns the replacement immediately
      (`lib/engine.js:441`) — it has to, the next attack needs a target — but the
      1500ms `hit` anim for the killing blow and the 2500ms `kill` anim after it
      both play *past* that swap, and the HUD read `state.monster` every frame.
      So the fatal blow landed on a monster that had never been in the fight
- [x] Fixed by pinning the corpse to the animations that are about it: the
      killing blow, the death, and the boss celebration all carry a `mon` copy,
      and the HUD prefers it to `state.monster`. Deliberately *not* by delaying
      the spawn — the anim queue is a render detail and the fold reducer should
      not be waiting on it. Non-fatal hits stay untagged so ordinary combat adds
      nothing to the save
- [x] `bossdown` now holds the corpse on the field for its 6s too. It was
      flipping back to a live sprite under a "DEFEATED" banner, which is the same
      bug wearing a hat
- [x] 5 new tests (155 total), verified to fail against the old files — 2 on the
      engine invariant, 3 on the rendered scene

---

## EOW Findings — 2026-07-28 (W1 review, base 6ad9607)

Two criticals were fixed during the review, not filed: the shared-tmp save race
(`lib/paths.js`) and the NaN death spiral (`lib/engine.js`). Both have regression
tests that were verified to fail without their fix. The rest:

- [x] **W1-EOW-dogfood-blind** — `lib/classify.js` dropped classification for
      *any* command whose text contained `idle-claude-rpg`, so working in this repo
      earned no XP and sounded no War Horn. Replaced with `SELF_RE`, which matches
      our entrypoints as an invoked path token. The substring check turned out to
      be wrong in *both* directions: `node bin/rpg.js status` (relative path, no
      project name in the string) farmed XP freely, so the guard also failed at the
      only job it had. Both directions are now pinned by tests, and the hardcoded
      `/Users/eva0012/...` path is out of `test/classify.test.js`.
      Still open: the same developer path remains in `docs/PLAN.md:103`
- [x] **W1-EOW-foreign-hook-clobber** — `bin/settings.js:41` decided a hook was
      "ours" by bare substring `c.includes('rpg-hook.js')`, so a hook belonging to
      another tool that merely had that string in its command was silently
      rewritten on merge and stripped on `--remove`. Ownership is now decided by
      *what the command runs*: `invokedScripts()` picks the first token of each
      `|;&`-separated segment that isn't an interpreter, a flag or a `VAR=value`,
      and the tail must be `hooks/rpg-hook.js` — directory included, since that
      layout is in every legitimate clone. Matching a path *token* was the first
      attempt and was not enough: `lint.js --ignore hooks/rpg-hook.js` is a
      perfectly good path token, and it took writing the test to see it
- [x] The repair loop rewrote *every* stale entry in place rather than collapsing
      them, so two pre-existing entries became two byte-identical ones and the
      hero double-ticked — invisible, because a double tick is just a faster
      hero. Now every copy is gathered before anything is written, one is kept
      (an entry already pointing here, else the first stale one, repointed), and
      the rest go along with any group *we* emptied
- [x] 4 new tests (150 total), each verified to fail against the old file:
      dedupe across separate groups and within one, and a `merge`+`remove`
      round-trip over two impostor commands that survives both untouched
- [x] **W1-EOW-dmg-width-cap** — `gapMarks()` built the `dmg`/`counter` marks from
      raw values with no width cap. The base commit had `mid.slice(0, 24)` as a
      safety net; it was dropped when `row()`/`put()` landed. `engine.enqueue`
      sums rapid hits into one anim and counters sum onto that same record, so
      neither number has a ceiling and a catch-up fold can hand the renderer a
      mark wider than the gap it lives in
- [x] The symptom is worse than "the line gets long". `row.put` butts overflowing
      text on one column late, and only the two art rows carrying marks are
      affected — so the monster **shears** rather than sliding, and it reads as
      bad sprite art rather than as a renderer fault. Big art is centred near the
      terminal midpoint, so `R.fit` never actually gets to truncate it away; the
      shear is the whole of the damage, and it starts at 9 digits
- [x] The budget is now derived from the layout (`monLeft - gapLeft - 2`) rather
      than written down as a constant, so it cannot drift from `HERO_GAP` again.
      Compact shares one line between flight and damage, so it caps the pair
      together as well as each mark. Digits stay **exact while they fit** — damage
      is the one number you watch tick — and fall back to `R.fmt` when they don't,
      rather than truncating to `✦-1234567…`, which reads as a broken renderer
      instead of a big hit. `R.fit` sits under both as the floor
- [x] 3 new tests (164 total): the missing `anim: hit` fixture — nothing exercised
      `gapMarks()` at all — plus two column-trueness regressions, big and compact,
      both verified to fail against the old file. They assert the monster art
      lands in the *same columns* as an ordinary 38-damage hit, since a check on
      line width alone is tautological: `R.fit` guarantees it and the bug survives
- [x] **W1-EOW-destructive-cmd-tests** — the destructive CLI paths had no
      subprocess coverage: `sell all` / `sell <rarities>`, `upgrade <slot> max`,
      and `reset --confirm`. The `--confirm` gates were read and found correct,
      but nothing pinned them, so a refactor could drop one silently and the first
      person to notice would be a player who had already lost the thing. 6 new
      tests (170 total), run the way the commands are: a subprocess against a real
      save
- [x] Each test asserts on the *save after the fact*, not on the printed preview
      — the gate that matters is the one that stops gold moving. `sell` also pins
      its deliberate asymmetry: `sell 2` names one line you just read off
      `/hero inventory`, so it goes through with no confirmation at all, while
      `all` and rarity words match a set you cannot see from the command
- [x] Verified by mutation rather than by writing them red: replacing each gate
      with `if (false)` fails exactly the tests that cover it (sell → 2, upgrade
      → 1, reset → 1), and shortening `reset`'s unlink list to two of its five
      files fails on `events.ndjson survived the reset`. A save is spread across
      five files, and leaving the inbox or the lock behind hands the next hero the
      last one's queued events
- [ ] **W1-EOW-migration-untested** — the v1→v2 migration body (`lib/state.js:23-52`
      — reslot-by-noun, stat re-roll, hp refresh) has no direct test; coverage stops
      at "fresh v2 round-trips" and "unknown version rejected". This is the one path
      that can corrupt a real player's gear on load. Also `lib/state.js:100` only
      refreshes the backup when it's >24h stale, so the first save after a bad
      migration can overwrite the last good pre-migration snapshot

Deferred, deliberately not filed as items: shop restock trusts the system clock
(accepted — offline local game, same trust model as offline progress); settings
writes don't preserve a hardened file mode; seven of eight hook fixtures in
`test/fixtures/` are never read by any test; `test/sim.js:213 assertBalance()`
never runs under `node --test`.

---

## v2.0 — 2026-07-28 ✅ — the War Horn actually sounds, and installs work

- [x] **`git push` is detected from git, not from the hook.** The classifier only
      ever sees commands *Claude* runs, so a push typed with `!`, made in another
      terminal, or made from an IDE fired nothing. Found the honest way: a save
      with 17 commits, 44 passing tests and `pushes: 0` after three real pushes.
      The headline feature of the README had never once fired for its own author
- [x] `lib/gitwatch.js` reads the refs directly — no subprocess, no git binary
      needed. A push is "the remote-tracking ref moved **and** now equals local
      HEAD"; the second half is what separates a push from a fetch, since
      fetching someone else's work advances `origin/main` to a commit you don't
      have. Handles packed-refs (a `git gc` would otherwise blind it), worktrees
      and submodules (`.git` as a file), non-`origin` remotes, and subdirectories
- [x] Wired into `state.tryFold`, not into either caller: it is the one place
      holding the lock, the loaded state and the write. The hook and the
      statusline therefore share **one recorded SHA per repo**, so whichever
      sees the change first fires and the other sees none — that shared record
      is the entire dedup, with no time window to tune
- [x] One exception needed an explicit guard: a push Claude runs through the
      Bash tool produces *both* a classified event and a moved ref. Suppressed
      on the batch (`events.some(e => e.e === 'push')`) rather than on a clock,
      since the hook appends and folds in the same breath
- [x] `state.repos` is bounded at 24 entries — a save follows the user across
      every project they ever open. First sighting records silently, so opening
      a new repo is never a free War Horn
- [x] **`skill/SKILL.md` had the author's home directory baked in**, including in
      `allowed-tools`, which is a permission grant and cannot be relative. The
      installer copied it verbatim, so every other person on earth got a `/hero`
      pointing into a directory they don't have. Now a `{{REPO}}` template
      rendered by `bin/settings.js skill`
- [x] **The repo's copy of the skill was also two versions behind the installed
      one** — `equip best`, the status nudge and the entire Insight board were
      written into `~/.claude/skills/hero/` and never made it back. A clone
      shipped a `/hero` that had never heard of half the game, and nothing
      failed, because a missing prose section reads like one that was never
      needed. `test/skill.test.js` now diffs the skill against the CLI's own
      command list
- [x] Fixed a latent flake: the shop test demanded `restocks in \d+h \d+m`,
      which is wrong for one hour in every four
- [x] 24 new tests (141 total), incl. gitwatch against **real** git repositories
      rather than fixtures — the module exists to read what git actually writes

## v1.9 — 2026-07-28 ✅ — you can see it without installing it

- [x] **`node bin/demo.js`** renders the eleven HUD states worth looking at —
      crit, boss intro, boss at a quarter health, boss down, level up, legendary
      drop, kill, death, offline return, capped-with-Insight, and a fresh Lv1
- [x] Built for the screenshots a public launch needs, but it pays for itself as
      **coverage**: a legendary drop, a boss intro and a death are rare by
      design, so several `bannerText` branches had never been rendered by
      anything. Waiting for one to happen is not a test strategy
- [x] Each scene is a synthetic save rendered by shelling out to the *real*
      statusline. A demo carrying its own copy of the layout would keep looking
      right long after the thing it stands in for broke
- [x] Heroes are posed, not played — but `maxHp` comes from `E.refreshMaxHp`
      rather than a plausible-looking constant, and a test pins the capped
      scene's HP against what the engine actually derives. A screenshot quoting
      numbers the engine would never produce is a screenshot that lies
- [x] **Found by looking at it:** the death banner printed a bare `-21594g`
      beside a vitals line reading `⛁ 410,300g`. Gold in banners now goes
      through `fmtGold` and xp through `fmt`, same as everywhere else
- [x] 9 new tests (117 total), incl. every scene in all three layouts and the
      per-line-trim check applied to demo output too

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

- [x] **Redraw the rogue's big art** — the `╲` on row 3 and `▼` on row 4 touched
      nothing and read as debris, the head was a bare `○`, and widths ramping
      7,6,7,8,10 leaned the figure. Redrawn hooded with the body on one axis and
      the dagger held high on the guard side: fist `▙`, crossguard `╪`, blade
      `╱ ╱` climbing one cell per row. Knight got the same treatment (sword wound
      back over the left shoulder, shield forward) and the ranger picked up a
      plumed cap and a quiver arrow. Two new tests in `statusline.test.js` pin
      both blades by slope, alongside the ranger's bow. The columns were solved
      rather than eyeballed — see the fixed-point note in the README
- [ ] Two smaller sprite nits, both cosmetic and both long-deferred: `harpy` has
      a stray `▚` floating off the right wing, and `leech` is 8 cells wide where
      the rest of the set is 11-13, so it reads undersized next to its zone
- [ ] One-line sprites in `lib/content.js` are still the original kaomoji — only
      the 5-row big art was redrawn in v1.2, so compact and mini HUD modes never
      got the pass
- [ ] **Why does the Grove shop stock gear that isn't worth buying?** A real
      shelf, rolled live at level 8 with 2,494g in hand and the boss at full HP —
      of five offers, *two* were non-purchases and one was marginal:
      ```
      1. [rare] Runed Grove Wand (weapon i7) ATK+11 — 840g   ← the exact item worn
      2. [uncommon] Fine Grove Helm (head i8) DEF+1 HP+6 — 672g
      3. [rare] Runed Grove Focus (offhand i8) ATK+2 DEF+2 HP+5 — 960g
      4. [rare] Runed Grove Mantle (back i4) DEF+1 HP+4 — 480g   ← +1 def changes
      5. [rare] Runed Grove Treads (feet i1) HP+1 — 90g SALE     nothing at Lv9
      ```
      `rollStock` rolls ilvl uniformly over the *zone* span (grove 1-9) and never
      looks at what the hero is wearing, so slot 1 can be a byte-identical copy of
      the equipped weapon at full price, and slot 5 can be an i1 strictly dominated
      by worn i7 — with the SALE tag drawing the eye straight to it. Compounding it:
      a `+` adds 2% of what the item *rolled*, which on Grove numbers is +0.22 ATK,
      so upgrades are also dead at this tier and there is nothing else to spend on.
      The question isn't the balance of any one line — it's what the shelf is *for*
      before Cobalt Caves. Options, roughly in order of how much they change:
      (a) roll against worn ilvl so an offer is at least a sidegrade — cheap, but
      makes the shelf a vending machine and kills the "hunt the one good slot" read;
      (b) leave the rolls honest but mark dominated offers in the CLI (`worse than
      worn`, and suppress SALE on them), so a bad shelf is legible rather than a
      trap for someone who can't diff twelve slots by eye; (c) accept a dead shelf
      as the point — you *should* sometimes bank the gold — and make waiting cost
      nothing, which argues for the daily-rotation entry below. (b) is the small
      honest fix; (a) is the design decision. Note this is only sharp in the Grove:
      the ratio armour model means +1 def matters less at low mLvl, and the whole
      thing is self-correcting once ilvl spreads widen in later zones
- [ ] **Loot goblin.** ~5% chance on spawn of getting a goblin instead of the
      zone's trash. Kill it and it pays out one of two ways: a big slug of gold,
      or a guaranteed epic. Open questions before this is buildable: (a) what
      rolls the 5% — `spawnMonster` is the obvious hook, but it must not consume
      boss-cycle kills or the goblin becomes a boss-delay tax; (b) scale the
      payout off `killGold(mLvl)` and `itemStats(ilvl)` so it stays a windfall
      rather than a level-8 hero holding Null-tier gear — the epic arm is the
      dangerous one, since `BOSS_RARITY_FLOOR` currently makes epics the boss's
      job; (c) it needs to *read* as an event — sprite, banner, and something
      in `bannerText`, or a 1-in-20 spawn is just a monster with odd numbers.
      Worth simming: at 300 events/day a 5% spawn is several a day, which is
      enough to move the economy the v1.5 sink was tuned against
- [ ] Cosmetic titles from the shop; trinket special affixes
- [ ] Shop daily rotation (seeded by date+zone) + "Boss Drum" consumable to arm the boss early
- [ ] Heisenbug gag: sprite renders in a different spot each frame (it moves when observed)
- [ ] Per-session stats view
- [ ] Edit/Write `tool_response` schema is undocumented — revisit if a future
  Claude Code version documents per-tool line counts (we count from `tool_input`)
