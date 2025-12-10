#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${ROOT_DIR}/.tools/actionlint"
BIN_PATH="${BIN_DIR}/actionlint"
VERSION="${ACTIONLINT_VERSION:-1.7.9}"

if [ -x "$BIN_PATH" ]; then
  exit 0
fi

mkdir -p "$BIN_DIR"

os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$arch" in
  x86_64|amd64) arch="amd64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

case "$os" in
  linux) ext="tar.gz" ;;
  darwin) ext="tar.gz" ;;
  *) echo "Unsupported OS: $os" >&2; exit 1 ;;
esac

url="https://github.com/rhysd/actionlint/releases/download/v${VERSION}/actionlint_${VERSION}_${os}_${arch}.${ext}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -sSL "$url" -o "${tmp}/actionlint.${ext}"
tar -C "$tmp" -xzf "${tmp}/actionlint.${ext}"
mv "${tmp}/actionlint" "$BIN_PATH"
chmod +x "$BIN_PATH"

echo "Installed actionlint ${VERSION} to ${BIN_PATH}"
