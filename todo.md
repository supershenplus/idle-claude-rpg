# idle-claude-rpg — open work

An idle hero RPG that lives **inside Claude Code**, implemented as a JS hook.
Your hero grinds while you code: hook events are the game tick. Full design in
`docs/PLAN.md`.

**This file is what's left.** Finished milestones — every version, the W1 review
and the security pass, with the reasoning that produced them — live in
`BUILD-LOG.md`. Move an item there when it lands rather than ticking it here, so
this file stays readable as a list of things to do.

---

## Prestige — the one part of the roster spec that did not land

The roster shipped on 2026-07-30 (`BUILD-LOG.md`), which was always the
prerequisite: prestige, "switch character" and "restart" are one feature — *the
save is not the only hero* — and the other two are now policies on a primitive
that exists. What is left is the question the roster was supposed to make
answerable.

- [ ] **Re-ask whether it is still wanted, now that the roster exists**, because
      the thing people want from prestige is usually "play a Knight without losing
      my Wizard", and `/hero init` is that, in one command, for free. The honest
      remainder is narrower than the original ask: a *second run of the same
      class* that carries something forward. If it is still wanted: the README's
      standing objection (`Past the cap`) is to an *automatic* wipe imposed while
      you are not watching, and does not apply to an opt-in offer made at a moment
      you chose — but it does still apply to the wipe itself, so any version has
      to answer what carries over. Insight is the obvious candidate, as a
      meta-currency that survives resets
- [ ] **Do not balance it before someone has finished the game.** The cap is ~45
      days of regular use and nothing has reached it. Insight's numbers came off
      the sim; prestige's would too, but the sim would be validating a loop no
      human has played
- [ ] **Prerequisite either way: the Grove is the game's weakest hour** — still
      true, but for a narrower reason than this file claimed, now that it has been
      measured (see the corrected shelf items in the backlog). It is not that
      there is nothing to spend gold on; there is, and the sink eats most of it.
      It is that the Grove's *tail* thins out — useful offers fall to 1-of-5 while
      gold climbs to ~8.4k — and that a `+` is worth a fifth there of what it is
      worth from Caves onward. Prestige sends you back through exactly that
      stretch, and the first half of it is fine, which makes the fix smaller than
      it looked. Fixing it still helps new players, which is a far better bet than
      a fix that only pays off after 45 days

---

## Found in play — 2026-07-28

- [ ] **Bosses should get hand-scripted attacks of their own.** Still open, and
      now cheaper to judge: the depth pass landed (`sprites.BOSS_SWING`, see
      `BUILD-LOG.md`), so the keying question is answered — `monsterAttackFrame`
      takes an id and falls back to the shared script, the same
      `null`-means-generic shape `attackFrame` uses. What is left is the art:
      a wind-up pose, a signature projectile, and a recoil per boss, which is
      six hand-drawn sequences and a real budget. The ranger's took a solver to
      align, so cost that in
- [ ] **What the depth pass changed about the case for it.** Paying the depth in
      standoff makes the *impact frame* identical across bosses by construction,
      so at roughly one redraw a second over a six-frame blow, the depth is not
      what you catch — the standoff is, and that one is permanent and always on
      screen. Which means hand-drawn frames would be buying legibility on frames
      a viewer mostly does not see. The honest re-framing: per-boss art is worth
      it if you expect people to *watch* a boss fight rather than glance at it,
      and the way to find that out is to fight one and notice whether you did
- [ ] A smaller thing the depth pass surfaced and did not take: `hold` has
      exactly two settings, because a 1500ms blow is six frames and the script
      has to open and close on its mark. Every extra pose or beat the bosses
      might want runs into the same wall. Lengthening `mhit` for bosses only is
      one line in `engine.retaliate` and would need `MAX_HOLD` to stop being a
      constant — worth doing *with* the art, never before it

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
- [ ] **Settings half of the control is verified as of 2026-07-28 — don't
      re-derive it.** `~/.claude/settings.json` is `defaultMode: "default"` with
      empty allow *and* deny; `~/.claude/settings.local.json` has 26 allow
      entries and not one of them matches `node`; there is no project-level
      `.claude/settings.json` or `settings.local.json` in this repo. The
      installed `~/.claude/skills/hero/SKILL.md` carries the expanded absolute
      path, so `allowed-tools` is the only thing that could be granting the call.
      That means the *config* is already a valid control, and the session's
      permission mode is the sole remaining variable
- [ ] **It cannot be run by Claude, in any session Claude is already in.** The
      session that closed the carried-debt items ran `git commit`, `node --test`,
      `cp`, `sed -i` and `git stash` against this repo without a single prompt,
      none of them allow-listed — so the same wholesale-Bash condition as the
      first attempt was still in force, and any result gathered from inside it
      would have measured the mode again. Whoever runs this has to start the
      session themselves and watch for the prompt with their own eyes: a prompt
      that never appears is indistinguishable, from in here, from one that was
      auto-approved. The two commands go in as `! `-prefixed lines or as `/hero`
      invocations typed by the user

---

## Found by the redraw measurement — 2026-07-31

The frame-weighting fix landed (`BUILD-LOG.md`); this is the other half of what
the same logs showed, left undone on purpose.

- [ ] **A hit queues behind whatever banner is playing, and can be minutes of
      game-time late by the time it draws.** `enqueue` serialises: `at = max(now,
      last.at + last.dur)`. So a blow that arrives during a `kill` (2500ms) plus a
      `levelup` (5000ms) is scheduled after both. Measured in one 19-second window:
      a hit sat queued 6.5 seconds, and while it waited every further hit coalesced
      into it. What the player sees is a stretch where the hero visibly never
      swings, then one swing out of nowhere long after the work that earned it —
      which is the *other* half of "attack animations don't always render"
