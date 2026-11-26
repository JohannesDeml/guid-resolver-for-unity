#!/usr/bin/env bash
# Sets the version in the Chrome and Firefox manifests.
# Usage: ./tools/bump-version.sh 1.3.1

set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -ne 1 ]; then
  echo "Usage: $0 <version>   e.g. $0 1.3.1" >&2
  exit 1
fi
version="$1"

# Browsers accept one to four dot-separated numbers
if ! [[ "$version" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]]; then
  echo "Invalid version '$version': use numbers like 1.3.1" >&2
  exit 1
fi

for manifest in chrome/manifest.json chrome/content/manifest.json; do
  # Only the "version" key; manifest_version and strict_min_version are left alone
  VERSION="$version" perl -pi -e 's/("version"\s*:\s*")[^"]*(")/${1}$ENV{VERSION}${2}/' "$manifest"
  echo "$manifest: $(grep -m 1 '"version"' "$manifest" | tr -d ' ,')"
done
