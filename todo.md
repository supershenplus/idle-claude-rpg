# idle-claude-rpg — open work

An idle hero RPG that lives **inside Claude Code**, implemented as a JS hook.
Your hero grinds while you code: hook events are the game tick. Full design in
`docs/PLAN.md`.

**This file is what's left.** Finished milestones — every version, the W1 review
and the security pass, with the reasoning that produced them — live in
`BUILD-LOG.md`. Move an item there when it lands rather than ticking it here, so
this file stays readable as a list of things to do.

---

## The character roster — spec, 2026-07-30

The next feature. Written up before starting because the layout decision is hard
to walk back once saves exist in the wild.

**The case, in one sentence: there are four classes and you only ever play one.**
Knight makes commits hit harder, Ranger turns lines of code into damage, Wizard
crits, Rogue farms — those genuinely change how *your work* maps to the game, and
trying a second one currently costs you the first. `init` refuses when a save
exists unless you pass `--force`, whose help text is honest about what it does:
"this deletes your hero". That is the whole problem, and it is a file-layout
problem wearing a game-design hat.

**It also absorbs two other ideas.** Prestige, "switch character" and "restart"
are one feature — *the save is not the only hero*. Switch is a pointer move,
restart is "make a new one and keep the old", prestige is "make a new one that
inherits something". Build the roster and the other two are policies on top of a
primitive that already exists. Build prestige first and you have built the
narrowest of the three, plus a reset nobody asked for.

### Layout (recommended)

- [ ] **`characters/<slug>/` per hero, with the existing filenames unchanged
      inside it.** `state.json`, `state.bak.{1..4}.json`, `state.corrupt-*.json`,
      `state.v*.json` and `state.tmp.<pid>.json` all move down one level and keep
      their names, so `paths.js` gains one indirection and *nothing else in
      `state.js` changes* — the `saveFiles()` glob, `reapOrphanTmp`'s pid regex
      and the whole backup-generation walk keep working verbatim. The flat
      alternative (`state.<slug>.bak.2.json`) makes every one of those regexes
      ambiguous for the sake of a shallower tree. Not worth it
- [ ] **A top-level `active` file naming the slug.** One line, read on every
      load. Rewriting a pointer is atomic-ish and cheap; moving `state.json`
      around to mean "current" is neither
- [ ] **Slugs are generated, never derived from the hero's name.** Names are user
      input: sanitized to 24 code points, and legitimately CJK or emoji
      (`engine.sanitizeName` explicitly protects `勇者` and `Eva 🗡`). A path built
      from that hits filesystem-unsafe characters, macOS case-insensitive
      collisions and length limits. Use `hero_<base36>` and keep the display name
      inside the save, where it already is

### What must stay global, and why it is the easy thing to get wrong

- [ ] **`events.ndjson` does not move.** The hook appends work events without
      knowing which hero is active, and it must stay that way — it runs on every
      tool call and cannot afford a load. Per-character inboxes would strand
      events on whoever was active when they were written. Global inbox, and the
      active hero receives whatever is in it: the events mean "work happened",
      and whoever is on the clock gets paid for it
- [ ] **`state.lock` does not move.** It serializes *folds*, and a fold now reads
      `active` before it writes — two folds for different characters would still
      race on that read. One lock for the whole install, unchanged

### The decision that actually needs making

- [ ] **Switching is machine-wide, and that is the direct cost of the property
      worth keeping.** One save dir behind every repo and every open window is
      why three windows triple your tick rate on one hero. It is also why
      switching character in one window swaps the hero in every other HUD
      instantly, mid-animation. The proposed answer is the pattern the codebase
      already uses for exactly this shape of problem: the file-based `active` is
      the default and switches everywhere, and an `IDLE_RPG_HERO` env var
      overrides it per-window — precisely how `$RPG_HUD` already sits above the
      saved HUD pin, warning included. Anyone who wants two heroes in two windows
      opts in; nobody else pays

### What composes for free (verified, do not re-derive)

- [ ] Coming back to a hero left three weeks ago costs nothing new: `applyTime`
      sees the gap, grants away progress capped at `OFFLINE_MAX_HOURS`, and
      `pruneAnims` drops the stale queue. The sitting closes and reopens across
      the same gap, so a switched-away character reports its last sitting
      correctly the moment you return to it. All existing behaviour

### What silently breaks, and is probably acceptable

- [ ] **A switch can swallow one War Horn.** `state.repos` is per-save, and
      `gitwatch.sync` returns `firstSight: true, pushed: false` the first time it
      sees a repo — it needs a previous value to compare against. So a character
      who has never been played in this repo will not fire the horn on its first
      push here. The fix would be a global repos map, which costs the "a save is
      self-contained" property that makes backup and recovery comprehensible.
      Leave it; note it in the README

### The destructive edges

- [ ] **`reset --confirm` has to learn scope, and its promise is explicit.** It
      currently deletes `S.saveFiles()` and the help says "forever". With a roster
      it must mean *this character*, with a separate spelling for all of them —
      likely `/hero delete [<slug>] --confirm` for one and leaving `reset` as the
      nuclear option. Whichever way round, the wording has to change at the same
      commit as the behaviour, not after it
- [ ] **`init` stops being destructive.** Today: refuses unless `--force`, which
      overwrites. After: creates a new character and switches to it, with no
      `--force` path at all. That flag's only remaining meaning would be "delete
      the hero I am about to stop using", which is what `delete` is for

### Migration

- [ ] **An existing install has `state.json` at the top level and must not
      notice.** First run adopts it into `characters/<slug>/` with its backups,
      quarantines and snapshots intact, and writes `active`. Idempotent, and it
      has to run *before* `loadState`'s backup-walk, or a half-migrated directory
      looks exactly like a corrupt save with recoverable generations behind it —
      which would "recover" the hero into the wrong place

### Only then, prestige

- [ ] **Re-ask whether it is still wanted once the roster exists**, because the
      thing people want from prestige is usually "play a Knight without losing my
      Wizard", and that is the roster. If it is still wanted: the README's
      standing objection (`Past the cap`) is to an *automatic* wipe imposed while
      you are not watching, and does not apply to an opt-in offer made at a moment
      you chose — but it does still apply to the wipe itself, so any version has
      to answer what carries over. Insight is the obvious candidate, as a
      meta-currency that survives resets
- [ ] **Do not balance it before someone has finished the game.** The cap is ~45
      days of regular use and nothing has reached it. Insight's numbers came off
      the sim; prestige's would too, but the sim would be validating a loop no
      human has played
- [ ] **Prerequisite either way: the Grove is the game's weakest hour** (see the
      shelf item in the backlog — a `+` buys +0.22 ATK, three of five offers read
      *worse than worn*, nothing to spend gold on before zone 2). Prestige sends
      you back through exactly that stretch. Fixing it helps new players too,
      which is a far better bet than a fix that only pays off after 45 days

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
- [ ] Edit/Write `tool_response` schema is undocumented — revisit if a future
  Claude Code version documents per-tool line counts (we count from `tool_input`)
