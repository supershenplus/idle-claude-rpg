# idle-claude-rpg — open work

An idle hero RPG that lives **inside Claude Code**, implemented as a JS hook.
Your hero grinds while you code: hook events are the game tick. Full design in
`docs/PLAN.md`.

**This file is what's left.** Finished milestones — every version, the W1 review
and the security pass, with the reasoning that produced them — live in
`BUILD-LOG.md`. Move an item there when it lands rather than ticking it here, so
this file stays readable as a list of things to do.

---

## Found in play — 2026-07-28

- [ ] **The monster's blow plays the hero's attack animation.** Reported from the
      statusline: the mob hitting back drives the *ranger's* shot — bow draw and
      all — when nothing the hero did should be firing. Logged unworked; the
      report is the finding, the cause below is a starting point and not verified
- [ ] Two sites make it plausible. A counter never gets an animation of its own:
      `retaliate` folds its damage into whatever `hit` is already on the queue
      (`lib/engine.js:543-546`), and the renderer decides the hero is attacking
      from `anim.type === 'hit'` alone (`statusline/rpg-statusline.js:148`). So a
      counter is drawn *through* the hero's attack frame, because that is the only
      frame it has. Worth checking whether the symptom is a counter riding a real
      hero attack, or a mob hit landing with no hero attack behind it at all —
      those want different fixes, and only the second is straightforwardly a bug
- [ ] Whatever the cause, the class that shows it worst is the one with a
      projectile: `test/sprites.test.js` already pins the ranger's shot across
      three widths, so the regression test has somewhere obvious to live

---

## Security — the one question issue #1 left open

