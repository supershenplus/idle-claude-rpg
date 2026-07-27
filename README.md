# idle-claude-rpg

An idle hero RPG that lives **inside Claude Code**. Your hook events are the
game tick: every command Claude runs is an attack, passing tests grant XP,
`git commit` smites, `git push` sounds the War Horn. The statusline is your HUD.

```
⚔ Eva the Wizard  Lv 23  XP [██████▌░░░] 6.2k/11.0k   ♥ 84/97   ⛁ 1,204g
             ◢◣          ↩-7        ░▒▓▓▓▒░
          (∩｀-´)⊃  ━━☆ﾟ.*            (◣_◢)
           ╱▓▓╲         ✦-38!        ╲░░░╱
                  Lv 31  Ash Wraith   HP [███▌░░░░░░] 210/540
  Ember Wastes · +38 crit! · Magma Imp slain +162xp · [rare] Ember Wand dropped
```

The HUD picks a layout from `$COLUMNS`: 3-line sprites with the monster centred
at ≥76 cols, one-line sprites at ≥50, and a single status line below that. Force
one with `RPG_HUD=big|compact|mini`.

- **Zero token cost** for the passive loop — hooks never write to stdout, the
  statusline is pure UI. Only `/hero …` commands (user-initiated) cost tokens.
- **Zero dependencies** — plain Node ≥18, no npm install, no network calls.
- Fail-open everywhere: a broken save or hook error can never break a session.

## The game

- 4 classes: Wizard (crits), Knight (tanky, commits hit harder), Rogue
  (gold + loot), Ranger (LOC damage + XP).
- 7 zones from Whispering Grove to **Production** (Heisenbug, Race Condition,
  Memory Leak…), each with a boss that gates the next zone.
- Loot in 5 rarities, 3 gear slots, a shop, and a 20-slot bag.
- Level cap 60 — roughly 2-4 months of regular use. Passing tests is the
  best XP (60s cooldown, don't bother loop-farming), a failing command means
  the monster hits *you*, and Stop events let your hero rest.
- Away for hours? Offline progress trickles in while the app is closed.

## Install

```sh
git clone https://github.com/supershenplus/idle-claude-rpg.git
cd idle-claude-rpg
./install.sh
```

That copies the `/hero` skill and prints the `settings.json` snippet (hooks +
statusLine) for you to merge **manually** — the installer never edits your
settings by design. Restart Claude Code, then run `/hero init` and pick a class.

Keep the clone around: the hook and statusline entries in `settings.json` point
at absolute paths inside it, so moving or deleting the directory silently stops
the game (fail-open — your session keeps working, the hero just stops ticking).

### Updating

```sh
git pull && ./install.sh
```

`install.sh` is idempotent. Your save lives in `~/.config/idle-claude-rpg/`,
outside the repo, so pulling never touches your hero. If a release changes the
hook or statusline paths, re-merge the printed snippet; otherwise the pull is
all you need.

## Commands

`/hero` (status) · `/hero zone [go <id>]` · `/hero shop [buy <n>]` ·
`/hero inventory` · `/hero equip <n>` · `/hero sell <n>` · `/hero stats`

All of it also works token-free as `! node bin/rpg.js <cmd>`.

## Event → game mapping

| You (Claude) do | Hero does |
|---|---|
| any successful command | jab, 0.4× ATK |
| write/edit N lines | attack up to 1.25× ATK (diminishing, capped at 300 lines) |
| build succeeds | heavy attack 1.5× |
| tests pass | +XP and an attack |
| tests fail | monster hits you, hard |
| `git commit` | **smite, 3×** |
| `git push` | **War Horn: instakill + guaranteed loot** (5× vs bosses) |
| command fails | chip damage to you |

Monsters fight back: every attack you land has a ~30% chance of a counter-swing
(shown as `↩-7` flying back at you), so damage no longer depends on you fumbling
a command. Bosses counter *less often* but hit far harder — a boss has 10× HP, so
its fight runs ~10× longer, and per-swing parity with trash would make bosses
unkillable rather than merely dangerous.

## Dev

```sh
node --test 'test/*.test.js'      # 32 tests incl. concurrency stress
node test/sim.js --days 90        # replay synthetic days through the engine
node test/sim.js --assert         # balance gates (time-to-cap, boss cadence)
```

`--assert` is the guard that matters when touching combat: the sim runs a *naked*
hero (it never equips loot), so it is a worst case, and any change to incoming
damage shows up there as time-to-cap and boss cadence long before it shows up in
a real save.

State lives in `~/.config/idle-claude-rpg/` (atomic writes, daily backup,
corrupt-save quarantine). Tuning knobs are all in `lib/balance.js`.
