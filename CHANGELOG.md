# Changelog

## [7.1.0] - 2026-06-11

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

## [7.0.0] - 2026-06-05

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

## [6.0.1] - 2026-05-31

- Removed `better-sqlite3` and `electron-rebuild` dependencies

## [6.0.0] - 2026-05-31

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

## [5.0.3] - 2025-06-24

- Added Changelogs
- Removed Rabbit.js

## [5.0.2] - 2025-06-24

- Added info logs for scrapers
- Added support for `.mpd` (KAA) file format

## [5.0.1] - 2025-06-14

- fixed downloads skipping due to duplicate -dub or -sub in episode links [(#69)](https://github.com/TheYogMehta/StrawVerse/issues/69)

## [5.0.0] - 2025-06-13

- Rebranded to StrawVerse

## [4.0.1] - 2025-06-11

- Fixed MarketPlace Download Logic
- Fixed version mismatch logic in Marketplace
- Fixed error when loading providers
- Fixed missing sort option on search results

## [4.0.0] - 2025-06-07

- Added MarketPlace ( Settings > Anime > Provider )

## [3.2.0] - 2025-06-07

- Fixed custom location resetting issue it no longer changes unexpectedly
- Removed Merge Subtitles and Subtitle Format settings
- Subtitles are now saved by default in the subs folder
- Subtitles auto-detect in VLC
- Subtitle files are saved in SRT format by default
- Fixed Animepahe extractor and resolved related CORS issues
- Updated HiAnimez.to to Hianime.bz
- Fixed loading of local subtitles in the app
- Disabled Animekai

## [3.1.2] - 2025-05-16

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

## [3.1.1] - 2025-05-15

- Added Back Button ( [#51](https://github.com/TheYogMehta/StrawVerse/issues/51) )
- Added Discord Rich Presence (RPC)

## [3.0.6] - 2025-05-14

- Fixed Local Source Not Opening

## [3.0.5] - 2025-05-13

- Fixed HiAnime episode list issue
- Changed HiAnime base URL to hianimez.to
- Fixed some local anime so they show up in local sources
- Added Filters ( [#53](https://github.com/TheYogMehta/StrawVerse/issues/53) )

## [3.0.4] - 2025-04-10

- Fixed Animekai Extractor
- Enhanced downloader Utils by making it fast
- Added Timestamp in myanimelist page if it has next episode date

## [3.0.3] - 2025-04-10

- Animekai extractor fixes
- fixed downloads overall
- fixed watching now text
- Fixed Mal episodes being ??
- Fixed extractor
- Fixed Local Anime not playing / downloading
- Fixed download starts with Reversed order ( [#40](https://github.com/TheYogMehta/StrawVerse/issues/40) )

## [3.0.2] - Skipped By Mistake

## [3.0.1] - 2025-03-20

- fixed settings page not opening

## [3.0.0] - 2025-03-20

- Ui Changes
- Added Mal Support ( Can add anime to list & update anime entry with controls in info page )
- HiAnime fixed
- Animepahe fixed
- download concurrency set to 1
- overall app will feel fast :3
- Note :
  - manga download wont be loaded from downloads will be fixed in later versions sorry 🙏🙇‍♂️

## [2.8.9] - 2025-03-07

- Minor UI Change

## [2.8.8] - 2025-03-07

- Added Image Proxy For AnimeKai
- Added Failed To Load Error Image
- Removed Unwanted Images
- Downloads Starts From 5 Concurrency Instead of 10
- Downloader Remove Files If Download Failed
- Creates Mp4 After Downloading All Segments
- Logs Concurrency & Download Speed ( in logs page )
- fixed pagination & search results issue

## [2.8.7] - 2025-03-04

- Starts downloading from 5 files, with a maximum of 100 files per episode.
- If a download fails, it waits for 5 seconds before retrying and notifies the user.
- Reduced PC load on the downloads page by preventing frequent data fetching with ipcRenderer.
- Re-added MAL login.
  - Currently, nothing else works with MyAnimeList. A future update will include automatic anime tracking and a dedicated MAL page where users can view their anime updates and continue watching directly.
