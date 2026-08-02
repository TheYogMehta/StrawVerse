# Changelog

## [9.1.1] - 2026-08-03

### Anime Streaming & Offline Downloads

- **Fixed Wrong Video Playing Bug**: Fixed a bug where clicking any anime episode kept playing the video from the last anime you watched because video link caching was mistakenly sharing one key for all videos.
- **Adaptive Concurrency Auto-Scaler & AnimePahe Fix**: Dynamic per-domain download concurrency auto-scaling stored in SQLite. Automatically halves worker concurrency when rate-limited (HTTP 429) and steps up during smooth downloads, resolving AnimePahe/Kwik download failures.

### Settings & UI Fixes

- **Watch Together Settings Cleanup**: Removed unused Watch Together server settings section and configuration controls from the Settings panel.
- **Image Cache Stats & Import Fix**: Resolved `ImageCacheManager is not defined` backend route error and added safe numeric fallback handling for image cache usage statistics (`MB` & file count display).

## [9.1.0] - 2026-08-03

### Initial Release

### Native Video Player & Touch Gestures

- **Picture-in-Picture (PiP) Mode**: Continue watching anime in a floating window while multitasking on your device.
- **In-Player Controls & Quality Selection**: Switch video stream quality, server sources, audio tracks (Dub/Sub), and subtitles directly inside the player.
- **Intuitive Touch Gestures**: Double-tap left/right to seek 10s backward/forward, swipe vertically to adjust screen brightness and volume, and smooth timeline drag seeking.
- **Playback Enhancements**: One-tap intro/outro skip buttons and playback speed control (0.25x to 2.0x).

### Anime Streaming & Offline Downloads

- **High-Performance Streaming & Faster Cloudflare Bypass**: Smooth playback with automatic security header/cookie handling and faster challenge resolution on protected sources.
- **Offline Batch Downloads & Notifications**: Download full series or selected episodes directly to your device, with real-time download progress and error notifications.
- **Gallery Auto-Hide**: Keeps app media assets and downloaded covers hidden from your device photo gallery.
- **Subtitle Language Preference**: Prioritizes subtitle downloads and streams based on your preferred languages setting.
- **Smart Folder Cleanup**: Automatically cleans up empty download directories while preserving your library tracking data.

### Catalog & Library Management

- **MyAnimeList Integration**: Track watch/read progress, prioritize high-resolution MAL cover art, and filter your library by status (Watched, Unwatched, Read, Unread).
- **Catalog Exploration & Tagging**: Browse airing calendars, detailed media info, expandable show descriptions, and custom library tags.
- **Download Path Fixes**: Resolved folder name handling to prevent duplicate or invalid series download paths.
