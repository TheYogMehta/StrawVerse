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
} from "lucide-react";
import { apiPost } from "../utils/common";
import "./css/DownloadsTracker.css";

export default function DownloadsTracker() {
  const [activeTask, setActiveTask] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);

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
    if (data.totalSegments && data.totalSegments > 0) {
      setActiveTask({
        caption: data.caption,
        totalSegments: data.totalSegments,
        currentSegments: data.currentSegments,
        epid: data.epid,
      });
    } else {
      setActiveTask(null);
    }
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
        if (data.totalSegments && data.totalSegments > 0) {
          setActiveTask({
            caption: data.caption,
            totalSegments: data.totalSegments,
            currentSegments: data.currentSegments,
            epid: data.epid,
          });
        } else {
          setActiveTask(null);
        }
        if (data.queue) {
          setQueue(data.queue);
        }
        if (data.isPaused !== undefined) {
          setIsPaused(!!data.isPaused);
        }
      });
    }
  }, []);

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

  const calculateProgress = () => {
    if (!activeTask || !activeTask.totalSegments) return 0;
    return Math.floor(
      (activeTask.currentSegments / activeTask.totalSegments) * 100,
    );
  };

  return (
    <div className="tracker-wrapper">
      <header className="tracker-header">
        <h1 className="tracker-title">Download Queue</h1>
        <div className="tracker-actions">
          {queue.length > 0 && (
          <button
            onClick={handleTogglePause}
            className={`btn-pause-queue ${isPaused ? "paused" : ""}`}
            title={isPaused ? "Start / Resume Queue" : "Pause Queue"}
          >
            {isPaused ? <Play size={16} /> : <Pause size={16} />}
            <span>{isPaused ? "Start Queue" : "Pause Queue"}</span>
          </button>
          )}

          <button
            onClick={fetchDownloads}
            className="btn-refresh"
            title="Force Refresh"
          >
            <RefreshCw size={16} />
          </button>
          {queue.length > 0 && (
            <button
              onClick={() => handleRemoveItem(null)}
              className="btn-clear-all"
            >
              <Trash2 size={16} />
              <span>Clear Queue</span>
            </button>
          )}
        </div>
      </header>

      {/* Active Downloading Progress */}
      {activeTask ? (
        <div className="active-panel glass-panel">
          <div className="active-header">
            <div className="u-style-27">
              {isPaused ? (
                <Pause size={20} color="var(--warning, #f59e0b)" />
              ) : (
                <Loader2 size={20} className="spin" color="var(--accent)" />
              )}
              <span className="active-caption">
                {isPaused
                  ? `[PAUSED] ${activeTask.caption}`
                  : activeTask.caption}
              </span>
            </div>
            <span className="active-percentage">{calculateProgress()}%</span>
          </div>

          {/* Progress bar wrapper */}
          <div className="progress-bg">
            <div
              className={`progress-fill ${isPaused ? "paused-fill" : ""}`}
              style={{ width: `${calculateProgress()}%` }}
            />
          </div>

          <div className="active-footer">
            <span>
              Downloaded {activeTask.currentSegments} of{" "}
              {activeTask.totalSegments} segments
            </span>
            <button
              onClick={() => handleRemoveItem(activeTask.epid)}
              className="btn-cancel-dl"
            >
              Cancel Download
            </button>
          </div>
        </div>
      ) : (
        <div className="idle-panel">
          <HardDrive size={36} color="var(--text-muted)" />
          <h3 className="u-style-28">
            {isPaused ? "Queue is paused" : "No active downloads"}
          </h3>
          <p className="u-style-29">
            {isPaused
              ? "Click Start Queue to resume downloading."
              : "Ready for tasks."}
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
              {queue.map((item, idx) => (
                <div key={item.epid || idx} className="queue-card glass-panel">
                  <div className="queue-item-info">
                    <span className="queue-title-text">{item.Title}</span>
                    <span className="queue-meta">
                      {item.Type === "Anime"
                        ? `Episode ${item.EpNum}`
                        : `Chapter ${item.EpNum}`}{" "}
                      • {item.Type.toUpperCase()}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveItem(item.epid)}
                    className="btn-remove-item"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
