# Android & Capacitor Platform

## 1. Overview

StrawVerse for Android is built using Capacitor with an embedded Node.js backend. This allows the complete scraping, downloading, and SQLite database stack to run locally on mobile devices without requiring cloud servers.

```mermaid
graph TD
    App[Android StrawVerse App]
    
    subgraph Frontend_Host [Capacitor WebView]
        Web[React GUI (HTML/JS/CSS)]
    end

    subgraph Node_Host [nodejs-mobile Runtime]
        NodeEngine[Node.js Engine (C++ / POSIX thread)]
        Backend[Express Server (backend/)]
        NodeEngine --> Backend
    end

    subgraph Native_Android [Java Native Layer]
        MainAct[MainActivity.java]
        PlayerAct[PlayerActivity.java (ExoPlayer)]
        CFPlugin[CloudflareBypassPlugin.java]
        DBBridge[DatabaseBridge.java]
        Service[DownloadForegroundService.java]
    end

    App --> Frontend_Host
    App --> Node_Host
    App --> Native_Android

    Web <-->|Bridge Message Events| NodeEngine
    Web <-->|Capacitor Plugins| CFPlugin
    Web -->|Intent / Launch| PlayerAct
    NodeEngine -->|HTTP Loopback| Web
    Service -->|Keep-Alive| NodeEngine
```

---

## 2. Directory Structure

```text
capacitor/
├── capacitor.config.json    # Capacitor configuration & Android app ID
├── package.json             # Capacitor dependencies & sync scripts
├── scripts/
│   ├── bundle-backend.mjs   # Bundles backend/ into capacitor/www/nodejs
│   ├── fetch-ffmpeg.mjs     # Fetches mobile prebuilt ffmpeg binaries
│   ├── patch-gradle.mjs     # Injects custom Gradle tasks
│   └── sync.mjs             # Synchronizes GUI dist & backend into Android assets
├── www/                     # Web assets and packaged Node.js engine
│   ├── nodejs/              # Packaged Node backend executed on Android
│   └── index.html           # Compiled React frontend
└── android/                 # Android Native Gradle Project
    └── app/src/main/java/app/strawverse/android/
        ├── MainActivity.java                # Main entry point for Capacitor
        ├── PlayerActivity.java              # Native ExoPlayer 4K/1080p video player
        ├── CloudflareBypassPlugin.java      # Headless WebView Cloudflare challenge solver
        ├── DownloadForegroundService.java   # Android Foreground Service for persistent downloads
        ├── DownloadNotificationManager.java # Dynamic status bar progress notification
        ├── NotificationActionReceiver.java  # Notification click actions (Pause/Cancel)
        ├── DatabaseBridge.java              # High-performance Android SQLite bridge
        ├── KwikDataSource.java              # Custom ExoPlayer data source for custom headers
        └── HighlightsOverlayView.java       # Visual overlay rendering for player highlights
```

---

## 3. Key Native Components

### 3.1 Embedded Node.js (`nodejs-mobile`)
- The backend directory is bundled into `capacitor/www/nodejs/` via [`capacitor/scripts/bundle-backend.mjs`](../capacitor/scripts/bundle-backend.mjs).
- When the Android app starts, `nodejs-mobile` spawns the Express server on local loopback.
- The UI detects the server address and starts communicating via standard HTTP REST.

### 3.2 Native Player Activity ([`PlayerActivity.java`](../capacitor/android/app/src/main/java/app/strawverse/android/PlayerActivity.java))
- When users watch video on Android, `PlayerActivity` is launched via an explicit Android Intent.
- Uses Google's **ExoPlayer** for hardware accelerated HLS playback, subtitle rendering, and aspect ratio management.
- Supports background playback, Picture-in-Picture (PiP), and custom HTTP request headers via [`KwikDataSource.java`](../capacitor/android/app/src/main/java/app/strawverse/android/KwikDataSource.java).

### 3.3 Cloudflare Challenge Bypass ([`CloudflareBypassPlugin.java`](../capacitor/android/app/src/main/java/app/strawverse/android/CloudflareBypassPlugin.java))
- Intercepts requests blocked by Cloudflare turnstile or bot protection.
- Runs an off-screen Android WebView instance with genuine device headers, collects `cf_clearance` cookies and session tokens, and returns them to the backend scraper.

### 3.4 Foreground Download Service ([`DownloadForegroundService.java`](../capacitor/android/app/src/main/java/app/strawverse/android/DownloadForegroundService.java))
- Prevents the Android operating system from killing background download tasks during low memory conditions or screen lock.
- Updates download status, current file, and percentage in real-time on Android notification trays via [`DownloadNotificationManager.java`](../capacitor/android/app/src/main/java/app/strawverse/android/DownloadNotificationManager.java).
