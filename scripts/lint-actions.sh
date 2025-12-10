#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_PATH="${ROOT_DIR}/.tools/actionlint/actionlint"
if [ -n "${ACTIONLINT_FLAGS:-}" ]; then
  read -r -a AL_FLAGS <<< "$ACTIONLINT_FLAGS"
else
  AL_FLAGS=(-ignore '.*runner of "actions/checkout@v3" action is too old.*')
fi

if [ -n "${ACTIONLINT_PATHS:-}" ]; then
  read -r -a AL_PATHS <<< "$ACTIONLINT_PATHS"
else
  AL_PATHS=(. lib/notifications.ubq.fi)
fi

"${ROOT_DIR}/scripts/install-actionlint.sh"

run_lint() {
  local path="$1"
  if [ ! -d "${path}/.github/workflows" ]; then
    return 0
  fi
  echo "==> Linting ${path#${ROOT_DIR}/}"
  (cd "$path" && "$BIN_PATH" "${AL_FLAGS[@]}")
}

for p in "${AL_PATHS[@]}"; do
  run_lint "${ROOT_DIR}/${p}"
done