- [ ] The banners themselves are not the problem: during a level-up you want the
      level-up. The problem is that the hit is neither dropped nor merged into what
      is on screen, so it survives as a stale swing. Three honest options, none
      obviously right: **drop** a `hit` whose start would be more than ~2s out (the
      damage is already banked in state — anims are cosmetic — so this costs only
      the tell, and the ticker still reports it); **overlay**, letting a hit play on
      the sprites while a banner holds the text line, which is a renderer change
      rather than a queue change and is where the real fidelity is; or **leave it**,
      on the grounds that a delayed swing is better than no swing. Worth deciding
      with the sprites in front of you rather than from the queue code
- [ ] Note for whoever picks this up: the measurement method is cheap and worth
      repeating rather than trusting the numbers above. Append `Date.now()` and the
      anim queue to a scratch file at the top of `main()` in the statusline, drive a
      few tool calls, read the gaps. Both redraw rates in the build log came from
      about four minutes of that

---

## Backlog

- [ ] **The corpse is the one place the uniform one-line widths don't hold.**
      `DEAD_MONSTER` is 8 cells — trash width — so killing a 10-cell boss shifts
      the scene one column for the length of the kill animation, which is exactly
      the jitter the fixed widths exist to stop. Deliberately left: it is one
      cell, once per boss, under a flashing DEFEATED banner, and the big HUD has
      carried a far larger version of it since v1.2 (`DEAD_MONSTER_BIG` is 11
      against a 17-cell boss) without anyone noticing. The fix if it ever reads
      wrong is a second corpse at boss width, keyed off `mon.isBoss` at the two
      call sites — cheap, but it buys a frame nobody is looking at, and it wants
      the big-HUD half done at the same time or the inconsistency just moves
- [ ] **The right-edge reserve gives way before the hero's does, and only where
      it matters most.** `MAX_MONSTER_BACK` keeps two columns clear so a
      knockback is never trimmed, but the monster's floor column
      (`LEFT_MIN + MAX_RECOIL + heroW + HERO_GAP` = 34) wins when both can't be
      honoured. So the reserve holds down to 53 columns; at 52 a knocked-back
      boss loses a cell to `R.fit` on exactly the frames you hit it, and at 51
      and below the widest boss is already clipped standing still. Not reachable
      by accident (`hudFor` picks compact under 76, so it takes a pinned
      `RPG_HUD=big`) and the scene is over-constrained there anyway — 17 cells of
      boss, 13 of hero and a 14-cell gap don't fit. A note, not a bug. The
      honest fix if it ever bites is to narrow `HERO_GAP` under pressure rather
      than to clamp the flinch, which is the thing the hero's margin exists to
      avoid doing
- [ ] **The Grove shelf is legible now, but is it still worth *stocking*?** The
      listing fix landed (option (b), see `BUILD-LOG.md`) so a dead offer says so
      instead of wearing a SALE tag. That closes the trap and deliberately leaves
      the design question open: a shelf where three of five lines read `worse than
      worn` is honest, and still not much of a shop. Option (a) — roll ilvl against
      what the hero wears so every offer is at least a sidegrade — remains
      unchosen, because it turns the shelf into a vending machine and kills the
      "hunt the one good slot" read. Worth re-asking only if the tags make the
      Grove *feel* barren in play rather than merely look it; the effect is
      self-correcting once ilvl spreads widen past Cobalt Caves
- [ ] **The "nothing to spend gold on before zone 2" half of this was measured on
      2026-07-30 and is false** — the upgrade-legibility pass (`BUILD-LOG.md`)
      came out of checking it. Folding real Grove runs through the engine: the
      zone is ~25 hours at 300 events/day, the hero earns ~7k gold and the
      *existing* sink absorbs ~5.9k of it, and 100% of shelf offers are
      affordable by the time they leave. Gold has somewhere to go and the shop is
      not priced out of reach. Two things that *are* true and were not the stated
      reason: the shelf's useful offers decay from 5-of-5 early to 1-of-5 by
      hour 22 while gold keeps climbing to ~8.4k, so it is the Grove's *tail*
      that is thin, not its opening; and a `+` is worth 1.6% of hero ATK there
      against 7–8.7% from Caves onward, because gear is 46% of a low hero's ATK
      and 67% of a capped one's. The second is now *reported* rather than fixed —
      re-tune only if it still reads badly with the numbers on screen
- [ ] The measurement also killed an argument this file used to make: gold poured
      into gear a drop later displaces is **not** destroyed. `autoEquip` benches
      the upgraded item into the bag with its `+` intact, and both equip-ranking
      and inventory eviction rank on `itemValue`, which counts `plus`. Only
      `sellPrice` ignores it, which is the deliberate sink. Nothing to fix
- [ ] **The away window still can't spawn a goblin, only lose one.** Wiring the
      escape into the summary (see `BUILD-LOG.md`) closed the case where a goblin
      was already standing there when you shut the laptop. It cannot handle the
      other one: away progress is abstract — `applyTime` awards N kills without
      ever spawning a monster — so no goblin can *turn up* during an absence, and
      an eight-hour away window rolls exactly zero of them where eight hours at
      the keyboard would rock roughly a dozen. Not obviously a bug: away kills
      already pay half rate and drop no loot, so "no goblins either" is
      consistent with a window that is deliberately not as good as playing. Worth
      deciding on purpose rather than by omission, though — the honest options are
      to leave it (absence is worse, that's the deal), or to roll goblins at the
      away rate and pay only the gold arm, never the epic
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
- [ ] Edit/Write `tool_response` schema is undocumented — revisit if a future
  Claude Code version documents per-tool line counts (we count from `tool_input`)
