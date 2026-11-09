# Architecture Overview

## 1. System Topology

StrawVerse is designed with an "embedded local micro-service" architecture. Instead of relying on a remote hosted backend, each StrawVerse client runs a localized backend instance alongside a unified Single Page Application (SPA).

```mermaid
flowchart TD
    Client[User Interaction] --> View[React Frontend / GUI]

    subgraph Desktop [Desktop Host: Electron]
        View --> |Local HTTP| ExpressD[Backend Express Server (Port 3000/dynamic)]
        View --> |contextBridge IPC| Preload[Electron Preload]
        Preload --> |IPC| Main[Electron Main Process (gui.js)]
        Main --> MPV[MPV Player Subprocess + IPC]
    end

    subgraph Mobile [Android Host: Capacitor]
        View --> |Local HTTP| ExpressA[nodejs-mobile Backend]
        View --> |Capacitor Plugin| Plugins[Custom Android Plugins]
        Plugins --> |JNI/Java| JavaCore[MainActivity / PlayerActivity / DB Bridge]
    end

    ExpressD --> DB1[(Local SQLite Database)]
    ExpressA --> DB2[(Local SQLite Database)]
    ExpressD --> Web[External Anime/Manga Providers & MAL API]
    ExpressA --> Web
```

---

## 2. Platform Execution Models

### 2.1 Desktop (Electron)

- **Main Process**: [`electron/gui.js`](../electron/gui.js) coordinates window creation, native menus, Discord Rich Presence, auto-updates, and MPV child process lifecycles.
- **Backend Spawn**: The Express server is booted either in-process or as an attached background process via [`backend/download.js`](../backend/download.js) / routes.
- **IPC Communication**: [`electron/preload.js`](../electron/preload.js) exposes typed APIs via `contextBridge` (`window.electronAPI`), strictly isolating Node.js capabilities from renderer scripts.

### 2.2 Mobile (Android / Capacitor)

- **Runtime Environment**: Uses `@capacitor-community/http` and `nodejs-mobile-capacitor` to package the complete Node.js engine inside the Android APK.
- **Native Player**: Playback on Android is offloaded from HTML5 video to native Android ExoPlayer through [`PlayerActivity.java`](../capacitor/android/app/src/main/java/app/strawverse/android/PlayerActivity.java).
- **Background Downloads**: Utilizes [`DownloadForegroundService.java`](../capacitor/android/app/src/main/java/app/strawverse/android/DownloadForegroundService.java) and [`NotificationActionReceiver.java`](../capacitor/android/app/src/main/java/app/strawverse/android/NotificationActionReceiver.java) to maintain persistent downloads even when the application is backgrounded or device memory is restricted.

---

## 3. Communication Patterns

### 3.1 REST API Over Local Loopback

The React frontend abstracts all communication through [`gui/src/utils/apiAdapter.js`](../gui/src/utils/apiAdapter.js). Whether running on desktop or mobile, the application connects to `http://127.0.0.1:<PORT>/api` for:

- Fetching catalogs, anime/manga details, and streams.
- Controlling download queues and tracking progress.
- Managing local database records, playlists, and watch histories.
- Authenticating with external services like MyAnimeList.

### 3.2 WebSocket & Server-Sent Events (SSE)

- Real-time download progress updates and queue lifecycle events are streamed from [`backend/routes/downloads.js`](../backend/routes/downloads.js) back to the UI.
- Log outputs and system alerts are emitted using standard event dispatchers to avoid polling.

### 3.3 Hardware & Native Bridge Pattern

- Frontend accesses native capabilities through [`gui/src/utils/nativeBridge.js`](../gui/src/utils/nativeBridge.js).
- Detects runtime (`isElectron`, `isAndroid`, `isWeb`) and delegates to `window.electronAPI` or `Capacitor.Plugins` seamlessly.

---

## 4. Security Architecture

1. **Context Isolation**:
   - In Electron, `nodeIntegration: false` and `contextIsolation: true` are strictly enforced. The renderer cannot execute arbitrary Node.js commands.
2. **Local Loopback Security**:
   - The Express backend binds to localhost/127.0.0.1 by default, preventing external network exposure on public interfaces.
3. **Cloudflare & Bot Protection Bypass**:
   - Dedicated Android [`CloudflareBypassPlugin.java`](../capacitor/android/app/src/main/java/app/strawverse/android/CloudflareBypassPlugin.java) and backend proxy headers resolve challenges using legitimate client headers and session cookies.
4. **Credential Isolation**:
   - MyAnimeList OAuth tokens and application settings are persisted in local encrypted storage or SQLite with PKCE authorization flows ([`backend/utils/pkce.js`](../backend/utils/pkce.js)).
