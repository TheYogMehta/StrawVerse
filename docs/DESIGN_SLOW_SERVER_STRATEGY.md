# Slow Server Strategy & Automated Mirror Failover

## 1. Overview & Understanding Summary

* **What is being built:** A dual-phase slow server remediation strategy for background video downloads: (1) dynamic concurrency ramp-up, followed by (2) automated mirror failover with soft fallback.
* **Why it exists:** Some CDNs and streaming mirrors throttle download speeds down to 40–100 KB/s, causing episodes to take hours to download when faster mirrors or higher parallelism could finish the download in minutes.
* **Target Users:** Users downloading video queues who want reliable, high-speed downloads without getting trapped on throttled hosts.
* **Detection Mechanism:** Continuous rolling sliding window measuring sustained throughput over 15–20 seconds throughout the download, backed by a configurable minimum speed floor in Settings (default: 300 KB/s).
* **Two-Phase Action:**
  1. **Concurrency Boost:** Scales parallel segment threads up to the safe maximum (16 threads) and monitors for a 12-second grace period.
  2. **Automated Server Failover:** If speed remains below the floor, the connection is aborted with `SLOW_MIRROR_FAILOVER`, blacklisting the slow host for this episode and immediately switching to the next candidate mirror.
* **Soft Fallback:** If all available mirrors are slow (or only one mirror exists), the queue worker engages permissive recovery mode, completing the download on the best available server rather than failing or looping.
* **Explicit Non-Goals:** Modifying live online video streaming playback or altering web player chunk buffering (strictly scoped to the download queue).

---

## 2. Assumptions

1. **Default Threshold:** Proposed at **300 KB/s**, with user-selectable options in Settings (`Disabled`, `150 KB/s`, `300 KB/s`, `500 KB/s`, `1 MB/s`, `2 MB/s`).
2. **Warmup & Jitter Shield:** First 6 segments or 8 seconds are ignored to avoid initial handshake latency; momentary dips below the floor do not trigger failover unless sustained for the full sliding window + grace period.
3. **Safe Bounds:** Concurrency scale-up is capped at 16 threads to avoid HTTP 429 rate limits.
4. **Session-Scoped Cooldown:** Host exclusions are tracked per-episode execution to prevent infinite bouncing between two slow hosts.

---

## 3. Decision Log

| Decision | Alternatives Considered | Reason for Choice |
| :--- | :--- | :--- |
| **Sliding-Window Throughput Sentinel** | Pre-download benchmark, segment swarming | Zero upfront delay; catches mid-download throttling; avoids 429 blocks and chunk corruption. |
| **Two-Phase Action (Boost then Failover)** | Immediate failover without boosting | Many CDNs throttle single TCP connections; scaling threads often cures the bottleneck without abandoning the mirror. |
| **Zero-Penalty Mirror Retry** | Standard error backoff with retry burn | Slow servers are not application crashes; switching mirrors should happen instantly without exhausting the task's retry limit. |
| **Soft Permissive Fallback** | Hard abort / task failure | Prevents downloads from failing when an anime is only hosted on a single slow mirror. |
| **Configurable Speed Floor in Settings** | Hardcoded speed floor | Accommodates users on varying home internet bandwidths. |

---

## 4. Technical Architecture & Implementation Design

### 4.1 In-Flight Speed Sentinel (`backend/utils/downloader.js`)
* **Sliding Window:** Tracks `(timestamp, bytesReceived)` samples over the last 15 seconds.
* **State Machine:**
  * `WARMUP`: Bypasses checks during initial connection setup.
  * `NORMAL`: Runs at domain concurrency (6–8 threads).
  * `BOOST`: If rolling throughput $< \text{speedFloor}$, immediately scale concurrency to 16 threads and start a 12-second grace timer.
  * `FAILOVER`: If rolling throughput remains $< \text{speedFloor}$ after the grace period and $>10$ segments remain, abort download and reject with `SLOW_MIRROR_FAILOVER` tagged with `{ failedHost, bps }`.

### 4.2 Queue Worker Failover & Soft Fallback (`backend/utils/queue.js`)
* **Catching Failover:** Intercepts `SLOW_MIRROR_FAILOVER`, records `failedHost` into `hostSkipByEpid.get(epid)`.
* **Zero-Penalty Re-run:** Restarts source resolution immediately without incrementing retry count or waiting for backoff.
* **Segment Preservation:** Preserves already-downloaded chunks on disk so the next mirror continues where the previous mirror left off.
* **Permissive Mode:** If all available servers are excluded, clears `hostSkipByEpid` and completes the download with speed floor set to 0.

### 4.3 Settings UI & Persistence (`gui/src/components/settings/SettingsView.jsx`)
* Adds **"Minimum Download Speed"** dropdown in Settings $\rightarrow$ Downloads.
* Saves `minDownloadSpeed` (default: 300 KB/s) to database settings.

---

## 5. Verification Strategy

1. **Concurrency Ramp-Up Test:** Verify that when download speed drops below 300 KB/s, worker concurrency increases to 16 threads.
2. **Auto-Failover Test:** Verify that when throttled speed persists, the worker seamlessly switches to Server 2 and updates the download caption.
3. **Permissive Fallback Test:** Verify that when all available mirrors are throttled, the task finishes downloading without error.
4. **Settings Verification:** Verify changes in the UI dynamically update the downloader's speed floor.