- [ ] **Find out what `Bash(node {{REPO}}/bin/rpg.js *)` actually permits.** The
      one item from the security issue (#1, closed) that needs an answer rather
      than a patch, and the public close comment promises it is tracked. The
      skill frontmatter pre-approves that pattern, and a trailing `*` is a prefix
      match against a string that ends up at a shell — so the question is whether
      Claude Code splits on `;`, `&&` and `|` before comparing. If it does not,
      `node …/rpg.js status; <anything>` runs pre-approved
- [ ] This is a test, not a fix. Only if it clears does the wildcard need
      tightening — to explicit subcommands, or by moving arg handling somewhere
      the permission can bound. Note the closed issue framed this as "a malicious
      fork could edit SKILL.md", which is the wrong risk: a fork you installed
      already runs whatever it likes. The boundary worth knowing is what the
      *unmodified* skill hands out
- [ ] **Attempted 2026-07-28, and the result was about the method.** Ran
      `/hero status; echo pwned`. `pwned` printed — and that proves nothing,
      because the run had no control. Settings were `defaultMode: "default"` with
      no `Bash(node *)` anywhere in the allow list, so the `node` call should have
      prompted on its own merits before the `;` was ever reached. It didn't, and
      neither did anything else that session: `git commit` in this repo, `node
      --test`, an `rm -rf` on a scratchpad, none of them allow-listed. Something
      upstream of both the allow list and `allowed-tools` was permitting Bash
      wholesale, so the appended command succeeding measured the session mode
- [ ] The retest needs the control the first run skipped, and both halves matter.
      Fresh session, `default` mode, no bypass flag. **First** `/hero status`
      alone: it has to run *without* a prompt, which is what demonstrates
      `allowed-tools` is the thing granting permission — if it prompts, the grant
      is not in force and nothing after it is interpretable. **Then**
      `/hero status; echo pwned`: a prompt means the matcher splits on `;` and
      the boundary holds; silence means the wildcard spans shell operators.
      Without step one, both outcomes of step two have two explanations

---

## Known-carried debt

- [ ] The developer path `/Users/eva0012/...` still sits in `docs/PLAN.md:103`.
      It came out of `test/classify.test.js` during the W1 review and was never
      chased into the doc
- [ ] Deferred during the W1 review and still true: settings writes don't
      preserve a hardened file mode; seven of eight hook fixtures in
      `test/fixtures/` are never read by any test; `test/sim.js:213
      assertBalance()` never runs under `node --test`

---

## Backlog

- [ ] Two smaller sprite nits, both cosmetic and both long-deferred: `harpy` has
      a stray `▚` floating off the right wing, and `leech` is 8 cells wide where
      the rest of the set is 11-13, so it reads undersized next to its zone
- [ ] One-line sprites in `lib/content.js` are still the original kaomoji — only
      the 5-row big art was redrawn in v1.2, so compact and mini HUD modes never
      got the pass
- [ ] **Monsters don't react to being hit.** The hero side of a blow is now
      scripted frame by frame — `sprites.attacks` gives the ranger a release
      pose, a 3-cell recoil and an arrow that crosses the gap — and the monster
      just stands there through all of it. The only thing on screen that says
      the shot connected is the `✦-N` in the gap and the HP bar under the
      nameplate, so a landed hit and a whiffed one look identical. The impact
      frame is already known (`sprites.hitFrame(cls)`), so the timing is free;
      what's open is what a flinch *is*. Roughly in order of cost:
      (a) shove the whole sprite right a couple of cells on the impact frame —
      the exact mirror of the hero's recoil, one transform, works for all 28
      monsters and needs no new art; (b) flash the sprite (dim, or red) for one
      frame, which is the only option that also reads in the compact HUD where
      there is one row and no room to move; (c) hand-drawn hurt art, which only
      pays for itself on the six bosses. (a) and (b) compose and are probably
      the whole feature. Two things to watch: a knockback needs the same
      reserved-room treatment `MAX_RECOIL` got for the hero, but against the
      *right* edge, where the binding constraint is `R.fit` truncating the line
      rather than column 0; and it must not fight the corpse path — `kill` and
      `bossdown` already swap in `DEAD_MONSTER_BIG` and pin `anim.data.mon`, so
      the flinch has to end where the death begins
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
- [ ] **Guild / shared boss — abstract, unscoped, not a spec.** One boss, several
      people, everybody's work is the damage: your commits and mine land on the
      same HP bar, and the kill belongs to whoever was grinding. It fits the
      premise better than anything else on this list, because the game already
      says "your work is the tick" and a guild just makes the tick collective.
      Filed as an idea to think about, not a thing to start
- [ ] The reason it isn't a weekend job: **shared state is the whole feature, and
      this game has none by design.** Zero network calls and zero dependencies
      are load-bearing properties — they are why the security review came out as
      clean as it did, and they're advertised in the README. Anything with a
      server trades that away permanently, so the interesting question is how far
      a guild gets *without* one
- [ ] The on-theme answer is probably that **the boss lives in a git repo.** A
      shared repo is a shared filesystem everyone already has, already
      authenticated, already conflict-resolving; damage arrives as commits, the
      boss's HP is a file, and `lib/gitwatch.js` has most of the reading
      machinery. Merge conflicts on a hot HP counter are the obvious problem —
      the plausible dodge is append-only damage entries folded on read, one file
      per player, so two people never write the same line. No server, no account,
      no protocol
- [ ] **The part that actually needs deciding first is trust, and it invalidates
      an argument we already made.** Issue #1 raised save-editing and RNG
      predictability, and both were dismissed as game integrity only — you can
      already hand yourself a million gold, and the only person you cheat is you.
      That is a *single-player* argument and it stops holding the moment a second
      person's boss kill depends on your numbers. A guild would need damage the
      other players can check, from a save nobody can be stopped from editing,
      which is either a real anti-cheat problem or a deliberate decision that the
      guild is small and trusted and cheating is beneath everyone. Worth settling
      that before any of the fun parts, because it decides whether this is a
      weekend feature or a genuinely hard one
- [ ] Cosmetic titles from the shop; trinket special affixes
- [ ] Shop daily rotation (seeded by date+zone) + "Boss Drum" consumable to arm the boss early
- [ ] Heisenbug gag: sprite renders in a different spot each frame (it moves when observed)
- [ ] Per-session stats view
- [ ] Edit/Write `tool_response` schema is undocumented — revisit if a future
  Claude Code version documents per-tool line counts (we count from `tool_input`)
