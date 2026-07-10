# Changelog

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
