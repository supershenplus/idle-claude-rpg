#!/usr/bin/env bash
# idle-claude-rpg installer — idempotent, no sudo, no dependencies.
#
# By default this NEVER touches ~/.claude/settings.json: it copies the /hero
# skill, self-tests the hook, and prints the settings snippet for you to paste.
# settings.json decides what runs on every tool call in every session, and a
# game installer is not entitled to it by default.
#
#   ./install.sh                    skill + self-test + print the snippet
#   ./install.sh --write-settings   ...and merge it in for you, with a backup
#   ./install.sh --print-settings   just print the snippet
#   ./install.sh --check            diagnose an install that stopped working
#   ./install.sh --uninstall        remove the wiring (leaves your save alone)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS_JS="$REPO/bin/settings.js"

MODE=install
FORCE=()
for arg in "$@"; do
  case "$arg" in
    --print-settings) MODE=print ;;
    --write-settings) MODE=write ;;
    --check)          MODE=check ;;
    --uninstall)      MODE=uninstall ;;
    --force)          FORCE=(--force) ;;
    -h|--help)        sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "error: node not found on PATH" >&2; exit 1
  fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if (( major < 18 )); then
    echo "error: node >= 18 required (found $(node -v))" >&2; exit 1
  fi
}

case "$MODE" in
  print)     require_node; exec node "$SETTINGS_JS" print ;;
  check)     require_node; exec node "$SETTINGS_JS" check ;;
  uninstall)
    require_node
    node "$SETTINGS_JS" remove
    rm -f "$CLAUDE_DIR/skills/hero/SKILL.md"
    rmdir "$CLAUDE_DIR/skills/hero" 2>/dev/null || true
    echo "ok: /hero skill removed"
    exit 0 ;;
esac

require_node

# 1. dirs
mkdir -p "$HOME/.config/idle-claude-rpg" "$CLAUDE_DIR/skills/hero"

# 2. skill — rendered, not copied: it names this clone's absolute path twice,
# once in `allowed-tools`, which is a permission grant and cannot be relative.
node "$SETTINGS_JS" skill

# 3. self-test: run the hook against a fixture in a throwaway state dir
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

# 4. wiring
if [[ "$MODE" == write ]]; then
  node "$SETTINGS_JS" merge "${FORCE[@]+"${FORCE[@]}"}"
else
  node "$SETTINGS_JS" print
fi
