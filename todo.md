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

- [ ] **Some monster blows are drawn as nothing at all.** Fell out of chasing the
      counter-hit ordering bug (fixed, see `BUILD-LOG.md`) and is the *other* half
      of that report — the half that turned out to be real. `test_fail` and
      `bash_fail` call `hurtHero` directly (`lib/engine.js:665,668`) without ever
      calling `enqueue`, so a failing test or a failing command takes HP off the
      hero and puts nothing on screen. Only the counter path
      (`retaliate` → folded onto the hero's `hit`) has any frame at all, and it
      borrows the hero's. So the game has no monster attack animation in any form
- [ ] Which makes this the same open question as the flinch item below, from the
      other side: that one asks what it looks like when a monster is *hit*, this
      one asks what it looks like when a monster *hits*. They share the impact
      frame, the reserved-room problem against the right edge, and the corpse
      path they both have to not fight — so they want designing together even if
      they land separately. Cheapest sketch that covers all 28: a shove *left*
      (mirror of the hero's recoil) plus a mark travelling right-to-left in the
      gap, which is `gapMarks` run backwards and needs no new art
- [ ] **Bosses should get hand-scripted attacks of their own.** The generic
      treatment above is what makes the other 22 monsters legible; the six bosses
      are where per-monster art actually pays for itself, the same way
      `sprites.attacks.ranger` pays off for the class you play. A wind-up pose, a
      signature projectile or reach, and a recoil — so Rootfang's swing doesn't
      read like a leech's. Prerequisites, in order: the generic monster attack
      above has to exist first (the bosses are the exception to a rule that isn't
      written yet); `attacks`/`attackFrame`/`MAX_RECOIL` are keyed by class id and
      would need to take a monster id too, or a second table beside them; and
      `MAX_RECOIL` reserves room on the *hero's* side only, so the right-edge
      equivalent is a new constraint the layout has never had. Worth deciding
      early whether a boss script is a full `frames` array like the ranger's or
      just a pose swap on the impact frame — six hand-drawn sequences is a real
      art budget, and the ranger's took a solver to align

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
      the flinch has to end where the death begins. Pairs with the monster-attack
      items up top: same impact frame, same right-edge reserve, same corpse path
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
- [ ] **Loot goblin — shipped, but it doesn't flee.** See `BUILD-LOG.md`. The
      archetype's other half is that a loot goblin *runs*: it should be possible
      to lose the prize by not working fast enough, which is the only version of
      this that makes the banner urgent rather than decorative — and the banner
      already says "get it before it runs", which is currently a bluff. Not built
      because fleeing means a monster can leave the field on a *timer* rather
      than on an event, and every other state change in this game is driven by a
      folded hook event. A goblin that despawns at wall-clock T is the first
      thing in the engine whose outcome depends on when you happened to look,
      which is exactly the class of bug `fold` exists to prevent. Plausible dodge:
      give the goblin a kill-deadline in *events* rather than seconds (it flees
      if it survives N more folded events), which keeps the whole thing
      deterministic and replayable. Worth doing — it is the difference between an
      event and a bonus
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
