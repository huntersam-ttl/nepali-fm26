#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/build-macos-release.sh --unsigned [--output-dir DIR]
       scripts/build-macos-release.sh --signed [--notarize] [--output-dir DIR]

--unsigned  Build a universal diagnostic artifact; never public-ready.
--signed    Require DEVELOPER_ID_APPLICATION and sign nested code.
--notarize  With --signed, submit the DMG using NOTARY_PROFILE.
EOF
}

MODE=""
NOTARIZE=0
OUTPUT_DIR="releases/public/0.1.0-rc.2-unsigned-diagnostic"
while (($#)); do
  case "$1" in
    --unsigned) MODE="unsigned" ;;
    --signed) MODE="signed" ;;
    --notarize) NOTARIZE=1 ;;
    --output-dir) shift; OUTPUT_DIR="${1:?missing output directory}" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ -z "$MODE" ]]; then
  echo "Choose --unsigned or --signed explicitly; refusing an implicit release mode." >&2
  exit 2
fi
if [[ "$MODE" == "unsigned" && "$NOTARIZE" == 1 ]]; then
  echo "--notarize requires --signed." >&2
  exit 2
fi
if [[ "$MODE" == "signed" && -z "${DEVELOPER_ID_APPLICATION:-}" ]]; then
  echo "Signed release requested but DEVELOPER_ID_APPLICATION is not set." >&2
  exit 3
fi
if [[ "$MODE" == "signed" ]] && ! security find-identity -v -p codesigning 2>/dev/null | rg -Fq "$DEVELOPER_ID_APPLICATION"; then
  echo "Signed release requested but the configured Developer ID identity is not available in Keychain." >&2
  exit 3
fi
if [[ "$NOTARIZE" == 1 && -z "${NOTARY_PROFILE:-}" ]]; then
  echo "Notarization requested but NOTARY_PROFILE is not set." >&2
  exit 3
fi
if [[ "$NOTARIZE" == 1 ]]; then
  xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
X64_TRIPLE="x86_64-apple-darwin"
ARM_TRIPLE="aarch64-apple-darwin"
X64_APP="apps/desktop/src-tauri/target/$X64_TRIPLE/release/bundle/macos/Nepal Football Simulation.app"
ARM_APP="apps/desktop/src-tauri/target/$ARM_TRIPLE/release/bundle/macos/Nepal Football Simulation.app"
APP_NAME="Nepal Football Simulation.app"
MAIN_REL="Contents/MacOS/nepal-football-sim"
mkdir -p "$OUTPUT_DIR"

git diff --check
rustup target list --installed | rg -qx "$X64_TRIPLE"
rustup target list --installed | rg -qx "$ARM_TRIPLE"
pnpm --filter @nepal-football-sim/desktop exec tauri build --target "$X64_TRIPLE" --bundles app
pnpm --filter @nepal-football-sim/desktop exec tauri build --target "$ARM_TRIPLE" --bundles app

WORK_DIR="$(mktemp -d /private/tmp/nepal-macos-release.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT
UNIVERSAL_APP="$WORK_DIR/$APP_NAME"
ditto "$ARM_APP" "$UNIVERSAL_APP"
lipo -create "$X64_APP/$MAIN_REL" "$ARM_APP/$MAIN_REL" -output "$UNIVERSAL_APP/$MAIN_REL"

SIGNING_MANIFEST="$OUTPUT_DIR/SIGNING-MANIFEST.txt"
 : > "$SIGNING_MANIFEST"
while IFS= read -r candidate; do
  if file "$candidate" | rg -q 'Mach-O'; then
    echo "${candidate#"$UNIVERSAL_APP/"}" >> "$SIGNING_MANIFEST"
  fi
done < <(find "$UNIVERSAL_APP" -type f -print)
sort -u "$SIGNING_MANIFEST" -o "$SIGNING_MANIFEST"
while IFS= read -r binary; do
  binary_path="$UNIVERSAL_APP/$binary"
  info="$(lipo -info "$binary_path")"
  [[ "$info" == *x86_64* && "$info" == *arm64* ]] || {
    echo "Universal release contains a non-universal Mach-O: $binary ($info)" >&2
    exit 4
  }
done < "$SIGNING_MANIFEST"

if [[ "$MODE" == "signed" ]]; then
  while IFS= read -r binary; do
    [[ "$binary" == "$MAIN_REL" ]] && continue
    codesign --force --options runtime --timestamp --sign "$DEVELOPER_ID_APPLICATION" "$UNIVERSAL_APP/$binary"
  done < "$SIGNING_MANIFEST"
  codesign --force --options runtime --timestamp --sign "$DEVELOPER_ID_APPLICATION" "$UNIVERSAL_APP"
  codesign --verify --deep --strict --verbose=4 "$UNIVERSAL_APP"
fi

LABEL="0.1.0-rc.2-macos-universal"
if [[ "$MODE" == "unsigned" ]]; then LABEL="0.1.0-rc.2-macos-universal-unsigned-diagnostic"; fi
DMG="$OUTPUT_DIR/Nepal-Football-Simulation-$LABEL.dmg"
ZIP="$OUTPUT_DIR/Nepal-Football-Simulation-$LABEL.zip"
DMG_STAGE="$WORK_DIR/dmg-stage"
mkdir -p "$DMG_STAGE"
ditto "$UNIVERSAL_APP" "$DMG_STAGE/$APP_NAME"
ln -s /Applications "$DMG_STAGE/Applications"
hdiutil create -volname "Nepal Football Simulation" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG"
ditto -c -k --sequesterRsrc --keepParent "$UNIVERSAL_APP" "$ZIP"

if [[ "$NOTARIZE" == 1 ]]; then
  set +e
  NOTARY_OUTPUT="$(xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait 2>&1)"
  NOTARY_STATUS=$?
  set -e
  echo "$NOTARY_OUTPUT"
  if ((NOTARY_STATUS != 0)); then
    SUBMISSION_ID="$(printf '%s\n' "$NOTARY_OUTPUT" | awk '/id:/{print $2; exit}')"
    if [[ -n "$SUBMISSION_ID" ]]; then
      xcrun notarytool log "$SUBMISSION_ID" --keychain-profile "$NOTARY_PROFILE" || true
    fi
    exit "$NOTARY_STATUS"
  fi
  xcrun stapler staple "$UNIVERSAL_APP"
  xcrun stapler staple "$DMG"
fi

(cd "$OUTPUT_DIR" && shasum -a 256 "$(basename "$DMG")" "$(basename "$ZIP")" > SHA256SUMS)
cat "$OUTPUT_DIR/SHA256SUMS"
echo "Release artifacts written to $OUTPUT_DIR"
echo "Mode: $MODE; notarized: $NOTARIZE"
