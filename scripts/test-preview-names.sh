#!/usr/bin/env bash
set -euo pipefail

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's#[^a-z0-9]+#-#g; s#-+#-#g; s#^-+##; s#-+$##'
}

shorten_slug() {
  value="$1"
  max_len="$2"
  [ ${#value} -le "$max_len" ] && {
    printf '%s' "$value"
    return 0
  }
  hash=$(printf '%s' "$value" | sha1sum | cut -c1-4)
  head_len=$((max_len - 5))
  printf '%s-%s' "${value:0:${head_len}}" "$hash"
}

branch_preview_name() {
  project_name="$1"
  ref_name="$2"

  base="${project_name%-ubq-fi}"
  if [ "$project_name" = "ubq-fi" ]; then
    base="ubq"
  fi

  branch_slug="$(slugify "$ref_name")"
  base_slug="$(slugify "$base")"
  [ -n "$branch_slug" ] || branch_slug="preview"
  [ -n "$base_slug" ] || base_slug="ubq"

  suffix="-ubq-fi"
  available=$((26 - ${#suffix}))
  separator_len=1
  min_branch_len=6
  min_base_len=6

  branch_len=${#branch_slug}
  base_len=${#base_slug}
  if [ $((branch_len + separator_len + base_len)) -gt "$available" ]; then
    base_budget=$((available - separator_len - min_branch_len))
    if [ "$base_budget" -lt "$min_base_len" ]; then
      base_budget="$min_base_len"
    fi
    if [ "$base_budget" -gt "$base_len" ]; then
      base_budget="$base_len"
    fi

    branch_budget=$((available - separator_len - base_budget))
    if [ "$branch_budget" -lt "$min_branch_len" ]; then
      branch_budget="$min_branch_len"
      base_budget=$((available - separator_len - branch_budget))
    fi

    base_slug="$(shorten_slug "$base_slug" "$base_budget")"
    branch_slug="$(shorten_slug "$branch_slug" "$branch_budget")"
  fi

  printf '%s-%s-ubq-fi\n' "$branch_slug" "$base_slug"
}

assert_eq() {
  expected="$1"
  actual="$2"
  label="$3"
  if [ "$expected" != "$actual" ]; then
    echo "not ok - ${label}: expected '${expected}', got '${actual}'" >&2
    exit 1
  fi
}

assert_valid_project() {
  value="$1"
  label="$2"
  if [ ${#value} -gt 26 ]; then
    echo "not ok - ${label}: '${value}' is longer than 26 chars" >&2
    exit 1
  fi
  if ! [[ "$value" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
    echo "not ok - ${label}: '${value}' is not DNS-safe" >&2
    exit 1
  fi
}

pay_preview="$(branch_preview_name pay-ubq-fi feat/widget)"
assert_eq "feat-widget-pay-ubq-fi" "$pay_preview" "short branch preview"
assert_valid_project "$pay_preview" "short branch preview"

first_notifications="$(branch_preview_name notifications-ubq-fi feat/a)"
second_notifications="$(branch_preview_name notifications-ubq-fi fix/b)"
assert_valid_project "$first_notifications" "long base branch preview"
assert_valid_project "$second_notifications" "second long base branch preview"
if [ "$first_notifications" = "$second_notifications" ]; then
  echo "not ok - long base branches collapsed to the same project" >&2
  exit 1
fi
case "$first_notifications" in
  p-*|preview-*)
    echo "not ok - long base branch preview fell back to shared naming: ${first_notifications}" >&2
    exit 1
    ;;
esac

long_branch="$(branch_preview_name pay-ubq-fi feature/some-large-ui-change)"
assert_valid_project "$long_branch" "long branch preview"

empty_slug="$(branch_preview_name pay-ubq-fi '---')"
assert_eq "preview-pay-ubq-fi" "$empty_slug" "empty branch slug fallback"

echo "Preview naming tests passed"
