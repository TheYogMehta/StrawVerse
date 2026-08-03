#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
#  release.sh — Build both Desktop (Electron) & Mobile (Android),
#               and publish unified release to GitHub.
#  Usage: ./release.sh (or npm run release)
# ─────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="$SCRIPT_DIR/electron"
CAPACITOR_DIR="$SCRIPT_DIR/capacitor"
CHANGELOG="$ELECTRON_DIR/CHANGELOG.md"
ELECTRON_PKG="$ELECTRON_DIR/package.json"
CAPACITOR_PKG="$CAPACITOR_DIR/package.json"
DIST_DIR="$ELECTRON_DIR/dist"
REPO="TheYogMehta/StrawVerse"
DISCORD_LINK="https://discord.gg/PzfUBgQ2gt"

# ── Colors ───────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${CYAN}[release]${NC} $*"; }
ok()    { echo -e "${GREEN}  ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $*"; }
fail()  { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }

# ── 1. Ensure CHANGELOG.md exists ─────────────────────────
if [ ! -f "$CHANGELOG" ]; then
  fail "CHANGELOG.md not found at $CHANGELOG"
fi

# ── 2. Extract version from root CHANGELOG.md ────────────
log "Reading version from ${BOLD}CHANGELOG.md${NC}..."

VERSION=$(grep -oP '(?<=^# \[)[0-9]+\.[0-9]+\.[0-9]+(?=\])' "$CHANGELOG" | head -1)
[ -z "$VERSION" ] && fail "Could not parse version from CHANGELOG.md"
TAG="v${VERSION}"
ok "Version: ${BOLD}${VERSION}${NC}  →  Tag: ${BOLD}${TAG}${NC}"

# ── 3. Extract release notes ─────────────────────────────
log "Extracting release notes from Desktop & Mobile changelogs..."

extract_notes() {
  local file="$1"
  if [ ! -f "$file" ]; then echo ""; return; fi
  node -e "
    const fs = require('fs');
    const file = process.argv[1];
    const ver = process.argv[2];
    if (!fs.existsSync(file)) process.exit(0);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let found = false;
    const result = [];
    for (const line of lines) {
      if (/^#+\s*\[/.test(line)) {
        if (found) break;
        if (line.includes('[' + ver + ']')) { found = true; continue; }
      }
      if (found) result.push(line);
    }
    console.log(result.join('\n').trim());
  " "$file" "$VERSION"
}

DESKTOP_NOTES=$(extract_notes "$ELECTRON_DIR/CHANGELOG.md")
MOBILE_NOTES=$(extract_notes "$CAPACITOR_DIR/www/nodejs/CHANGELOG.md")

# ── 4. Find previous tag ─────────────────────────────────
PREV_TAG=$(git -C "$SCRIPT_DIR" tag --list 'v*' --sort=-v:refname | grep -v "^${TAG}$" | head -1)
if [ -n "$PREV_TAG" ]; then
  ok "Previous tag: ${BOLD}${PREV_TAG}${NC}"
else
  warn "No previous tag found, skipping Full Changelog link"
fi

# ── 5. Assemble release body ─────────────────────────────
RELEASE_BODY=""

if [ -n "$DESKTOP_NOTES" ]; then
  RELEASE_BODY+=$'# Desktop\n\n'"$DESKTOP_NOTES"$'\n\n'
fi

if [ -n "$MOBILE_NOTES" ]; then
  RELEASE_BODY+=$'# Android\n\n'"$MOBILE_NOTES"$'\n\n'
fi

if [ -z "$RELEASE_BODY" ]; then
  fail "Could not extract release notes for ${TAG}"
fi

if [ -n "$PREV_TAG" ]; then
  RELEASE_BODY+=$'\n'"**Full Changelog**: https://github.com/${REPO}/compare/${PREV_TAG}...${TAG}"
fi
RELEASE_BODY+=$'\n'"**Discord Support Server**: ${DISCORD_LINK}"

log "Release body assembled"

# ── 6. Sync package.json versions ────────────────────────
log "Syncing package.json versions to ${VERSION}..."

