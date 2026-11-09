# StrawVerse Technical Documentation Index

Welcome to the comprehensive technical documentation for **StrawVerse**, an open-source anime and manga indexing, streaming, reading, and batch-downloading application built for Windows, Linux, and Android.

---

## Documentation Structure

| Document                                                      | Description                                                                                                          | Target Audience                        |
| :------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------- | :------------------------------------- |
| **[1. Architecture Overview](./ARCHITECTURE.md)**             | System topology, Electron/Capacitor execution models, Express backend, IPC, and security                             | Architects, Tech Leads, New Developers |
| **[2. Backend Core & Services](./BACKEND.md)**                | Express API routes, download engine, scraping subsystem, queueing, and SQLite database schema                        | Backend & Systems Developers           |
| **[3. Frontend Architecture](./FRONTEND.md)**                 | React 19 / Vite structure, dual-runtime API adapters, native bridges, state, and UI modules                          | Frontend & UI/UX Engineers             |
| **[4. Android & Capacitor Platform](./ANDROID_CAPACITOR.md)** | Embedded Node.js runtime, Java native bridges, Android ExoPlayer activity, foreground service, and Cloudflare bypass | Mobile & Android Developers            |
| **[5. Desktop & Electron Platform](./DESKTOP_ELECTRON.md)**   | Main process lifecycle, preloads, MPV player integration with IPC/LUA, and binary bundling                           | Desktop Engineers                      |
| **[6. Development & Deployment Guide](./DEVELOPMENT.md)**     | Local environment setup, build pipelines, cross-platform packaging, release automation, and scripts                  | Developers & DevOps Engineers          |

---

## High-Level System Architecture

```mermaid
graph TD
    subgraph UI_Layer [Frontend: React 19 + Vite]
        UI[React UI Components]
        API_Adapter[apiAdapter.js]
        Native_Bridge[nativeBridge.js]
        UI --> API_Adapter
        UI --> Native_Bridge
    end

    subgraph Runtime_Target [Target Platforms]
        direction TB
        subgraph Electron_Platform [Desktop: Electron]
            ElecMain[Electron Main Process (gui.js)]
            MPV[Embedded MPV Player + Lua Scripts]
            ElecPreload[Preload IPC Bridge]
            ElecMain --- ElecPreload
            ElecMain --> MPV
        end

        subgraph Android_Platform [Mobile: Capacitor Android]
            CapActivity[MainActivity / Capacitor WebView]
            CapBridge[DatabaseBridge / CloudflareBypassPlugin]
            ExoPlayer[ExoPlayer / PlayerActivity]
            ForegroundService[DownloadForegroundService]
            CapActivity --> CapBridge
            CapActivity --> ExoPlayer
            CapActivity --> ForegroundService
        end
    end

    subgraph Backend_Layer [Embedded Express Backend]
        Server[Express HTTP & WebSocket Server]
        Routes[API Routes: System, Media, Library, Downloads, MAL]
        Engine[Download Queue & Worker Engine]
        Scraper[Scraper & Consumet Provider Integration]
        DB[(Local SQLite Database)]

        Server --> Routes
        Routes --> Engine
        Routes --> Scraper
        Routes --> DB
        Engine --> DB
    end

    Native_Bridge -. IPC (contextBridge) .-> ElecPreload
    Native_Bridge -. Capacitor Plugins .-> CapBridge
    API_Adapter -- HTTP / REST --> Server
```

---

## Key System Characteristics

1. **Dual-Runtime Execution**:
   - **Desktop**: Express backend runs as a child or internal worker within Electron Node.js runtime; UI is loaded into Chromium window; media playback uses native MPV or HTML5 video.
   - **Android**: Embedded `nodejs-mobile` executes the backend inside the APK; UI runs within Android WebView powered by Capacitor; native ExoPlayer activity (`PlayerActivity.java`) handles 4K/1080p playback and hardware decoding.

2. **Decoupled API Architecture**:
   - The frontend communicates with the backend via standard HTTP REST endpoints (`/api/...`), enabling unified behavior regardless of whether running inside Electron or Android.

3. **Concurrency-Managed Downloader Engine**:
   - Dynamic per-domain rate limiting, exponential backoff, circuit breaking, and retry queues prevent IP blocking across third-party media and scraper CDNs.

4. **Zero-Cloud Dependency**:
   - Complete local offline management with embedded SQLite storage (`sqlite3` / `node:sqlite` fallback or native bridge).
