/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useState, useEffect } from "react";
import { Loader2, LogOut, CheckCircle, Trash2, MessageSquare } from "lucide-react";
import Swal from "sweetalert2";
import "./css/SettingsView.css";

export default function SettingsView({ onMarketplaceOpen, onSelectMedia }) {
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
  const [imageCacheSizeLimit, setImageCacheSizeLimit] = useState(5);
  const [cacheStats, setCacheStats] = useState(null);
  const [clearingCache, setClearingCache] = useState(false);

  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState("general");

  const [stats, setStats] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);

  const [changelog, setChangelog] = useState("");
  const [changelogLoading, setChangelogLoading] = useState(false);

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

  useEffect(() => {
    if (activeTab === "changelog" && !changelog) {
      const fetchChangelogData = async () => {
        setChangelogLoading(true);
        try {
          const res = await fetch("/api/changelog");
          const data = await res.json();
          if (data.changelog) {
            setChangelog(data.changelog);
          }
        } catch (err) {
          console.error("Failed to fetch changelog:", err);
        } finally {
          setChangelogLoading(false);
        }
      };
      fetchChangelogData();
    }
  }, [activeTab, changelog]);

  const fetchCacheStats = async () => {
    try {
      const response = await fetch("/api/cache/stats");
      const data = await response.json();
      setCacheStats(data);
    } catch (err) {
      console.error("Failed to fetch cache stats:", err);
    }
  };

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
      setImageCacheSizeLimit(s.imageCacheSizeLimit || 5);

      setHasChanges(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchCacheStats();

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

  const handleClearHistory = async () => {
    const confirmResult = await Swal.fire({
      title: "Clear All History?",
      text: "Are you sure you want to permanently clear all watch and read history? This cannot be undone.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, clear all",
      cancelButtonText: "Cancel",
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      confirmButtonColor: "var(--danger)",
      cancelButtonColor: "var(--bg-tertiary)",
    });
    if (!confirmResult.isConfirmed) return;

    try {
      const response = await fetch("/api/history/clear", {
        method: "POST",
      });
      const data = await response.json();
      if (data.success) {
        Swal.fire({
          title: "Cleared!",
          text: "All activity history has been cleared.",
          icon: "success",
          timer: 1500,
          showConfirmButton: false,
        });
        setStats({
          watchHours: 0,
          readHours: 0,
          completedEpisodes: 0,
          completedChapters: 0,
          distinctAnime: 0,
          distinctManga: 0,
        });
        setHistoryList([]);
      } else {
        Swal.fire({
          title: "Error",
          text: data.error || "Failed to clear history.",
          icon: "error",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const autoSaveSettings = async () => {
    const finalLimit = parseInt(imageCacheSizeLimit, 10);
    if (isNaN(finalLimit) || finalLimit < 5) return; // Don't auto-save invalid limits

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
          imageCacheSizeLimit: finalLimit,
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
          imageCacheSizeLimit: finalLimit,
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
    const finalLimit = parseInt(imageCacheSizeLimit, 10);
    const isValidLimit = !isNaN(finalLimit) && finalLimit >= 5;

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
      malDiscordProfile !== (settings.malDiscordProfile || "off") ||
      (isValidLimit && finalLimit !== (settings.imageCacheSizeLimit || 5));

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
    imageCacheSizeLimit,
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

  const handleClearCache = async () => {
    const confirmResult = await Swal.fire({
      title: "Clear Image Cache?",
      text: "This will delete all cached cover and metadata images. They will be re-downloaded when needed.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, clear cache",
      cancelButtonText: "Cancel",
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      confirmButtonColor: "var(--danger)",
      cancelButtonColor: "var(--bg-tertiary)",
    });
    if (!confirmResult.isConfirmed) return;
    setClearingCache(true);
    try {
      const res = await fetch("/api/cache/clear", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        Swal.fire({
          title: "Cache Cleared",
          text: "Image cache cleared successfully!",
          icon: "success",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
          timer: 1500,
          showConfirmButton: false,
        });
        fetchCacheStats();
      } else {
        Swal.fire("Error", data.error || "Failed to clear cache.", "error");
      }
    } catch (err) {
      console.error(err);
      Swal.fire("Error", err.message || "An error occurred.", "error");
    } finally {
      setClearingCache(false);
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
          onClick={() => setActiveTab("anime_manga")}
          className={`settings-tab-btn ${activeTab === "anime_manga" ? "active" : ""}`}
        >
          Anime & Manga Settings
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`settings-tab-btn ${activeTab === "history" ? "active" : ""}`}
        >
          History & Stats
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("changelog")}
          className={`settings-tab-btn ${activeTab === "changelog" ? "active" : ""}`}
        >
          Release Notes
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

            <div className="settings-panel glass-panel">
              <h2 className="settings-panel-title">Storage & Cache</h2>
              <div className="settings-input-wrapper">
                <label className="settings-label">Image Cache Size Limit</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="number"
                    min={5}
                    value={imageCacheSizeLimit}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setImageCacheSizeLimit(isNaN(val) ? "" : val);
                    }}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (isNaN(val) || val < 5) {
                        setImageCacheSizeLimit(5);
                      }
                    }}
                    className="settings-text-input"
                    style={{ width: '100px', padding: '10px 14px' }}
                  />
                  <span style={{ fontSize: '14px', color: 'var(--text-main)', fontWeight: '600' }}>GB</span>
                </div>
                <span className="settings-hint">
                  Minimum 5 GB. Automatically evicts oldest cached images if the cache folder exceeds this size.
                </span>
              </div>
              <div className="settings-input-wrapper" style={{ marginTop: '12px' }}>
                <label className="settings-label">Current Cache Usage</label>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    {cacheStats ? `${(cacheStats.sizeInBytes / (1024 * 1024)).toFixed(1)} MB (${cacheStats.filesCount} files)` : 'Calculating...'}
                  </span>
                  <button
                    type="button"
                    onClick={handleClearCache}
                    disabled={clearingCache}
                    className="settings-logout-btn"
                    style={{ margin: 0, padding: '6px 12px', backgroundColor: 'var(--danger)', color: 'white', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    {clearingCache ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                    <span>Clear Image Cache</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-panel glass-panel">
              <h2 className="settings-panel-title">Community & Support</h2>
              <div className="settings-input-wrapper" style={{ gap: '10px' }}>
                <span className="settings-hint" style={{ fontSize: '13px', lineHeight: '1.5' }}>
                  Join our Discord community to chat with other members, request features, report issues, and stay updated!
                </span>
                <a
                  href="https://discord.gg/PzfUBgQ2gt"
                  target="_blank"
                  rel="noreferrer"
                  className="settings-connect-link"
                  style={{
                    backgroundColor: '#5865F2',
                    boxShadow: '0 4px 12px rgba(88, 101, 242, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    marginTop: '8px'
                  }}
                >
                  <MessageSquare size={16} />
                  <span>Join Discord Server</span>
                </a>
              </div>
            </div>
          </div>
        )}

        {activeTab === "anime_manga" && (
          <div className="settings-row">
            {/* Anime Settings Card */}
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

              <h3 className="settings-panel-subtitle">
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

            {/* Manga Settings Card */}
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
                style={{ marginTop: "20px" }}
              >
                Open Manga Marketplace
              </button>
            </div>

            {/* MyAnimeList Connection Card */}
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
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px dashed var(--border)", paddingBottom: "10px" }}>
                    <h2 className="settings-panel-title" style={{ margin: 0, borderBottom: "none", paddingBottom: 0 }}>
                      Recent Activity History
                    </h2>
                    {historyList.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearHistory}
                        className="settings-clear-history-btn"
                        style={{
                          background: "rgba(239, 68, 68, 0.15)",
                          border: "1.5px solid var(--danger)",
                          color: "var(--danger)",
                          borderRadius: "6px",
                          padding: "6px 14px",
                          fontSize: "12px",
                          fontWeight: "600",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                        }}
                      >
                        Clear History
                      </button>
                    )}
                  </div>
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
                          <div
                            key={idx}
                            className="settings-history-item clickable"
                            onClick={() => {
                              if (onSelectMedia && item.media_id) {
                                onSelectMedia(
                                  item.media_id,
                                  item.type,
                                  "local",
                                  "Back to Settings"
                                );
                              }
                            }}
                          >
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
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                  <strong className="settings-history-item-title">
                                    {item.title}
                                  </strong>
                                  {item.is_completed === 1 && (
                                    <span className="settings-completed-badge" style={{ fontSize: "9px", padding: "2px 6px" }}>
                                      Completed
                                    </span>
                                  )}
                                </div>
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
                                flexShrink: 0,
                              }}
                            >
                              <span className="settings-history-item-date">
                                {formattedDate}
                              </span>
                              <button
                                type="button"
                                className="history-delete-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteHistory(
                                    item.type,
                                    item.id,
                                    item.title,
                                    item.number,
                                  );
                                }}
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

        {activeTab === "changelog" && (
          <div className="settings-panel glass-panel">
            <h2 className="settings-panel-title">Release Notes / Changelog</h2>
            {changelogLoading ? (
              <div className="settings-loading-center">
                <Loader2 size={32} className="spin" />
                <p>Loading release notes...</p>
              </div>
            ) : changelog ? (
              <ChangelogRenderer markdown={changelog} />
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                Failed to load release notes.
              </p>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

function ChangelogRenderer({ markdown }) {
  if (!markdown) return null;

  const lines = markdown.split("\n");
  return (
    <div className="changelog-container">
      {lines.map((line, idx) => {
        if (line.startsWith("# ")) {
          return (
            <h1 key={idx} className="changelog-h1">
              {line.replace("# ", "")}
            </h1>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <h2 key={idx} className="changelog-h2">
              {line.replace("## ", "")}
            </h2>
          );
        }
        if (line.startsWith("### ")) {
          return (
            <h3 key={idx} className="changelog-h3">
              {line.replace("### ", "")}
            </h3>
          );
        }
        if (line.startsWith("- ")) {
          return (
            <li key={idx} className="changelog-li">
              {parseChangelogContent(line.replace("- ", ""))}
            </li>
          );
        }
        if (line.trim() === "") {
          return <div key={idx} style={{ height: "8px" }} />;
        }
        return (
          <p key={idx} className="changelog-p">
            {parseChangelogContent(line)}
          </p>
        );
      })}
    </div>
  );
}

function parseChangelogContent(text) {
  // Check for keyboard shortcut pattern: "Key Name: Description"
  const shortcutRegex = /^([^:]+):\s*(.*)$/;
  const match = text.match(shortcutRegex);
  if (match) {
    const keysPart = match[1].trim();
    const descPart = match[2].trim();

    // Verify it is a shortcut (alphanumeric/arrow symbols, max 45 chars, no multiple spaces, not a standard word)
    const isShortcut = /^[a-zA-Z0-9\s+/→←↑↓`&,|-]+$/.test(keysPart) && 
                       keysPart.length < 45 && 
                       !keysPart.includes("  ") &&
                       !/^(http|https|fix|add|implement|split|update|remove|rebranded|re-added|select|choose|join|join\s+our)/i.test(keysPart);
    
    if (isShortcut) {
      const tokens = keysPart.split(/(\s*\/\s*|\s+or\s+|\s*\+\s*|\s*,\s*)/g);
      const renderedKeys = tokens.map((token, index) => {
        const isSeparator = /^\s*(\/|or|\+|,)\s*$/.test(token);
        if (isSeparator) {
          return <span key={index} className="kbd-separator">{token}</span>;
        }
        const cleanKey = token.replace(/`/g, "").trim();
        if (!cleanKey) return null;
        return (
          <kbd key={index} className="changelog-kbd">
            {cleanKey}
          </kbd>
        );
      });

      return (
        <span className="changelog-shortcut-row">
          <span className="changelog-keys-wrapper">{renderedKeys}</span>
          <span className="kbd-desc-separator">:</span>
          <span className="changelog-desc">{parseMarkdownLinks(descPart)}</span>
        </span>
      );
    }
  }

  return parseMarkdownLinks(text);
}

function parseMarkdownLinks(text) {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    const [, linkText, url] = match;
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      parts.push(text.substring(lastIndex, matchIndex));
    }

    parts.push(
      <a
        key={matchIndex}
        href={url}
        target="_blank"
        rel="noreferrer"
        className="changelog-link"
      >
        {linkText}
      </a>,
    );

    lastIndex = linkRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}
