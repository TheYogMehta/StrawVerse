# Changelog

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
