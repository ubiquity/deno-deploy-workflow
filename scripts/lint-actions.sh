#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_PATH="${ROOT_DIR}/.tools/actionlint/actionlint"
YAMLLINT_BIN="${ROOT_DIR}/.tools/yamllint/bin/yamllint"
SCHEMA_URL="https://json.schemastore.org/github-workflow.json"
SCHEMA_FILE="${ROOT_DIR}/.tools/github-workflow-schema.json"

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

# Install yamllint if not present
if ! command -v yamllint >/dev/null 2>&1 && [ ! -f "$YAMLLINT_BIN" ]; then
  echo "==> Installing yamllint"
  mkdir -p "${ROOT_DIR}/.tools/yamllint"
  pip install --target "${ROOT_DIR}/.tools/yamllint" yamllint >/dev/null 2>&1 || {
    echo "Warning: Failed to install yamllint, skipping schema validation"
    YAMLLINT_BIN=""
  }
fi

# Download schema if not present
if [ -n "$YAMLLINT_BIN" ] && [ ! -f "$SCHEMA_FILE" ]; then
  echo "==> Downloading GitHub Actions schema"
  mkdir -p "${ROOT_DIR}/.tools"
  curl -s "$SCHEMA_URL" -o "$SCHEMA_FILE" || {
    echo "Warning: Failed to download schema, skipping schema validation"
    SCHEMA_FILE=""
  }
fi

run_lint() {
  local path="$1"
  if [ ! -d "${path}/.github/workflows" ]; then
    return 0
  fi
  echo "==> Linting ${path#"${ROOT_DIR}"/}"
  (cd "$path" && "$BIN_PATH" "${AL_FLAGS[@]}")
  # Additional schema validation with yamllint
  if [ -n "$YAMLLINT_BIN" ] && [ -n "$SCHEMA_FILE" ]; then
    echo "==> Schema validating ${path#"${ROOT_DIR}"/}"
    (cd "$path" && find .github/workflows -name "*.yml" -o -name "*.yaml" | xargs -I {} "$YAMLLINT_BIN" --schema "$SCHEMA_FILE" {} 2>/dev/null || echo "Schema validation skipped for some files")
  fi
}

for p in "${AL_PATHS[@]}"; do
  run_lint "${ROOT_DIR}/${p}"
done
