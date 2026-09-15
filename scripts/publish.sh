#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
repo="AlirezaT/gardena-mower-card"
version="$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')"
python3 scripts/build.py --check
gh auth status
if ! gh repo view "$repo" >/dev/null 2>&1; then
  gh repo create "$repo" --public --description 'Animated Home Assistant dashboard card for Gardena Mower BLE, installable through HACS' --source . --remote origin
fi
gh repo edit "$repo" --add-topic home-assistant --add-topic hacs --add-topic lovelace --add-topic custom-card --add-topic gardena
git push -u origin main
if ! git rev-parse "v$version" >/dev/null 2>&1; then git tag "v$version"; fi
git push origin "v$version"
if ! gh release view "v$version" --repo "$repo" >/dev/null 2>&1; then
  gh release create "v$version" dist/* --repo "$repo" --verify-tag --title "Gardena Mower Card $version" --notes-file CHANGELOG.md
fi
