# idle-claude-rpg — Implementation Plan

## Context

An idle hero RPG that lives inside Claude Code. Hook events are the game tick: passing tests grants XP, commits smite monsters, lines of code do damage. One global hero across all projects/sessions; monsters drop rarity-tiered loot; classes, zones, bosses. HUD + animations render in the statusline (currently unconfigured — the slot is free). A `/hero` skill drives subcommands. Hard constraints from the user: no network calls, hook finishes in seconds, atomic writes, don't break the existing guardrail hooks, **zero token cost for the passive loop**, not maxed in a week but not idle-game grindy.

**Verified harness facts this design rests on:**
- Statusline supports multi-line ANSI output, `refreshInterval: 1` (1s polling → ~1fps animation), refresh also on new assistant messages. `$COLUMNS` available.
- PostToolUse/Stop hook plain stdout is **not** sent to the model → zero tokens. SessionStart stdout IS injected → **no SessionStart hook, ever**.
- Bash `tool_response.content = {exit_code, output}`. Edit/Write tool_response is undocumented → compute lines from `tool_input` only.
- User+project hooks merge; matching hooks run in parallel → concurrent hook invocations must be race-safe.
- Existing guardrails (`bash-fs-guard.js`, `self-protect.js`) block Claude from writing `~/.claude/hooks/*` and `~/.claude/settings*.json` → game hook lives **in the repo**, referenced by absolute path; the settings.json edit is pasted by the user via `!` (same pattern as bigmode's installer). Installing to `~/.claude/skills/hero/` is NOT blocked.
- House style: zero-npm-dependency Node, fail-open (exit 0 on any error), async stdin chunk pattern.

## Repo layout

```
idle-claude-rpg/
├── install.sh                 # idempotent; copies skill, self-tests, prints settings snippet
├── hooks/rpg-hook.js          # single entry for PostToolUse AND Stop (hook_event_name switch)
├── statusline/rpg-statusline.js
├── bin/rpg.js                 # CLI: init/status/zone/shop/inventory/equip/sell/stats/fold/sim/reset
├── lib/
│   ├── paths.js               # STATE_DIR=~/.config/idle-claude-rpg; IDLE_RPG_HOME env override for tests
│   ├── state.js               # load/save (tmp+rename), lockfile, migrations, corrupt recovery
│   ├── classify.js            # hook payload → game event (pure, table-driven, unit-tested)
│   ├── engine.js              # fold(events, state, now): combat, kills, levelups, loot, offline
│   ├── balance.js             # EVERY tunable constant + formula in one file
│   ├── content.js             # classes, zones, monsters, bosses, shop items (pure data)
│   ├── sprites.js             # ASCII frames + animation frame tables
│   ├── render.js              # bars, ANSI helpers, width-fitting
│   └── rng.js                 # mulberry32 seeded RNG + weighted pick
├── skill/SKILL.md             # source of truth → installed to ~/.claude/skills/hero/
└── test/                      # node:test, zero deps: classify/engine/state tests, fixtures/, sim.js
```

Hot-path rule: `rpg-hook.js` requires only `paths.js`+`classify.js` to append, lazily requires `engine.js` for a non-blocking fold attempt. Anything throws → exit 0 silently. Budget <100ms.

## State & concurrency

`~/.config/idle-claude-rpg/`: `state.json` (canonical), `state.bak.json` (daily backup), `events.ndjson` (append-only inbox), `events.processing` (fold-in-progress), `state.lock`.

**state.json** (version field for migrations): `hero {name, class, level, xp, hp, maxHp, gold, zone, unlockedZones}`, `equipment {weapon, offhand, head, chest, back, hands, feet, neck, ring1..ring4}` (v2; v1 saves migrate by item noun), `inventory[]` (cap 20), `monster {id, name, level, hp, maxHp, isBoss}`, `counters {kills, bossKills, killsSinceBoss, zoneKills, commits, pushes, testsPassed, testsFailed, linesWritten, deaths, lastTestXpAt}`, `anim[]` (cap 10, serialized timings), `lastEventAt`.

**Concurrency (races possible — hooks run in parallel):**
1. Hooks `fs.appendFileSync` one compact event line (<200 bytes) to `events.ndjson` — atomic in practice.
2. Fold (from hook, statusline, or CLI): acquire `state.lock` via `openSync('wx')`; on EEXIST, steal if >10s stale, else **return silently** (statusline folds within 1s anyway). Under lock: rename inbox → `events.processing` (new appends recreate inbox transparently; fold crash leftover is processed first next time), reduce line-by-line (skip malformed lines), apply lazy time effects (offline progress, 1%/min HP regen, anim pruning), write `state.tmp.json` → rename. Release lock in `finally`.

Event line: `{"t":<ms>,"e":"test_pass","sid":"...","m":{"lines":N}}`. Event types: `attack_lines | attack_jab | attack_build | commit | push | test_pass | test_fail | bash_fail | rest`.

## Event mapping (classify.js — test regex before git regex)

| Trigger | Detection | Effect |
|---|---|---|
| Test pass | Bash exit 0 + TEST_RE (jest/vitest/pytest/cargo test/swift test/npm test/go test/…) | XP grant `5+3·L` + normal attack. **60s cooldown on the XP grant** (anti test-loop) |
| Test fail | Bash exit ≠0 + TEST_RE | Hero takes `max(1, 2·mLvl − DEF)` |
| git commit | Bash exit 0, `git … commit` | **Smite: 3.0×ATK** crit animation |
| git push | Bash exit 0, `git … push` | **War Horn:** instakill non-boss + guaranteed loot + gold ×1.5; vs boss 5.0×ATK |
| Build ok | Bash exit 0 + BUILD_RE (tsc/cargo build/make/xcodebuild…) | 1.5×ATK |
| Other Bash ok | exit 0 | Jab 0.4×ATK (idle bread-and-butter) |
| Other Bash fail | exit ≠0 | Chip damage `max(1, mLvl − DEF)` |
| Edit/Write/MultiEdit/NotebookEdit | lines from `tool_input` (new_string/content), **capped 300/event** | `ATK × (0.75 + 0.5·(1−e^(−lines/60)))` → caps at 1.25× |
| Stop | hook_event_name | Fold + regen 25% missing HP; no damage |

Missing/ambiguous exit code → treat as success (fail open toward fun). Kill: XP+gold+loot roll, next spawn. Death: lose 5% gold, full heal both, respawn.

## Balance (all in balance.js)

- `xpToNext(L) = floor(100·L^1.5)`, **cap 60**, total ≈1.07M XP.
- `monsterHP(mLvl) = (25+10·mLvl)·±15%`; effective ATK ≈ `8+3.2L` (class base + gear); average event ≈0.75×ATK → **~4.2 events/kill at every level** (constant action cadence).
- `killXP = 10+5·mLvl` (×8 boss), `killGold = (5+2·mLvl)·rand(0.7–1.3)` (×10 boss).
- `monsterHitDamage = raw · mLvl/(mLvl+def)` — armour is a **ratio**. Def equal to monster level halves the blow, twice its level thirds it, nothing reaches zero. Was `raw − def`, a cliff a full set crossed: geared → immune (1 death in 90 sim-days), naked → the whole curve (198). Mitigation now sits ~50% for a kitted hero at every level, so difficulty is flat by construction.
- **Death is punctuation, and it lives at bosses.** Trash costs a geared hero <3% max HP/kill vs 1%/min regen (attrition you shrug off; an under-geared hero feels it, which is the signal to equip). Bosses counter *more* often than trash (0.45 / ×1.6) and a fight is expected to cost most of a health bar. Losing to a boss **drives it off and resets `killsSinceBoss`** rather than restarting the fight — see `engine.hurtHero`. Gold loss stays 5%: it's no longer the economy's regulator, and raising it only punishes the struggling player who needs gold to escape.
- Time to cap: ~104 active days @200 events/day, ~69 @300, ~41 @500 → **~2–4 months**; one heavy week ≈ L16. Tuning knobs: the 100 coefficient and 1.5 exponent.
- `monsterLevel(zone, killsSinceBoss)` = the zone band walked from `min` to `max−1` as the boss cycle fills, jittered 0–2 down. A zone therefore **escalates toward its boss** and the boss is one step up, not a cliff. Kills drive it, not hero level, so a hero held by the level gate meets tougher trash → more XP → clears the gate; the stall is self-correcting. (Until v1.3 this was `min + rand()·4`, which made `zone.max` dead data — the Grove advertised 1–9 and never spawned above 4.)
- **Boss:** after 15 zone kills + level gate (`hero ≥ bossLevel−1`) → next spawn is boss (10× HP ≈ one focused hour, 8× XP, guaranteed rare+ loot). Boss kill unlocks next zone. `engine.bossGate()` is the single source of truth for both the spawner and the readout, so the HUD can never report a gate the spawner disagrees with.
- **Loot:** 18% drop/kill (rogue ×1.5, boss/push 100%). Rarity weights 60/25/10/4/1 (common→legendary), stat mult 1.0/1.4/2.0/3.0/4.5, ilvl = mLvl. Legendaries get per-zone names.
- **Shop:** price `60·ilvl·rarityMult` (~a day's gold for at-level rare); sell-back 25%.
- **Upgrading (the gold sink):** worn gear only, `+0…+10`, each `+` worth 2% of the item's rolled stats. Cost `5·ilvl·(plus+1)²` — quadratic, so a full set at +10 runs ~1.16M, about a whole run's income, and you are always choosing. `engine.sellPrice` ignores `plus` so the gold is *destroyed*; `engine.itemValue` counts it so auto-equip never benches an item you invested in. Without this an attentive player finished holding ~1.07M with nothing to buy, and the figure barely moved whatever the death penalty was. Note `gearSum` totals all twelve slots **unrounded** and rounds once: at 2% a level most single upgrades are sub-integer, and rounding per-slot discarded nearly all of them.

## Classes & zones

Classes (init choice; distinct sprite + one mechanic): **Wizard** `(∩｀-´)⊃━☆ﾟ.*･｡` 15% crit ×2 · **Knight** damage taken ×0.5, +25% HP, commits ×1.25 · **Rogue** gold ×1.25, drops ×1.5 · **Ranger** edit damage ×1.15, XP ×1.10.

7 zones, level-gated + boss-gated: Whispering Grove (1–9, boss Rootfang) → Cobalt Caves (10–18, Echo Wyrm) → Sunken Archives (19–27, The Unindexed) → Ember Wastes (28–36, Pyrelord Kzz) → Glass Peaks (37–45, Aurelia) → The Null Expanse (46–54, **The Garbage Collector**; Segfault Stalker, Dangling Pointer) → Production (55–60, **The Root Cause**; Heisenbug, Race Condition, Memory Leak). Outleveled zones stall XP naturally + HUD hints `/hero zone`.

## Statusline HUD

3 lines at COLUMNS≥80 (2 at <80, 1 at <50; all strings width-truncated, never wrap):

```
⚔ Eva the Wizard  Lv 23  XP [██████▌░░░] 6.2k/11.0k   ♥ 84/97   ⛁ 1,204g  ◆BM
  (∩｀-´)⊃━☆ﾟ.*･｡ﾟ                        (◣_◢) Ash Wraith  HP [███▌░]  210/540
  Ember Wastes · +38 crit! · Magma Imp slain +162xp · [rare] Ember Wand dropped
```

`◆BM` badge if `~/.claude/.bigmode-active` exists. Animations: pending queue with serialized `at`/`dur`, frame = `floor((now−at)/250ms)`; projectile-travel hits (1.5s), kill flip to `(x_x)` (2.5s), `★ LEVEL UP ★` banner (5s), `▓▓ ☠ BOSS ☠ ▓▓` marquee intro + defeat banner (6s), offline-return summary (5s). Consecutive hits within 2s coalesce. No save → `run /hero init to begin`. Renderer never throws (fallback `⚔ …`, exit 0). Statusline fold attempt is what advances regen/anims between events.

## CLI + /hero skill

CLI is plain-text, non-interactive (works via `!` and via skill): `init [--class X --name Y]` (no args prints class menu + exact commands), `status`, `zone [go <id>]`, `shop [buy <n>]`, `inventory`, `equip <id>`, `sell <id>`, `stats`, plus dev utils `fold`, `sim <days> <events/day>`, `reset --confirm`.

Skill `~/.claude/skills/hero/SKILL.md`: frontmatter `name: hero`, `allowed-tools: Bash(node /Users/eva0012/Projects/idle-claude-rpg/bin/rpg.js *)`. Body: map `$ARGUMENTS` → CLI call, **relay output verbatim in a code fence** (minimal tokens). `init` with no args → AskUserQuestion for class (4 options with flavor) + name, then run `init --class X --name Y`. This solves first-run interactivity.

## Installer + wiring

`install.sh`: check node ≥18, `mkdir -p` state + skill dirs, copy SKILL.md, self-test (pipe fixture through hook with `IDLE_RPG_HOME` temp), then **print** the settings snippet for the user to paste manually (guardrails block me from editing settings.json — by design):

- `PostToolUse` group: matcher `Bash|Edit|Write|MultiEdit|NotebookEdit` → `node .../hooks/rpg-hook.js`, timeout 5
- `Stop` group: same script, timeout 5
- `statusLine`: `node .../statusline/rpg-statusline.js`, `refreshInterval: 1`, `padding: 0`

Instructions note these merge into the existing `hooks` object (PreToolUse/SessionStart guardrails untouched). **No SessionStart hook.** Writes limited to `~/.config/idle-claude-rpg/` + `~/.claude/skills/hero/`.

## Edge cases

Corrupt state → rename to `state.corrupt-<ts>.json`, restore from bak, else first-run prompt (keep max 3 corrupt files). Inbox >512KB → fold in chunks. Anim queue cap 10, never schedule >30s ahead. Hook: single top-level try/catch → exit 0, no stderr. Level cap: XP shows `MAX`, kills still drop loot (prestige = v2).

## Build order

1. `paths/state/balance/content/engine` + CLI `init/status/fold` + unit tests
2. `classify` + hook + fixtures
3. statusline + sprites + animations
4. skill + install.sh
5. `test/sim.js` balance replay + tune constants
6. shop/inventory/equip + offline progress + hardening
7. Copy this plan into the repo as `docs/PLAN.md`; update `todo.md` phases to match

## Verification

- `node --test test/` — classify table (every regex row incl. `git commit -m "run tests"` → commit), engine kill/levelup/boss/loot/death/offline math, state atomicity + lock-steal + corrupt recovery.
- Hook smoke: `IDLE_RPG_HOME=<scratch> cat test/fixtures/bash-test-pass.json | node hooks/rpg-hook.js` → XP moved, exit 0, `time` < 200ms.
- Statusline smoke: pipe stdin JSON at COLUMNS 100/70/45, with no/valid/corrupt state.
- Balance sim: `node test/sim.js --days 90 --events 300` → assert L60 in 40–120 days @300/day, ≥25 days @500/day, boss every 0.5–4 sim-days, attentive player dies once per 4–30 days, **and all three equip profiles (`upgrade`/`fill`/`none`) reach the cap**. The sim equips as it plays; before 2026-07-28 it never did, so every figure it asserted described a naked hero and the gates were calibrated to a player who does not exist.
- Concurrency stress: 20 parallel append+fold processes for 10s → valid state, ≥98% events folded, no deadlock.
- Live: user pastes settings + restarts, runs one Bash command → jab animates; `/hero init` end-to-end; confirm guardrail hooks still fire.
