# Changelog

# [11.2.0] - 2026-11-09

### Manga Reader Improvements

- **Accurate Online vs. Downloaded Chapter Routing:** Fixed an issue where reading an online chapter (e.g. Chapter 3) when earlier chapters were downloaded locally incorrectly labeled the chapter as local and served Chapter 1's pages. Online streams now strictly fetch and display the requested online chapter.
- **Android & Mobile Reader Optimization:** Immersive fullscreen reading experience on mobile by hiding the bottom app navigation bar while reading, eliminating layout overlap with the floating page pill. Compacted top bar controls so chapter and page selectors fit cleanly without overflowing on narrow screens.
- **Simplified Chapter Selector:** Removed redundant `(Downloaded)` labels from the chapter selector dropdown since local/online status is already clearly badged on the right.
- **Background Image Preloading:** Single-page and double-page modes now preload upcoming (5 pages ahead) and previous (2 pages) images in the background so you can flip through pages smoothly without loading spinners.
- **Pinch to Zoom on Mobile:** You can now smoothly pinch with two fingers to zoom in and out of manga pages on your phone or tablet. Your preferred zoom size is saved automatically.
- **Keyboard Zoom Shortcuts:** Easily adjust page width on desktop with `Ctrl +` and `Ctrl -`.
- **Cleaner Reading View:** Removed extra title text from the top bar to give you more room to read, and added convenient previous/next buttons plus a page jump menu to hop straight to any page.
- **Help & Shortcuts Guide:** Tap the new info icon in the top right (or press `?` on your keyboard) to open a handy guide showing all gestures and keyboard shortcuts.

### Settings & Download Locations

- **Separate Anime & Manga Settings Tabs:** Split the combined settings view into two dedicated navigation tabs for Anime Settings and Manga Settings for cleaner organization.
- **Independent Download Folders:** Set custom download directories independently for anime and manga. By default, media saves to `<Downloads>/Anime` and `<Downloads>/Manga` (or `/StrawVerse/Anime` and `/StrawVerse/Manga` on Android).
- **Direct Custom Folder Saving & File Manager Opener:** Choosing a custom download folder (e.g. `Downloads/MyFolder`) downloads media directly inside that folder without generating redundant subdirectories. Fixed the folder opener in the library/details view to properly resolve custom download locations.
- **Downloads Tab Custom Location Scanning:** Enhanced the Library "Downloads" tag filter to scan across custom download directories, ensuring downloaded anime and manga reliably display under the Downloads tab.
- **Android Custom Locations:** Android users can now customize download directories for both anime and manga directly from the mobile app.
- **Download File Naming Schemes & Automatic Migration:** Choose your preferred file naming pattern for anime and manga (.cbz formatting). Changing the manga naming scheme in Settings now automatically renames existing downloaded chapters to match the selected scheme, and ensures all subsequent downloads strictly follow the new format.

### Extensions & Marketplace

- **Quick "In Use" Provider Switcher:** Activate and switch your default anime and manga providers directly from the Extensions / Marketplace view without having to open Settings.
- **Faster, Lighter Extension Updates:** The app now only downloads what has actually changed for each of your installed extensions rather than re-downloading entire databases, saving data and keeping syncing fast.
- **Smoother Extension Installs:** Handled extension installation errors gracefully with automatic rollback to keep your extensions folder clean and reliable.

### Details & Info Page

- **Single-Line Desktop Toolbar:** Aligned the in-page search box, sort selector, language controls, and bulk selection controls onto a single row on desktop viewports.
- **Select & Copy Title & Description:** Easily select and copy text from anime and manga titles and descriptions via keyboard (`Ctrl + C`) or mobile text selection.

### Catalog, Discover & Filters

- **Airing Calendar:** Discover and keep track of currently airing anime with the new weekly release schedule calendar.
- **Genre Filters & Scroll Position Retention:** Filter titles effortlessly by genre, and seamlessly return to your exact browsing position when navigating back to the catalog.
- **More Poster Columns & Layout Options:** Expanded grid layout options to support up to 12 columns on wide screens, along with adjustable poster height settings so your library looks great on any display.
- **Dedicated Watch & Reading Filters:** Distinct "Watching" status for anime and "Reading" status for manga with accurate MyAnimeList account syncing and a helpful sign-in prompt when disconnected.

### Smarter History & Progress Tracking

- **Smarter "Continue" Button:** The app now intelligently figures out your next chapter or episode, seamlessly recognizing whether you are picking up where you left off or re-reading an earlier chapter.
- **Mark Multiple Episodes / Chapters at Once:** Easily select several episodes or chapters to mark them all as watched, read, unwatched, or unread in a single click.
- **Edit Watch Dates & Progress:** Click the new clock icon on any episode or chapter to tweak your progress or change the date and time you completed it, with handy "Now" and "Yesterday" quick buttons.
- **Restore Hidden Continue Shelf Titles:** Accidentally hid a show from your Continue Watching or Continue Reading shelf? You can now view and restore hidden titles anytime directly in Settings.

### Jellyfin & Plex Media Server Integration

- **Jellyfin & Plex Compatibility Mode:** Added a toggle in Anime Settings (Desktop). When enabled, anime downloads automatically follow standard Jellyfin and Plex naming conventions.
- **Automatic Metadata & Artwork:** When enabled, StrawVerse automatically generates show summaries, episode details, and poster artwork in your download folders so titles display properly in Jellyfin and Plex without needing online scrapers.
- **External Subtitle Detection:** Subtitle files are automatically matched so Jellyfin, Plex, and local players detect and load them seamlessly.
- **Automatic Background Sync:** Turning the setting on automatically updates your existing downloads in the background, and newly completed downloads are prepared automatically. Existing files remain untouched if turned off.

### Recommended Media Server Plugins / Extensions

- **For Jellyfin Users:**
  - Install the **Jellyfin Anime Plugin** (or community MyAnimeList / AniList metadata plugins via Jellyfin Dashboard -> Plugins -> Catalog) to utilize MyAnimeList IDs embedded in StrawVerse's `tvshow.nfo`.
  - In your Jellyfin Library settings, ensure the **Nfo** metadata reader is enabled so Jellyfin prioritizes your local artwork and synopsis.
- **For Plex Users:**
  - In your Plex Library settings (`Manage Library -> Edit -> Advanced`), set **Local Assets** to _Prefer local metadata_ so Plex uses the local `poster.jpg` and metadata files directly.

### macOS Apple Silicon Support

- **Native macOS (arm64) Desktop Support:** StrawVerse now runs natively on macOS Apple Silicon (M1/M2/M3/M4) Macs with dedicated DMG installer and portable ZIP packages.
- **macOS Window Lifecycle & Deep-Linking:** Full macOS integration with dock click handling (reopening minimized windows), clean window close behavior, and custom protocol (`strawverse://`) deep-linking.

### Speed, Stability & Engine

- **Database & Dynamic Provider Query Hardening:** Dynamic provider mapping queries now validate schemas and handle missing tables safely without sync errors.
- **Cleaned Internal Server Configuration:** Streamlined internal server settings and standardized internal bridge ports for a lighter, faster app.

