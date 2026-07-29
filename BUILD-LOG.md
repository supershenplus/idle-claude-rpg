# idle-claude-rpg — Build Log

A running ledger of milestones, latest first. Updated whenever one lands, so it
can seed a retrospective write-up later. Open work lives in `todo.md`; the design
is in `docs/PLAN.md`.

## The attempt

- **Goal:** an idle hero RPG that lives **inside Claude Code**. Your hero grinds
  while you code — hook events are the game tick, so the thing that levels you up
  is the work you were doing anyway.
- **Started:** 2026-07-27.
- **Stack:** plain Node, **zero dependencies and zero network calls** — both
  load-bearing, and both re-verified by the security pass below. A PostToolUse /
  Stop hook (`hooks/rpg-hook.js`, zero tokens, fail-open, <100 ms), a statusline
  HUD (`statusline/rpg-statusline.js`, three responsive layouts at 1 fps), a CLI
  (`bin/rpg.js`) and a `/hero` skill, over a fold-reducer engine in `lib/`.
  Save state is concurrency-safe by ndjson inbox + lock + atomic rename.

## Current status (latest first)

### The compact HUD gets the art the big one got a week ago (2026-07-29)

- **The gap this closed.** v1.2 redrew all 33 sprites as 5-row block art and
  banned two-cell glyphs from it — and stopped there. The one-liners the compact
  HUD draws stayed the kaomoji the game shipped with on day one, so the two
  layouts drew visibly different creatures: an Ash Wraith was a nine-glyph
  revenant at 80 columns and `(◣_◢)` at 70. Long-deferred in the backlog, and
  deferred partly because it looked like taste. It wasn't: the narrow layout is
  the one a split pane or a sidebar terminal actually gets
- **The rule that made it 35 decisions instead of 35 inventions.** Each one-liner
  is that creature's own big art *at the waist* — the row the projectile already
  flies along — compressed to a fixed width. So `▐◉▌───┃` (the wizard) and
  `▚░▒█▓▙╪` (the rogue) are their big art's middle row verbatim; the knight's and
  the ranger's fold the eye down one row, because a face is most of what makes
  seven cells read as a person. Nothing was designed twice, and a monster added
  later has an obvious answer to "what does it look like small"
- **Widths are uniform per tier — and that is a layout fix, not a tidiness one.**
  Compact centres the monster on the terminal midpoint and hangs the hero a fixed
  gap to its left, so the hero's column is a *function of the monster's width*.
  The old set ranged 3 to 11 cells, which meant the hero shuffled sideways on
  every kill — several times a minute, on a redraw that also had a corpse and a
  banner in it, so it read as the layout settling rather than as anything in the
  game. 8 cells of trash and 10 of boss makes the geometry constant within a
  tier. A boss still moves it, which is a shift that means something
- **Two big-art nits went with it, both the same bug.** `harpy` had a `▚`
  floating three columns off its right wing and `leech` was 8 cells against a
  roster of 11–13. The harpy's stray glyph was not a stray glyph: its row was 12
  cells against a 13-cell sprite, and per-row centring nudged it half a column
  out of line with everything else. Redrawn to uniform 13 — the same fix the loot
  goblin already carried, and the reason every row now has to *end* on a glyph
  (which is what the frost motes on the bottom rows are). The leech grew to 11,
  longer rather than fatter: it is the trash of the Null Expanse and it read as a
  Grove mob that had wandered in
- 4 new tests in `sprites.test.js` mirroring the big art's: single-cell glyphs,
  exact width per tier, no whitespace padding, and every hero one-liner fitting
  inside its own big art. The one-liners had no invariants at all before, which
  is exactly how they stayed two-cell-wide long after the big art had banned that
- Follow-on tidying the pass forced: `bin/rpg.js`'s class menu aligns now
  (`.padEnd(12)` counts code units, which kaomoji made a lie), `SKILL.md`'s class
  picker shows the real sprites, and `render.js`'s `charWidth` comment stopped
  citing the sprites as its reason. It keeps a better one — the hero's name is
  whatever the player typed, and it is the one string on the vitals line the game
  does not control

### Four backups instead of one, after losing a day to having one (2026-07-29)

- **Cause, recorded plainly.** A throwaway probe script written during the boss
  -depth work required `lib/state` *before* setting `IDLE_RPG_HOME`. `paths.js`
  resolves `STATE_DIR` at require time, so the env var came too late and the
  probe's `saveState` wrote a fresh level-1 knight over the live hero. Five
  levels, the XP and the gold behind them, and the kill counters went with it.
  `test/state.test.js` has carried the warning in a comment since the beginning
  — *"must be set before requiring lib/paths"*
- **What made it expensive was the backup policy, not the mistake.**
  `state.bak.json` refreshed on a 24h clock, so it was 22 hours stale when it
  was needed, and it was the *only* copy — no Time Machine destination on the
  machine and no user-data APFS snapshots. Gear survived (the backup plus the
  events still queued in the inbox); the levels did not
- **Four generations an hour apart, rather than a shorter single roll.** The
  distinction that decided it: the damaging write produced a **valid** save.
  Corruption is the case a single backup handles well, because the load path can
  see it and step back; a valid overwrite is invisible to every check the game
  has, so the only defence is more than one step back. A one-hour single roll
  would have made this cost an hour instead of a day, and would still have been
  defeated by two bad saves in a row
- **The roll is on a clock, not on a save count.** The statusline saves about
  once a second and a catch-up fold saves in bursts, so counting saves would
  roll the whole window out in about a minute — which is the same as having no
  history at all. Cost on the overwhelming majority of saves is one `statSync`
- **An existing `state.bak.json` is adopted as generation 1**, not written past:
  on an installed copy it is a real recovery point, and the first roll would
  otherwise step straight over it. `saveFiles()` still lists both shapes, so
  `reset`'s promise of "forever" keeps covering everything on disk
- **Recovery now walks outward** from `state.bak.1.json` instead of trying one
  file: whatever corrupted the live save can have been copied into the newest
  generation before anyone noticed, which is exactly when the next one back is
  the thing you want
- **The pre-migration snapshot stays separate and is now better justified.**
  More generations *shortens* the window in which pre-migration bytes survive
  the roll, so folding `state.v<N>.json` into the generations would have made
  the case it exists for worse rather than better
- **Tests:** 4 new in `state.test.js` — the window steps back one generation per
  interval and drops the oldest (and does *not* move for saves inside the
  interval); a corrupt newest generation is stepped over rather than surrendered
  to, with the live save unreadable too; a pre-generational backup is adopted;
  and a reset takes every generation with it

### Bosses swing deeper, for one number each (2026-07-29)

