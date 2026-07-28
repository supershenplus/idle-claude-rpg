'use strict';

// Detecting `git push` from git itself rather than from a hook.
//
// The classifier only ever sees commands *Claude* runs. A push typed with the
// `!` prefix, run in a second terminal, or made from an IDE fires no hook at
// all — so the War Horn, which the README leads with, silently never happened
// for anyone whose push guardrail routes them through `!`. That is how this was
// found: three real pushes, `counters.pushes: 0`.
//
// Reading the refs instead catches every one of those, because a push is a fact
// about the repository rather than about who typed it.
//
// A push is "the remote-tracking ref moved, and it now equals local HEAD". The
// second half is what separates a push from a fetch: fetching someone else's
// work also advances `origin/main`, but to a commit you don't have. (A fetch
// that fast-forwards you to exactly your own HEAD is indistinguishable, and is
// rare enough to be worth the false positive.)

const fs = require('fs');
const path = require('path');

const MAX_REPOS = 24;      // bounded so a long-lived save can't grow forever
const SHA_RE = /^[0-9a-f]{40,64}$/;

const read = f => { try { return fs.readFileSync(f, 'utf8').trim(); } catch (_) { return null; } };

// `.git` is a directory normally, but a file holding `gitdir: <path>` inside a
// worktree or submodule.
function gitDirOf(startDir) {
  let dir = startDir;
  for (let i = 0; i < 64 && dir; i++) {
    const dot = path.join(dir, '.git');
    let st = null;
    try { st = fs.statSync(dot); } catch (_) { /* keep walking */ }
    if (st && st.isDirectory()) return dot;
    if (st && st.isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(read(dot) || '');
      if (m) return path.resolve(dir, m[1].trim());
      return null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

// Loose ref first, then packed-refs. Both may be absent for a branch that has
// never been pushed, which is a legitimate null rather than an error.
function resolveRef(gitDir, ref) {
  const loose = read(path.join(gitDir, ref));
  if (loose && SHA_RE.test(loose)) return loose;
  const packed = read(path.join(gitDir, 'packed-refs'));
  if (!packed) return null;
  for (const line of packed.split('\n')) {
    if (!line || line[0] === '#' || line[0] === '^') continue;
    const sp = line.indexOf(' ');
    if (sp > 0 && line.slice(sp + 1).trim() === ref) return line.slice(0, sp);
  }
  return null;
}

function headOf(gitDir) {
  const head = read(path.join(gitDir, 'HEAD'));
  if (!head) return { sha: null, branch: null };
  if (SHA_RE.test(head)) return { sha: head, branch: null };   // detached
  const m = /^ref:\s*(.+)$/.exec(head);
  if (!m) return { sha: null, branch: null };
  const ref = m[1].trim();
  return { sha: resolveRef(gitDir, ref), branch: ref.replace(/^refs\/heads\//, '') };
}

// `branch.<name>.remote`, falling back to origin. Read with a deliberately
// loose parser rather than a full INI one: getting this wrong costs a missed
// War Horn, and requiring a git binary would cost a subprocess per frame.
function remoteFor(gitDir, branch) {
  const cfg = read(path.join(gitDir, 'config'));
  if (!cfg || !branch) return 'origin';
  const re = new RegExp(`\\[branch\\s+"${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\]([^[]*)`, 'm');
  const sec = re.exec(cfg);
  const m = sec && /^\s*remote\s*=\s*(\S+)/m.exec(sec[1]);
  return m ? m[1] : 'origin';
}

// The observable state of a repo, or null when there isn't one here.
function inspect(dir) {
  if (!dir) return null;
  const gitDir = gitDirOf(dir);
  if (!gitDir) return null;
  const { sha, branch } = headOf(gitDir);
  if (!branch || !sha) return null;             // detached HEAD has nothing to push
  const remote = remoteFor(gitDir, branch);
  const upstream = resolveRef(gitDir, `refs/remotes/${remote}/${branch}`);
  return { gitDir, branch, head: sha, remote, upstream };
}

// Records what the remote-tracking ref points at, and reports whether that
// constitutes a push since the last call.
//
// Callers are the hook and the statusline, both of which run constantly and
// share one save — so whichever observes the change first fires, and the other
// sees no change. That is the entire dedup story: no timestamps, no windows,
// and a push Claude ran through the Bash tool cannot also fire here.
function sync(state, dir) {
  const info = inspect(dir);
  if (!info || !info.upstream) return { pushed: false, info };

  if (!state.repos || typeof state.repos !== 'object') state.repos = {};
  const prev = state.repos[info.gitDir];
  state.repos[info.gitDir] = info.upstream;

  // Bound the map. Insertion order is stable for string keys, so the oldest
  // repo seen is the first one out.
  const keys = Object.keys(state.repos);
  for (let i = 0; i < keys.length - MAX_REPOS; i++) delete state.repos[keys[i]];

  // `recorded` tells the caller the save is dirty even when nothing fired.
  // Without it a first sighting would never persist, so every poll would look
  // like a first sighting and no push would ever be detected.
  const recorded = prev !== info.upstream;
  if (prev === undefined) return { pushed: false, recorded, info, firstSight: true };
  if (!recorded) return { pushed: false, recorded: false, info };
  return { pushed: info.upstream === info.head, recorded, info };
}

module.exports = { sync, inspect, gitDirOf, resolveRef, headOf, remoteFor, MAX_REPOS };
