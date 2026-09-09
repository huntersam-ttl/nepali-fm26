#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/build-macos-release.sh --unsigned-diagnostic [--output-dir DIR]
       scripts/build-macos-release.sh --signed [--output-dir DIR]
       scripts/build-macos-release.sh --check

--unsigned-diagnostic  Build a universal diagnostic artifact; never public-ready.
--signed               Build, sign, notarise, staple, and Gatekeeper-check.
--check                Validate signing and notary credentials; never builds.

APPLE_SIGNING_IDENTITY may name the Developer ID Application identity.
APPLE_NOTARY_PROFILE may name the notarytool Keychain profile.
EOF
}

MODE=""
NOTARIZE=0
CHECK_ONLY=0
OUTPUT_DIR=""
while (($#)); do
  case "$1" in
    --unsigned|--unsigned-diagnostic) MODE="unsigned" ;;
    --signed) MODE="signed" ;;
    --notarize) NOTARIZE=1 ;;
    --check) CHECK_ONLY=1 ;;
    --output-dir) shift; OUTPUT_DIR="${1:?missing output directory}" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if ((CHECK_ONLY == 1)); then
  [[ -z "$MODE" ]] || { echo "--check cannot be combined with a build mode." >&2; exit 2; }
  MODE="signed"
fi
if [[ -z "$MODE" ]]; then
  echo "Choose --unsigned-diagnostic, --signed, or --check explicitly." >&2
  exit 2
fi
if [[ -z "$OUTPUT_DIR" ]]; then
  if [[ "$MODE" == "signed" ]]; then OUTPUT_DIR="releases/public/0.1.0-rc.2";
  else OUTPUT_DIR="releases/public/0.1.0-rc.2-current-unsigned-diagnostic"; fi
fi