### Security & Safety

- **Media Streaming Protection:** Fixed a security vulnerability in how video streams and subtitle files are accessed to keep local files strictly protected (GHSA-g8jx-jpcr-7jp6).
- **Safer Android File Extraction:** Updated internal app packages on Android to eliminate potential security risks during archive and file extraction.

### New Contributors & Special Thanks

- Special thanks to **@AmarilloNL** for their contributions to Jellyfin & Plex media server integration, NFO metadata generation, and sidecar subtitle support!
- Special thanks to **@cyber-winner** for their contributions to extension installation error handling and scraper loading rollback!
- Special thanks to **@satoridev01** for responsibly disclosing the media/subtitles security vulnerability!
- Special thanks to **@Buff-alo** for their contributions to native macOS Apple Silicon (arm64) support, MPV and FFmpeg binary packaging, and macOS window lifecycle integration!

# [11.1.1] - 2026-10-26

### Android Updates & Notifications

- **Tap to Install from Notification Bar:** When an app update finishes downloading, you can now tap the notification directly in your Android notification shade to open the installer immediately

### Mobile & Marketplace

- **Fixed Broken Mobile Marketplace Layout:** extension cards were cut off on the left with blank space on the right on mobile screens. The header buttons and tabs now wrap neatly to fit your phone.

### Database & Mapping Stability

- **Fixed Mapping Sync Errors:** Fixed an issue where mapping database updates would fail on mobile due to missing unmapped tables and schema differences, ensuring updates apply smoothly.

# [11.1.0] - 2026-10-25

### Discover, Filters & Browsing

- **New Dedicated Filters Page:** Added a full-featured Filters page allowing you to easily browse and discover anime and manga by Genre (Action, Romance, Isekai, etc.), Release Season, Year, Format (TV, Movie, OVA, Manga, Manhwa), Airing Status, and your MyAnimeList watch status.
- **Filter by Extension / Mapped Status:** You can now filter specifically for titles linked to MyAnimeList or browse unmapped titles unique to your installed community extensions.
- **Better Discover Covers:** Fixed an issue where new episode releases on the Discover tab would display wide video screenshots instead of vertical poster covers ( pahe ).

### Library & Organization

- **Added "Completed" Status:** You can now mark your anime and manga as "Completed" directly from the library tags dropdown, matching the rest of your watching and reading lists.
- **Cleaner Library Menu:** Streamlined the library tags list so internal download labels no longer clutter your status selection.

### Extensions & Sources

- **Fixed Extension Icons:** Fixed community extension icons (.ico) not displaying in Settings and player source dropdowns so they show up everywhere consistently just like in the Marketplace.
- **Smarter Source Linking:** AnimePahe links now lock onto the anime's title so your library and watch history stay connected even when provider links or IDs change behind the scenes.
- **Synced Custom Mappings:** When linking an anime or manga manually, detailed titles, episode counts, and poster art now link seamlessly across providers and your library.
- **Scoped Extension Mapping & Instant Cleanup:** Installing an extension now only fetches mapping and unmapped metadata for that specific provider instead of transferring unnecessary database records. Deleting an extension immediately purges its mapping tables, unmapped items, and settings from your device.
- **Compacted Delta Sync & Auto-Reconciliation:** Delta mapping updates are squashed to transmit only the latest net state for installed extensions. Local manual links and unmapped entries are automatically reconciled and pruned when server mappings arrive, eliminating duplicate metadata.
- **Dynamic Catalog Filters & Clean Metadata:** The Catalog source dropdown now strictly shows installed extensions that have unmapped results.

# [11.0.4] - 2026-10-25

### Android Extensions & Marketplace

- **Fixed Extension Downloads on Android:** Fixed a bug where installing or updating anime and manga extensions on Android would show a false "App Update Required" error or refuse to download.
- **Custom Repositories on Android:** You can now add and remove community extension repositories directly in the mobile app.
- **Smoother & Faster Mobile Downloads:** Extension files, icons, and marketplace updates on Android now download through your phone's native network connection, making them much faster and more reliable.

### Video Player & Streaming Improvements

- **Fixed Anime Playback Issues:** Resolved stream failures on sources like Anikoto where episodes would get stuck on a loading screen or fail to play.
- **Instant Video Loading:** Fixed internal player communication so that video streams, quality options, and subtitles load immediately without errors.

# [11.0.3] - 2026-10-24

### Video Player & Streaming Fixes

- **Anikoto & HLS Streaming Fix:** Resolved an issue where HLS streams (e.g., from Anikoto) failed to buffer or load in MPV due to demuxer segment restrictions and proxy URL routing.
- **Enhanced Segment Streaming & Byte-Range Support:** Added `.ts` extension support and partial content byte-range handling (`206 Partial Content`) to the local stream proxy, enabling smooth segment buffering and seeking in MPV.
- **MPV Demuxer & Header Hardening:** Configured MPV's libavformat demuxer (`allowed_extensions=ALL,allowed_segment_extensions=ALL`) and fixed comma escaping in HTTP header fields so providers with complex tokens or custom headers load without misparsing.
- **Stream Clearance Retries:** Added automatic Cloudflare clearance retry handling to video segment proxy requests to reliably recover from transient 403/503 errors during playback.

### Security & Dependency Updates

- **Security Hardening:** Updated `@electron/get` to mitigate transitive `sprintf-js` prototype pollution vulnerabilities.
- **Dependencies Bump:** Updated `vite` and frontend dependencies to their latest stable releases.

# [11.0.2] - 2026-10-16

### Video Player & Streaming

- **Faster Video Playback:** Direct video streams (`.mp4`, `.mkv`) and local files now open and seek instantly in MPV without buffering delays.
- **Fixed Crash on Titles with Commas:** Fixed an issue where anime titles or folder paths containing commas caused the video player to fail on launch.
- **Instant Local File Playback:** Fixed an issue where locally downloaded files would show a loading spinner on startup instead of playing immediately.
- **Subtitle Fixes:** Subtitle tracks now load reliably and display correctly for preferred languages.
- **Protected Stream Support:** Improved playback reliability for protected media hosts, preventing 403 playback errors.

### Downloads & Library

- **Fast Multi-Part Downloads:** Direct video files (`.mp4`, `.mkv`) now download in parallel chunks with automatic resume support and accurate speed and progress tracking.
- **Protected Server Downloads:** Fixed download failures and 403 errors on protected video servers.
- **Open in File Manager:** Clicking the folder button on downloaded episodes and chapters now opens your system file manager (Explorer, Thunar/Dolphin, or Android Files) instead of opening a media player like VLC.

### User Interface

- **Clean Source Switcher:** The source provider selector now only displays providers that have verified mappings for the current title, hiding unmapped extensions.

### Android Mobile

- **Engine Boot Fix:** Resolved an engine crash on Android during app startup.

### Background Checks

