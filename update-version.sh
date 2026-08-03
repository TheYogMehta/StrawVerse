#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo -e "\033[0;31mError: Please provide a version number.\033[0m"
  echo "Usage: $0 <version>"
  echo "Example: $0 9.1.2"
  exit 1
fi

NEW_VERSION="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo -e "\033[0;33mWarning: '$NEW_VERSION' does not match standard semver format (x.y.z).\033[0m"
fi

echo -e "\033[0;36mUpdating version to \033[1m${NEW_VERSION}\033[0m...\033[0m"

FILES=(
  "capacitor/www/nodejs/package.json"
  "capacitor/package-lock.json"
  "capacitor/package.json"
  "electron/package-lock.json"
  "electron/package.json"
)

for file in "${FILES[@]}"; do
  filepath="$SCRIPT_DIR/$file"
  if [ -f "$filepath" ]; then
    node -e "
      const fs = require('fs');
      const file = process.argv[1];
      const newVer = process.argv[2];
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.version = newVer;
      if (data.packages && data.packages['']) {
        data.packages[''].version = newVer;
      }
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    " "$filepath" "$NEW_VERSION"
    echo -e "  \033[0;32m✓\033[0m Updated $file"
  else
    echo -e "  \033[0;31m✗\033[0m File not found: $file"
  fi
done

GRADLE_FILE="$SCRIPT_DIR/capacitor/android/app/build.gradle"
if [ -f "$GRADLE_FILE" ]; then
  node -e "
    const fs = require('fs');
    const file = process.argv[1];
    const newVer = process.argv[2];
    let content = fs.readFileSync(file, 'utf8');
    
    // Update versionName
    content = content.replace(/versionName\s+[\"'].*?[\"']/, \`versionName \"\${newVer}\"\`);
    
    // Increment versionCode
    content = content.replace(/versionCode\s+(\d+)/, (match, code) => {
      const newCode = parseInt(code, 10) + 1;
      return \`versionCode \${newCode}\`;
    });
    
    fs.writeFileSync(file, content);
  " "$GRADLE_FILE" "$NEW_VERSION"
  echo -e "  \033[0;32m✓\033[0m Updated capacitor/android/app/build.gradle (versionName & bumped versionCode)"
else
  echo -e "  \033[0;31m✗\033[0m File not found: capacitor/android/app/build.gradle"
fi

echo -e "\n\033[0;32mSuccessfully updated all version fields to \033[1m${NEW_VERSION}\033[0m!\033[0m"
