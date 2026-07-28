# idle-claude-rpg

An idle hero RPG that lives **inside Claude Code**. Your hook events are the
game tick: every command Claude runs is an attack, passing tests grant XP,
`git commit` smites, `git push` sounds the War Horn. The statusline is your HUD.

```
⚔ Eva the Wizard  Lv 23  XP [██████▌░░░] 6.2k/11.0k   ♥ 84/97   ⛁ 1,204g
          ▲    ·★°                  ◢▓▓▓◣   ·
         ▟███▙  ┃     ↩-7          ◢◆ ◆▓▓◣ ░·
          ▐◉▌───┃   ━━━☆ﾟ.*       ◢▓▓▓▓▓▓▓◣ ░
         ░▒██▓  ┃    ✦-38!        ▚▓▞▒▚▞░▚▞ ·
         ◢▒███▓◣                  ░ ▒░  ░ ▒ ·
                 Lv 31  Ash Wraith   HP [███▌░░░░░░] 210/540
  Ember Wastes · +38 crit! · Magma Imp slain +162xp · [rare] Ember Wand dropped
```

The HUD picks a layout from `$COLUMNS`: 5-line sprites with the monster centred
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
- Loot in 5 rarities across 12 gear slots, a shop that restocks every 4 hours,
  and a 20-slot bag.
- Level cap 60 — roughly 2-4 months of regular use. Passing tests is the
  best XP (60s cooldown, don't bother loop-farming), a failing command means
  the monster hits *you*, and Stop events let your hero rest.
- Away for hours? Offline progress trickles in while the app is closed.

## Gear

Twelve slots: `weapon offhand head chest back hands feet neck ring1-4`. You wear
four rings, and a cloak and a breastplate are different things worn in different
places.

Every slot rolls its own stat mix, so gear reads as what it is rather than as
twelve nouns over the same numbers — chest is the DEF anchor, head/back/feet lean
HP, gloves and jewelry mix in ATK, offhand splits everything. Each slot has its
own nouns (Hauberk, Mantle, Greaves, Torc, Signet…), and rings drop 4× as often
as helms since you wear four.

```
  Gear (6/12 slots):
    weapon   [rare] Runed Cobalt Maul (weapon i12) ATK+19
    chest    [epic] Mythic Cobalt Plate (chest i12) DEF+6 HP+32
    back     [rare] Runed Cobalt Cloak (back i12) DEF+2 HP+11
    ring1    [common] Plain Grove Signet (ring i4) ATK+1 HP+1
    …        (the real panel lists all twelve, empties included)
```

`/hero equip <n>` fills the first free slot of the item's kind, and only
displaces something once they're all full — then the cheapest one, so putting on
a fourth ring never quietly bins your best. `/hero equip <n> ring2` targets a
slot explicitly.

`/hero equip all` fills **every empty slot at once** with the best thing in the
bag that fits, which is how you kit out a fresh hero or fill in the gaps after a
good run. It is strictly additive: it never unequips, never displaces, and never
touches a slot you already filled, so unlike bulk selling there is nothing to
preview and nothing to undo.

## Shop

The shelf is a roll, not a fixture: five items in distinct slots, rarities from
uncommon to legendary, item levels anywhere in the zone's band, the occasional
25%-off sale — and it **restocks every 4 hours**, so gold has somewhere to go
besides the next zone and checking the shop is worth doing twice.

```
  Whispering Grove shop — you have 599g · restocks in 3h 59m:

  1. [rare] Runed Grove Wand (weapon i7) ATK+11 — 840g
  2. [uncommon] Fine Grove Helm (head i8) DEF+1 HP+6 — 672g
  …
  5. [rare] Runed Grove Treads (feet i1) HP+1 — 90g SALE (was 120g)
```

The roll is seeded on (zone, 4-hour window) rather than being random per call,
so the shelf you read is the shelf you buy from, and every zone stocks something
different in the same window. Every restock carries at least one rare or better.
If a rotation lands between your `shop` and your `shop buy`, the buy is cancelled
and the new shelf printed instead of your gold going on an item you never saw.

`/hero sell all` and `/hero sell commons rares` clear the bag in bulk. Both match
a set you can't see from the command you typed, so they print what would go and
sell nothing until you re-run with `--confirm`. `/hero sell <n>` is one item you
just read off `/hero inventory`, so it sells immediately.

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

Saves migrate forward on load, so an old hero survives a pull. The v1→v2 jump
(3 slots → 12) re-slots each item by the noun in its name — a Cloak was always a
cloak, it just had nowhere to go — and re-rolls its stats onto the v2 curve, so
legacy gear doesn't permanently outclass every new drop for its slot.

## Commands

`/hero` (status) · `/hero zone [go <id>]` · `/hero shop [buy <n>]` ·
`/hero inventory` · `/hero equip <n> [slot] | all` ·
`/hero sell <n> | all | <rarity…> [--confirm]` · `/hero stats`

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
node --test 'test/*.test.js'      # 64 tests incl. concurrency stress
node test/sim.js --days 90        # replay synthetic days through the engine
node test/sim.js --assert         # balance gates (time-to-cap, boss cadence)
```

(Point it at the glob, not `test/` — the directory also holds `sim.js`, which is
a simulation script rather than a test file.)

`--assert` is the guard that matters when touching combat: the sim runs a *naked*
hero (it never equips loot), so it is a worst case, and any change to incoming
damage shows up there as time-to-cap and boss cadence long before it shows up in
a real save.

One trap if you touch the HUD: Claude Code renders a status line as
`stdout.trim().split('\n').flatMap(l => l.trim() || []).join('\n')`, so every
line is trimmed and blank lines are dropped. The scene is laid out entirely with
leading spaces, and losing them collapses each row flush-left by a different
amount — the art still looks like art, just badly drawn, so nothing fails
loudly. `render.keepIndent` leads each line with U+2800 BRAILLE PATTERN BLANK
(draws nothing, one cell wide, not whitespace to `String.trim`), and
`test/statusline.test.js` asserts the output survives that transform
byte-for-byte.

Adding a gear slot means adding it in three places: `content.SLOT_TYPES` (count
+ nouns), `balance.SLOT_STATS` (stat profile + primary), and a bump of
`state.CURRENT_VERSION` with a migration if saved items need re-slotting.
`test/equipment.test.js` fails if the first two drift apart.

State lives in `~/.config/idle-claude-rpg/` (atomic writes, daily backup,
corrupt-save quarantine). Tuning knobs are all in `lib/balance.js`.