- **Fewer Verification Windows:** Background site integrity checks now run only for your active providers, preventing inactive scrapers from opening Cloudflare verification windows while watching videos.

# [11.0.1] - 2026-10-15

### Downloader & Network Improvements

- **Chromium `net::ERR_FAILED` Elimination:** Aligned downloader request headers directly with the stream proxy (`getMediaRequestHeaders`), stripping forbidden browser-internal headers (`sec-*`, `host`, `connection`, `origin` on GET) across `downloader.js` and `electronNetAdapter`.
- **Domain Agnostic Cloudflare Bypass:** Removed legacy hardcoded domain checks (`owocdn`, `uwucdn`, `kwik`) in favor of generic referer-based Turnstile clearance bypass across `downloader.js` and `media.js`.
- **Direct Video (.mp4) Downloads:** Added immediate pre-check in `DownloadsChecking` to bypass M3U8 text playlist extraction for direct binary video streams (`.mp4`, `.mkv`, `.webm`), preventing memory exhaustion and socket timeouts.
- **Resilient Server Reachability Probing:** Improved download server selection in `queue.js` by preserving unverified candidate streams if reachability probes fail or encounter Cloudflare challenges, allowing the downloader's retry and bypass mechanisms to resolve them.
- **Network Error Clearance Retries:** Enhanced downloader clearance retry logic to detect Chromium network errors (`net::ERR_*`) and automatically trigger clearance refresh.
- **Dynamic Referer Propagation:** Added automatic referer propagation on variant playlist selection and segment retrieval to prevent 403 Forbidden errors on hosts requiring origin tracking.

### Extension Icons & Namespace Scoping

- **Scoped Extension Icons:** Extension icons are now downloaded and stored within `<RepoOwner>/<ExtensionName>.ico` scoped folders in `ScraperIcons`, eliminating icon collisions across different providers.
- **Legacy Root Icon Cleanup:** Automatically cleans up obsolete root `.ico` files upon installing or updating scoped extensions.

### Database & Network Stability

- **IPv4 Fallback on Mapping Updater:** Enforced IPv4 socket connections in `mappingUpdater.js` to prevent IPv6 `connect ENETUNREACH` failures when syncing the mapping database from cloud servers.

# [11.0.0] - 2026-10-14

### Decentralized Extensions & Multi-Repo Marketplace

- **Decentralized Extension Repositories:** Anyone can now create, host, and maintain their own StrawVerse extensions repository on GitHub. Add third-party repositories via GitHub repo URL or direct `marketplace.json` link using the new **+ Add Repo** button in the Marketplace.
- **Scoped Extension Namespaces:** Extensions are installed and loaded into scoped directories (`/Anime/<REPO_OWNER>/<EXTENSION>.js` and `/Manga/<REPO_OWNER>/<EXTENSION>.js`), allowing multiple creators to develop extensions for the same site without file collisions.
- **Creator Badges & Repository Manager:** Extensions display `@repoOwner` badges (with official verification badges for `@TheYogMehta`). A dedicated **Repos** manager lets you inspect and remove added repositories.

### Extension Security Sandbox

- **Static AST & Code Analysis:** Extensions undergo safety verification before download and installation. Any scraper attempting to access restricted Node.js modules or dangerous operations (`child_process`, `fs`, `worker_threads`, `cluster`, `process.exit`, etc.) is blocked.
- **Runtime Module Interceptor:** Built-in module resolution blocks extensions from requiring unauthorized system libraries at runtime.

### Core Architecture & Extension Decoupling

- **Decoupled Extension Hooks:** Site-specific logic (such as integrity canary checks and mapping database reporting) has been extracted from the StrawVerse core into generic scraper hooks (`onInfoFetched`, `checkCanary`).
- **Compatibility Verification:** Marketplace and scraper loader now verify `MinAppVersion` compatibility to ensure extensions match the running StrawVerse version.
- **Legacy Extension Auto-Cleanup:** Automatically removes obsolete flat extension files from the root scraper directory to prevent duplicate provider loading.

# [10.1.2] - 2026-10-07

### Downloads

- **Custom Download Location:** Pick your own download folder from Settings, with one-click reset to the default.
- **Manga Discover Filters:** Genre, status, and sort filters for manga, matching the anime experience.
- **Tougher Downloads:** Segment downloads recover through clearance refresh, carry CDN session cookies, and mirror the working streaming path, fixing vault 403 failures.
- **Quieter Logs:** Download speed tuning now logs one summary per domain every 30 seconds instead of every batch.

### Logging

- **External Log Files:** Per-session log files in a folder outside the app, with a setting for how many to keep (1–10, default 5, total under 500 MB). Available on Desktop and Android.

### Extensions & Maintenance

- **Scraper Remove Fix:** Removing a scraper from the marketplace works again.
- **Mapping Sync Hardening:** Collision-safe history healing and an hourly directory sync that can no longer wedge the app.

# [10.0.0] - 2026-10-06

### Desktop & Android Unified

- **Shared App Experience:** Android and Desktop now share the exact same modern interface and features. No more missing features, outdated layouts, or mismatched settings on mobile.
- **Polished UI:** Cleaner menus, dropdowns, and smoother navigation across all screen sizes.

### Fixed Broken AnimePahe Episodes & History

- **Auto-Fix Broken Anime & 404s:** Fixed an issue where AnimePahe shows would suddenly stop working or throw 404 errors when the site changed its internal links.
- **Automatic History & Library Repair:** Your watch history, saved library bookmarks, custom tags, and downloads now automatically repair themselves in the background, so you never lose your progress or have to re-add your anime.

### Smarter Downloads

- **Automatic Server Switching:** Downloads no longer get stuck on dead or slow download links—the app now automatically detects stalled downloads and switches to faster working servers.
- **Android Download Fixes:** Fixed download freezes, database lockups, and crashes on Android during heavy downloads.

### Discover Filters

- **Filter Anime on Anikoto:** Find what to watch faster with new filters in Discover. Filter by Genre, Airing Status (Airing, Completed), Media Type (TV, Movie, OVA, Special), and Sort order (Trending, Rating, Latest, Popular).

### Video Player & Streaming

- **Smoother Playback:** Better video streaming performance with improved subtitle and audio track switching on both Desktop and Android.
- **Cloudflare Verification Fix:** Resolved issues where Cloudflare checks would fail or get stuck when loading video streams.

### New Contributors

- Special thanks to **@RavenGod1** for their contributions to download engine optimizations, discover catalog filters!

# [9.5.3] - 2026-08-14

### Downloads Tracker

- **Live Speed & Time Remaining:** Active download cards now show real-time download speeds (e.g. `2.4 MB/s`) and estimated time remaining (ETA).
- **Clearer Status Messages:** Downloads now display `"Resolving stream links..."` while preparing episodes instead of showing confusing `0 of 0` segment counters.
- **Faster Download Recovery:** Downloads automatically retry faster if your connection hiccups, reducing stuck downloads.

### Video Player & Streaming Fixes

