# Download Quality Selection & Resolution-Aware Server Matching

## 1. Overview & Understanding Summary

* **What is being built:** A quality selection step for video downloads (combining language version SUB/DUB and target resolution e.g. 1080p, 720p, etc.) combined with backend queue resolution that actively selects the server providing the requested resolution.
* **Why it exists:** When downloading an episode with the global setting configured to 1080p, the downloaded file could end up at 720p because scrapers often distribute different resolutions across different servers, and the downloader previously picked the first available server regardless of its maximum resolution.
* **Target Users:** Users who want explicit control over video resolution (e.g. guaranteeing 1080p over 720p) per download.
* **Batch Downloads:** Probes the first selected episode's sources to populate available qualities and applies the user's choice to all selected episodes in the queue.
* **Non-Goals:** Exposing internal/cryptic server names to users; options are presented as clean resolutions (1080p, 720p, 480p, 360p).

---

## 2. Assumptions

1. **Default Setting Retained:** The existing quality option in Settings (`SettingsView.jsx`) remains the default pre-selected value in the download modal.
2. **Fast Probing & Loading State:** Clicking "Download" shows a brief loading spinner on the button while fetching available qualities. If probing times out, it defaults to the saved setting (1080p).
3. **Queue Item Schema:** The queue item config supports `quality`; the chosen quality is passed directly into `downloadAnimeSingle`, `downloadMovieSingle`, `downloadMediaMulti`, and the queue task config.
4. **Consistency:** Operates consistently across Anime and Movies downloads.

---

## 3. Decision Log

| Decision | Alternatives Considered | Reason for Choice |
| :--- | :--- | :--- |
| **Unified Version & Quality Modal** | Split button dropdown, separate modal popups | Keeps the download flow concise in a single step with SUB/DUB and Quality side-by-side or stacked. |
| **Probe First Episode for Batch** | Probing every episode vs. static dropdown | Fast and lightweight; provides realistic available qualities without triggering scraper rate limits. |
| **Resolution-Aware Server Inspection** | Static server ranking only | Resolves the core bug where Server 1 maxes out at 720p while another server contains the requested 1080p stream. |
| **Pass Per-Item Quality Through Queue Config** | Global setting overwrite | Keeps user's global setting intact while honoring the specific quality chosen for this download task. |
| **Graceful Probe Fallback** | Abort download if probe fails | Ensures downloads never get blocked even if the source probe request times out. |
| **Soft Quality Fallback** | Strict rejection if requested resolution is absent | Older anime or single-quality mirrors can still download at their highest possible resolution without hard errors. |

---

## 4. Final Architecture & Technical Design

### 4.1 Frontend Component (`gui/src/components/InfoView.jsx`)
1. **Trigger & Loading State:**
   * When Download is clicked, set button state to loading (`"Checking sources..."`).
   * Probe `/api/watch` with the episode details to retrieve available languages and video sources.
2. **Combined Selection Modal:**
   * Styled `Swal.fire` dialog with:
     * **Language Version Selection:** `SUB`, `DUB`, `HSUB`.
     * **Target Quality Selection:** Clean resolution badges/dropdown (`1080p`, `720p`, `480p`, `360p`), pre-selecting the user's default setting from `settings.quality`.
   * If only one option exists for both language and quality, skip prompt and queue immediately.
3. **Payload Dispatch:**
   * Calls `/api/download/:type/:singleMulti` including `{ subdub, quality }`.

### 4.2 Backend Routes & Queue Worker
1. **Routes (`backend/routes/downloads.js` & `backend/download.js`):**
   * Accept `quality` in request body.
   * Forward `quality` into queue item `config.quality`.
2. **Resolution-Aware Server Inspection (`backend/utils/queue.js`):**
   * In `downloadEpisodeByQuality`:
     * Read target height from `config.quality` (e.g. 1080).
     * Resolve candidate servers.
     * When inspecting candidate streams, verify whether the stream / HLS master playlist contains streams matching the target height.
     * If Server 1 only has $\le 720\text{p}$ and subsequent candidate servers exist, retain Server 1 as fallback and inspect Server 2.
     * If a server matching target height is found, pick it. If none match, fall back to the highest available resolution across tested servers.
3. **Downloader (`backend/utils/downloader.js`):**
   * Receives target quality and extracts the stream segments matching the requested height.

---

## 5. Verification Strategy

1. **Single Episode Test:** Download an episode with 1080p selected from a scraper known to offer 720p on Server 1 and 1080p on Server 2. Verify downloaded file resolution is 1080p.
2. **Batch Download Test:** Select multiple episodes, verify modal prompts once, and all items in queue inherit the chosen quality.
3. **Fallback Verification:** Verify an older show (max 480p or 720p) downloads cleanly without failure when 1080p is selected.
