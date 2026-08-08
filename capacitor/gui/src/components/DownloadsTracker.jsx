/* eslint-disable react-hooks/exhaustive-deps, no-unused-vars */
import { useState, useEffect } from "react";
import {
  Loader2,
  Trash2,
  X,
  CheckCircle,
  HardDrive,
  RefreshCw,
  Pause,
  Play,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { apiPost } from "../utils/common";
import "./css/DownloadsTracker.css";

export default function DownloadsTracker() {
  const [activeTasks, setActiveTasks] = useState([]);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(null);

  const fetchDownloads = async () => {
    try {
      const data = await apiPost("/downloads");
      updateStates(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const updateStates = (data) => {
    let tasks = [];
    if (Array.isArray(data.activeTasks) && data.activeTasks.length > 0) {
      tasks = data.activeTasks;
    } else if (data.totalSegments && data.totalSegments > 0) {
      tasks = [
        {
          caption: data.caption,
          totalSegments: data.totalSegments,
          currentSegments: data.currentSegments,
          epid: data.epid,
          id: data.id,
          malid: data.malid,
          EpNum: data.EpNum,
          Title: data.Title,
          Type: data.Type,
          concurrency: data.concurrency,
          lastTestedConcurrency: data.lastTestedConcurrency,
        },
      ];
    }
    setActiveTasks(tasks);
    setQueue(data.queue || []);
    if (data.isPaused !== undefined) {
      setIsPaused(!!data.isPaused);
    }
  };

  useEffect(() => {
    fetchDownloads();

    // Listen to real-time Electron IPC download events
    if (window.sharedStateAPI && window.sharedStateAPI.on) {
      window.sharedStateAPI.on("download-logger", (data) => {
        let incomingTasks = [];
        if (Array.isArray(data.activeTasks) && data.activeTasks.length > 0) {
          incomingTasks = data.activeTasks;
        } else if (data.totalSegments && data.totalSegments > 0) {
          incomingTasks = [
            {
              caption: data.caption,
              totalSegments: data.totalSegments,
              currentSegments: data.currentSegments,
              epid: data.epid,
              id: data.id,
              malid: data.malid,
              EpNum: data.EpNum,
              Title: data.Title,
              Type: data.Type,
              concurrency: data.concurrency,
              lastTestedConcurrency: data.lastTestedConcurrency,
            },
          ];
        }

        setActiveTasks((prevTasks) => {
          return incomingTasks.map((task) => {
            const prev = prevTasks.find((t) => t.epid === task.epid);
            return {
              ...task,
              id: task.id ?? prev?.id,
              malid: task.malid ?? prev?.malid,
              EpNum: task.EpNum ?? prev?.EpNum,
              Title: task.Title ?? prev?.Title,
              Type: task.Type ?? prev?.Type,
              concurrency: task.concurrency ?? prev?.concurrency,
              lastTestedConcurrency:
                task.lastTestedConcurrency ?? prev?.lastTestedConcurrency,
            };
          });
        });

        if (data.queue) {
          const activeEpids = new Set(incomingTasks.map((t) => t.epid));
          setQueue(data.queue.filter((item) => !activeEpids.has(item?.epid)));
        }
        if (data.isPaused !== undefined) {
          setIsPaused(!!data.isPaused);
        }
      });
    }
  }, []);

  useEffect(() => {
    const rawCaption = activeTasks[0]?.caption || "";
    const retryMatch = rawCaption.match(/Retrying in (\d+)s/i);

    if (retryMatch) {
      const initialSeconds = parseInt(retryMatch[1], 10);
      setRetryCountdown(initialSeconds);

      const interval = setInterval(() => {
        setRetryCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    } else {
      setRetryCountdown(null);
    }
  }, [activeTasks[0]?.caption]);

  const handleTogglePause = async () => {
    try {
      const endpoint = isPaused
        ? "/api/download/resume"
        : "/api/download/pause";
      const data = await apiPost(endpoint);
      if (data.isPaused !== undefined) {
        setIsPaused(data.isPaused);
      }
      fetchDownloads();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveItem = async (epid) => {
    try {
      await apiPost("/api/download/remove", { AnimeEpId: epid });
      fetchDownloads();
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearQueue = async () => {
    try {
      await apiPost("/api/download/remove", {});
      fetchDownloads();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="downloads-tracker-container">
      <header className="tracker-header">
        <div className="tracker-title-group">
          <h1 className="u-style-26 tracker-main-title">Downloads</h1>
          <p className="tracker-subtitle">
            Manage your active and queued downloads
          </p>
        </div>

        <div className="header-actions">
          <button
            onClick={handleTogglePause}
            className={`btn-pause-toggle ${isPaused ? "resume" : "pause"}`}
          >
            {isPaused ? <Play size={15} /> : <Pause size={15} />}
            <span>{isPaused ? "Resume Queue" : "Pause Queue"}</span>
          </button>

          <button onClick={fetchDownloads} className="btn-refresh">
            <RefreshCw size={15} />
            <span>Refresh</span>
          </button>

          {(activeTasks.length > 0 || queue.length > 0) && (
            <button onClick={handleClearQueue} className="btn-clear-all">
              <Trash2 size={15} />
              <span>Clear Queue</span>
            </button>
          )}
        </div>
      </header>

      {/* Active Downloading Progress */}
      {activeTasks.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {activeTasks.map((activeTask) => {
            const progressPct = activeTask.totalSegments
              ? Math.floor(
                  (activeTask.currentSegments / activeTask.totalSegments) * 100,
                )
              : 0;
            const rawCaption = activeTask.caption || "";
            let mainTitle = rawCaption;
            let subStatus = null;

            const errorMatch = rawCaption.match(
              /(Download error on segment[\s\S]+|Error downloading[\s\S]+|Retrying in[\s\S]+)/i,
            );
            if (errorMatch && errorMatch.index > 0) {
              mainTitle = rawCaption.substring(0, errorMatch.index).trim();
              subStatus = errorMatch[0].trim();
            } else {
              const match = rawCaption.match(
                /^(Downloading\s+(?:EP|CHP)\s+[\d\.]+\s+.*?\(\s*\d+p\s*\))/i,
              );
              if (match) {
                mainTitle = match[1].trim();
                if (rawCaption.length > mainTitle.length) {
                  subStatus = rawCaption.substring(mainTitle.length).trim();
                }
              }
            }

            return (
              <div key={activeTask.epid} className="active-panel glass-panel">
                <div className="active-header">
                  <div className="active-title-block">
                    <div className="active-title-row">
                      {isPaused ? (
                        <Pause size={16} color="var(--warning, #f59e0b)" />
                      ) : (
                        <Loader2
                          size={16}
                          className="spin"
                          color="var(--accent)"
                        />
                      )}
                      <span className="active-caption">
                        {isPaused ? `[PAUSED] ${mainTitle}` : mainTitle}
                      </span>
                    </div>
                    {subStatus && (
                      <div className="active-substatus">
                        {retryCountdown !== null
                          ? subStatus.replace(
                              /Retrying in \d+s/i,
                              `Retrying in ${retryCountdown}s`,
                            )
                          : subStatus}
                      </div>
                    )}
                  </div>
                  <span className="active-percentage">{progressPct}%</span>
                </div>

                <div className="progress-bg">
                  <div
                    className={`progress-fill ${isPaused ? "paused-fill" : ""}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                <div className="active-footer">
                  <div className="active-footer-left">
                    <span>
                      Downloaded {activeTask.currentSegments} of{" "}
                      {activeTask.totalSegments} segments
                    </span>
                    {activeTask.concurrency && (
                      <span className="badge-concurrent">
                        <Zap size={11} /> {activeTask.concurrency} Concurrent
                      </span>
                    )}
                    {subStatus && activeTask.lastTestedConcurrency && (
                      <span className="badge-warning">
                        <AlertTriangle size={11} /> Last tested:{" "}
                        {activeTask.lastTestedConcurrency} concurrent
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveItem(activeTask.epid)}
                    className="btn-cancel-dl"
                  >
                    Cancel Download
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="idle-panel glass-panel">
          <div className="idle-icon-box">
            <HardDrive size={28} />
          </div>
          <h3 className="idle-title">
            {isPaused ? "Queue is Paused" : "No Active Downloads"}
          </h3>
          <p className="idle-subtitle">
            {isPaused
              ? "Click Resume Queue to continue downloading."
              : "Downloads added from Discovery will appear here."}
          </p>
        </div>
      )}

      {/* Queue items list */}
      {!loading && queue.length === 0 ? null : (
        <div className="queue-section">
          <h2 className="queue-title">Upcoming Queue ({queue.length})</h2>

          {loading ? (
            <div className="loading-center">
              <Loader2 size={36} className="spin" color="var(--accent)" />
            </div>
          ) : (
            <div className="queue-list">
              {queue.map((item, idx) => {
                const qualStr = item.config?.quality
                  ? ` ( ${item.config.quality} )`
                  : "";
                const displayTitle =
                  item.Type === "Anime"
                    ? `EP ${item.EpNum} ${item.Title}${qualStr}`
                    : `CHP ${item.EpNum} ${item.Title}${qualStr}`;
                const isItemCooling =
                  item.caption &&
                  (item.caption.includes("Retrying in") ||
                    item.caption.includes("Rate limited"));
                return (
                  <div
                    key={item.epid || idx}
                    className="queue-card glass-panel"
                  >
                    <div className="queue-item-info">
                      <span className="queue-title-text">{displayTitle}</span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          marginTop: "2px",
                        }}
                      >
                        <span className="queue-meta">
                          {item.Type.toUpperCase()}
                        </span>
                        {isItemCooling && (
                          <span
                            className="badge-warning"
                            style={{ fontSize: "10px", padding: "1px 6px" }}
                          >
                            <AlertTriangle size={10} /> Cooldown (Retrying soon)
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveItem(item.epid)}
                      className="btn-remove-item"
                    >
                      <X size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