- **Auto-Save Watch Progress:** Your watch progress is now automatically saved every 10 seconds, as well as whenever you seek or pause, so you won't lose your place if the app or video player closes.
- **Fixed Video Loading & Freezing:** Resolved video loading errors on streams (such as Anikoto and Anineko) where videos would freeze or fail to load.
- **Accurate Subtitle Track Selection:** Fixed an issue where French or other subtitle tracks were accidentally selected instead of English, and cleaned up duplicate subtitle track options.
- **English DUB Server Fix:** Fixed English Dub servers on Anikoto and Anineko so Dub episodes load and play correctly.
- **Automatic Extension Updates:** Extension updates now automatically apply as soon as you launch the app.

# [9.5.2] - 2026-08-09

### Stream Proxy & MPV Playback

- **HLS Segment PNG Header Stripping:** Fixed MPV stream playback failure on HLS streams (e.g. Anineko, Anikoto). The local stream proxy now buffers segment responses and strips obfuscated PNG headers before sending video segments to MPV, resolving `Video: png` format misdetection and demuxer error crashes.

# [9.5.1] - 2026-08-09

### UI

- **Transparent Icon Styling:** Made the + icon and library icon transparent for a cleaner, more polished look.

### Platform Stability

- **Windows FFmpeg Fix:** Fixed FFmpeg binary not found on Windows. The build now downloads a dedicated Windows `ffmpeg.exe` during packaging, resolving cross-platform build issues when compiling from Linux.

# [9.5.0] - 2026-08-08

### Dynamic Theme Engine & Preset Colors

- **Custom Color Themes & Presets:** Added a full dynamic theme engine with selectable color presets: Midnight Obsidian (Default), Cyberpunk Neon, Emerald Forest, Sunset Romance, Crimson Royale, and Rose Gold.
- **Custom Accent & Background Tuning:** Customize individual UI color tokens including Primary Accent, Secondary Accent, Sidebar Active item, Text color, and Background color with live preview cards.

### Info View & Catalog Management

- **Expandable Cover Image Modal:** View high-resolution cover art with interactive Pan & Zoom controls (Zoom In, Zoom Out, Drag/Pan, and Reset).
- **Manual Mapping & Linking Tool:** Search and link titles directly to MyAnimeList / central mapping entries from the InfoView details panel. Automatically resolves provider IDs and updates local watch/read history and intro skip references.
- **Smart Library Deletion & Disk Cleanup:** Removing a title from your library now prompts with an optional confirmation to delete all downloaded files, episode folders on disk, and database entries in one clean action.
- **Live Download Status Sync:** InfoView episode and chapter lists now reflect active and queued download statuses in real-time with quick actions to view or open completed files.

### Downloader & Download Tracker

- **Multi-Domain Parallel Queue & Serial FFmpeg Merge Lock:** Queue items on unique server domains now download segments in parallel (up to 5 parallel downloads), while items on identical domains queue up sequentially to avoid rate limits. Heavy post-processing (file concatenation, subtitle remuxing, and FFmpeg execution) is protected by a global mutex lock and runs strictly 1 by 1.
- **Dynamic Speed-Aware Concurrency & Root-Domain Normalization:** Segment concurrency now automatically auto-tunes per domain based on real-time WiFi download throughput (MB/s) rather than scaling up blindly. Automatically holds concurrency at optimal levels when user connection bandwidth is saturated, steps down on socket congestion, and normalizes CDN subdomains (e.g. `s1.megap.mikora.top` -> `mikora.top`) so subdomains share rate limits across identical server IPs.
- **Live Segment Retry Countdown:** Displays a live countdown indicator (e.g. "Retrying in X s") when segment downloads fail or encounter rate limits.
- **Active Task Telemetry & Concurrency Info:** Active download cards now show live worker concurrency, last tested concurrency limits, and dynamic scaling metrics.

# [9.1.5] - 2026-08-03

### Downloader & Queue Management

- **Segment Retry Schedule (10s -> 30s -> 60s):** Eliminated segment skipping and 0-byte dummy file creation. Segment downloads now retry on a strict 10s -> 30s -> 60s schedule.
- **Error Popup & Queue Eviction:** If all retries fail, the download gracefully stops, presents an error popup to the user, and evicts the failed item from the queue to prevent corrupted video files.

### Platform Stability & FFmpeg

- **FFmpeg Platform Isolation:** Strictly isolated FFmpeg resolution logic—Desktop (Electron) resolves from `app.asar.unpacked`/`ffmpeg-static`, while Android (Capacitor) resolves from APK native `libffmpeg.so`.

# [9.1.4] - 2026-08-03

fix(ffmpeg): FFmpeg binary resolution

# [9.1.3] - 2026-08-03

### Downloads & Domain Concurrency

