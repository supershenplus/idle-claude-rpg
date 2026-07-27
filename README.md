# idle-claude-rpg

An idle hero RPG that lives **inside Claude Code**. Your hook events are the
game tick: every command Claude runs is an attack, passing tests grant XP,
`git commit` smites, `git push` sounds the War Horn. The statusline is your HUD.

```
⚔ Eva the Wizard  Lv 23  XP [██████▌░░░] 6.2k/11.0k   ♥ 84/97   ⛁ 1,204g
  (∩｀-´)⊃━━☆ﾟ.* ✦-38!                    (◣_◢) Ash Wraith  HP [███▌░] 210/540
  Ember Wastes · +38 crit! · Magma Imp slain +162xp · [rare] Ember Wand dropped
```

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

## Dev

```sh
node --test 'test/*.test.js'      # 29 tests incl. concurrency stress
node test/sim.js --days 90        # replay synthetic days through the engine
node test/sim.js --assert         # balance gates (time-to-cap, boss cadence)
```

State lives in `~/.config/idle-claude-rpg/` (atomic writes, daily backup,
corrupt-save quarantine). Tuning knobs are all in `lib/balance.js`.
