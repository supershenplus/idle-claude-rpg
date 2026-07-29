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

## Backlog

- [ ] Two smaller sprite nits, both cosmetic and both long-deferred: `harpy` has
      a stray `▚` floating off the right wing, and `leech` is 8 cells wide where
      the rest of the set is 11-13, so it reads undersized next to its zone
- [ ] One-line sprites in `lib/content.js` are still the original kaomoji — only
      the 5-row big art was redrawn in v1.2, so compact and mini HUD modes never
      got the pass
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
      self-correcting once ilvl spreads widen past Cobalt Caves. Related: a `+`
      adds 2% of what the item rolled, which on Grove numbers is +0.22 ATK, so
      upgrades are dead at that tier too and there is genuinely nothing to spend
      gold on before the second zone
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
- [ ] Per-session stats view
- [ ] Edit/Write `tool_response` schema is undocumented — revisit if a future
  Claude Code version documents per-tool line counts (we count from `tool_input`)