- **The costed middle option, taken.** `todo.md` carried two versions of
  per-boss attacks: the full one (six hand-drawn frame sequences, a real art
  budget, and the ranger's shows they need a solver to align) and a cheap one
  nobody had priced — keep the single shared script and give each boss only a
  *depth*. This is the cheap one, built to find out whether it makes the full
  version unnecessary or merely overdue. It is 7 lines of data and no new art
- **Two numbers, not one.** `reach` is how far forward the boss comes at full
  extension in cells, against the shared script's 3; every forward frame scales
  in proportion so the shape of the blow survives and only its size changes.
  `hold` is how many frames it sits there. Rootfang and the Echo Wyrm are the
  pair that proves the second axis earns its place: identical reach of 5, and
  the treant is still leaning in a frame after the wyrm has snapped back
- **Two things deliberately don't scale.** The wind-up, because rocking back
  onto the heel is the same movement whatever the boss weighs — and because it
  is the frame that spends `MAX_MONSTER_BACK`, so scaling it would buy
  right-edge reserve for nothing anybody reads as weight. And `fly`, which is a
  fraction of the gap rather than a count of cells, so it already crosses
  whatever distance the boss left itself
- **`hold` has exactly two settings and that is the animation's ceiling, not a
  choice.** A 1500ms blow at 250ms a frame is six frames; the script has to open
  and close on its own mark, and the blow lands on frame 3 — so there is one
  spare frame to hold and no way to buy a second without lengthening the blow
  for all 28 monsters. Written down as `MAX_HOLD`, derived, and asserted
- **The depth is paid for in standoff, not out of the gap.** A lunge taken out
  of the gap would shorten it by exactly the depth on exactly the frame the
  damage figure appears — and the deepest boss in the game hits hardest, so the
  Garbage Collector's four-digit hits would have arrived as `♥-1.2` while a
  kobold's rendered in full. Instead a boss that reaches further *stands*
  further back (`monsterStandoff`), so every monster closes to the same gap on
  its impact frame. `MAX_RECOIL` and `MAX_MONSTER_BACK` are now derived over
  every depth as well as the shared script; neither actually grew
- **The finding, which was not the expected one.** Because the standoff makes
  the impact frame identical across bosses, depth carries *no* information on
  the frame you are most likely to catch — the HUD redraws about once a second
  over a six-frame blow. What it does instead is make the standoff permanent and
  always on screen: the hero visibly keeps five more columns from the Garbage
  Collector than from a kobold, and crowds The Unindexed, whether or not anything
  is swinging. That is a better read than the motion was going to be, and it is
  the half a hand-drawn frame sequence would *not* have delivered. So the answer
  to "does this make the full version unnecessary" is no — but it moves what the
  full version is for, from "bosses hit differently" to "bosses hit differently
  *once you are already looking*", which is a much smaller claim on the budget
- **Tests:** 3 new in `sprites.test.js` (every depth belongs to a boss and every
  boss has one; a scaled swing obeys every invariant the shared script does,
  including the two no-scale rules; reach and hold each demonstrably do
  something, and something different). In `statusline.test.js` every
  displacement test now runs against a boss *and* a monster with no depth —
  because the failure a per-boss depth introduces is not "the boss doesn't lunge
  further", it is the 22 monsters that have no depth quietly acquiring one — plus
  the truncation case stated as the thing you would see, and the deepest boss
  added to the right-edge trim test, since a standoff raises the monster's floor
  column and that is the clamp that fights the right-hand edge
- New demo scene `heave`, which is only legible next to `struck`: same
  animation, same reach, and what separates them is standoff and one held frame

### The monster gets a swing, and a reason to flinch (2026-07-29)

- **Found in play: some monster blows were drawn as nothing at all.** `test_fail`
  and `bash_fail` called `hurtHero` and stopped there, never touching the anim
  queue — so a failing test took HP off the bar and put nothing on screen. The
  only monster blow the scene had ever drawn was the counter, and that one
  borrows the hero's animation to show a number in the gap. One combatant was
  scripted frame by frame; the other stood still through its own blows and
  through yours
- **The two halves were one design problem.** "What it looks like when a monster
  hits" and "what it looks like when a monster *is* hit" share the impact frame,
  the corpse path they both have to not fight, and a right-edge reserve the
  layout had never needed — because until now nothing on the monster's side of
  the scene moved. They landed together and are ~40 lines of script between them
- **Displacement, not art, for all 28.** `monsterAttack` is one six-frame script
  (wind up two cells, lunge three, recover) and `MONSTER_FLINCH` is three frames
  of knockback, both applied to whatever sprite is standing there. One sign
  convention — positive is toward the hero — covers a lunge, a recoil and a
  flinch. Per-monster attack art stays deferred to the boss item in `todo.md`,
  which is what the six bosses are actually for
- **The mark is `gapMarks` run backwards**, with the head starting against the
  monster and the trail streaming out to its right. Its glyphs (`◄╍`) are
  deliberately ones nothing else draws: monsters face left, so ◀ is the obvious
  head and half the roster already wears one as a maw — a mark built from art
  glyphs reads as a piece of the monster that came loose, and is untestable
  besides. `sprites.test.js` holds the whole set apart
- **`♥-N`, not `↩-N`.** The counter's arrow means "in answer to yours" and an
  unprovoked blow is not one. `♥` is the glyph the vitals line already spends on
  HP, so the new mark needed no new vocabulary
- **The flash is yellow because both combatants share a line.** A struck monster
  lights up in the colour of the damage figure hitting it — and *not* red, which
  in the big HUD is drawn on the same physical rows and already means "the hero
  is taking damage". Colour is also the only half of the flinch that survives the
  compact HUD, where two cells of shift on a 3-cell sprite is not legibly motion
- **Two things that had to be derived rather than written down.** `MAX_RECOIL`
  now folds in the hero-knockback the monster's script applies, so the left
  margin cannot be outgrown by a blow the hero didn't throw; and
  `MAX_MONSTER_BACK` is its right-edge counterpart — a different kind of edge,
  where nothing throws and `R.fit` just trims the line, so a knocked-back boss
  quietly loses its last columns. Both are computed from the scripts
- **The gap is measured to where the monster is *drawn*, not to its mark.** A
  lunge closes the gap it is reaching across, and marks measured against the home
  column get butted aside by `row.put` on exactly the two art rows that carry
  them — a shear, not a collision, and it looks like bad art. The nameplate goes
  the other way and stays on the mark, so it doesn't shuffle under a reeling
  sprite
- **Compact hangs the monster's mark from the monster.** It ignores `flightCol`
  by design (mark and figure share one row), so travel is carried by the trail
  lengthening — which makes *which end it grows from* the only thing left saying
  which way the blow is going. Pinned to the hero it read as a blow that had
  already arrived a frame before it was thrown
- 17 new tests (`sprites`, `engine`, `statusline`) and a `struck` demo scene; 330
  pass. The engine tests pin the figure to the HP that actually came off — the
  knight halves incoming damage after the caller hands over its number — and that
  a killing blow leaves the death banner rather than `♥-0` under a corpse-to-be

### The swings that miss (2026-07-29)

- **A dodge needed something to represent, and the roll was already there.**
  `retaliate` rolled one number and either countered or returned in silence, so
  ~70% of hits had no tell at all. The roll is now read three ways: under the
  threshold the monster connects, in a 20-point band above it it swung and
  missed, above that it never swung. No new roll, no damage prevented
- **The band is the whole design decision.** Narrating every non-counter as a
  dodge was the obvious version and the wrong one — at 70% of hits the hero is
  perpetually mid-lean and the animation stops meaning anything. A fifth is often
  enough to see in a session and rare enough to still read as an event, and the
  silence that remains is honest: most of the time nothing happened
- **Proven, not asserted, to be free.** The claim that this changes no balance
  rests entirely on the RNG stream being untouched, so a test pins that
  `retaliate` draws exactly one number down every branch, and `test/sim.js`
  prints byte-identical output with the feature on
- **The dodge is a lean, not a pose.** Per-row displacement — `[2,2,1,0,0]`,
  deepest at the head, nothing at the feet — applied on top of whatever attack
  frame the class was already holding. Which means it costs no per-class art and
  a fifth class cannot forget to draw one. It is also, deliberately, the exact
  shear every sprite in the file is drawn to avoid: rows coming apart on a
  gradient reads as a body bending, rows coming apart at random reads as broken
  art, and the difference is only ever the gradient
- **Colour carries what happened to you, the gap carries the verdict.** Red wash
  for a blow taken, dimmed afterimage for one slipped, `↩-7` or `↩ dodge` in the
  counter's slot. `MAX_RECOIL` now sums the lean onto the script's own recoil
  over exactly the frames where they can coincide (5 cells, from the wizard),
  so the deepest case still clears the left edge at 60 columns
- **Blood beats a dodge on a coalesced record.** A burst folds into one hit anim,
  so a near miss and a landed counter can reach the same one; a frame showing the
  hero shrugging off a swing it actually took is a lie. Enforced in the engine
  and again in the renderer
- 298 tests green

### Every class swings, and getting hit shows on the hero (2026-07-28)

- **Three classes were standing still through their own attacks.** The ranger
  had a scripted shot; wizard, knight and rogue fell through to the generic mark
  crawling out of the gap, so three quarters of the roster fought by growing a
  dash. Each now has poses and a script: the wizard gathers `·★°` into `◇◆◇` and
  is thrown back three cells by the discharge, the knight steps *onto* a raised
  sword and sweeps it through 90° coming off it, the rogue cocks its dagger and
  throws it. Whatever leaves the sprite is what crosses the gap — the star, the
  dagger, the arrow. The knight is the deliberate exception: it never lets go, so
  the `≫` is a shockwave and the sword stays in the art
- **`back` reads two ways, and that was the useful discovery.** For the two
  classes that throw something it is a flinch (deep in the middle, recovering at
  the end); for the two that swing it is the wind-up step, so the blow frames sit
  at the mark and the hero *gains* ground exactly as the blade comes over. One
  field, opposite readings, no new machinery
- **The poses had to be drawn on the rendered grid, not on the source lines.**
  The idle art is ragged and each row is nudged right by half its shortfall,
  while a padded pose row is not nudged at all — so the first draft of the knight
  put the crossguard one column left of the fist it had just been in, and the
  sprite twitched on the frame the pose was held. Same fixed-point trap as the
  sprite-centring note further down this log, one level up. Solved by dumping the
  rendered grid and drawing against it; `statusline.test.js` now pins the fist,
  the staff and the dagger across every pose the same way
- **Taking a hit is now a colour, not a number.** The counter-swing's `↩-N` was
  the only sign the monster had hit *you*. The hero is now washed red from the
  frame the blow lands to the end of the animation, alternating two reds so a
  once-a-second redraw reads it as a flash rather than as a hero who is simply
  red. A flinch *pose* was the obvious alternative and the wrong one: it would
  need authoring against each of four attack scripts and would fight the recoil
  those scripts are already applying
- **Found by the new tests, not by looking:** the wizard's `☆ﾟ.*` projectile was
  five cells wide, which was fine for as long as nothing moved it — a scripted
  shot anchors the mark to the projectile's *position*, so `R.fit` ate the star
  at the far end of the flight and left `━━━…` pointing at nothing. It is now the
  same `★` that sits on the staff tip, and the flight maths reserves the head's
  width so no future projectile can be clipped either
- `bin/demo.js` gained a scene per class (`hit` wizard, `swing` knight, `throw`
  rogue, `loose` ranger) and moved its sample frame to 3, where every class lands
  its blow — before, it sampled a frame where the damage number had not appeared
- 275 tests green

### A goblin can't wait behind a closed laptop (2026-07-28)

- **The real gap was not the missing summary line, it was the frozen deadline.**
  Away progress is abstract — `applyTime` awards N kills without touching the
  monster — so a goblin standing on the field when the lid shut was still there
  on return with its patience untouched. Closing the laptop mid-goblin suspended
  the clock, and "get it before it runs" stopped being true the moment you
  stopped looking
- **Away kills now spend patience the way folded events do.** They are the away
  window's unit of work, so they are what the deadline is denominated in there.
  An hour away costs a tick; a full eight-hour window outlasts any goblin
- **An away escape grants no boss progress**, unlike a live one. A live goblin
  that flees is credited because it stood in the vanguard's place and ate the
  same stretch of clock — but an away window is documented as granting none at
  all (`OFFLINE_REWARD_FRAC`: "no loot, no boss progress"), so there is nothing
  to pay back and crediting it would smuggle progress out of a window defined
  not to give any
- **One piece of news, not two.** The escape is folded into the `idle` banner
  (`⌛ while away: 46 kills +2.1kxp +890g · a goblin got away`) rather than
  queueing its own frame behind it — the player was not present for either
  event, so they are one report about the same absence
- **Four tests**, including the two that matter in opposite directions: a long
  absence must lose the goblin, and a short one must cost patience without
  crying wolf in the summary

### The goblin runs (2026-07-28)

- **The deadline is counted in folded events, never in seconds.** A wall-clock
  timer would be the only thing in this engine whose outcome depends on when you
  happened to look, and `fold` exists precisely so that replaying the same events
  lands where the live run did. The goblin carries a `patience` counter that ticks
  down once per folded event it survives; at zero it leaves
- **`patience` rides on the monster, not on the save's top level**, so it cannot
  outlive the goblin it belongs to and flee the *next* one early
- **The fold loop holds the monster it was facing across the event.** `dealDamage`
  can kill and respawn inside a single event, swapping `state.monster` underneath;
  without the identity check a freshly spawned goblin would be billed for the
  event that killed its predecessor and start a tick short. Pinned by a test
- **10 events, measured rather than guessed.** Escape rates over six seeds × 90
  days, by how well the hero is kept up: at 8 events an attentive player loses
  19.2%, at 10 it is 5.9%, at 11 it is 3.9%, and at 14 the feature never fires at
  all. A hero who never opens their inventory loses 50.7% at the same setting.
  That spread is the design: the deadline is a DPS check, so gear is the whole
  defence and falling behind is what makes goblins start getting away
- **Fleeing costs the prize and nothing else** — it still credits the boss cycle
  exactly as a kill would, because it stood in the vanguard's place and ate the
  same stretch of clock. Charging the boss cycle as well would make a fled goblin
  strictly worse than the trash mob it displaced, which is the tax this feature
  was built not to be
- **The death gate needed twenty seeds, not eight.** The eight-seed fix from the
  previous entry was an improvement and still not enough: it left a standard
  error of ±0.33 deaths against a threshold only ~0.35 away, so it kept flipping
  on changes that moved the true mean by nothing. Twenty brings that to ±0.23 and
  clears every configuration — 20 days with no goblin, 17 with one that never
  flees, 24 with the shipped one. The whole gate suite still runs in 0.45s

### The loot goblin, and the balance gate it exposed (2026-07-28)

- **A sub-boss that turns up in place of trash, 5% of non-boss spawns.** ×3 HP,
  ×3 XP, and one payout in one of two arms: a slug of gold at ×8 this monster's
  own `killGold`, or a guaranteed epic at this monster's own ilvl. Never both —
  two prizes makes the second one the expected outcome and the goblin stops
  being a coin-flip you look forward to
- **Every number is a multiple of what that spawn would have been**, which is
  the safety property the todo asked for: a goblin met at Lv8 in the Grove pays
  Grove rates, so the prize is a *rarity* windfall and never an ilvl one. The
  failure mode being designed out is a low-level hero holding Null-tier gear
- **The boss always wins the roll**, and the goblin draws the same three rolls
  off the rand() stream as the trash it replaces — so a fold replays identically
  whether or not one turned up. Both pinned by tests
- **It credits boss progress ×3, not ×1, and that was measured rather than
  guessed.** Crediting one kill for a three-kill fight looked fair and wasn't: a
  controlled A/B (same stream, `GOBLIN_CHANCE` 0 vs 0.05) put 90-day boss kills
  at 65 without and 56 with — a 14% cut, which showed up downstream as a 36%
  smaller upgrade sink, because bosses are the gear engine. Crediting
  `GOBLIN_HP_MULT` restored it to 65 exactly
- **The gold arm turned out to be economically neutral at ×8** — total gold
  earned moved 0.5% — because the slugs almost exactly offset the kills lost to
  the extra HP. It makes income lumpier without inflating it, which is the right
  outcome, and it is why the sink gate never moved
- **It bites, because the sim proved a riskless goblin breaks the pacing.** As a
  fat trash mob with a prize, the attentive hero over-geared and stopped dying.
  Retaliation now sits between trash and boss (0.40/1.0 against 0.30/0.45 and
  0.45/1.6), and since the fight lasts ×3 as long, total exposure is roughly
  nine times a trash mob's
- **The death gate was a coin flip, and had been all along.** It asserted a ratio
  over a single-digit death count from one hardcoded seed. Across eight seeds an
  *unchanged* engine produces 2,1,3,2,3,0,2,0 deaths — it fails its own gate
  three times in eight, and was passing on `0xC0FFEE` by luck. Any change that
  moved the stream re-rolled the coin, and this one lost. Fixed by averaging the
  gate over eight seeds, where the mean is stable to a tenth of a death: it now
  reads 27 days with goblins disabled and 21 with them on, both inside 4-30.
  Worth stating plainly — **the goblin makes the hero die *more*, not less**
  (mean 1.63 → 2.00 across those seeds). The single-seed gate said the opposite

### The shelf stopped advertising things you can't use (2026-07-28)

- **The same disease as the bag, on the buying side.** `rollStock` rolls ilvl
  uniformly over the zone span and never looks at the hero, so a Grove shelf
  could list a byte-identical copy of the equipped weapon at full price and put
  a SALE tag on an i1 the hero out-classes twelvefold. Reproduced exactly: at
  Lv9 in rare i7, three of five offers were dead
- **Fixed at the listing, not the roll — deliberately.** Option (b) of the three
  in `todo.md`. The roll stays blind to the hero, which is what keeps the shelf a
  hunt instead of a vending machine and keeps it identical for two players in the
  same grove in the same window. What changed is that a dead offer now *says* so:
  `· you are wearing this` for an exact tie, `· worse than worn` below it
- **SALE is stripped from anything dominated; the discount itself is not.** A
  discount is a reason to look twice, so hanging one on a strictly-beaten item
  aims the eye at the worst line on the shelf — the single most expensive
  mistake the listing can cause. The price stays cut, only the flourish goes
- **`worthKeeping` did the work**, the same predicate the drop filter uses an
  hour earlier — so the shop, the drop filter and `equip best` cannot disagree
  about whether a thing is worth having
- **A wholly dead shelf now says so**, because five grey lines otherwise read as
  "you can't afford any of this". Banking the gold is a real move and the shelf
  rerolls in 4h
- **The buy confirmation stopped lying too.** It said "/hero equip to wear it"
  for every purchase, which is false for a dominated buy — `equip best` ranks it
  below what's on and leaves it in the bag, so the player would run the command,
  watch nothing happen, and go looking for the bug in the wrong file
- **Seven tests**, including the one guarding the property the fix is built to
  preserve: two heroes with opposite gear still see the same five offers

### The bag stopped being a chore (2026-07-28)

- **Loot is judged at the door, not on overflow.** An inventory cap exists to
  make the player choose which of two good things to keep — but in an idle game
  the player isn't there when the bag fills, so no choice ever happened. The
  engine just resolved it, and resolved it on rarity, which isn't what makes an
  item good here: ilvl is. A `[legendary] i1` trinket sat protected while an
  incoming `[common] i13` weapon — a real upgrade — pushed something out. Now
  `rollLoot` asks `worthKeeping()` before bagging anything: does this fit an
  empty slot, or beat the **weakest** item worn in its slot? Weakest, not best,
  because a ring only has to out-rank the worst of three to earn its place.
  Everything else goes straight to the merchant with a ticker line
- **The comparison is `itemValue`, the one `equip best` already trusts.** No
  second opinion about what "better" means — a bagged item and a worn item are
  ranked by the same function, so the filter and the auto-equipper can never
  disagree about whether something was worth carrying
- **Vendoring on the spot is safe because worn gear is static.** Nothing about
  levelling makes a bagged item catch up to one it already loses to, so a "no"
  is permanent rather than "not yet". That's the property that makes this a
  filter and not a gamble
- **The cap survives as a backstop, and now evicts on value too.** It is close
  to unreachable from drops alone; shop buys are the realistic way to fill a bag
  now. `equip best` still displaces into the bag and still never sells — the
  undo promise in the skill doc is intact — so a long unattended stretch can
  still leave worn-and-replaced gear sitting there. That's the one remaining
  path to a full bag, and it holds only gear you actually wore
- **Five tests**, including the one that matters: over 400 drops, every item
  left in the bag either still beats something worn or was worn once and got
  displaced. A drop that is neither slipped past the filter

### Security review — issue #1 opened and closed (2026-07-28)

- **An adversarial pass over trust boundaries, supply chain and game integrity**,
  filed as issue #1 with eight findings graded up to High. Three survived
  checking against the code and are fixed in `604a0d3`; the rest were rejected
  on the record in the closing comment rather than quietly dropped
- **Hero name sanitization.** `--name` went into the save raw and out to the
  terminal raw, and `render.visible()` strips only SGR `\x1b[…m`, so a `\x1b[2J`
  survived the width math and reached the terminal. `newState` now strips C0, DEL
  and C1 (U+009B is a bare CSI on its own), caps at 24 code points so the cut
  cannot land mid-surrogate, and falls back to `Hero`. Not a security fix — you
  are the only person who can name your own hero — but a stray escape renders as
  a broken status line rather than a broken name, which sends you debugging the
  wrong file. `init` also stopped echoing the raw argument, which was printing the
  one string we had just decided not to print
- **Lock liveness, adopted in the opposite direction to the recommendation.** A
  lock whose owner has *exited* is now stale on sight instead of waiting out
  `LOCK_STALE_MS` — it cannot be mid-write if the process does not exist. But the
  literal suggestion (never break a live process's lock) trades a 10 s hiccup for
  a game that never folds again, so the timeout stays as the backstop for the
  alive-but-wedged case. Fail-open is the rule everywhere else in that file
- **Orphaned staging files.** Better evidence than the issue gave: `paths.js`
  exported `tmpGlobPrefix` and *only the tests ever used it* — the cleanup was
  designed and never landed. `tryFold` now reaps them under the lock, and only
  where `kill(pid, 0)` proves the owner gone, so a live writer's staging file
  stays untouchable
- **What the save holds is now documented** rather than changed. `state.repos`
  keeps an absolute path and a tracking SHA per repo, which amounts to an
  inventory of the projects on the machine — and is also the only reason a push
  made outside Claude's tools is detected at all. Local-only, no network, but
  worth saying out loud
- **Rejected: the two High findings are the same finding twice, and neither is a
  defect.** Both reduce to "after installing a hook, the hook runs", which is the
  feature, and "a compromised `main` gains code execution", which is true of every
  hook, dotfile repo and postinstall script. The recommendations (pin-to-commit,
  hash checks, signed releases) are advice for consumers of a *distributed
  artifact*; this is installed from a local clone by the person who wrote it
- **Two corrections.** The dedup observation was backwards — `isOurHook` matches
  on the path *suffix* (`bin/settings.js:73-74`) so it catches every clone
  regardless of location, and `doMerge` collapses all matches to one and repoints
  it, which is the exact case it was written for. And "PowerShell tool
  invocations aren't classified" describes a tool that does not exist
- **The one question left open** is what `allowed-tools: Bash(node …/rpg.js *)`
  actually permits — a prefix match against a string bound for a shell. Tested
  the same day and the result was about the method: the run had no control, so it
  measured the session's permission mode rather than the wildcard. Tracked in
  `todo.md` with the retest design
- 14 new tests (**191 total**)

### Carried debt — all four items closed (2026-07-28)

- **The four things the W1 review deferred rather than fixed**, cleared together
  because each was small and none was getting smaller. 192 → 225 tests
- **Settings writes no longer widen a hardened file.** `writeSettings` is
  create-then-rename, so the mode that ends up in place is the temp file's, not
  the user's: a `settings.json` hardened to 0600 came back at the umask default.
  That is a silent permission widening on the file naming every executable Claude
  Code runs, as a side effect of an unrelated merge. Now stats the live file and
  re-asserts its mode on the temp before the rename. Two details worth keeping:
  a temp left by a crashed run is `rm`'d first, because `mode` on `writeFileSync`
  applies only on create and the settings body would otherwise sit at a
  predictable path under stale permissions; and a *new* file still takes the
  umask default, since preserving a mode the user chose and picking one for them
  are different decisions and only the first was the debt
- **The balance sim runs under `node --test` now.** `assertBalance()` printed and
  called `process.exit`, so its twelve checks — does a heavy day reach the cap in
  40-120 days, do all three equip profiles finish, does the gold sink absorb the
  gold — only ran when someone typed the command by hand. The one thing in the
  repo that can tell you a tuning change made the game unwinnable was the one
  thing not gating a commit, and `lib/balance.js` is full of numbers that get
  nudged casually. It returns its results now; the CLI keeps printing and exiting
  on them, and `test/balance.test.js` makes each check its own case so a failure
  names the property. Unconditional because it is ~0.25s and deterministic —
  fixed seed, fixed epoch. Verified by moving `LEVEL_CAP` 60 → 90: three checks
  fail, naming the sink and the death cadence
- **The hook fixtures are used by a test.** Seven recorded Claude Code payloads
  had sat in `test/fixtures/` since v1 with only `install.sh` reading one of
  them. They were the repo's only record of the shape Claude Code actually sends,
  and nothing checked `lib/classify.js` still understood it — a payload change
  upstream would have surfaced as the hero quietly never levelling again, because
  the hook fails open and says nothing by design. `test/hook.test.js` runs each
  fixture through `classify` for the mapping and through the real hook binary for
  the whole chain, plus the two properties that keep this game out of the user's
  actual work: stdout stays empty, and junk input exits clean
- **The developer path is out of `docs/PLAN.md`.** It described the skill
  frontmatter with an absolute `/Users/eva0012/…` where the template has
  `{{REPO}}` — stale as well as leaky, since the installer does the substitution

### Found in play — the counter-hit drew before the blow (2026-07-28)

- **Reported from the statusline: the monster's blow appeared to drive the
  ranger's shot** — bow draw and all — when nothing the hero did should have
  been firing. Two candidate causes were logged with it; the honest answer was
  neither of the guesses and cheaper than both
- **The engine was never wrong.** `retaliate` is reachable only from
  `dealDamage`, which enqueues the hero's `hit` immediately before it — so a
  counter with no attack behind it is not a state the engine can reach, and the
  folding of a counter into the hero's anim (`engine.js:543`) is sound. What was
  wrong was drawing order: in `gapMarks`, `dmg` waited on
  `frame >= sprites.hitFrame(cls)` and `counter` waited on nothing. So on any
  answered blow the monster's `↩-N` was on screen from frame 0 — while the
  ranger still stood at its mark with a nocked bow, three frames before its own
  `✦-N`. The reply preceded the blow, and the eye supplied the causality
- **Both numbers now wait for impact.** One shared `landed` gate. That the fix is
  a two-line change is the point: the symptom read as an animation-system bug and
  drew a plausible pair of theories about counters lacking frames of their own,
  when the ordering was the whole of it. Worth reading twice before rebuilding
  anything the next time a scene lies about cause
- Guarded by *the counter-hit waits for the blow it is answering* in
  `test/statusline.test.js`, which asserts no `↩-` on every frame before
  `hitFrame` and its arrival on that frame — verified to fail at frame 0 against
  the pre-fix renderer. Full suite 192 pass / 0 fail
- **Left open, and separate:** `test_fail` and `bash_fail` call `hurtHero`
  directly with no `enqueue` at all, so those monster blows cost HP and draw
  nothing whatsoever. That is the "mob hit with no hero attack behind it" case
  the report guessed at — it exists, it just isn't what was seen. Carried to
  `todo.md` rather than folded in here, because giving it a frame means deciding
  what a monster attack animation *is*

### Found in play — travel, and the kill scene (2026-07-28)

- **Travel is automatic now.** Beating a zone's boss unlocked the next zone
  and then said nothing that lasted: a 6s banner and a ticker line that
  scrolls off in three events. The standing nudge (`statusline:99`) waits for
  `level > zone.max + 2`, so after a first clear at level 8 the game knew the
  Caves were open and stayed quiet for four levels — while the Grove re-armed
  Rootfang, making "farm a boss you already beat" the default path
- The trigger is **unlocked *and* at the new zone's level floor**, not the
  boss kill. The boss gate opens at `boss.level - 1` and the next zone starts
  one above the boss, so on a first clear you are *always* two levels short —
  switching on the kill would drop every hero into a zone under-levelled,
  every time. Never fires mid-boss either: past the first clear that is a
  re-armed boss the player chose to fight
- This is the rule `test/sim.js` had been playing by all along, in its own
  copy at the day boundary — so every number the sim asserts already
  described it. Moved into the engine and the sim now plays the real one,
  same call as `E.autoEquip` in v1.4. Twelve gates hold: cap day 45 → 44,
  deaths one per 23 → 22 days, boss cadence 3.3 → 2.4 days (bosses arrive
  sooner because zones do), sink 515k → 455k
- `E.travelTo` is now the single path for typed *and* automatic travel, which
  surfaced a real divergence: `killsSinceBoss` is one global counter meaning
  "kills toward the boss of the zone I'm in", and `/hero zone go` carried it
  across the border. Since `monsterLevel` reads it to escalate trash, walking
  into an unseen zone with a full counter spawned its *top* tier on the first
  step — precisely the cliff the v1.3 escalation curve exists to remove
- 6 new tests + a `travel` demo scene (161 total), since a banner branch that
  fires once per zone is exactly what the demo exists to cover

- **The kill scene ran in the wrong order.** Reported from the statusline:
  killing a monster showed the *next* one first, then the death of the last
  one, then back. `resolveKill` spawns the replacement immediately
  (`lib/engine.js:441`) — it has to, the next attack needs a target — but the
  1500ms `hit` anim for the killing blow and the 2500ms `kill` anim after it
  both play *past* that swap, and the HUD read `state.monster` every frame.
  So the fatal blow landed on a monster that had never been in the fight
- Fixed by pinning the corpse to the animations that are about it: the
  killing blow, the death, and the boss celebration all carry a `mon` copy,
  and the HUD prefers it to `state.monster`. Deliberately *not* by delaying
  the spawn — the anim queue is a render detail and the fold reducer should
  not be waiting on it. Non-fatal hits stay untagged so ordinary combat adds
  nothing to the save
- `bossdown` now holds the corpse on the field for its 6s too. It was
  flipping back to a live sprite under a "DEFEATED" banner, which is the same
  bug wearing a hat
- 5 new tests (155 total), verified to fail against the old files — 2 on the
  engine invariant, 3 on the rendered scene

### EOW W1 review — all findings closed (2026-07-28, base 6ad9607)

Two criticals were fixed during the review, not filed: the shared-tmp save race
(`lib/paths.js`) and the NaN death spiral (`lib/engine.js`). Both have regression
tests that were verified to fail without their fix. The rest:

- **W1-EOW-dogfood-blind** — `lib/classify.js` dropped classification for
  *any* command whose text contained `idle-claude-rpg`, so working in this repo
  earned no XP and sounded no War Horn. Replaced with `SELF_RE`, which matches
  our entrypoints as an invoked path token. The substring check turned out to
  be wrong in *both* directions: `node bin/rpg.js status` (relative path, no
  project name in the string) farmed XP freely, so the guard also failed at the
  only job it had. Both directions are now pinned by tests, and the hardcoded
  `/Users/eva0012/...` path is out of `test/classify.test.js`.
  Still open: the same developer path remains in `docs/PLAN.md:103`
- **W1-EOW-foreign-hook-clobber** — `bin/settings.js:41` decided a hook was
  "ours" by bare substring `c.includes('rpg-hook.js')`, so a hook belonging to
  another tool that merely had that string in its command was silently
  rewritten on merge and stripped on `--remove`. Ownership is now decided by
  *what the command runs*: `invokedScripts()` picks the first token of each
  `|;&`-separated segment that isn't an interpreter, a flag or a `VAR=value`,
  and the tail must be `hooks/rpg-hook.js` — directory included, since that
  layout is in every legitimate clone. Matching a path *token* was the first
  attempt and was not enough: `lint.js --ignore hooks/rpg-hook.js` is a
  perfectly good path token, and it took writing the test to see it
- The repair loop rewrote *every* stale entry in place rather than collapsing
  them, so two pre-existing entries became two byte-identical ones and the
  hero double-ticked — invisible, because a double tick is just a faster
  hero. Now every copy is gathered before anything is written, one is kept
  (an entry already pointing here, else the first stale one, repointed), and
  the rest go along with any group *we* emptied
- 4 new tests (150 total), each verified to fail against the old file:
  dedupe across separate groups and within one, and a `merge`+`remove`
  round-trip over two impostor commands that survives both untouched
- **W1-EOW-dmg-width-cap** — `gapMarks()` built the `dmg`/`counter` marks from
  raw values with no width cap. The base commit had `mid.slice(0, 24)` as a
  safety net; it was dropped when `row()`/`put()` landed. `engine.enqueue`
  sums rapid hits into one anim and counters sum onto that same record, so
  neither number has a ceiling and a catch-up fold can hand the renderer a
  mark wider than the gap it lives in
- The symptom is worse than "the line gets long". `row.put` butts overflowing
  text on one column late, and only the two art rows carrying marks are
  affected — so the monster **shears** rather than sliding, and it reads as
  bad sprite art rather than as a renderer fault. Big art is centred near the
  terminal midpoint, so `R.fit` never actually gets to truncate it away; the
  shear is the whole of the damage, and it starts at 9 digits
- The budget is now derived from the layout (`monLeft - gapLeft - 2`) rather
  than written down as a constant, so it cannot drift from `HERO_GAP` again.
  Compact shares one line between flight and damage, so it caps the pair
  together as well as each mark. Digits stay **exact while they fit** — damage
  is the one number you watch tick — and fall back to `R.fmt` when they don't,
  rather than truncating to `✦-1234567…`, which reads as a broken renderer
  instead of a big hit. `R.fit` sits under both as the floor
- 3 new tests (164 total): the missing `anim: hit` fixture — nothing exercised
  `gapMarks()` at all — plus two column-trueness regressions, big and compact,
  both verified to fail against the old file. They assert the monster art
  lands in the *same columns* as an ordinary 38-damage hit, since a check on
  line width alone is tautological: `R.fit` guarantees it and the bug survives
- **W1-EOW-destructive-cmd-tests** — the destructive CLI paths had no
  subprocess coverage: `sell all` / `sell <rarities>`, `upgrade <slot> max`,
  and `reset --confirm`. The `--confirm` gates were read and found correct,
  but nothing pinned them, so a refactor could drop one silently and the first
  person to notice would be a player who had already lost the thing. 6 new
  tests (170 total), run the way the commands are: a subprocess against a real
  save
- Each test asserts on the *save after the fact*, not on the printed preview
  — the gate that matters is the one that stops gold moving. `sell` also pins
  its deliberate asymmetry: `sell 2` names one line you just read off
  `/hero inventory`, so it goes through with no confirmation at all, while
  `all` and rarity words match a set you cannot see from the command
- Verified by mutation rather than by writing them red: replacing each gate
  with `if (false)` fails exactly the tests that cover it (sell → 2, upgrade
  → 1, reset → 1), and shortening `reset`'s unlink list to two of its five
  files fails on `events.ndjson survived the reset`. A save is spread across
  five files, and leaving the inbox or the lock behind hands the next hero the
  last one's queued events
- **W1-EOW-migration-untested** — the v1→v2 migration body had no direct
  test; coverage stopped at "fresh v2 round-trips" and "unknown version
  rejected". It is the one load path that fails *quietly*: a truncated file
  throws and an unknown version returns null, and both end at the backup,
  while a bad reslot returns a structurally valid save with a player's gear
  missing from it and the game plays on without mentioning it. 6 new tests
  pin reslot-by-noun, the no-noun legendary fallback, the stat re-roll onto
  the v2 curve, the hp refresh, the bag, and the collision branch that sends
  a displaced item to the bag rather than overwriting the winner
- Verified by mutating the migration rather than by writing them red: every
  one of the six behaviours fails its own test when removed (dropping the
  noun lookup fails three)
- **`state.bak` cannot be the pre-migration recovery point** and shouldn't be
  asked to: it refreshes on the first save more than 24h after the last, so
  the last good pre-v2 file can be gone within a day of the upgrade. Rather
  than tighten that window — the backup is doing its own job, against
  corruption, and shortening it costs a write per fold — `loadState` now
  keeps the *original bytes* as `state.v<n>.json` when it migrates. Written
  once, never rewritten, and never read by the game: it exists so a player
  who lost gear has something to go back to
- Which made `reset` a liar, since it promises "forever" against a hardcoded
  list of five files. It now deletes `S.saveFiles()`, which sweeps the spilled
  copies too — that also closes a pre-existing gap, since quarantined
  `state.corrupt-*` files were surviving a reset already
- 7 new tests + 1 extended (177 total)

Deferred, deliberately not filed as items: shop restock trusts the system clock
(accepted — offline local game, same trust model as offline progress); settings
writes don't preserve a hardened file mode; seven of eight hook fixtures in
`test/fixtures/` are never read by any test; `test/sim.js:213 assertBalance()`
never runs under `node --test`.

### v2.0 — the War Horn actually sounds, and installs work (2026-07-28)

- **`git push` is detected from git, not from the hook.** The classifier only
  ever sees commands *Claude* runs, so a push typed with `!`, made in another
  terminal, or made from an IDE fired nothing. Found the honest way: a save
  with 17 commits, 44 passing tests and `pushes: 0` after three real pushes.
  The headline feature of the README had never once fired for its own author
- `lib/gitwatch.js` reads the refs directly — no subprocess, no git binary
  needed. A push is "the remote-tracking ref moved **and** now equals local
  HEAD"; the second half is what separates a push from a fetch, since
  fetching someone else's work advances `origin/main` to a commit you don't
  have. Handles packed-refs (a `git gc` would otherwise blind it), worktrees
  and submodules (`.git` as a file), non-`origin` remotes, and subdirectories
- Wired into `state.tryFold`, not into either caller: it is the one place
  holding the lock, the loaded state and the write. The hook and the
  statusline therefore share **one recorded SHA per repo**, so whichever
  sees the change first fires and the other sees none — that shared record
  is the entire dedup, with no time window to tune
- One exception needed an explicit guard: a push Claude runs through the
  Bash tool produces *both* a classified event and a moved ref. Suppressed
  on the batch (`events.some(e => e.e === 'push')`) rather than on a clock,
  since the hook appends and folds in the same breath
- `state.repos` is bounded at 24 entries — a save follows the user across
  every project they ever open. First sighting records silently, so opening
  a new repo is never a free War Horn
- **`skill/SKILL.md` had the author's home directory baked in**, including in
  `allowed-tools`, which is a permission grant and cannot be relative. The
  installer copied it verbatim, so every other person on earth got a `/hero`
  pointing into a directory they don't have. Now a `{{REPO}}` template
  rendered by `bin/settings.js skill`
- **The repo's copy of the skill was also two versions behind the installed
  one** — `equip best`, the status nudge and the entire Insight board were
  written into `~/.claude/skills/hero/` and never made it back. A clone
  shipped a `/hero` that had never heard of half the game, and nothing
  failed, because a missing prose section reads like one that was never
  needed. `test/skill.test.js` now diffs the skill against the CLI's own
  command list
- Fixed a latent flake: the shop test demanded `restocks in \d+h \d+m`,
  which is wrong for one hour in every four
- 24 new tests (141 total), incl. gitwatch against **real** git repositories
  rather than fixtures — the module exists to read what git actually writes

### v1.9 — you can see it without installing it (2026-07-28)

- **`node bin/demo.js`** renders the eleven HUD states worth looking at —
  crit, boss intro, boss at a quarter health, boss down, level up, legendary
  drop, kill, death, offline return, capped-with-Insight, and a fresh Lv1
- Built for the screenshots a public launch needs, but it pays for itself as
  **coverage**: a legendary drop, a boss intro and a death are rare by
  design, so several `bannerText` branches had never been rendered by
  anything. Waiting for one to happen is not a test strategy
- Each scene is a synthetic save rendered by shelling out to the *real*
  statusline. A demo carrying its own copy of the layout would keep looking
  right long after the thing it stands in for broke
- Heroes are posed, not played — but `maxHp` comes from `E.refreshMaxHp`
  rather than a plausible-looking constant, and a test pins the capped
  scene's HP against what the engine actually derives. A screenshot quoting
  numbers the engine would never produce is a screenshot that lies
- **Found by looking at it:** the death banner printed a bare `-21594g`
  beside a vitals line reading `⛁ 410,300g`. Gold in banners now goes
  through `fmtGold` and xp through `fmt`, same as everywhere else
- 9 new tests (117 total), incl. every scene in all three layouts and the
  per-line-trim check applied to demo output too

### v1.8 — installable by a stranger (2026-07-28)

- **MIT LICENSE.** The repo was unlicensed, which for anyone who isn't the
  author means no right to use it — the single hardest blocker to publishing
- **`./install.sh --write-settings`** merges the hooks and statusLine into
  `settings.json` for you. Pasting JSON into the right nesting level of a
  file you may not have is where a first-time install actually fails, and
  the printed snippet asked every new player to do exactly that
- Default is still print-only, and deliberately so: `settings.json` decides
  what runs on every tool call in every session. The merge is opt-in, backs
  the file up first (timestamped, with a collision suffix — merge and
  uninstall land in the same second), and is idempotent
- **It refuses to take a status line you already have.** You only get one,
  and silently replacing a working one is the only move here that destroys
  work rather than adding to it. Hooks still go in; `--force` overrides.
  A half-install that ticks beats an aborted one
- Everything keys off the two script *basenames*, not exact command strings,
  so a re-run after moving the clone **repoints** the stale paths instead of
  appending a second copy. Moving the directory is this design's one real
  fragility and it fails silently — fail-open means no error anywhere
- **`--check`** is the doctor: node, skill, both hooks, statusLine, save,
  queue depth — ordered so the first `FAIL` is the thing to fix. Written
  against the support question a public release will actually get, which is
  "I merged the settings and nothing happens"
- **`--uninstall`** removes only our entries, leaving co-tenant hooks in the
  same group and a foreign status line alone. Round-trip to the original
  file is a test. The save is never touched
- The check's hero readout guessed `state.name`/`state.class` and printed
  "undefined the ?" against a healthy save — the fields live under
  `state.hero`. Pinned by a test that inits a real save and reads it back
- 16 new tests (108 total). The settings tests also stopped inheriting the
  developer's real `IDLE_RPG_HOME`, which they were reading through
- README: install/update/troubleshoot/uninstall rewritten, test count
  corrected 77 → 108, license section added. `HANDOFF.md` is now ignored

### v1.7 — the cap stops being a wall (2026-07-28)

- **Insight (paragon).** `engine.addXp` returned early above level 60, so
  every point earned at the cap was discarded and a capped hero had the loot
  chase and nothing else. XP past the cap now banks toward Insight, spent on
  three tracks: `atk` +2%/pt, `gold` +3%/pt, `drop` +2%/pt, 25 points each
- Deliberately **not** a prestige reset — level, gear, gold and zone are
  never touched. This repo's line on setbacks is that they have a way back,
  and wiping twelve slots you spent weeks filling, while you were looking at
  a compiler rather than at the game, is the opposite of that
- Rate is 40% of a cap-level per point (~3/day at the sim's 300 events/day):
  the first point lands within hours, and all 75 points take ~120 days past
  the cap against the 45 it took to reach it. A tenth of a cap-level was the
  first guess and maxed everything in 30 days — a tail no longer than the climb
- Tracks cap at 25 rather than running forever. An unbounded ATK multiplier
  eventually deletes the difficulty curve `monsterHitDamage` exists to keep flat
- **The sim now plays past the cap.** It used to `break` the moment it hit
  level 60, so the entire paragon curve would have gone untested. Three new
  gates: xp banks rather than evaporating, 30 days past the cap buys under
  three quarters of the board, and the board does finish by 150 days
- Post-cap deaths are 0 with paragon *and* 0 without it (1,124 boss kills
  either way) — the flat curve at the cap is pre-existing, not something
  Insight introduced. What Insight measurably changes is throughput: 29,609
  kills against 24,715 over the same 150 days
- The statusline read a flat `MAX` forever at the cap; it now shows the
  Insight bar filling and the count climbing, and is *narrower* than the
  pre-cap `[bar] 1,234/4,567` it replaces
- No save migration, same call as `plus`: `insight`, `capXp` and `paragon`
  are absent on every pre-v1.7 save and every read path defaults them
- 7 new tests + 3 sim gates

### v1.6 — gear you'd actually wear (2026-07-28)

- **Gear is named for the class that wears it.** Both the shelf and the drop
  table pulled their noun from one flat per-slot list, so a Ranger fired
  arrows out of a wand. Classes now carry a `nouns` override for the four
  slots where the name says something about how you fight — weapon, offhand,
  head, chest. Back, hands, feet, neck and rings stay generic
- Flavour only, and pinned as such: both callers roll slot/rarity/ilvl/stats
  first and read the noun off the class afterwards, and the shop seed stays
  `(zone, window)` with no class in it. A test diffs all four classes'
  shelves with `name` stripped across 12 rotations of every zone, so the day
  class leaks into the seed the shop stops being one shared economy
- Class nouns go into `NOUN_SLOT` alongside the generic ones — that map is
  what the v1→v2 migration reads an old item's slot off, and a noun a class
  can generate but the map doesn't know is unplaceable gear
- **`/hero equip best`** — the way out of the `equip all` trap below. Same
  ranking, allowed to displace; a superset of `equip all` since it fills
  empty slots too. No `--confirm`: it only moves gear between body and bag,
  so the worst case is one `equip <n>` to put something back
- `status` nudges, one line, in priority order: what the bag beats (exact,
  via `previewAutoEquip`), else worn ilvl against the zone's trash level
  (`gearLag`, empty slots counted as the zero gear they are). Both dead ends
  of `equip all` now point at `equip best` instead of shrugging — including
  "nothing fits your empty slots", which is the one that started this
- The nudge runs the *real* `autoEquip` against a throwaway facade rather
  than reimplementing its ranking. A second copy of "best `keys.length` of
  (worn ∪ bag), ties keep the worn item" would drift, and a nudge that
  disagrees with the command it recommends is worse than no nudge
- **Fixed a real bug the new count exposed:** promoting one ring into a full
  set of four reported *four* changes — the winner took `ring1` and shoved
  the three survivors down a slot each. Same gear worn, so it was invisible
  until a user-facing count depended on it. Survivors now keep their slot
  and newcomers take what's left
- 6 new tests; sim gates unchanged (attentive still dies every 23 days, sink
  still absorbs 515k). `equip:fill` still dies 238 times a run — that number
  is the trap, and the nudge is now the only thing in the game that says so

### v1.5 — gold has somewhere to go (2026-07-28)

- **`/hero upgrade`** — worn gear only, `+0…+10`, each `+` worth 2% of the
  item's rolled stats, costing `5·ilvl·(plus+1)²`. Quadratic on purpose: a
  full set at +10 runs ~1.16M, about a whole run's income, so you are always
  choosing which items to invest in. Sim: absorbs 515k, leaves 69k idle
  against the ~1.07M an attentive player used to finish holding
- The sink doesn't leak — `engine.sellPrice` ignores `plus` entirely, so
  upgrade gold is destroyed rather than being a 25%-refundable deposit.
  `engine.itemValue` *does* count it, so auto-equip never benches an item
  you poured gold into in favour of an identical raw drop
- `gearSum` totals all twelve slots **unrounded** and rounds once. At 2% a
  level a single upgrade is usually sub-integer (+2% of a def-11 chestpiece
  is 0.22), and rounding per-slot silently discarded nearly all of it — a
  set at +10 measured almost the same as a set at +0
- Power had to come down twice: at 5%/+ and then 3%/+ the attentive player
  stopped dying (40 days/death, outside the punctuation band), because every
  point of def/atk/hp makes bosses safer. 2% keeps the 23-day cadence *and*
  still absorbs the gold — the sink's appetite comes from the cost curve,
  not the reward, so it works even at 0% power
- Upgrading is deliberately poor value early (2% of a 3-point stat is a
  rounding error, and the same gold buys a whole rare off the shelf), so
  `upgrade <slot> max` previews the ATK/DEF/HP its spend would buy and says
  so outright when the gain rounds to nothing
- 6 new tests + a sink gate in the sim (gold absorbed > gold idle)
- No save migration: `plus` is absent on every pre-v1.5 item and every read
  path defaults it to 0, which is strictly safer than a migration that
  rewrites saves to add a zero

### v1.4 — death is punctuation (2026-07-28)

- **The balance sim never equipped anything.** It folded 83 days of combat
  with all twelve slots empty, so every figure it asserted — deaths above
  all, since mitigation keys off def — described a hero who fought
  Production naked. `E.autoEquip()` is now shared by `/hero equip all` and
  the sim, which replays three profiles: `upgrade` (attentive), `fill`
  (fills empty slots only, never upgrades), `none` (the old behaviour)
- Armour is a **ratio**, not a subtraction. `mLvl − def` was a cliff: a full
  set rolls def ≈ 1.0–1.2× ilvl and ilvl tracks monster level, so def
  crossed mLvl and every blow clamped to the floor of 1 — a geared hero was
  literally immune (1 death per 90 days) while a naked one ate the whole
  curve (198). Now `raw · mLvl/(mLvl+def)`: def equal to monster level
  halves the blow, nothing reaches zero, and mitigation holds near 50% at
  every level, so the difficulty curve is flat by construction
- **Losing to a boss drives it off** instead of restarting the fight. A boss
  reset to full HP on death, so a hero who couldn't win one could never do
  anything else either — the `fill` player died ~2000 times and never
  reached the cap. Forfeiting the approach costs the 15 kills that earned
  it, a setback you can work off
- Bosses counter *more* often than trash now (0.45 / ×1.6, inverting the old
  rule, whose whole rationale was the boss-reset wall). Trash is attrition
  regen outpaces; bosses are where death lives. Attentive player: one death
  per ~12 days. Gold loss stays 5% — see the economy note below
- 7 new tests (ratio-armour monotonicity, per-zone boss danger bounds, trash
  attrition ceiling, boss-despawn, trash-death isolation) + 2 new sim gates
  (death cadence, every profile reaches the cap)

### v1.3 — zones use their whole band (2026-07-28)

- Zones use their whole band. `spawnMonster` rolled `zone.min + rand()*4`
  clamped to `zone.max`, so `zone.max` was dead data: every zone spawned only
  its bottom 4 levels of 9 while its boss sat at the top. The Grove
  advertised "1-9" and never spawned above Lv4, then asked for a Lv9 boss.
  Trash now walks `min → max-1` as the boss cycle fills, so a zone escalates
  and the boss is one step up rather than a five-level cliff
- Boss progress is driven by kills, not hero level — a hero held by the level
  gate meets tougher trash, earns more XP, and clears the gate. The stall is
  self-correcting instead of a flat grind
- `engine.bossGate()` is one source of truth for the spawner *and* the
  readout. The status line used to say "Boss in 0 more kills (need Lv8+)" —
  true and useless, because the kill counter had been satisfied for 43 kills
  while the level gate silently held. It now names whichever gate is actually
  binding: "Rootfang the Ancient Treant stirs — 3 levels away"
- 4 regression tests (band coverage, escalation, gate/spawner agreement,
  readout honesty). Cap holds at day 83 @300/day; boss cadence ~3.0 days

### v1.2 — sprite art rewrite (2026-07-27)

- Sprite art rewrite: 5-row drawn silhouettes for all 4 classes + 29
  monsters/bosses, replacing the 3-row kaomoji-with-a-hat art. Big HUD is
  now 8 lines. Heroes face right, monsters face left; each zone has its own
  shape language (Archives rectilinear, Embers diagonal, Null corrupted)
- Big art restricted to single-cell glyphs (box drawing / blocks /
  geometric). The old art mixed two-cell kaomoji like `皿ᴥ`, which silently
  skewed every centred column in the battle scene
- Projectile/damage/counter marks anchor to the sprites' waistline derived
  from `BIG_ROWS` instead of hardcoded rows 0/1/2
- `test/sprites.test.js` — 6 invariant tests (exact row count, single-cell
  glyphs, width caps at the 76-col threshold, no trailing whitespace, full
  coverage of every monster in `content.js`)
- **Later follow-up, completed out of the backlog** (undated — it was ticked in
  place rather than logged, which is part of why this file now exists):
  **redraw the rogue's big art** — the `╲` on row 3 and `▼` on row 4 touched
  nothing and read as debris, the head was a bare `○`, and widths ramping
  7,6,7,8,10 leaned the figure. Redrawn hooded with the body on one axis and
  the dagger held high on the guard side: fist `▙`, crossguard `╪`, blade
  `╱ ╱` climbing one cell per row. Knight got the same treatment (sword wound
  back over the left shoulder, shield forward) and the ranger picked up a
  plumed cap and a quiver arrow. Two new tests in `statusline.test.js` pin
  both blades by slope, alongside the ranger's bow. The columns were solved
  rather than eyeballed — see the fixed-point note in the README

### v1.1 — monsters fight back (2026-07-27)

- Monster retaliation (~30% counter per hero attack; bosses rarer but harder)
  — before this, damage only ever came from *your* failed commands
- 3-line sprite art for all 4 classes + 29 monsters/bosses; monster centred
  on the terminal midpoint instead of pinned to the right edge
- Monster level shown in HUD and `/hero status`
- Width-aware layout (`R.width`) — kaomoji are full-width, combining accents
  are zero-width; code-point counts skewed every centred column
- 3 regression tests + boss-survivability gate

### v1 — built (2026-07-27)

- Engine: fold reducer, combat, XP curve (cap 60), loot (5 rarities), classes, 7 zones + bosses
- PostToolUse/Stop hook (zero tokens, fail-open, <100ms) + event classifier
- Statusline HUD: 3/2/1-line responsive, hit/kill/loot/level-up/boss/death/away animations at 1fps
- Concurrency-safe state: ndjson inbox + lock + atomic rename, daily backup, corrupt quarantine
- CLI (`bin/rpg.js`) + `/hero` skill (init via AskUserQuestion class picker)
- `install.sh` (skill copy + self-test + settings snippet; never edits settings.json)
- 29 unit tests incl. 8-process concurrency stress; balance sim gates pass
  (cap on day 81 @300 events/day; heavy week → Lv17)
- **Wiring (user action):** merged into `~/.claude/settings.json` — PostToolUse +
  Stop hooks and the `statusLine` key (refreshInterval 1, padding 0). Verified
  live 2026-07-27. Guardrail/secret-grep PreToolUse hooks were preserved alongside