- **Crowdsourced Domain Concurrency (`mapping.db`):** Implemented server aggregation of client rate-limit telemetry into `mapping.db` (table #9 `domain_concurrency`). Client apps automatically receive optimal domain rules during mapping database updates.
- **Kwik/AnimePahe Rate-Limit Fix:** Lowered default starting concurrency for `kwik.cx`/`animepahe` to 2 and added exponential backoff (up to 4 retries) on HTTP 429 errors in StreamProxy.

### Core Backend & Stability

- **Startup Race Condition Fix:** Resolved `Missing Provider!` error by adding scraper loading retry handling in `providerFetch`.

# [9.1.2] - 2026-08-03

### Video Player & Playback

- **Saved Playback Speed:** Your preferred playback speed (1.25x, 1.5x, 2x, etc.) is now saved to local settings and automatically reapplied across episodes and new series in MPV player sessions.
- **MPV Process Logging & Subtitle Fixes:** Subtitle tracks now load reliably with explicit `--sid` flags, process `stderr` output is logged for easier debugging, and script options are cleanly passed using `--script-opts-add=`.

### Stream Proxy & Core Backend

- **Stream Proxy & Range Header Support:** Refactored `/api/stream/segment` proxy to forward HTTP `Range` request headers and stream video data directly using Node streams, reducing memory overhead and resolving buffering/playback errors.
- **Net Adapter Stream Handling:** Extended Electron net adapter in scraper utilities to handle `stream` response types via Node `Readable` streams.

# [9.1.1] - 2026-08-03

### Anime Streaming & Video Playback

- **Fixed Wrong Video Playing Bug**: Fixed a bug where clicking any anime episode kept playing the video from the last anime you watched because video link caching was mistakenly sharing one key for all videos.

### Downloads & Library Management

- **Adaptive Concurrency Auto-Scaler & AnimePahe Fix**: Added dynamic per-domain download concurrency auto-scaling with SQLite persistence. Fixes AnimePahe/Kwik segment download rate limiting (429) by automatically halving worker concurrency on rate-limits and stepping up on smooth download streaks.

### Settings & UI Fixes

- **Watch Together Settings Cleanup**: Removed unused Watch Together server settings section and configuration controls from the Settings panel.
- **Image Cache Stats & Import Fix**: Resolved `ImageCacheManager is not defined` backend route error and added safe numeric fallback handling for image cache usage statistics (`MB` & file count display).

# [9.1.0] - 2026-08-03

### Mobile (Android)

- **Native Video Player & Touch Gestures**: Added Picture-in-Picture (PiP) mode, double-tap to seek 10s backward/forward, vertical swipe gesture for brightness/volume control, and smooth timeline drag seeking.
- **Offline Batch Downloads & Notifications**: Download full series or selected episodes directly to your device, with real-time download progress and error notifications.
- **Gallery Auto-Hide**: Keeps app media assets and downloaded covers hidden from your device photo gallery.
- **Capacitor Packaging Pipeline**: Configured Capacitor Android build scripts (`npm run package:android`) and automated release signing for production APK distribution (`StrawVerse-<version>.apk`).

### Desktop (Electron)

- **Player Loading Overlay**: Added a smooth loading card and progress indicator when launching the MPV video player engine.
- **Playback & Track Sync**: Improved audio/subtitle track selection and settings synchronization in MPV player sessions.

### Core Streaming & Scrapers

- **Faster Cloudflare Bypass**: Optimized Cloudflare challenge resolution for faster stream loading across all providers.
- **Subtitle Language Preference**: Automatic filtering of subtitle tracks based on your preferred subtitle languages.

### Downloads & Library Management

- **Download Error Toast Notifications**: Displays real-time error toasts whenever a download fails or encounters an issue.
- **Directory Conflict Fixes & Smart Cleanup**: Added media ID identification to prevent folder name collisions and improved empty folder removal.

### User Interface & Metadata

- **MyAnimeList Cover Fallbacks**: Reliable loading for catalog and history thumbnails using MyAnimeList and local cover art fallbacks.
- **Improved Chapter Action Controls**: Redesigned manga chapter buttons with smooth hover states and visual feedback.

# [9.0.1] - 2026-08-02

### Video Player & Playback

- **Stream Security & Referrer Sync**: Fixed video loading and buffering errors on protected sources with automatic header and cookie management.
- **Subtitle & Audio Track Controls**: Improved subtitle track selection and audio track switching during playback.

### Settings Fixes

- **Enhanced Show Information**: Added expandable show description toggle, updated language format tags (Sub, Dub, Softsub, Softdub), and improved episode download tracking accuracy.

# [9.0.0] - 2026-08-02

### Native MPV Video Player

- **MPV Player Integration**: Integrated native MPV player engine for Windows and Linux desktop environments, delivering smooth hardware-accelerated video playback.

### Scrapers & Cloudflare Bypass Engine

- **Turnstile & CF Bypass Engine**: Overhauled scraper infrastructure with automated session-based Cloudflare Turnstile challenge resolution and header persistence.
- **Provider Reliability Fixes**: Resolved video streaming, image loading, and cookie persistence issues for Pahe, Anikoto, AniNeko, and AllManga providers.
- **Stream Proxy Segment Fix**: Fixed stream segment proxy delivery errors for smoother buffering.
- **Automatic Extension Selection**: Automatically selects the first installed provider extension when no default is set.

### Library & Catalog Management

- **MAL Cover Image Prioritization**: Media fetching and metadata routes now prioritize high-resolution MyAnimeList cover art with automatic fallback to scraper sources.
- **Quick Tag Management**: Introduced `TagPickerModal` allowing users to quickly apply and customize tags for catalog items.
- **Bulk Episode Selection Filters**: Added "Unwatched", "Watched", "Read", and "Unread" selection filters in InfoView to streamline bulk operations.
- **Quick Catalog & Home Actions**: Added direct quick-delete buttons on library catalog cards and a remove button to clean up items directly from the Home view.
- **Open Download File Location**: Added IPC handler and UI action to open downloaded media files and folders directly in the system file manager.
- **Folder Name Sanitization**: Enhanced folder name sanitization for downloaded series to avoid invalid path errors on disk.
- **Storage Optimization**: Removed redundant image disk caching during metadata downloads to conserve local disk space.

### Architecture & Refactoring

- **Workspace Decoupling**: Renamed core source directory to `/electron` to clearly isolate desktop code from mobile Capacitor builds.

# [8.0.3] - 2026-07-10

### App Updates & Installer

- **App Updater**: app updater flow under the Settings > About tab.
- **Real-Time Download Progress**: Displays real-time download speed and progress percentages directly inside a clean SweetAlert2 dialog during updates.

# [8.0.2] - 2026-07-10

### Website & Branding

- **New Landing Page**: Launched a dedicated landing page at [strawverse.theyogmehta.online](https://strawverse.theyogmehta.online/).
- **Mapping URL Migration**: Updated the mapping server URL from `mapping.theyogmehta.online` to [strawverse.theyogmehta.online](https://strawverse.theyogmehta.online/).

### Bug Fixes

- **Dropdown Z-Index Fix**: Fixed dropdown menus in Settings and Watch Together getting covered by other UI elements. Dropdowns now properly elevate above surrounding cards and panels when opened.
- **Manga Chapter Splash Color Fix**: Fixed the chapter title text on the manga reader splash screen rendering with a bright white background block instead of the intended gradient text effect. The CSS `-webkit-background-clip` and `-webkit-text-fill-color` properties were incorrectly written in kebab-case, preventing the gradient from clipping to the text.
- **Back Button Navigation Fix**: Fixed the back button not navigating correctly when returning from detail or reader views.

# [8.0.1] - 2026-07-09

updated watch together episode api with new one

# [8.0.0] - 2026-07-09

### Downloader & Performance

- **Instant Pause & Cancel**: Fixed downloads not stopping immediately when you click cancel or pause. It now cleans up unfinished temp files from your disk and stops right away.
- **Fixed Lag and Freeze**: Fixed the app freezing and lagging when a download starts or is running in the background.
- **Fast Download Starts**: Made downloads start instantly by avoiding loading details from the web if they are already saved in your library.
- **Fixed Cancelled Items Reappearing**: Fixed a bug where cancelled downloads would sometimes reappear in the list as "retrying".

### Airing Calendar

- **Weekly Airing Calendar**: Introduced a brand new airing calendar feed showing scheduled anime releases.

### Video Player & Navigation

- **Timeline Skip Markers**: Added skip indicators on the timeline progress bar to visualize the exact duration of intros and outros and skip button.
- **Auto-Skip**: Added a global "Auto-Skip Intro & Outro" Yes/No toggle in Settings > Anime Settings.
- **Offline Skip Times Cache**: Automatically saves intro/outro timestamps directly to the database.
- **Picture-in-Picture (PiP) Mode**: Added a PiP toggle button.

### Manga Reader & Settings

- **Multiple Layout Modes Supported**: Fully supports Long Strip, Single Page, and Double Page layouts, all selectable globally inside Settings.
- **Fluid Page Width Control**: Replaced standard Minimize and Maximize size toggle buttons with a fluid range slider (400px to 1600px) inside the reader header and Settings panel to customize display width dynamically for all layout modes.
- **Improved Side-Click Navigation**: In Single and Double page layouts, click directly on the left half of the screen to go back, and the right half to go forward. In Long Strip layout, click the top half to scroll up, and the bottom half to scroll down.

### Watch Together

- **Session Metadata Sync Fix**: Corrected active media tracking inside the Watch Together panel. Restricted metadata overrides to only allow title, ID, and episode matches that align with the currently playing media or active session to prevent mismatching data.

# [7.5.0] - 2026-07-08

### Watch Together

- **UI Overhaul (by artiriart)**: Redesigned the collapsed sidebar into a vertical rail with active highlights.
- Added padding spacing around the main layout area.
- Redesigned the Create and Join watch room landing cards with symmetric layouts.
- Aligned heights and text sizes for the episode filter controls row.
- Replaced the browser range-error alert dialog with a dark-themed SweetAlert2 box.
- Removed the user count indicator from the header top bar.
- Stopped search selections from automatically playing if a video is active or in queue.

### Player & Sidebar

- The sidebar will now hide automatically when a video is playing so you can watch in full screen, and you can bring it back just by moving your mouse to the left side.
- Thickened the video progress bar and made it glow purple when you hover over it.
- Replaced the bulky exit player button with a clean and light back button.

### Details Page & Styling

- Show your last watched time (like `4:10 / 24:02`) or last page read on individual episode and chapter rows.
- The details page will now remember if you sorted episodes ascending or descending.
- Redesigned the episode range select box to match the other inputs next to it.
- Aligned catalog cards so their titles line up perfectly.
- Made text on cover badges easier to read on bright backgrounds by adding a dark shadow behind them.

### History & Stats

- Added a switch next to your history list to filter by all, only anime, or only manga.

### Library

- Starting a video or reading a chapter now automatically adds the series to your library under "Watching" or "Reading".
- Custom MyAnimeList manga mapping link and unlink updates are now automatically sent to the mapping server.

# [7.4.4] - 2026-07-07

### Stream Downloader & Subtitles

- **AniNeko Subtitle Fixed**: Resolved a crash/ReferenceError (`subtitleData is not defined`) in the subtitle download fallback.

### Library Catalog & Folder Operations

- **Delete All Refactoring**: Refactored the "Delete All Downloads" button handler to dynamically collect all downloaded numbers and call the robust `/api/local/delete-multiple` endpoint.
- **Robust Folder & Suffix Resolvers**: Patched `delete-episode` and `delete-multiple` routes to check for suffix-appended folder variations (e.g. `_sub`, `_dub`, `_hsub`), resolving folder-not-found failures.

# [7.4.3] - 2026-07-07

### Features & Synchronization

- **Delta Updates**: Implemented incremental sync for mapping updates. The app now pings the server with its current version tag and downloads only database changes (inserts, updates, deletes) in a small JSON payload rather than redownloading the entire database.
- **Server Update Source**: Moved the update checks and downloads from GitHub Releases to the self-hosted mapper server endpoints.

### Safety & Compliance

- **Legal Disclaimers**: Added a prominent legal disclaimer block at the top of the repository `README.md` and extensions `README.md`.
- **About & Disclaimer Panel**: Integrated a dedicated "About & Legal Disclaimer" tab inside the Settings panel to declare the software as an indexing tool.
- **Monetization Removal**: Removed the donation links.

# [7.4.2] - 2026-07-07

### Bug Fixes

- **Anikoto Subtitles**: Fixed subtitle download and extraction failing for Anikoto sources.
- **AnimePahe Cookie Headers**: Fixed cookie headers not being sent correctly in AnimePahe scraper requests.
- **Duplicate Download Folder Names**: Fixed download titles appending a redundant SubDub suffix when the title already ends with it.
- **Download Performance Lag**: Throttled download progress updates to a maximum of once per 500ms, preventing an IPC message flood that caused severe frontend UI lag during downloads.
- **Merged Subtitles Local Playback**: Fixed subtitles not playing in the internal player for local files when `mergeSubtitles` is enabled. Added on-the-fly subtitle extraction from the video file container.

### Improvements

- **Anineko Mapping**: Added Anineko as a new provider mapping source.
  **Auto Library Tagging**: Starting a download now automatically adds the title to your library as "Downloads" if it wasn't already added.
- **Smart Tag Cleanup**: If all downloaded files are deleted and nothing is queued, the library tag automatically reverts back to "None".

# [7.4.1] - 2026-07-06

### Centralized Mapping Synchronization

- **Forward Custom MAL Mappings**: Custom MyAnimeList mapping link and unlink updates are now automatically forwarded to a central mapping server (`https://mapper.theyogmehta.online/mapping`) to keep community mappings up to date.
- **Payload Simplification**: Streamlined the central mapping API payload to send the media ID directly.

### Scraper & Network Patches

- **Case-Insensitive Request Headers**: Scraper utilities and Axios request interceptors now handle headers case-insensitively to prevent duplicates (`Referer`, `Origin`, `User-Agent`, `Cookie`), fixing request errors with AnimePahe.

# [7.4.0] - 2026-07-06

### Redesigned Settings & Layout

- Redesigned Settings panel into a responsive full-width row layout.
- Moved Watch Together settings card to the General tab, simplifying the Server URL input to show only the plain domain.
- Added Reset and HTTP `/health` connection verification controls to the Server URL config.
- Developer Mode changes to show/hide the Logs tab.
- Centered version headings in Release Notes with fade-gradient lines.

### Consolidated Navigation

- Merged Local Anime/Manga tabs into a unified **Home** view.
- Merged Discover Anime/Manga tabs into a unified **Discover** view.
- Centered the main header search bar and added a sliding content-type selector toggle to the far right.

### Subtitle & Download Improvements

- Supported raw VTT downloading and preserved overlapping sign/dialogue subtitle cues.
- Prompted Sub/Dub/HSUB version selection dialogs on bulk and single downloads.
- Patched AnimePahe scraper requests with Referer headers to prevent Cloudflare 403 blocks.
- Fixed Info view Select All / Deselect All logic to target only available released items.

### Bug Fixes & Deduplication

- Deduplicated Watch History entries using base media IDs.
- Fixed cover art scaling stretch on details view.
- Fixed sidebar logo clipping on collapsed state.

# [7.3.1] - 2026-07-04

fixes: download queue freeze, animepahe scraper, library tagging, and player volume resetting

# [7.3.0] - 2026-07-04

### Watch Together

- **Real-Time Synced Watching:** Host or join rooms to watch anime synchronously with friends.
- **Zero-Desync Episode Loading:** Automatic background buffering ensures all clients unpause simultaneously when switching episodes.
- **Binary WebSockets Protocol:** Ultra-fast, minimal bandwidth synchronization.
- **Live Ephemeral Chat & Shared Queue:** Chat in real-time and queue up episodes together.
- **Floating Session Bar:** Quick-access room status bar while watching.
- **Verified MyAnimeList Token Auth:** Secured room connections with direct server-side MyAnimeList token verification to prevent username spoofing.
- **Host Controls:** Added quick-play buttons next to queue items and a native "Skip Episode" control in the player header for room hosts.
- **Watch Together Settings Box:** Extracted and separated Watch Together options into a dedicated card tab under settings with proper input text styling.
- **UI & Player Cleanups:** Removed duplicate episode title labels in the queue list and cards, and hid the navigation toolbar when in watch-together mode.

### Download Manager Improvements

- **Pause & Resume Queue:** Pause all active downloads and resume them whenever you're ready.
- **Queue Status Indicator:** Added visual pause banners and updated task indicators.

### Manga Reader Sizing Controls

- **Compact & Full Width Modes:** Minimize or Maximize reader width to suit your screen size.
- **Preference Persistence:** Automatically saves your favorite reader size setting.

### Backend & Scraping Refinements

- Improved anime stream resolution fallback and proxy header handling.
- Enhanced metadata fetching and download queue reliability.

# [7.2.2] - 2026-06-29

### Bulk Selection & Keybinds

- **Selection Controls**: Select items with a single click, or select a range with **Ctrl + Click** (Shift+Click is disabled).
- **Sticky Actions Bar**: The selection controls now stick to the top of your screen as you scroll down the episode list.
- **Clear Selections**: Quickly clear all active checkmarks using the new red "Clear Selected" button.
- **Range Input Validation**: Displays a red border glow when you type invalid characters in the range selector.

### Custom Dropdowns & Sorting

- **Custom Sort Dropdowns**: Replaced the native sort button with a premium custom dropdown selector that matches the Source Provider dropdown.
- **Downloaded Sort Filter**: Added a new **Sort: DOWNLOADED** option that filters the view to show only downloaded episodes/chapters.

### Bug Fixes

- **Local Deletion Resolution**: Fixed an issue where deleting local files failed with a "folder not found on disk" error after switching active provider tabs.
- **Subtitle Auto-Cleanup**: Automatically deletes downloaded subtitle files after they have been successfully merged into the video file.

# [7.2.1] - 2026-06-29

### Performance & Idle CPU Optimizations

- **Background Throttling**: Enabled Electron renderer background throttling (`backgroundThrottling: true`) and removed the disable renderer backgrounding switch to let Chromium release resources when minimized or backgrounded.
- **Dynamic Power Save Blocker**: Refactored the power save blocker to activate dynamically only when download items are active in the queue, letting the system sleep at idle.
- **Event-Driven Queue Worker**: Converted the continuous 1-second database polling loop into an event-driven model that wakes the queue processor only when items are added and shuts down fully on idle.
- **Module Simplification**: Merged the queue worker (`queueWorker.js`) and queue manager (`queue.js`) into a single file to resolve circular dependencies and simplify function calls.

### Audio & Player Engine Fixes

- **AAC Audio Codec Remap**: Patched `MediaSource.prototype.addSourceBuffer` to transparently rewrite `mp4a.40.1` (AAC-Main) to `mp4a.40.5` (AAC-LC) to fix audio playback issues on specific platforms/environments.
- **Kwik HLS Fragment Loader**: Integrated a custom Hls.js segment loader (`KwikFragmentLoader`) to reliably proxy, decrypt, and handle fragment streaming for Pahe/Kwik networks.

### Database & Image Cache Migration

- **Image Disk Cache Migration**: Migrated Base64-encoded image blobs from local SQLite tables to the disk cache, dropped the legacy `image` column, and ran database `VACUUM` to decrease database size.
- **Watch/Read History Auto-Cleanup**: Automatically cleans up orphaned `WatchHistory` and `ReadHistory` database records when their related Anime/Manga items are deleted.

### Bug Fixes

- **Local Playback Path Fix**: Added a folder-name fallback inside local file-retrieval helpers in `Metadata.js` to resolve the path-null error when playing local downloaded anime.

# [7.2.0] - 2026-06-28

### Image Caching & Optimization

- Implement disk-based image caching for external posters and metadata images.
- Add startup cleanup to automatically purge orphaned files and cache records older than 6 days.
- Add configurable image cache size limits (default 5 GB) with LRU (least-recently-used) eviction.
- Migrate legacy Base64-encoded images from SQLite database to disk cache and run `VACUUM` to significantly reduce database size.

### Library Stats & History

- Add a Library Stats Dashboard to the local Catalog showing total time spent, completed episodes, and chapters read.
- Add settings to clear all watch/read history and manage image cache storage.
- Automatically clean up history entries when their corresponding local metadata is deleted.

### Subtitle Merging

- Integrate subtitles directly into output MP4 files using FFmpeg copy/codec mappings during segment merge.
- Support language and title metadata mapping for multiple subtitle tracks in MP4.

# [7.1.2] - 2026-06-16

- fix playback/downloading issues regarding animepahe

# [7.1.1] - 2026-06-15

- fix playback/downloading issues regarding anikoto
- moved changelog.md location

# [7.1.0] - 2026-06-11

### Scraper & Video Player Optimizations

- Generalize player CDN rules (.buzz/.click/.club) to fix sparkora.buzz block.
- Add double-click to fullscreen and idle mouse cursor hiding to video player.
- Add standard keyboard shortcuts:
  - F: Toggle fullscreen
  - Space / K: Toggle Play/Pause
  - M: Toggle Mute/Unmute
  - ArrowLeft / J: Seek backward 10s
  - ArrowRight / L: Seek forward 10s
  - ArrowUp / ArrowDown: Increase/decrease volume by 10%

### Catalog & Metadata

- Add upcoming episode release countdowns to Catalog cards and InfoView details.
- Implement auto-sorting of local anime:
  - Unwatched aired episodes first.
  - Active watching shows next.
  - Not started shows (0 episodes watched) next.
  - Caught-up shows waiting for next release next.
  - Fully completed shows at the bottom.
- Map animepahe/anikoto to MAL IDs with options to manually correct mappings.

### Database & Network

- Split user and mapping databases, add mapping updater, and LiveChart schedules weekly.
- Implement HLS segment retry backoff and empty fallback on failure.
- Add Discord links, external link handling, and Release Notes settings tab.
- Add custom "What's New" startup release notes modal integrated with Electron IPC and local SQLite database version tracking.

### Discord RPC

- Add Litterbox integration for temporary Discord status thumbnails.
- Uploads Discord RPC thumbnails to Litterbox temporarily (expires in 1 hour).
- Caches the uploaded URLs in the local SQLite database for 1 hour to prevent redundant uploads.

# [7.0.0] - 2026-06-05

### Frontend Migration

- Migrated the entire frontend from server-side EJS templates and Vanilla JS/CSS to a component-based React + Vite single-page application.
- Added components for Catalog, DownloadsTracker, InfoView, LogsView, MangaReader, Marketplace, SettingsView, Sidebar, and VideoPlayer.
- Relocated public assets (fonts, images, icons) to `src/gui/public` to fit the Vite project structure.

### Database & Storage

- Replaced the legacy JSON databases (`database.json`, `queue.json`) and the `simpl.db` dependency with Node's native SQLite (`node:sqlite`).
- Created a robust database utility in `src/backend/utils/db.js` that automatically handles schema creation, dynamic updates, and data migrations.
- Structured SQLite tables for Anime/Manga metadata, MAL/Manga trackers, application settings, downloading queue, cookies, and watch/read history.

### Local Tracking & History

- Added SQLite schemas (`WatchHistory`, `ReadHistory`) to track progress: episode/chapter number, duration, current time, time spent, completion status, and last activity timestamps.
- Implemented route endpoints to save, retrieve, and update user watch/read progress in real-time.

### MyAnimeList (MAL) Integration Updates

- Updated the MAL utility (`src/backend/utils/mal.js`) to support both Anime and Manga tracking, list fetching, and item addition.
- Migrated MAL OAuth/PKCE tokens and settings storage from JSON files to the SQLite `Settings` table.
- Implemented synced tracking logic using local SQLite tables (`MyAnimeList`, `MyMangaList`) to store user list items and query MAL lists.

### Backend & Routing Refactoring

- Redesigned backend routes (`src/backend/routes.js`) to act as a RESTful JSON API instead of template-rendering routes.
- Updated endpoints to interface with the SQLite DB for queries (e.g., retrieving settings, logs, tracking items, and managing downloading queues).

### Network & Bypass Updates

- Introduced a proxy headers manager (`src/backend/utils/proxyHeaders.js`) to handle referer and cookie injection for scraping and downloads.
- Improved scrapper and downloader logic to bypass Cloudflare protection reliably.

### Build & Configuration

- Added a root "build" script to trigger the frontend production build.
- Configured custom desktop mime types and protocol handlers (`strawverse://` deep-linking).
- Updated electron-builder exclusion rules to omit source development files (e.g. `src/gui/src/`) from the production package build.
- Upgraded multiple core dependencies in `src/package.json`.

# [6.0.1] - 2026-05-31

- Removed `better-sqlite3` and `electron-rebuild` dependencies

# [6.0.0] - 2026-05-31

- Added ability to delete individual downloaded episodes directly from the UI
- Added option to remove local downloads and database entries entirely
- Added new Anime provider **Anikoto** with Cloudflare bypass
- Fixed **AnimePahe** downloader and streaming issues
- Added new Manga provider **AllManga** to the marketplace
- Fixed headers issue and bumped version for **WeebCentral** Manga provider
- Added pagination, improved error handling, and new UI elements for Anime & Manga sections
- Improved backend robustness to handle missing download directories and fallback provider configs
- Updated site addresses and fixed routing issues
- Added support and documentation for Linux (AppImage & Snap packaging) alongside Windows

# [5.0.3] - 2025-06-24

- Added Changelogs
- Removed Rabbit.js

# [5.0.2] - 2025-06-24

- Added info logs for scrapers
- Added support for `.mpd` (KAA) file format

# [5.0.1] - 2025-06-14

- fixed downloads skipping due to duplicate -dub or -sub in episode links [(#69)](https://github.com/TheYogMehta/StrawVerse/issues/69)

# [5.0.0] - 2025-06-13

- Rebranded to StrawVerse

# [4.0.1] - 2025-06-11

- Fixed MarketPlace Download Logic
- Fixed version mismatch logic in Marketplace
- Fixed error when loading providers
- Fixed missing sort option on search results

# [4.0.0] - 2025-06-07

- Added MarketPlace ( Settings > Anime > Provider )

# [3.2.0] - 2025-06-07

- Fixed custom location resetting issue it no longer changes unexpectedly
- Removed Merge Subtitles and Subtitle Format settings
- Subtitles are now saved by default in the subs folder
- Subtitles auto-detect in VLC
- Subtitle files are saved in SRT format by default
- Fixed Animepahe extractor and resolved related CORS issues
- Updated HiAnimez.to to Hianime.bz
- Fixed loading of local subtitles in the app
- Disabled Animekai

# [3.1.2] - 2025-05-16

- Resolved issue with duplicate subtitle buttons after switching episodes.
- MyAnimeList (MAL) auto-tracking now triggers correctly once an episode is 90% watched.
- Improved intro skip detection for HiAnime episodes.
- Fixed download page not rendering properly.
- Fixed local anime not showing up
- New Features : Keyboard Hotkeys added to the player for a smoother experience:
  `Space`: Play / Pause
  `→`: Skip forward 5 seconds
  `←`: Rewind 5 seconds
  `↑`: Increase volume
  `↓`: Decrease volume
  `F`: Toggle fullscreen
  `M`: Mute / Unmute
  `S`: Skip intro (if available)

# [3.1.1] - 2025-05-15

- Added Back Button ( [#51](https://github.com/TheYogMehta/StrawVerse/issues/51) )
- Added Discord Rich Presence (RPC)

# [3.0.6] - 2025-05-14

- Fixed Local Source Not Opening

# [3.0.5] - 2025-05-13

- Fixed HiAnime episode list issue
- Changed HiAnime base URL to hianimez.to
- Fixed some local anime so they show up in local sources
- Added Filters ( [#53](https://github.com/TheYogMehta/StrawVerse/issues/53) )

# [3.0.4] - 2025-04-10

- Fixed Animekai Extractor
- Enhanced downloader Utils by making it fast
- Added Timestamp in myanimelist page if it has next episode date

# [3.0.3] - 2025-04-10

- Animekai extractor fixes
- fixed downloads overall
- fixed watching now text
- Fixed Mal episodes being ??
- Fixed extractor
- Fixed Local Anime not playing / downloading
- Fixed download starts with Reversed order ( [#40](https://github.com/TheYogMehta/StrawVerse/issues/40) )

# [3.0.2] - Skipped By Mistake

# [3.0.1] - 2025-03-20

- fixed settings page not opening

# [3.0.0] - 2025-03-20

- Ui Changes
- Added Mal Support ( Can add anime to list & update anime entry with controls in info page )
- HiAnime fixed
- Animepahe fixed
- download concurrency set to 1
- overall app will feel fast :3
- Note :
  - manga download wont be loaded from downloads will be fixed in later versions sorry 🙏🙇‍♂️

# [2.8.9] - 2025-03-07

- Minor UI Change

# [2.8.8] - 2025-03-07

- Added Image Proxy For AnimeKai
- Added Failed To Load Error Image
- Removed Unwanted Images
- Downloads Starts From 5 Concurrency Instead of 10
- Downloader Remove Files If Download Failed
- Creates Mp4 After Downloading All Segments
- Logs Concurrency & Download Speed ( in logs page )
- fixed pagination & search results issue

# [2.8.7] - 2025-03-04

- Starts downloading from 5 files, with a maximum of 100 files per episode.
- If a download fails, it waits for 5 seconds before retrying and notifies the user.
- Reduced PC load on the downloads page by preventing frequent data fetching with ipcRenderer.
- Re-added MAL login.
  - Currently, nothing else works with MyAnimeList. A future update will include automatic anime tracking and a dedicated MAL page where users can view their anime updates and continue watching directly.
