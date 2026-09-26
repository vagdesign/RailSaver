#!/bin/sh
# Builds RailSaver.saver (universal: Apple silicon + Intel). Needs the Xcode
# command line tools. Usage: mac/build.sh [version]   → out/RailSaver.saver
set -eu
cd "$(dirname "$0")/.."
VERSION="${1:-0.6.1}"
OUT=out/RailSaver.saver
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"

clang -fobjc-arc -bundle -O2 -Wall \
  -arch arm64 -arch x86_64 -mmacosx-version-min=11.0 \
  -framework Cocoa -framework ScreenSaver -framework WebKit \
  mac/RailSaverView.m -o "$OUT/Contents/MacOS/RailSaver"

sed "s/__VERSION__/$VERSION/g" mac/Info.plist > "$OUT/Contents/Info.plist"
cp -R web "$OUT/Contents/Resources/web"

# Thumbnail shown in System Settings > Screen Saver.
if command -v sips >/dev/null 2>&1; then
  sips -z 100 90 docs/icon.png --out "$OUT/Contents/Resources/thumbnail.png" >/dev/null 2>&1 || true
  sips -z 200 180 docs/icon.png --out "$OUT/Contents/Resources/thumbnail@2x.png" >/dev/null 2>&1 || true
fi

# Ad-hoc signature (required on Apple silicon). Not notarised.
codesign --force --deep --sign - "$OUT"
echo "Built $OUT ($VERSION)"