if [[ "$MODE" == "signed" ]]; then
  SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-${DEVELOPER_ID_APPLICATION:-}}"
  NOTARY_PROFILE="${APPLE_NOTARY_PROFILE:-${NOTARY_PROFILE:-}}"
  IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  if [[ -z "$SIGNING_IDENTITY" ]]; then
    SIGNING_IDENTITY="$(printf '%s\n' "$IDENTITIES" | sed -n 's/.*\("Developer ID Application: [^"]*"\).*/\1/p' | head -1 | tr -d '"')"
  fi
  if [[ -z "$SIGNING_IDENTITY" ]]; then
    if security find-certificate -a -c 'Developer ID Application' >/dev/null 2>&1; then
      echo "PRIVATE_KEY_MISSING: Developer ID certificate exists but no valid signing identity is available." >&2
    else
      echo "SIGNING_BLOCKED: Developer ID Application identity not found." >&2
    fi
    exit 3
  fi
  if ! printf '%s\n' "$IDENTITIES" | rg -Fq "$SIGNING_IDENTITY"; then
    echo "SIGNING_BLOCKED: configured identity is not valid in the current Keychain." >&2
    exit 3
  fi
  TEAM_ID="${APPLE_TEAM_ID:-$(printf '%s\n' "$SIGNING_IDENTITY" | sed -n 's/.*(\([A-Z0-9]*\)).*/\1/p')}"
  [[ -n "$TEAM_ID" ]] || { echo "SIGNING_BLOCKED: Apple Team ID could not be resolved." >&2; exit 3; }
  [[ -n "$NOTARY_PROFILE" ]] || { echo "NOTARIZATION_BLOCKED: APPLE_NOTARY_PROFILE is not set." >&2; exit 3; }
  if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
    echo "NOTARIZATION_BLOCKED: notarytool profile is unavailable or invalid." >&2
    exit 3
  fi
  echo "Developer ID: $SIGNING_IDENTITY"
  echo "Team ID: $TEAM_ID"
  echo "Notary profile: $NOTARY_PROFILE (credentials remain in Keychain)"
  if ((CHECK_ONLY == 1)); then
    echo "Credential preflight: PASS"
    exit 0
  fi
  [[ "$OUTPUT_DIR" != *unsigned* ]] || { echo "PACKAGING_BLOCKED: signed artifacts cannot use an unsigned directory." >&2; exit 4; }
  if [[ -e "$OUTPUT_DIR" && -n "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "PACKAGING_BLOCKED: signed release directory is non-empty; choose the next RC." >&2
    exit 4
  fi
else
  [[ "$NOTARIZE" == 0 ]] || { echo "--notarize requires --signed." >&2; exit 2; }
  [[ "$OUTPUT_DIR" == *unsigned* || "$OUTPUT_DIR" == *diagnostic* ]] || { echo "PACKAGING_BLOCKED: unsigned diagnostics require an unsigned/diagnostic directory." >&2; exit 4; }
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
if [[ "$MODE" == "signed" ]]; then
  pnpm typecheck
fi
# NEPAL_RUNTIME_ARCH tells prepare-runtime.mjs (the beforeBuildCommand hook)
# which Node.js architecture to fetch for the sidecar runtime, independent of
# the host's own architecture — this is what makes a universal build
# possible from a single-arch build machine (see prepare-runtime.mjs).
NEPAL_RUNTIME_ARCH=x64 pnpm --filter @nepal-football-sim/desktop exec tauri build --target "$X64_TRIPLE" --bundles app
NEPAL_RUNTIME_ARCH=arm64 pnpm --filter @nepal-football-sim/desktop exec tauri build --target "$ARM_TRIPLE" --bundles app

WORK_DIR="$(mktemp -d /private/tmp/nepal-macos-release.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT
UNIVERSAL_APP="$WORK_DIR/$APP_NAME"
ditto "$ARM_APP" "$UNIVERSAL_APP"
lipo -create "$X64_APP/$MAIN_REL" "$ARM_APP/$MAIN_REL" -output "$UNIVERSAL_APP/$MAIN_REL"
# The Node sidecar must be launchable on either architecture too — each
# per-target build produces its own single-arch runtime/node (see
# apps/desktop/scripts/prepare-runtime.mjs), so it needs the same lipo
# treatment as the main binary rather than being left as whichever single
# arch happened to be ditto'd in as the base.
NODE_REL="Contents/Resources/runtime/node"
lipo -create "$X64_APP/$NODE_REL" "$ARM_APP/$NODE_REL" -output "$UNIVERSAL_APP/$NODE_REL"

SIGNING_MANIFEST="$OUTPUT_DIR/SIGNING-MANIFEST.txt"
 : > "$SIGNING_MANIFEST"
while IFS= read -r candidate; do
  if file "$candidate" | rg -q 'Mach-O'; then
    echo "${candidate#"$UNIVERSAL_APP/"}" >> "$SIGNING_MANIFEST"
  fi
done < <(find "$UNIVERSAL_APP" -type f -print)
sort -u "$SIGNING_MANIFEST" -o "$SIGNING_MANIFEST"
EXPECTED_MANIFEST="$WORK_DIR/expected-signing-manifest.txt"
# The Node sidecar (Contents/Resources/runtime/node) is dynamically linked
# against libnode plus a dozen more Homebrew-provided dylibs (icu4c, openssl,
# libuv, ...); prepare-runtime.mjs vendors that whole dependency graph into
# runtime/lib so the sidecar doesn't abort at launch with "Library not
# loaded". Anything prepare-runtime.mjs vendors there is expected by
# definition — its exact contents legitimately vary with the Homebrew Node
# build used at package time (see commit a98cd19). This check's real job is
# to catch a Mach-O showing up ANYWHERE ELSE in the bundle (a stray dev
# binary, an accidentally-included test fixture, ...), so only runtime/lib
# is treated as an open set; the main binary and the sidecar itself stay
# pinned to exact, single expected paths.
{
  printf '%s\n' "$MAIN_REL" 'Contents/Resources/runtime/node'
  grep '^Contents/Resources/runtime/lib/' "$SIGNING_MANIFEST" || true
} | sort > "$EXPECTED_MANIFEST"
if ! diff -u "$EXPECTED_MANIFEST" "$SIGNING_MANIFEST"; then
  echo "PACKAGING_BLOCKED: unexpected Mach-O set; refusing to sign or package." >&2
  exit 4
fi
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
    codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$UNIVERSAL_APP/$binary"
    codesign --verify --strict --verbose=2 "$UNIVERSAL_APP/$binary"
  done < "$SIGNING_MANIFEST"
  codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$UNIVERSAL_APP"
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

if [[ "$MODE" == "signed" ]]; then
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
  xcrun stapler validate "$UNIVERSAL_APP"
  xcrun stapler validate "$DMG"
  spctl --assess --type execute --verbose=4 "$UNIVERSAL_APP"
  spctl --assess --type open --verbose=4 "$DMG"
fi

(cd "$OUTPUT_DIR" && shasum -a 256 "$(basename "$DMG")" "$(basename "$ZIP")" > SHA256SUMS)
cat "$OUTPUT_DIR/SHA256SUMS"
echo "Release artifacts written to $OUTPUT_DIR"
echo "Mode: $MODE; notarized: $([[ "$MODE" == signed ]] && echo 1 || echo 0)"
