#!/bin/bash
# Patches CapacitorNodeJS.java to intercept db-* bridge events
# and configure Strawverse external storage directories in environment variables.
# Copies DatabaseBridge.java into net.hampoelz.capacitor.nodejs package.
#
# This script is called by Gradle before compiling the capacitor-nodejs module.

set -e

TARGET_FILE="$1"

if [ -z "$TARGET_FILE" ]; then
  echo "Usage: patch-capacitor-nodejs.sh <path-to-CapacitorNodeJS.java>"
  exit 1
fi

if [ ! -f "$TARGET_FILE" ]; then
  echo "ERROR: File not found: $TARGET_FILE"
  exit 1
fi

# Get the directory of CapacitorNodeJS.java
TARGET_DIR=$(dirname "$TARGET_FILE")
SCRIPT_DIR=$(dirname "$0")

# Copy DatabaseBridge.java into the same package directory
echo "Copying DatabaseBridge.java to: $TARGET_DIR"
cp "$SCRIPT_DIR/DatabaseBridge.java" "$TARGET_DIR/DatabaseBridge.java"

# Check if CapacitorNodeJS.java is already patched
if grep -q "DatabaseBridge" "$TARGET_FILE"; then
  echo "Already patched: $TARGET_FILE"
  exit 0
fi

echo "Patching: $TARGET_FILE"

# 1. Add the db-* event intercept in receiveMessage()
# We insert BEFORE the line: eventNotifier.channelReceive(eventName, args);
# The intercept checks if eventName starts with "db-" and routes to DatabaseBridge
sed -i '/eventNotifier\.channelReceive(eventName, args);/i \
                // ── Database bridge: intercept db-* events ──\
                if (eventName != null \&\& eventName.startsWith("db-")) {\
                    final NodeProcess np = nodeProcess;\
                    DatabaseBridge.getInstance().handleRequest(context, eventName, args,\
                        (ch, msg) -> np.send(ch, msg));\
                    return;\
                }' "$TARGET_FILE"

# 2. Add custom Strawverse directory setup to Node environment variables
# We replace the environment variable configuration with:
# - NODEJS_MOBILE_DATA_DIR pointing to public storage root (/storage/emulated/0/Strawverse)
# - STRAWVERSE_PUBLIC_ROOT pointing to public storage root (/storage/emulated/0/Strawverse)
sed -i '/nodeEnv.put("DATADIR", dataPath);/ {
    N
    N
    c\
            nodeEnv.put("DATADIR", dataPath);\
            \/\/ ─── Custom Strawverse Directory Resolution ───\
            java.io.File appSpecificRoot = new java.io.File(context.getExternalFilesDir(null), "Strawverse");\
            java.io.File extStorage = android.os.Environment.getExternalStorageDirectory();\
            java.io.File publicRoot = new java.io.File(extStorage, "Strawverse");\
            boolean usePublic = false;\
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {\
                if (android.os.Environment.isExternalStorageManager()) {\
                    usePublic = true;\
                }\
            } else {\
                try {\
                    if (!publicRoot.exists()) {\
                        usePublic = publicRoot.mkdirs();\
                    } else {\
                        java.io.File testFile = new java.io.File(publicRoot, ".test_write");\
                        if (testFile.createNewFile()) {\
                            testFile.delete();\
                            usePublic = true;\
                        }\
                    }\
                } catch (Exception e) {\
                    usePublic = false;\
                }\
            }\
            if (!usePublic) {\
                publicRoot = appSpecificRoot;\
            }\
            \
            \/\/ Pre-create all requested directories under publicRoot\
            new java.io.File(publicRoot, "data").mkdirs();\
            new java.io.File(publicRoot, "Anime").mkdirs();\
            new java.io.File(publicRoot, "Manga").mkdirs();\
            java.io.File scrapperRoot = new java.io.File(publicRoot, "scrapper");\
            new java.io.File(scrapperRoot, "Anime").mkdirs();\
            new java.io.File(scrapperRoot, "Manga").mkdirs();\
            new java.io.File(scrapperRoot, "ico").mkdirs();\
            \
            nodeEnv.put("NODEJS_MOBILE_DATA_DIR", publicRoot.getAbsolutePath());\
            nodeEnv.put("STRAWVERSE_PUBLIC_ROOT", publicRoot.getAbsolutePath());\
            nodeEnv.put("NODE_PATH", modulesPaths);\
            nodeEnv.putAll(env);
}' "$TARGET_FILE"

# 3. Add permission wait loop to Node engine background thread
sed -i '/Thread engine = new Thread(() -> {/a \
            while (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R \&\& !android.os.Environment.isExternalStorageManager()) {\
                try {\
                    Thread.sleep(250);\
                } catch (InterruptedException e) {\
                    return;\
                }\
            }' "$TARGET_FILE"

echo "Patch applied successfully."