update_pkg_version() {
  local pkg_file="$1"
  if [ -f "$pkg_file" ]; then
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('${pkg_file}', 'utf8'));
      if (pkg.version !== '${VERSION}') {
        pkg.version = '${VERSION}';
        fs.writeFileSync('${pkg_file}', JSON.stringify(pkg, null, 2) + '\n');
      }
    "
    ok "Synced $(basename "$(dirname "$pkg_file")")/package.json → ${VERSION}"
  fi
}

update_pkg_version "$ELECTRON_PKG"
update_pkg_version "$CAPACITOR_PKG"
update_pkg_version "$CAPACITOR_DIR/www/nodejs/package.json"

# Sync CHANGELOG to capacitor nodejs folder
if [ -f "$CAPACITOR_DIR/www/nodejs/CHANGELOG.md" ]; then
  cp "$CHANGELOG" "$CAPACITOR_DIR/www/nodejs/CHANGELOG.md"
  ok "Synced CHANGELOG.md to capacitor nodejs backend"
fi

# ── 7. Build Desktop (Electron) Application ──────────────
log "Building Desktop (Electron) frontend..."
npm run build --prefix "$ELECTRON_DIR/gui"
ok "Desktop frontend built"

log "Packaging Desktop application (Windows & Linux)..."
cd "$ELECTRON_DIR"
node -e "require('fs').rmSync('dist', { recursive: true, force: true });"
npx electron-builder --win --linux
ok "Desktop packaging complete"

# ── 8. Build Android (Capacitor) Application ─────────────
log "Building Android application (Capacitor)..."
cd "$CAPACITOR_DIR"
npm run package:android
ok "Android build complete"

# Copy signed release APK to DIST_DIR with clean versioned name
ANDROID_APK="$CAPACITOR_DIR/android/app/build/outputs/apk/release/app-release.apk"
if [ -f "$ANDROID_APK" ]; then
  NAMED_APK="$DIST_DIR/StrawVerse-${VERSION}.apk"
  cp "$ANDROID_APK" "$NAMED_APK"
  ok "Android APK copied to dist: $(basename "$NAMED_APK") ($(du -h "$NAMED_APK" | cut -f1))"
else
  fail "Android APK not found at $ANDROID_APK"
fi

# ── 9. Collect all release artifacts ──────────────────────
log "Collecting all release artifacts from ${BOLD}dist/${NC}..."
ARTIFACTS=()
for pattern in "*.apk" "*.exe" "*.AppImage" "*.deb" "*.snap" "*.zip" "latest-linux.yml" "latest.yml"; do
  while IFS= read -r -d '' f; do
    [[ "$f" == *.blockmap ]] && continue
    ARTIFACTS+=("$f")
    ok "$(basename "$f")  ($(du -h "$f" | cut -f1))"
  done < <(find "$DIST_DIR" -maxdepth 1 -name "$pattern" -print0 2>/dev/null)
done

[ ${#ARTIFACTS[@]} -eq 0 ] && fail "No release artifacts found in dist/"
log "Found ${BOLD}${#ARTIFACTS[@]}${NC} total artifacts to upload"

# ── 10. Create git tag ───────────────────────────────────
if git -C "$SCRIPT_DIR" rev-parse "$TAG" >/dev/null 2>&1; then
  warn "Tag ${TAG} already exists, skipping tag creation"
else
  log "Creating git tag ${BOLD}${TAG}${NC}..."
  git -C "$SCRIPT_DIR" tag "$TAG"
  git -C "$SCRIPT_DIR" push origin "$TAG"
  ok "Tag pushed to origin"
fi

# ── 11. Create GitHub release ────────────────────────────
log "Creating GitHub release ${BOLD}${TAG}${NC}..."

ASSET_ARGS=()
for f in "${ARTIFACTS[@]}"; do
  ASSET_ARGS+=("$f")
done

gh release create "$TAG" \
  --repo "$REPO" \
  --title "StrawVerse ${TAG}" \
  --notes "$RELEASE_BODY" \
  "${ASSET_ARGS[@]}"

ok "Release ${BOLD}${TAG}${NC} published!"
echo ""
echo -e "${GREEN}${BOLD}  🎉 Release live at: https://github.com/${REPO}/releases/tag/${TAG}${NC}"
echo ""
