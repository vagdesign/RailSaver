#!/bin/sh
# Puts the photographic skies (Poly Haven, CC0) from the `sky-assets` branch
# into web/skies/. Without them RailSaver uses its generated skies.
set -eu
cd "$(dirname "$0")/.."
git fetch --depth 1 origin +sky-assets:refs/remotes/origin/sky-assets
rm -rf web/skies && mkdir -p web/skies
git archive refs/remotes/origin/sky-assets | tar -x -C web/skies
rm -f web/skies/catalog.json web/skies/README.md
echo "Skies: $(ls web/skies/*.jpg | wc -l) panoramas in web/skies"
