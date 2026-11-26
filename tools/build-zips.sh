#!/usr/bin/env bash
# Packs the browser extension for the stores:
#   dist/chrome-<version>.zip   Chrome Web Store and Edge Add-ons, from chrome/
#   dist/firefox-<version>.zip  addons.mozilla.org, from chrome/content/
# Each version is read from that browser's manifest. Existing zips of the same
# version are replaced. Run from anywhere: ./tools/build-zips.sh

set -euo pipefail
cd "$(dirname "$0")/.."

manifest_version() {
  sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1
}

chrome_version="$(manifest_version chrome/manifest.json)"
firefox_version="$(manifest_version chrome/content/manifest.json)"

if [ -z "$chrome_version" ] || [ -z "$firefox_version" ]; then
  echo "Could not read the version from the manifests." >&2
  exit 1
fi
if [ "$chrome_version" != "$firefox_version" ]; then
  echo "Warning: Chrome manifest is $chrome_version, Firefox manifest is $firefox_version." >&2
fi
if [ -n "$(git status --porcelain -- chrome 2>/dev/null)" ]; then
  echo "Note: chrome/ has uncommitted changes; they are included in the zips." >&2
fi

mkdir -p dist
chrome_zip="dist/chrome-$chrome_version.zip"
firefox_zip="dist/firefox-$firefox_version.zip"
rm -f "$chrome_zip" "$firefox_zip"

# Chrome: manifest.json at the root next to content/. content/manifest.json is the
# Firefox manifest and is left out. -X drops macOS extra attributes (no __MACOSX).
(cd chrome && zip -r -X -q "../$chrome_zip" manifest.json content \
  -x 'content/manifest.json' -x '*.DS_Store')

# Firefox: the contents of chrome/content/, so its manifest.json is at the root.
(cd chrome/content && zip -r -X -q "../../$firefox_zip" . -x '*.DS_Store')

echo "Created $chrome_zip"
echo "Created $firefox_zip"
