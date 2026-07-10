#!/usr/bin/env bash

# StrawVerse Installer Script
# Usage: curl -fsSL https://raw.githubusercontent.com/TheYogMehta/StrawVerse/main/install.sh | bash

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

log() { echo -e "${BLUE}[install]${NC} $*"; }
ok() { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }
error() { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }

log "Starting StrawVerse installation..."

# Check dependencies
for cmd in curl grep cut head chmod mkdir; do
    if ! command -v "$cmd" &> /dev/null; then
        error "Required command '$cmd' is not installed. Please install it and try again."
    fi
done

# Get latest release AppImage URL from GitHub API
log "Fetching latest release information..."
REPO="TheYogMehta/StrawVerse"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

RELEASE_JSON=$(curl -s "$API_URL")

# Extract version and download URL
VERSION=$(echo "$RELEASE_JSON" | grep -m 1 '"tag_name":' | cut -d '"' -f 4)
if [ -z "$VERSION" ]; then
    error "Could not fetch the latest version information."
fi

APPIMAGE_URL=$(echo "$RELEASE_JSON" | grep "browser_download_url" | grep -i "\.AppImage" | cut -d '"' -f 4 | head -n 1)
if [ -z "$APPIMAGE_URL" ]; then
    error "Could not find an AppImage in the latest release ($VERSION)."
fi

log "Found StrawVerse version ${BOLD}${VERSION}${NC}"

# Directories
BIN_DIR="${HOME}/.local/bin"
ICON_DIR="${HOME}/.local/share/icons"
APP_DIR="${HOME}/.local/share/applications"

log "Creating directories..."
mkdir -p "$BIN_DIR"
mkdir -p "$ICON_DIR"
mkdir -p "$APP_DIR"
ok "Directories created or verified."

# Download AppImage
TARGET_BIN="${BIN_DIR}/strawverse"
log "Downloading StrawVerse AppImage from: ${CYAN}${APPIMAGE_URL}${NC}"
if ! curl -L -# -o "$TARGET_BIN" "$APPIMAGE_URL"; then
    error "Failed to download AppImage."
fi
chmod +x "$TARGET_BIN"
ok "AppImage downloaded and made executable at: ${BOLD}${TARGET_BIN}${NC}"

# Download Icon
ICON_URL="https://raw.githubusercontent.com/${REPO}/main/src/assets/luffy.png"
TARGET_ICON="${ICON_DIR}/strawverse.png"
log "Downloading application icon..."
if curl -fsSL -o "$TARGET_ICON" "$ICON_URL"; then
    ok "Icon downloaded to: ${BOLD}${TARGET_ICON}${NC}"
else
    warn "Failed to download icon. Desktop entry will use a fallback icon."
fi

# Create desktop entry
DESKTOP_FILE="${APP_DIR}/strawverse.desktop"
log "Creating desktop entry at: ${BOLD}${DESKTOP_FILE}${NC}"
cat <<EOF > "$DESKTOP_FILE"
[Desktop Entry]
Name=StrawVerse
Exec=${TARGET_BIN}
Icon=${TARGET_ICON}
Type=Application
Categories=Multimedia;Video;
Comment=Ridiculously efficient, fast and light-weight anime and manga manager.
Terminal=false
MimeType=x-scheme-handler/strawverse;
EOF
ok "Desktop entry created."

# Check if bin directory is in PATH
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    warn "${BOLD}~/.local/bin${NC} is not in your current ${BOLD}PATH${NC}."
    echo -e "To run StrawVerse from the terminal by typing ${CYAN}strawverse${NC}, please add it to your PATH."
    echo -e "You can do this by adding the following line to your shell configuration file (e.g., ${BOLD}~/.bashrc${NC} or ${BOLD}~/.zshrc${NC}):"
    echo -e "  ${BOLD}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
    echo ""
fi

log "${GREEN}${BOLD}StrawVerse installation completed successfully!${NC}"
log "You can now run StrawVerse from your applications menu or by executing ${CYAN}strawverse${NC} in the terminal."
