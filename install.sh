#!/usr/bin/env bash
# idle-claude-rpg installer — idempotent, no sudo.
# Deliberately NEVER touches ~/.claude/settings.json (the guardrail hooks
# treat settings edits as an explicit user action). It copies the /hero skill,
# self-tests the hook, and prints the settings snippet for you to paste.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
PRINT_ONLY=false
[[ "${1:-}" == "--print-settings" ]] && PRINT_ONLY=true

settings_snippet() {
  cat <<EOF
Merge the two hook groups into the EXISTING "hooks" object in
$CLAUDE_DIR/settings.json (your PreToolUse/SessionStart guardrails stay as
they are — hook groups merge), and add "statusLine" as a new top-level key:

  "hooks": {
    ...your existing PreToolUse / SessionStart entries...,
    "PostToolUse": [
      { "matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [{ "type": "command",
          "command": "node \"$REPO/hooks/rpg-hook.js\"",
          "timeout": 5 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command",
          "command": "node \"$REPO/hooks/rpg-hook.js\"",
          "timeout": 5 }] }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "node \"$REPO/statusline/rpg-statusline.js\"",
    "refreshInterval": 1,
    "padding": 0
  }

Then restart Claude Code and run /hero init.
EOF
}

if $PRINT_ONLY; then settings_snippet; exit 0; fi

# 1. node >= 18
if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found on PATH" >&2; exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
  echo "error: node >= 18 required (found $(node -v))" >&2; exit 1
fi

# 2. dirs
mkdir -p "$HOME/.config/idle-claude-rpg" "$CLAUDE_DIR/skills/hero"

# 3. skill (diff-print when changing an existing install)
SKILL_DST="$CLAUDE_DIR/skills/hero/SKILL.md"
if [[ -f "$SKILL_DST" ]] && ! cmp -s "$REPO/skill/SKILL.md" "$SKILL_DST"; then
  echo "updating $SKILL_DST:"
  diff -u "$SKILL_DST" "$REPO/skill/SKILL.md" || true
fi
cp "$REPO/skill/SKILL.md" "$SKILL_DST"
echo "ok: /hero skill installed at $SKILL_DST"

# 4. self-test: run the hook against a fixture in a throwaway state dir
TMPHOME="$(mktemp -d)"
trap 'rm -rf "$TMPHOME"' EXIT
IDLE_RPG_HOME="$TMPHOME" node "$REPO/bin/rpg.js" init --class wizard --name Smoke >/dev/null
IDLE_RPG_HOME="$TMPHOME" node "$REPO/hooks/rpg-hook.js" < "$REPO/test/fixtures/bash-jab.json"
IDLE_RPG_HOME="$TMPHOME" node "$REPO/bin/rpg.js" fold >/dev/null
if ! IDLE_RPG_HOME="$TMPHOME" node "$REPO/bin/rpg.js" status | grep -q "Smoke the Wizard"; then
  echo "error: hook self-test failed" >&2; exit 1
fi
echo "ok: hook self-test passed"
echo
settings_snippet
