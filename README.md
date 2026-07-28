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

That additivity is also a trap. Run `equip all` once and you read as "geared"
forever while the zone climbs past you — that's the sim's `fill` profile, and it
dies 238 times a run against the attentive player's 2. `/hero equip best` is the
way out: the same ranking, but allowed to **displace** anything the bag beats. It
fills empty slots too, so it is a superset of `equip all`. No `--confirm` — it
only moves gear between your body and your bag, and it prints every swap and the
ATK/DEF/HP the change bought.

`/hero status` nudges you when either applies: what the bag beats if anything
does, otherwise how far worn ilvl has fallen behind the zone's trash. The first
is exact rather than a heuristic — it runs the real auto-equip against a
throwaway copy, so the nudge and the command can never disagree.

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

## Where gold goes

`/hero upgrade` pours gold into gear you already wear: `+0` to `+10`, each level
worth 2% of what that item rolled, at a cost of `5 · ilvl · (plus+1)²`. The curve
is quadratic, so a full set at +10 runs to about a whole run's income — you are
meant to be choosing which items to invest in, never maxing everything.

This exists because gold had no floor. Levels cap and loot caps, but an attentive
player finished a run holding **~1.07M** with nothing left to buy, and the number
barely moved whatever the death penalty was set to (they only die a few times).
Upgrades absorb ~515k of that in the sim and leave ~69k idle.

The gold is genuinely destroyed: sell price ignores `+` entirely, so upgrading is
never a refundable deposit. What `+` *does* count toward is which item you'd
rather wear, so auto-equip never benches gear you invested in for an identical
raw drop.

Early on it is deliberately bad value — 2% of a 3-point stat is a rounding error,
and the same gold buys a whole rare off the shelf. `upgrade <slot> max` shows the
ATK/DEF/HP its spend would actually buy and says so outright when the gain rounds
to nothing, so the trap is visible before the gold is gone rather than after.

## Past the cap

Level 60 used to be a wall: `addXp` returned early and every point earned at the
cap was discarded, so a capped hero had the loot chase and nothing else. XP past
the cap now banks into **Insight**, spent on three tracks:

| track | per point | max | maxed |
|---|---|---|---|
| `atk` | +2% hero ATK | 25 | +50% |
| `gold` | +3% gold per kill | 25 | +75% |
| `drop` | +2% drop chance | 25 | +50% |

Points cost 1 Insight each for the first three, rising to 9 for the twenty-fifth.
The whole board is 351 Insight, which the sim puts at roughly **120 days past the
cap** against the 45 it took to reach it — you get your first point within hours,
and you are still choosing tracks months later.

This is deliberately **not** a prestige reset. Level, gear, gold and zone are
never touched. The game ticks while you are looking at a compiler rather than at
it, and wiping twelve slots you spent weeks filling — at a moment you weren't
even watching — is the opposite of this codebase's line that a setback should
have a way back.

`/hero insight` shows the board; `/hero insight <track>` buys one point;
`/hero insight <track> max` previews the spend and needs `--confirm`, because
Insight is the one currency you cannot farm back in an afternoon.

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
`/hero inventory` · `/hero equip <n> [slot] | all | best` ·
`/hero upgrade [<slot> [max]] [--confirm]` · `/hero insight [<track> [max]] [--confirm]` ·
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
a command.

**Death is punctuation, and it lives at bosses.** Trash costs a properly equipped
hero well under 3% of max HP per kill against 1%/min passive regen, so grinding
keeps your bar full and only an under-geared hero feels it — which is the game
telling you to go equip something. Bosses are the real threat: they counter *more*
often and far harder, and a boss fight is expected to cost most of a health bar.

Lose one and the boss drives you off rather than restarting the fight — you keep
your level and loot but forfeit the 15 kills that earned the attempt. That matters
more than it sounds: a boss used to reset to full HP when you died, so a boss you
couldn't beat was a boss you could never get *past*, and the zone quietly became a
wall. The grind back is where the levels and gear that win the rematch come from.

Armour is a ratio, not a subtraction. Defence equal to a monster's level halves
its blow, twice its level cuts it to a third, and nothing ever reduces damage to
zero. Because a full set's defence tracks monster level, mitigation lands near 50%
at every level — the difficulty curve is flat by construction. (It used to be
`monsterLevel − defence`, which was a cliff: a kitted hero crossed it and became
literally immune, while an under-geared one ate the entire curve.)

## Dev

```sh
node --test 'test/*.test.js'      # 77 tests incl. concurrency stress
node test/sim.js --days 90        # replay synthetic days through the engine
node test/sim.js --assert         # balance gates, across all three equip profiles
```

(Point it at the glob, not `test/` — the directory also holds `sim.js`, which is
a simulation script rather than a test file.)

`--assert` is the guard that matters when touching combat. It replays synthetic
days through the real engine as three different players, because balance that
only holds for one of them isn't balance:

| profile | behaviour |
|---|---|
| `upgrade` | equips anything that beats what's worn — the attentive player, and who the pacing is written for |
| `fill` | only fills empty slots, never upgrades (`/hero equip all`, rarely) |
| `none` | never opens the inventory at all — the floor |

Every profile has to reach the cap. That gate exists because the `fill` player
once died ~2000 times and *never* did, which is how the boss-reset wall above got
found. Note the spread between profiles is large and deliberate: managing gear is
the one real decision this game has, so it's allowed to matter a lot.

Until 2026-07-28 the sim never equipped anything at all, so every number it
asserted — deaths above all, since mitigation keys off defence — described a hero
who fought Production naked. If you change incoming damage, re-read those gates
before trusting them.

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
