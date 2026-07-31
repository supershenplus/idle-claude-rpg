# idle-claude-rpg

[![tests](https://github.com/supershenplus/idle-claude-rpg/actions/workflows/test.yml/badge.svg)](https://github.com/supershenplus/idle-claude-rpg/actions/workflows/test.yml)

An idle hero RPG that lives **inside Claude Code**. Your hook events are the
game tick: every command Claude runs is an attack, passing tests grant XP,
`git commit` smites, `git push` sounds the War Horn. The statusline is your HUD.

```
⚔ Eva the Wizard  Lv 23  XP [██████▌░░░] 6.2k/11.0k   ♥ 84/97   ⛁ 1,204g
          ▲    ·★°                  ◢▓▓▓◣   ·
         ▟███▙  ┃     ↩-7          ◢◆ ◆▓▓◣ ░·
          ▐◉▌───┃    ━━━★        ◢▓▓▓▓▓▓▓◣ ░
         ░▒██▓  ┃    ✦-38!        ▚▓▞▒▚▞░▚▞ ·
         ◢▒███▓◣                  ░ ▒░  ░ ▒ ·
                 Lv 31  Ash Wraith   HP [███▌░░░░░░] 210/540
  Ember Wastes · +38 crit! · Magma Imp slain +162xp · [rare] Ember Wand dropped
```

The HUD picks a layout from `$COLUMNS`: 5-line sprites with the monster centred
at ≥76 cols, one-line sprites below that. Every line is cut to the terminal
width on the way out, so narrow is a truncated scene, never a broken one. Pin a
layout with `/hero hud big|compact` (and `/hero hud auto` to go back to picking
by width) — it lives in your save and takes effect on the next frame.
`RPG_HUD=big|compact` in the environment overrides both.

Narrow is the same cast, not a different one. The one-line sprites are each
creature's own big art at the waist, compressed — that Ash Wraith again, seen
from further away:

```
⚔ Eva the Wizard  Lv 31  XP [█████░░░░░] 8.6k/17k   ♥ 194/2…
  ▐◉▌───┃    ━━━★ ✦-38!     ◢◆▓◆▓▓◣░
  Lv 31  Ash Wraith   HP [████░░░░░░] 131/335
  Ember Wastes · +38 crit! · Magma Imp slain +162xp
```

Widths are uniform per tier — 8 cells of trash, 10 of boss — because compact
centres the monster and hangs the hero a fixed gap off it, so a ragged set moves
the *hero* every time one mob replaces another. A boss is still allowed to shift
the scene, which is a shift that means something.

Every class animates its own attack over the six frames of a hit — the wizard
gathers its orb and is thrown back by the discharge, the knight steps onto a
raised sword and sweeps it through 90°, the rogue cocks and throws its dagger,
the ranger looses and recoils. Whatever leaves the sprite is what crosses the
gap. Take a counter-swing and the hero washes red; slip one and it ghosts and
leans out of the blow, head furthest, feet planted.

**The blows and the banners are separate lanes**, because they are separate
surfaces: a blow is what the sprites do and a banner is what the info row says.
They used to share one timeline, so a hit that arrived during a kill and the
level-up behind it was scheduled after both — measured in play, one sat queued
6.5 seconds, and every further hit coalesced into it while it waited. What you
saw was a stretch where the hero never swung, then a single swing long after the
work that earned it. Now a blow plays on the frame it was earned on and the
banner holds the row underneath it, both at once.

The exception is the handful of banners that put something on the *sprites* too
— a corpse, a field the monster fled, a hero who just died. Those hide a blow
rather than sharing with it, since a hero swinging at a body is worse than a
swing nobody saw; and for the same reason they wait for the blow lane before they
start, so the killing blow is still drawn before the corpse it made. One set in
`engine.js` decides both, because either rule alone is wrong: a `kill` that hid
the killing blow without waiting for it would hide it every time.

**Big blows throw a volley.** A commit, or a push against a boss, sends three
marks across the gap instead of one — `★━━★━━★` for the wizard, `➳--➳--➳` for the
ranger — strung on the class's own trail, so it reads as one weapon fired three
times rather than three unrelated things arriving together. They leave one at a
time as the leader clears the hero, so the volley grows out of the gap instead of
appearing whole. Those two are the hardest hits in the game (3.0× and 5.0× ATK)
and until now their entire weight was the colour of the damage number, which they
had to borrow from `crit` to get. The count doesn't scale with damage: the volley
says *this was one of the big ones*, and the number beside it says how big.

The monster gets a swing back. A failing test or a failing command is drawn as a
lunge — wind up, come forward, mark crossing the gap right-to-left, `♥-46` for
what it cost — instead of HP quietly leaving the bar, which is what it used to
be. And it reels when you connect: knocked back two cells and lit up in the
colour of the number hitting it. One script covers all 30 monsters; the seven
bosses scale it by a *depth* — how far they come and how long they hold it — so
Rootfang heaves where a leech jabs, on no extra art. Depth is paid for in
distance rather than out of the gap, so a deep boss stands correspondingly
further off: the hero keeps five more columns from the Garbage Collector than
from a kobold, and that reads whether or not anything is swinging.

See it without installing anything — every scene, drawn by the real renderer:

```sh
node bin/demo.js            # or: node bin/demo.js boss loot --mode compact
```

- **Zero token cost** for the passive loop — hooks never write to stdout, the
  statusline is pure UI. Only `/hero …` commands (user-initiated) cost tokens.
- **Zero dependencies** — plain Node ≥18, no npm install, no network calls.
- Fail-open everywhere: a broken save or hook error can never break a session.

## The game

- 4 classes: Wizard (crits), Knight (tanky, commits hit harder), Rogue
  (gold + loot), Ranger (LOC damage + XP).
- 7 zones from Whispering Grove to **Production** (Heisenbug, Race Condition,
  Memory Leak…), each with a boss that gates the next zone — 22 trash monsters,
  7 bosses, and a loot goblin that turns up anywhere.
- Loot in 5 rarities across 12 gear slots, a shop that restocks every 4 hours,
  and a 20-slot bag.
- Level cap 60 — the sim reaches it on day 43 at 300 events a day, day 27 at
  500. Passing tests is the best XP (60s cooldown, don't bother loop-farming),
  a failing command means the monster hits *you*, and Stop events let your hero
  rest.
- Past the cap, XP banks into **Insight**: three paragon tracks, and about
  another four months of spending.
- Away for hours? Offline progress trickles in while the app is closed — and a
  goblin you left alive spends its patience while you're gone.

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
dies 274 times a run against the attentive player's 1. `/hero equip best` is the
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
Upgrades absorb ~438k of that in the sim and leave ~88k idle.

The gold is genuinely destroyed: sell price ignores `+` entirely, so upgrading is
never a refundable deposit. What `+` *does* count toward is which item you'd
rather wear, so auto-equip never benches gear you invested in for an identical
raw drop.

Early on it is deliberately bad value, and the size of that gap is worth knowing,
because it is not a property of the upgrade curve at all. A `+` is a percentage of
*gear*, and gear is only 46% of a Grove hero's ATK against 67% of a capped one's —
class base and per-level ATK dominate while you are low. So every `+` is worth
**1.6%** of hero ATK leaving the Grove and settles at 7–8.7% from Cobalt Caves
onward, a fifth of its steady-state value in the one zone every player starts in.
Meanwhile `upgradeCost` is *linear* in ilvl. The two curves disagree: upgrades are
cheapest in exactly the zone they are worth least.

So every path that spends gold on a `+` reports what it buys, not just what it
costs — the shelf's per-slot gain column, the `cheapest:` nudge that used to
recommend on price alone, the single `upgrade <slot>`, and `upgrade <slot> max`.
A dead one says `→ nothing` outright. This is the same fix as the shop's
`worse than worn` tag, and the same reasoning: the roll stays honest, and the
listing stops hiding what it costs you.

The gain is measured at the item rather than at the hero, because `gearSum`
rounds its total — one `+` on a small item moves the stat sheet by nothing, but
it is not nothing, and the sum keeps every fraction and rounds once, so enough of
them cross a whole point. Reporting `+0.1 ATK` is the truthful answer; reporting
zero would not be.

## The loot goblin

5% of non-boss spawns aren't the local wildlife:

```
⚔ Gavin the Rogue  Lv 15  XP [█████░░░░░] 2.9k/5.8k   ♥ 101/142   ⛁ 12,400g
                     ▗▄▄▖   ╱                ▖ ▗ ▗▄▄▄▄▄▖
                     ▖▟█◕▙ ╱                ◢$█$◣▟▓⛁▒▓█▙
                    ▚░▒█▓▙╪                ◀▝▄██▄▟▒▓▒▓█▌
                    ▚░▒██▓                   ▟██▛▐▓▒⛁▓█▌
                    ▝▜▛ ▜▙                  ▐▘ ▝▙●▝▀▀▀▀▘
                          ≡$≡ ⛁ LOOT GOBLIN ⛁ — get it before it runs ≡$≡
  Cobalt Caves · it is not from around here
```

It is one monster for the whole game rather than one per zone — it has no home
band, it turns up wherever you are and fights at the level the trash there would
have been. A per-zone roster would be another name in every zone for a thing whose
entire character is "not from around here". The coins are part of its name (`⛁ Loot
Goblin ⛁`, the same glyph the vitals line uses for gold), so the nameplate, the
kill ticker and the banner's uppercase all pick them up for free.

Every number it carries is a **multiple of what that same spawn would have been**,
never an absolute — ×3 HP, ×3 XP, and a payout that is either ×8 gold or, 30% of
the time, a guaranteed **epic or better** at its own item level. That is the whole
safety property: a goblin met at level 8 in the Grove pays Grove rates, so it
stays a windfall instead of handing a level-8 hero Null Expanse gear.

**It bites, and it runs.** A sack of gold guarded by nothing is a vending machine,
not an event — and the sim proved it literally: as a fat trash mob carrying a
prize, it over-geared the attentive hero into 1 death per 90 days against a floor
of one per 30. So it counters at 40% for full damage (trash is 30% at 0.45×,
bosses 45% at 1.6×), and since the fight runs three times as long, total exposure
is roughly nine times a trash mob's.

The deadline is counted in **folded events, never seconds**: a wall-clock timer
would be the only thing in the engine whose outcome depends on when you happened
to look, and `fold` exists precisely so a replay lands where the live run did. The
goblin gets 10 events to survive. Ten is measured, not guessed — escape rates over
six seeds × 90 days:

| events | attentive | under-geared |
|---|---|---|
| 8 | 19.2% | 68.8% |
| 9 | 11.9% | 62.3% |
| **10** | **5.9%** | **50.7%** |
| 11 | 3.9% | 43.7% |
| 14 | 0.0% | — (feature never fires) |

A hero who wears what they find loses about one goblin in seventeen; a hero who
never opens their inventory loses half of them. That spread is the point — the
deadline is a DPS check, so gear is the whole defence, and falling behind is what
makes the goblin start getting away.

```
⚔ Gavin the Rogue  Lv 15  XP [█████░░░░░] 2.9k/5.8k   ♥ 78/…
   ▚░▒█◕▙╪              ◀$█▄▟⛁▓▌
 ≡$≡ ⛁ Loot Goblin ⛁ got away with the sack ≡$≡
 Cobalt Caves · it slipped away with the sack
```

Closing the lid does not freeze the clock. Away kills are the away window's unit
of work, so they spend the goblin's patience the way folded events do — otherwise
"get it before it runs" stopped being true the moment you stopped looking. An
escape that happens while you're gone is reported in the away summary (`· a goblin
got away`) rather than only in a banner nobody was there to see: it is the one
outcome in this game you can lose without ever being told it happened.

Boss progress is credited for the *time* the goblin took (3 kills, its HP
multiplier) rather than the one kill it technically is. Crediting a single kill
looked defensible and wasn't: a controlled sim — same `rand()` stream, goblin
chance 0 vs 0.05 — put boss kills over 90 days at 65 without goblins and 56 with,
a 14% cut, because every goblin was silently eating three trash mobs' worth of
approach. `/hero stats` counts goblins killed and, separately, how many got away.

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
cap** against the six weeks it took to reach it — you get your first point within
hours, and you are still choosing tracks months later.

This is deliberately **not** a prestige reset. Level, gear, gold and zone are
never touched. The game ticks while you are looking at a compiler rather than at
it, and wiping twelve slots you spent weeks filling — at a moment you weren't
even watching — is the opposite of this codebase's line that a setback should
have a way back. If what you wanted from prestige was a fresh start in a
different class, that is [the roster](#several-characters), and it costs you
nothing.

`/hero insight` shows the board; `/hero insight <track>` buys one point;
`/hero insight <track> max` previews the spend and needs `--confirm`, because
Insight is the one currency you cannot farm back in an afternoon.

### The ending

The last boss is **The Root Cause** (level 60, Production). Killing it the first
time is the one moment the game treats as an ending: its own flashing banner
(`YOU HAVE SHIPPED`), and **The Postmortem** — Production's named legendary —
handed over guaranteed. The trophy skips the drop filter, so a hero already
wearing better in that slot is not sold their own trophy under the credits.

`hero.clearedAt` dates it, and `/hero status` and `/hero stats` carry a
`✦ CLEARED <date>` line from then on. The Root Cause keeps coming back every 15
kills afterwards — repeat clears count up (`DEFEATED ×4`) rather than replaying
the ending. There is no prestige reset; see the note above for why.

`node bin/demo.js cleared` draws the frame without the two months.

## Several characters

There are four classes and you only ever played one. Knight makes commits hit
harder, Ranger turns lines of code into damage, Wizard crits, Rogue farms —
those genuinely change how *your work* maps to the game, and trying a second one
used to cost you the first: `init` refused unless you passed `--force`, whose
help text was honest about what it did ("this deletes your hero").

```
  Characters (3):

  ▸ 1. ▐◉▌───┃ Eva the Wizard            Lv 60  Production        1.2M      ✦ cleared
    2. ╪░▟◉█▙◆ Gavin the Knight          Lv 31  Ember Wastes      14,208g   2d ago
    3. ▚▒█◔▓┼▶ 勇者 the Ranger            Lv 4   Whispering Grove  212g      3w ago
```

`/hero init` now **adds** a hero and switches to it; there is no `--force` path
at all, because that flag's only remaining meaning would be "delete the hero I
am about to stop using". `/hero roster` lists them, `/hero switch <n|id|name>`
changes which one you are playing, and `/hero delete <n> --confirm` is the one
that removes anything.

Switching is **machine-wide**, and that is the direct cost of a property worth
keeping. One save behind every repo and every open window is why three windows
triple your tick rate on one hero; it is also why switching in one window swaps
the hero in every other HUD on its next frame, mid-animation. The escape hatch
is the pattern `$RPG_HUD` already uses over the saved HUD pin: `IDLE_RPG_HERO=hero_2`
in one window's environment overrides the shared pointer for that window only.
Anyone who wants two heroes at once opts in; nobody else pays.

Two things it deliberately does not do. **Prestige is not part of it** — see
[Past the cap](#past-the-cap) for why nothing here wipes anything, and note that
what people usually want from prestige is "play a Knight without losing my
Wizard", which is this. And a new character does not get its own inbox: the hook
appends work events without knowing who is active — it runs on every tool call
and cannot afford to load a save to find out — so the inbox is global and
whoever is on the clock gets paid for the work. Same for the lock.

One thing genuinely breaks, and it is small enough to keep. **A switch can
swallow one War Horn.** Pushes are read out of the repository (below), and the
record of what each remote pointed at lives *in the save* — so a character who
has never been played in this repo has nothing to compare against and will not
fire the horn on its first push here. The fix would be a global repo map, which
costs the "a save is self-contained" property that makes backup and recovery
comprehensible. One horn, once per character per repo.

Old installs migrate on first run: the flat `state.json` and everything it
spilled into move down into `characters/hero_1/` with their filenames unchanged,
and `active` is written to point at it. The save moves **last**, so an adoption
interrupted halfway is resumed rather than restarted — the other order would
strand the backup generations at the top level with nothing left to trigger a
second attempt, and the backups are the whole recovery story.

## Install

Node ≥ 18, no npm install, no network calls.

```sh
git clone https://github.com/supershenplus/idle-claude-rpg.git
cd idle-claude-rpg
./install.sh --write-settings
```

That copies the `/hero` skill, self-tests the hook, and wires both into
`~/.claude/settings.json`. Restart Claude Code, then run `/hero init` and pick a
class.

Plain `./install.sh` does everything except the last step, printing the snippet
for you to paste instead. That's the default because `settings.json` decides
what runs on every tool call in every session, and a game installer isn't
entitled to it unless you say so. The merge, when you do ask for it:

- **backs up** `settings.json` first (timestamped, never overwritten),
- is **idempotent** — re-running won't wire the hook twice,
- leaves your existing hooks alone, including guardrails on the same event,
- **refuses to replace a status line you already have.** You only get one, so if
  yours is doing a job it stays and only the hooks go in (`--force` overrides).
  You can still play token-free via `! node bin/rpg.js status`.

Keep the clone around: those entries point at absolute paths inside it, so
moving or deleting the directory stops the game — fail-open, meaning your
session keeps working and the hero just quietly stops ticking. If you do move
it, re-run `./install.sh --write-settings`; it repoints the stale paths rather
than adding a second copy.

### Updating

```sh
git pull && ./install.sh
```

`install.sh` is idempotent. Your save lives in `~/.config/idle-claude-rpg/`,
outside the repo, so pulling never touches your hero.

### If the HUD stops drawing

```sh
./install.sh --check
```

Checks node, the skill, both hooks, the status line, and your save — and names
the first thing that's actually wrong. It's built around the failure this design
can't avoid: a stale absolute path fails open, so a moved clone stops the game
with no error message anywhere.

### Uninstalling

```sh
./install.sh --uninstall
```

Removes the `/hero` skill and only our entries from `settings.json` (backed up
first; co-tenant hooks and a status line that isn't ours are left in place).
Your heroes survive in `~/.config/idle-claude-rpg/` — delete that directory by
hand if you want them gone too.

### What the save holds

Everything lives in `~/.config/idle-claude-rpg/`, never leaves the machine, and
is written with your default umask (usually mode `644` — readable by other users
on a shared box):

```
~/.config/idle-claude-rpg/
├── active                       which hero this machine is playing
├── events.ndjson                the shared inbox — global, see below
├── state.lock
└── characters/
    ├── hero_1/state.json        one directory per hero, +4 backup generations
    └── hero_2/state.json
```

Slugs are generated (`hero_2`) rather than derived from the hero's name. Names
are user input, sanitized but legitimately CJK or emoji, and a path built from
one hits filesystem-unsafe characters, macOS case-insensitive collisions and
length limits. The display name stays inside the save, where it already was.

Beyond the obvious hero and loot, `state.json` keeps one entry
per repo you have worked in: the **absolute path** to its git directory and the
SHA its remote-tracking branch pointed at. That is how a push made outside
Claude's tools is detected at all — see below — and it is capped at the 24
most-recently-seen repos, oldest evicted first.

The practical consequence is that your save lists which projects exist on the
machine and roughly when each moved. Nothing is transmitted anywhere (the game
makes no network calls and has no dependencies), but if that directory is
readable by someone you'd rather not hand a project inventory to, `chmod 700` it
— the game only ever reads and writes it as you.

Saves migrate forward on load, so an old hero survives a pull. The v1→v2 jump
(3 slots → 12) re-slots each item by the noun in its name — a Cloak was always a
cloak, it just had nowhere to go — and re-rolls its stats onto the v2 curve, so
legacy gear doesn't permanently outclass every new drop for its slot.

## Commands

`/hero` (status) · `/hero zone [go <id>]` · `/hero shop [buy <n>]` ·
`/hero inventory` · `/hero equip <n> [slot] | all | best` ·
`/hero upgrade [<slot> [max]] [--confirm]` · `/hero insight [<track> [max]] [--confirm]` ·
`/hero sell <n> | all | <rarity…> [--confirm]` · `/hero stats` ·
`/hero hud [big|compact|auto]` · `/hero roster` · `/hero switch <n|id|name>` ·
`/hero delete [<n|id|name>] --confirm` · `/hero reset --confirm`

All of it also works token-free as `! node bin/rpg.js <cmd>`.

### `/hero stats` and the sitting

`stats` opens on **this sitting** — kills, gold, XP, levels, commits, pushes,
tests, lines and loot since you sat down — and prints the lifetime totals under
it. A sitting ends the same way an away window starts: after
`OFFLINE_MIN_GAP_MS` (30 min) with no folds. The closed one is kept and shown as
a one-liner, so opening a fresh window still has something to report before the
first monster dies.

Two things it deliberately is not. It is **not** keyed on Claude Code's session
id, even though the hook carries one: the save is global, so one hero is shared
by every repo and every open window, and two concurrent sessions would reset
each other's totals all day. And the away window's take lands in **neither**
sitting — the away summary already reports it, and it is not keyboard work.

The numbers are deltas against a snapshot of the lifetime counters rather than a
second set of tallies, so the two blocks can never drift apart.

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
(shown as `↩-7` flying back at you, and the hero washed red for the rest of the
animation), so damage no longer depends on you fumbling a command.

The next 20% of that same roll is drawn as `↩ dodge` — a swing that missed. It
is narration, not a mechanic: no damage is prevented, `retaliate` still spends
exactly one random number whichever way it reads, and `test/sim.js` prints byte
-identical output with it on. The band exists so the tell stays worth watching;
calling *every* unanswered attack a dodge would mean 70% of hits, at which point
the hero is perpetually mid-lean and it says nothing.

The two blows in that table that are *not* answers to yours — a failing test, a
command that came back non-zero — are drawn as the monster's own lunge, marked
`♥-N` rather than the counter's `↩-N`, because `↩` means "in answer to yours".
They used to be the one thing in the game that changed a number and drew nothing
at all.

### The War Horn is detected from git, not from the hook

Everything else in that table is classified from a hook payload, which means it
only ever sees what **Claude** ran. A push you type yourself with the `!` prefix,
make in a second terminal, or make from an IDE fires no hook at all — so the
headline feature silently never happened for anyone whose workflow pushes that
way. That is not hypothetical: it shipped like that, and was found by noticing
`counters.pushes: 0` in a save with 17 commits and three real pushes behind it.

So pushes are read out of the repository instead. Each fold checks whether the
remote-tracking ref moved **and now equals local HEAD** — the second half is what
separates a push from a fetch, since fetching someone else's work also advances
`origin/main`, but to a commit you don't have. A push is a fact about the repo
rather than about who typed it, so every route into one now counts.

The hook and the statusline both poll, and both share one recorded SHA per repo
in the save, so whichever notices first fires and the other sees no change.
That shared record is the whole dedup story — no time windows to tune. It being
*in the save* is also why a freshly switched-to character misses its first horn
in a repo it has never seen — see [Several characters](#several-characters).

**Death is punctuation, and it lives at bosses.** Trash costs a properly equipped
hero well under 3% of max HP per kill against 1%/min passive regen, so grinding
keeps your bar full and only an under-geared hero feels it — which is the game
telling you to go equip something. Bosses are the real threat: they counter *more*
often and far harder, and a boss fight is expected to cost most of a health bar.
The [loot goblin](#the-loot-goblin) sits between the two, and is the only fight
you can lose without dying.

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
node --test 'test/*.test.js'      # 411 tests incl. concurrency stress
node test/sim.js --days 90        # replay synthetic days through the engine
node test/sim.js --assert         # balance gates, across all three equip profiles
node bin/demo.js --list           # 23 HUD scenes, for screenshots and layout work
node bin/demo.js loose --frames   # walk one scene across every frame of its blow
```

(Point it at the glob, not `test/` — the directory also holds `sim.js`, which is
a simulation script rather than a test file.)

CI runs both of those on Node 18/20/22/24 plus macOS, and fails the build if a
`package.json` or `node_modules` ever appears — the dependency-free invariant is
the kind of thing that erodes by accident, so it is asserted rather than trusted.

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

State lives in `~/.config/idle-claude-rpg/characters/<slug>/` (atomic writes,
four rolling hourly backups, corrupt-save quarantine — per character, and the
filenames inside are unchanged from before the roster, which is the entire
reason for the extra directory: a flat `state.<slug>.bak.2.json` would make
every filename regex in `state.js` ambiguous). The backups step back one generation an hour
rather than keeping a single daily copy, because the write that motivated them
was not a corruption but a perfectly valid save written over a good one — which
nothing in the load path can detect, so depth of history is the only defence.
Recovery walks `state.bak.1.json` outward until one parses. Tuning knobs are all
in `lib/balance.js`.

`bin/demo.js` poses a synthetic save per scene and shells out to the **real**
statusline rather than drawing its own version — a demo with its own copy of the
layout keeps looking right long after the thing it stands in for breaks. It is
also the only coverage of several animation branches: a legendary drop, a boss
intro and a death are rare by design, so waiting for one is not a test strategy.
It earns its keep — the unseparated `-21594g` in the death banner was found by
looking at a screenshot of it.

`--frames` walks a scene across every frame it has instead of drawing the one
worth a screenshot. A blow is 1500ms and the statusline redraws about once a
second, so in play you catch one frame of five at random — which is a bad way to
tell a recoil that recovers from one that sticks. Each scene is walked on the
clock its own animation runs on: a `hit` or `mhit` on the weighted frames of
`sprites.BLOW_MS`, a banner on the two flat ticks its flash alternates over, and
a scene with no animation drawn once. A scene can carry one anim from each lane
(`overlay`), and then the blow is the half with frames worth naming — the walk
shifts both by a common delta so the distance between them, which is the thing
that scene is about, survives being re-anchored.

Naming a frame means naming the clock too: animations are picked by elapsed time,
and a demo that spawns a child process is asking for a frame across a boundary the
scheduler is free to stretch, so `heave` sometimes drew whatever came next.
`$RPG_NOW` pins the clock the scene is drawn against and the offset becomes exact.
It moves the picture and not the save — the fold underneath deliberately keeps the
real clock.

`bin/settings.js` is the wiring: `print` / `merge` / `remove` / `check`, all
keyed off the two script basenames rather than exact command strings, so a
re-run after moving the clone repairs the paths instead of duplicating them.
`test/settings.test.js` covers it as a subprocess against real files — it's the
only thing here that writes to a file the user didn't create for us.

## License

MIT — see [LICENSE](LICENSE).
