/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useState, useEffect } from "react";
import { Loader2, LogOut, CheckCircle, Trash2 } from "lucide-react";
import Swal from "sweetalert2";
import "./css/SettingsView.css";

export default function SettingsView({ onMarketplaceOpen }) {
  const [settings, setSettings] = useState(null);
  const [url, setUrl] = useState("");
  const [malLoggedIn, setMalLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form states
  const [downloadLocation, setDownloadLocation] = useState("");
  const [discordRpc, setDiscordRpc] = useState("off");
  const [animeProvider, setAnimeProvider] = useState("");
  const [quality, setQuality] = useState("1080p");
  const [mangaProvider, setMangaProvider] = useState("weebcentral");
  const [autoLoadNextChapter, setAutoLoadNextChapter] = useState("on");
  const [pagination, setPagination] = useState("off");
  const [malStatus, setMalStatus] = useState("plan_to_watch");
  const [mergeSubtitles, setMergeSubtitles] = useState("off");
  const [subtitleFormat, setSubtitleFormat] = useState("vtt");
  const [malDiscordProfile, setMalDiscordProfile] = useState("off");
  const [malUsername, setMalUsername] = useState(null);

  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState("general");

  const [stats, setStats] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (activeTab === "history") {
      const loadHistoryData = async () => {
        setStatsLoading(true);
        try {
          const statsRes = await fetch("/api/history/stats");
          const statsData = await statsRes.json();
          setStats(statsData);

          const listRes = await fetch("/api/history/list?limit=50");
          const listData = await listRes.json();
          setHistoryList(listData);
        } catch (err) {
          console.error("Failed to fetch history:", err);
        } finally {
          setStatsLoading(false);
        }
      };
      loadHistoryData();
    }
  }, [activeTab]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings");
      const data = await response.json();
      setSettings(data.settings);
      setUrl(data.url);
      setMalLoggedIn(data.MalLoggedIn);

      // Load values into form states
      const s = data.settings;
      setDownloadLocation(s.CustomDownloadLocation || "");
      setDiscordRpc(s.enableDiscordRPC || "off");
      setAnimeProvider(s.Animeprovider || "");
      setQuality(s.quality || "1080p");
      setMangaProvider(s.Mangaprovider || "weebcentral");
      setAutoLoadNextChapter(s.autoLoadNextChapter || "on");
      setPagination(s.Pagination || "off");
      setMalStatus(s.status || "plan_to_watch");
      setMergeSubtitles(s.mergeSubtitles || "off");
      setSubtitleFormat(s.subtitleFormat || "vtt");
      setMalDiscordProfile(s.malDiscordProfile || "off");
      setMalUsername(data.malUsername || null);

      setHasChanges(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();

    if (window.sharedStateAPI && window.sharedStateAPI.on) {
      window.sharedStateAPI.on("mal", (data) => {
        setMalLoggedIn(data?.LoggedIn || false);
        fetchSettings();
      });
    }
  }, []);

  const handleDeleteHistory = async (type, id, title, number) => {
    const result = await Swal.fire({
      title: "Delete History Entry?",
      text: `Are you sure you want to delete the tracking entry for "${title}" (${type === "Anime" ? "Episode" : "Chapter"} ${number})? This will update your watch/read statistics.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#3085d6",
      confirmButtonText: "Yes, delete it!",
    });

    if (result.isConfirmed) {
      try {
        const res = await fetch(`/api/history/${type}/${id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (data.success) {
          Swal.fire({
            title: "Deleted!",
            text: "Your tracking entry has been deleted.",
            icon: "success",
            timer: 1500,
            showConfirmButton: false,
          });
          // Refresh statistics and history
          const statsRes = await fetch("/api/history/stats");
          const statsData = await statsRes.json();
          setStats(statsData);

          const listRes = await fetch("/api/history/list?limit=50");
          const listData = await listRes.json();
          setHistoryList(listData);
        } else {
          Swal.fire(
            "Error",
            data.error || "Failed to delete tracking entry.",
            "error",
          );
        }
      } catch (err) {
        Swal.fire(
          "Error",
          err.message || "An error occurred while deleting.",
          "error",
        );
      }
    }
  };

  const autoSaveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quality: quality,
          Animeprovider: animeProvider,
          Mangaprovider: mangaProvider,
          CustomDownloadLocation: downloadLocation,
          Pagination: pagination,
          autoLoadNextChapter: autoLoadNextChapter,
          status: malStatus,
          enableDiscordRPC: discordRpc,
          mergeSubtitles: mergeSubtitles,
          subtitleFormat: subtitleFormat,
          malDiscordProfile: malDiscordProfile,
        }),
      });
      const data = await response.json();
      if (data.message) {
        // Silently update comparison base to reset hasChanges state
        setSettings({
          ...settings,
          quality: quality,
          Animeprovider: animeProvider,
          Mangaprovider: mangaProvider,
          CustomDownloadLocation: downloadLocation,
          Pagination: pagination,
          autoLoadNextChapter: autoLoadNextChapter,
          status: malStatus,
          enableDiscordRPC: discordRpc,
          mergeSubtitles: mergeSubtitles,
          subtitleFormat: subtitleFormat,
          malDiscordProfile: malDiscordProfile,
        });
      } else if (data.error) {
        Swal.fire({
          title: "Error Saving Settings",
          text: data.error,
          icon: "error",
          toast: true,
          position: "top-end",
          showConfirmButton: false,
          timer: 3000,
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
        });
      }
    } catch (err) {
      console.error("Failed to auto-save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  // Monitor changes and trigger debounced auto-save
  useEffect(() => {
    if (!settings) return;
    const changed =
      downloadLocation !== (settings.CustomDownloadLocation || "") ||
      discordRpc !== (settings.enableDiscordRPC || "off") ||
      animeProvider !== (settings.Animeprovider || "") ||
      quality !== (settings.quality || "1080p") ||
      mangaProvider !== (settings.Mangaprovider || "weebcentral") ||
      autoLoadNextChapter !== (settings.autoLoadNextChapter || "on") ||
      pagination !== (settings.Pagination || "off") ||
      malStatus !== (settings.status || "plan_to_watch") ||
      mergeSubtitles !== (settings.mergeSubtitles || "off") ||
      subtitleFormat !== (settings.subtitleFormat || "vtt") ||
      malDiscordProfile !== (settings.malDiscordProfile || "off");

    setHasChanges(changed);

    if (changed) {
      const timer = setTimeout(() => {
        autoSaveSettings();
      }, 500); // 500ms debounce
      return () => clearTimeout(timer);
    }
  }, [
    downloadLocation,
    discordRpc,
    animeProvider,
    quality,
    mangaProvider,
    autoLoadNextChapter,
    pagination,
    malStatus,
    mergeSubtitles,
    subtitleFormat,
    malDiscordProfile,
    settings,
  ]);

  const handleMalLogout = async () => {
    const confirmResult = await Swal.fire({
      title: "Are you sure?",
      text: "Are you sure you want to logout from MyAnimeList?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, logout",
      cancelButtonText: "Cancel",
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      confirmButtonColor: "var(--danger)",
      cancelButtonColor: "var(--bg-tertiary)",
    });
    if (!confirmResult.isConfirmed) return;
    try {
      const res = await fetch("/mal/logout");
      if (res.ok) {
        Swal.fire({
          title: "Logged Out",
          text: "Logged out from MAL successfully!",
          icon: "success",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
        });
        fetchSettings();
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="settings-loading-center">
        <img src="/images/loading.gif" alt="loading" />
        <p>Loading configurations...</p>
      </div>
    );
  }

  return (
    <div className="settings-wrapper">
      <header className="settings-header">
        <h1 className="settings-title">App Settings</h1>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "13px",
            color: "var(--text-muted)",
          }}
        >
          {saving ? (
            <>
              <Loader2 size={14} className="spin" />
              <span>Saving changes...</span>
            </>
          ) : hasChanges ? (
            <span>Unsaved changes...</span>
          ) : (
            <>
              <span style={{ color: "var(--success)", fontWeight: "bold" }}>
                ✓
              </span>
              <span>All changes saved</span>
            </>
          )}
        </div>
      </header>

      {/* Horizontal Tabs Navigation */}
      <div className="settings-tabs-row">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={`settings-tab-btn ${activeTab === "general" ? "active" : ""}`}
        >
          General & UI
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("anime")}
          className={`settings-tab-btn ${activeTab === "anime" ? "active" : ""}`}
        >
          Anime Settings
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("manga")}
          className={`settings-tab-btn ${activeTab === "manga" ? "active" : ""}`}
        >
          Manga Settings
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("mal")}
          className={`settings-tab-btn ${activeTab === "mal" ? "active" : ""}`}
        >
          MyAnimeList
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`settings-tab-btn ${activeTab === "history" ? "active" : ""}`}
        >
          History & Stats
        </button>
      </div>

      <form onSubmit={(e) => e.preventDefault()} className="settings-form">
        {activeTab === "general" && (
          <div className="settings-row">
            <div className="settings-panel glass-panel">
              <h2 className="settings-panel-title">Directory & Discord</h2>
              <div className="settings-input-wrapper">
                <label className="settings-label">Download Location</label>
                <input
                  type="text"
                  value={downloadLocation}
                  onChange={(e) => setDownloadLocation(e.target.value)}
                  className="settings-text-input"
                  placeholder="Downloads directory path"
                />
              </div>
              <div className="settings-input-wrapper">
                <label className="settings-label">Discord Rich Presence</label>
                <select
                  value={discordRpc}
                  onChange={(e) => setDiscordRpc(e.target.value)}
                  className="settings-select"
                >
                  <option value="on">Enabled</option>
                  <option value="off">Disabled</option>
                </select>
              </div>
            </div>

            <div className="settings-panel glass-panel">
              <h2 className="settings-panel-title">UI Customization</h2>
              <div className="settings-input-wrapper">
                <label className="settings-label">Pagination Controls</label>
                <select
                  value={pagination}
                  onChange={(e) => setPagination(e.target.value)}
                  className="settings-select"
                >
                  <option value="on">Enabled (Page Buttons)</option>
                  <option value="off">Disabled (Infinite Scroll)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {activeTab === "anime" && (
          <div className="settings-panel glass-panel">
            <h2 className="settings-panel-title">Anime Settings</h2>
            <div className="settings-input-wrapper">
              <label className="settings-label">Active Anime Provider</label>
              <select
                value={animeProvider}
                onChange={(e) => setAnimeProvider(e.target.value)}
                className="settings-select"
              >
                <option value="">None selected</option>
                {settings?.providers?.Anime?.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-input-wrapper">
              <label className="settings-label">
                Preferred Streaming/Download Quality
              </label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className="settings-select"
              >
                <option value="1080p">1080p (Full HD)</option>
                <option value="720p">720p (HD)</option>
                <option value="360p">360p (SD)</option>
              </select>
            </div>

            <div
              style={{
                borderTop: "1px solid var(--border)",
                margin: "20px 0",
                paddingTop: "20px",
              }}
            />
            <h3
              className="settings-panel-title"
              style={{ marginBottom: "14px" }}
            >
              Subtitles Configuration
            </h3>
            <div className="settings-input-wrapper">
              <label className="settings-label">
                Merge Soft Subtitles into Video
              </label>
              <select
                value={mergeSubtitles}
                onChange={(e) => setMergeSubtitles(e.target.value)}
                className="settings-select"
              >
                <option value="on">Yes (Merge subtitles inside MP4)</option>
                <option value="off">
                  No (Download subtitles in subfolder)
                </option>
              </select>
              <span className="settings-hint">
                Merges multi-lingual soft subs directly into the video stream
                via FFmpeg.
              </span>
            </div>
            <div className="settings-input-wrapper">
              <label className="settings-label">
                Subtitle Format Conversion
              </label>
              <select
                value={subtitleFormat}
                onChange={(e) => setSubtitleFormat(e.target.value)}
                className="settings-select"
              >
                <option value="srt">SubRip (.srt)</option>
                <option value="vtt">WebVTT (.vtt)</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => onMarketplaceOpen("Anime")}
              className="settings-market-btn"
              style={{ marginTop: "20px" }}
            >
              Open Anime Marketplace
            </button>
          </div>
        )}

        {activeTab === "manga" && (
          <div className="settings-panel glass-panel">
            <h2 className="settings-panel-title">Manga Settings</h2>
            <div className="settings-input-wrapper">
              <label className="settings-label">Active Manga Provider</label>
              <select
                value={mangaProvider}
                onChange={(e) => setMangaProvider(e.target.value)}
                className="settings-select"
              >
                {settings?.providers?.Manga?.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-input-wrapper">
              <label className="settings-label">Auto Load Next Chapter</label>
              <select
                value={autoLoadNextChapter}
                onChange={(e) => setAutoLoadNextChapter(e.target.value)}
                className="settings-select"
              >
                <option value="on">Enabled</option>
                <option value="off">Disabled</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => onMarketplaceOpen("Manga")}
              className="settings-market-btn"
            >
              Open Manga Marketplace
            </button>
          </div>
        )}

        {activeTab === "mal" && (
          <div className="settings-panel glass-panel">
            <h2 className="settings-panel-title">MyAnimeList Connection</h2>
            {malLoggedIn ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "var(--success)",
                    fontWeight: "600",
                  }}
                >
                  <CheckCircle size={18} />
                  <span>MyAnimeList account is connected!</span>
                </div>
                <div className="settings-input-wrapper">
                  <label className="settings-label">
                    Auto update anime status to:
                  </label>
                  <select
                    value={malStatus}
                    onChange={(e) => setMalStatus(e.target.value)}
                    className="settings-select"
                  >
                    <option value="plan_to_watch">Plan To Watch</option>
                    <option value="watching">Watching</option>
                    <option value="completed">Completed</option>
                    <option value="on_hold">On Hold</option>
                    <option value="dropped">Dropped</option>
                  </select>
                </div>
                {discordRpc === "on" && (
                  <div className="settings-input-wrapper">
                    <label className="settings-label">
                      Show MAL Profile in Discord Activity
                    </label>
                    <select
                      value={malDiscordProfile}
                      onChange={(e) => setMalDiscordProfile(e.target.value)}
                      className="settings-select"
                    >
                      <option value="off">No</option>
                      <option value="on">Yes</option>
                    </select>
                    {malDiscordProfile === "on" && malUsername && (
                      <span className="settings-hint">
                        Profile button will link to: myanimelist.net/profile/
                        {malUsername}
                      </span>
                    )}
                    {malDiscordProfile === "on" && !malUsername && (
                      <span
                        className="settings-hint"
                        style={{ color: "var(--danger)" }}
                      >
                        MAL username not found — re-authenticate to fix.
                      </span>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleMalLogout}
                  className="settings-logout-btn"
                >
                  <LogOut size={16} />
                  <span>Disconnect Account</span>
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <p
                  style={{
                    fontSize: "13px",
                    color: "var(--text-muted)",
                    lineHeight: "1.5",
                  }}
                >
                  Connecting your MyAnimeList account allows StrawVerse to sync
                  your watch status, automatically update episodes in your
                  plan-to-watch/watching lists.
                </p>
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="settings-connect-link"
                  >
                    Authenticate MyAnimeList Account
                  </a>
                ) : (
                  <p style={{ color: "var(--danger)", fontSize: "12px" }}>
                    No OAuth URL generated by MAL backend.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {activeTab === "history" && (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "24px" }}
          >
            {statsLoading ? (
              <div className="settings-loading-center">
                <Loader2 size={32} className="spin" />
                <p>Loading history data...</p>
              </div>
            ) : (
              <>
                {/* Stats Dashboard Grid */}
                <div className="settings-stats-grid">
                  <div className="settings-stat-card glass-panel">
                    <span className="settings-stat-card-title">
                      Total Watch Time
                    </span>
                    <h3 className="settings-stat-card-val">
                      {stats?.watchHours || 0}{" "}
                      <span className="settings-stat-unit">hrs</span>
                    </h3>
                    <p className="settings-stat-card-sub">
                      {stats?.completedEpisodes || 0} episodes completed (
                      {stats?.distinctAnime || 0} titles)
                    </p>
                  </div>
                  <div className="settings-stat-card glass-panel">
                    <span className="settings-stat-card-title">
                      Total Read Time
                    </span>
                    <h3 className="settings-stat-card-val">
                      {stats?.readHours || 0}{" "}
                      <span className="settings-stat-unit">hrs</span>
                    </h3>
                    <p className="settings-stat-card-sub">
                      {stats?.completedChapters || 0} chapters completed (
                      {stats?.distinctManga || 0} titles)
                    </p>
                  </div>
                </div>

                {/* History Timeline */}
                <div className="settings-panel glass-panel">
                  <h2 className="settings-panel-title">
                    Recent Activity History
                  </h2>
                  {historyList.length === 0 ? (
                    <p
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "13px",
                        fontStyle: "italic",
                        padding: "10px 0",
                      }}
                    >
                      No history records found yet. Go watch some anime or read
                      some manga!
                    </p>
                  ) : (
                    <div className="settings-history-list-container">
                      {historyList.map((item, idx) => {
                        const formattedTime =
                          item.time_spent > 3600
                            ? `${(item.time_spent / 3600).toFixed(1)} hours`
                            : item.time_spent > 60
                              ? `${Math.round(item.time_spent / 60)} minutes`
                              : `${Math.round(item.time_spent)} seconds`;

                        const formattedDate = new Date(
                          item.date,
                        ).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        });

                        return (
                          <div key={idx} className="settings-history-item">
                            <div className="settings-history-item-left">
                              <span
                                className={`settings-history-type-badge ${item.type === "Anime" ? "" : "manga"}`}
                              >
                                {item.type}
                              </span>
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "4px",
                                }}
                              >
                                <strong className="settings-history-item-title">
                                  {item.title}
                                </strong>
                                <span className="settings-history-item-meta">
                                  {item.type === "Anime"
                                    ? "Episode"
                                    : "Chapter"}{" "}
                                  {item.number} • Spent {formattedTime}
                                </span>
                              </div>
                            </div>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "16px",
                              }}
                            >
                              <div className="settings-history-item-right">
                                <span className="settings-history-item-date">
                                  {formattedDate}
                                </span>
                                {item.is_completed === 1 && (
                                  <span className="settings-completed-badge">
                                    Completed
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                className="history-delete-btn"
                                onClick={() =>
                                  handleDeleteHistory(
                                    item.type,
                                    item.id,
                                    item.title,
                                    item.number,
                                  )
                                }
                                title="Delete history entry"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
