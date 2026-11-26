# Tasks for GUID Resolver for Unity. Run `just` to list them.

# Without a recipe name, list the recipes
_default:
    @just --list

# Build the store zips: dist/chrome-<version>.zip and dist/firefox-<version>.zip
build:
    ./tools/build-zips.sh

# Set the version in the Chrome and Firefox manifests, e.g. `just bump-version 1.3.1`
bump-version version:
    ./tools/bump-version.sh {{quote(version)}}