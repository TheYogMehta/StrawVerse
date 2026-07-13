/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useState, useEffect } from "react";
import {
  Loader2,
  LogOut,
  CheckCircle,
  Trash2,
  MessageSquare,
  Link as LinkIcon,
  RefreshCw,
} from "lucide-react";
import Swal from "sweetalert2";
import { swalSuccess, swalError, swalConfirm } from "../../utils/swal";
import { apiPost } from "../../utils/common";
import watchTogetherClient from "../../utils/watchTogetherClient";
import SettingsRow from "./SettingsRow";
import Dropdown from "../common/Dropdown";
import "../css/SettingsView.css";

export default function SettingsView({
  initialTab = "general",
  onMarketplaceOpen,
  onSelectMedia,
  onSettingsSaved,
}) {
  const [settings, setSettings] = useState(null);
  const [url, setUrl] = useState("");
  const [malLoggedIn, setMalLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form states
  const [downloadLocation, setDownloadLocation] = useState("");
  const [animeProvider, setAnimeProvider] = useState("");
  const [quality, setQuality] = useState("1080p");
  const [mangaProvider, setMangaProvider] = useState("weebcentral");
  const [autoLoadNextChapter, setAutoLoadNextChapter] = useState(true);
  const [pagination, setPagination] = useState(false);
  const [malStatus, setMalStatus] = useState("plan_to_watch");
  const [mergeSubtitles, setMergeSubtitles] = useState(false);
  const [subtitleFormat, setSubtitleFormat] = useState("vtt");
  const [malUsername, setMalUsername] = useState(null);
  const [imageCacheSizeLimit, setImageCacheSizeLimit] = useState(5);
  const [developerMode, setDeveloperMode] = useState(false);
  const [autoSkipIntro, setAutoSkipIntro] = useState(true);
  const [mangaReaderLayout, setMangaReaderLayout] = useState("long-strip");
  const [mangaReaderWidth, setMangaReaderWidth] = useState(800);
  const [cacheStats, setCacheStats] = useState(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const getProviderIcon = (name, type) => {
    if (!name || !settings?.installedExtensions) return null;
    const list =
      type === "Anime"
        ? settings.installedExtensions.Anime
        : settings.installedExtensions.Manga;
    const ext = list?.find((e) => e.name === name);
    return ext?.icon || null;
  };
  const cleanUrlForDisplay = (url) => {
    let cleaned = (url || "").trim();
    cleaned = cleaned.replace(/^(wss:\/\/|ws:\/\/|https:\/\/|http:\/\/)/i, "");
    cleaned = cleaned.replace(/\/ws$/i, "");
    cleaned = cleaned.replace(/\/+$/, "");
    return cleaned;
  };

  const [wtServerUrl, setWtServerUrl] = useState(
    cleanUrlForDisplay(watchTogetherClient.getServerUrl()),
  );
  const [verifyingWt, setVerifyingWt] = useState(false);

  const handleResetWtServer = () => {
    const defaultDisplay = "strawverse-wt.theyogmehta.online";
    setWtServerUrl(defaultDisplay);
    watchTogetherClient.setServerUrl(defaultDisplay);
    Swal.fire({
      title: "Reset Successful",
      text: "Watch Together server URL has been reset to default.",
      icon: "success",
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 3000,
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
    });
  };

  const handleVerifyWtServer = async () => {
    let targetUrl = wtServerUrl.trim();
    if (!targetUrl) {
      Swal.fire({
        title: "Invalid URL",
        text: "Please enter a Server URL to verify.",
        icon: "warning",
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 3000,
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
      });
      return;
    }

    let domain = targetUrl;
    domain = domain.replace(/^(wss:\/\/|ws:\/\/|https:\/\/|http:\/\/)/i, "");
    domain = domain.replace(/\/ws$/i, "");
    domain = domain.replace(/\/health$/i, "");
    domain = domain.replace(/\/+$/, "");

    setVerifyingWt(true);

    const protocols = ["https://", "http://"];
    let success = false;
    let serverInfo = null;

    for (const proto of protocols) {
      const healthUrl = `${proto}${domain}/health`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const res = await fetch(healthUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data && data.server === "StrawVerse Watch Together") {
            success = true;
            serverInfo = data;
            break;
          }
        }
      } catch (err) {
        // Continue
      }
    }

    setVerifyingWt(false);

    if (success) {
      Swal.fire({
        title: "Connection Successful",
        text: "Watch Together server verified successfully!",
        icon: "success",
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 3000,
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
      });
    } else {
      Swal.fire({
        title: "Verification Failed",
        text: "Could not reach a valid StrawVerse Watch Together server at this address. Make sure the domain is correct.",
        icon: "error",
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 4000,
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
      });
    }
  };

  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const [stats, setStats] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [historyFilter, setHistoryFilter] = useState("All");
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
      if (window.sharedStateAPI && window.sharedStateAPI.getSettings) {
        const data = await window.sharedStateAPI.getSettings();
        setSettings(data.settings);
        setUrl(data.url);
        setMalLoggedIn(data.MalLoggedIn);

        // Load values into form states
        const s = data.settings;
        setDownloadLocation(s.CustomDownloadLocation || "");
        setAnimeProvider(s.Animeprovider || "");
        setQuality(s.quality || "1080p");
        setMangaProvider(s.Mangaprovider || "weebcentral");
        setAutoLoadNextChapter(s.autoLoadNextChapter);
        setPagination(s.Pagination);
        setMalStatus(s.status || "plan_to_watch");
        setMergeSubtitles(s.mergeSubtitles);
        setSubtitleFormat(s.subtitleFormat || "vtt");
        setImageCacheSizeLimit(s.imageCacheSizeLimit || 5);
        setDeveloperMode(s.developerMode);
        setAutoSkipIntro(s.autoSkipIntro);
        const layoutVal = s.mangaReaderLayout || "long-strip";
        setMangaReaderLayout(layoutVal);
        localStorage.setItem("manga_reader_layout", layoutVal);

        const widthVal = parseInt(s.mangaReaderWidth, 10) || 800;
        setMangaReaderWidth(widthVal);
        localStorage.setItem("manga_reader_width", widthVal);
        if (window.sharedStateAPI && window.sharedStateAPI.getAppVersion) {
          window.sharedStateAPI.getAppVersion().then(setAppVersion);
        }
      }

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
    const result = await swalConfirm(
      "Delete History Entry?",
      `Are you sure you want to delete the tracking entry for "${title}" (${type === "Anime" ? "Episode" : "Chapter"} ${number})? This will update your watch/read statistics.`,
      "Yes, delete it!",
    );

    if (result.isConfirmed) {
      try {
        const res = await fetch(`/api/history/${type}/${id}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (data.success) {
          swalSuccess("Deleted!", "Your tracking entry has been deleted.");
          // Refresh statistics and history
          const statsRes = await fetch("/api/history/stats");
          const statsData = await statsRes.json();
          setStats(statsData);

          const listRes = await fetch("/api/history/list?limit=50");
          const listData = await listRes.json();
          setHistoryList(listData);
        } else {
          swalError("Error", data.error || "Failed to delete tracking entry.");
        }
      } catch (err) {
        swalError("Error", err.message || "An error occurred while deleting.");
      }
    }
  };

  const handleClearHistory = async () => {
    const confirmResult = await swalConfirm(
      "Clear All History?",
      "Are you sure you want to permanently clear all watch and read history? This cannot be undone.",
      "Yes, clear all",
    );
    if (!confirmResult.isConfirmed) return;

    try {
      const data = await apiPost("/api/history/clear");
      if (data.success) {
        swalSuccess("Cleared!", "All activity history has been cleared.");
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
        swalError("Error", data.error || "Failed to clear history.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const autoSaveSettings = async () => {
    const finalLimit = parseInt(imageCacheSizeLimit, 10);
    const isValidLimit = !isNaN(finalLimit) && finalLimit >= 5;

    const dirty = {};
    if (downloadLocation !== (settings.CustomDownloadLocation || ""))
      dirty.CustomDownloadLocation = downloadLocation;
    if (animeProvider !== (settings.Animeprovider || ""))
      dirty.Animeprovider = animeProvider;
    if (quality !== (settings.quality || "1080p")) dirty.quality = quality;
    if (mangaProvider !== (settings.Mangaprovider || "weebcentral"))
      dirty.Mangaprovider = mangaProvider;
    if (autoLoadNextChapter !== settings.autoLoadNextChapter)
      dirty.autoLoadNextChapter = autoLoadNextChapter;
    if (pagination !== settings.Pagination) dirty.Pagination = pagination;
    if (malStatus !== (settings.status || "plan_to_watch"))
      dirty.status = malStatus;
    if (mergeSubtitles !== settings.mergeSubtitles)
      dirty.mergeSubtitles = mergeSubtitles;
    if (subtitleFormat !== (settings.subtitleFormat || "vtt"))
      dirty.subtitleFormat = subtitleFormat;
    if (developerMode !== settings.developerMode)
      dirty.developerMode = developerMode;
    if (autoSkipIntro !== settings.autoSkipIntro)
      dirty.autoSkipIntro = autoSkipIntro;
    if (mangaReaderLayout !== (settings.mangaReaderLayout || "long-strip"))
      dirty.mangaReaderLayout = mangaReaderLayout;
    if (mangaReaderWidth !== (parseInt(settings.mangaReaderWidth, 10) || 800))
      dirty.mangaReaderWidth = mangaReaderWidth;
    if (isValidLimit && finalLimit !== (settings.imageCacheSizeLimit || 5))
      dirty.imageCacheSizeLimit = finalLimit;

    if (Object.keys(dirty).length === 0) return;

    setSaving(true);
    try {
      if (window.sharedStateAPI) {
        const dirtyKeys = Object.keys(dirty);
        if (dirtyKeys.length === 1) {
          const key = dirtyKeys[0];
          await window.sharedStateAPI.updateSetting(key, dirty[key]);
        } else {
          await window.sharedStateAPI.updateSettings(dirty);
        }

        if (dirty.Animeprovider || dirty.Mangaprovider) {
          if (window.catalogCache) {
            delete window.catalogCache[`Anime_provider`];
            delete window.catalogCache[`Manga_provider`];
          }
        }

        // Silently update comparison base to reset hasChanges state
        setSettings({
          ...settings,
          ...dirty,
        });
        localStorage.setItem("manga_reader_layout", mangaReaderLayout);
        localStorage.setItem("manga_reader_width", mangaReaderWidth);
        if (onSettingsSaved) onSettingsSaved();
      }
    } catch (err) {
      console.error("Failed to auto-save settings:", err);
      Swal.fire({
        title: "Error Saving Settings",
        text: err.message,
        icon: "error",
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 3000,
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
      });
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
      animeProvider !== (settings.Animeprovider || "") ||
      quality !== (settings.quality || "1080p") ||
      mangaProvider !== (settings.Mangaprovider || "weebcentral") ||
      autoLoadNextChapter !== settings.autoLoadNextChapter ||
      pagination !== settings.Pagination ||
      malStatus !== (settings.status || "plan_to_watch") ||
      mergeSubtitles !== settings.mergeSubtitles ||
      subtitleFormat !== (settings.subtitleFormat || "vtt") ||
      developerMode !== settings.developerMode ||
      autoSkipIntro !== settings.autoSkipIntro ||
      mangaReaderLayout !== (settings.mangaReaderLayout || "long-strip") ||
      mangaReaderWidth !== (parseInt(settings.mangaReaderWidth, 10) || 800) ||
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
    animeProvider,
    quality,
    mangaProvider,
    autoLoadNextChapter,
    pagination,
    malStatus,
    mergeSubtitles,
    subtitleFormat,
    imageCacheSizeLimit,
    developerMode,
    autoSkipIntro,
    mangaReaderLayout,
    mangaReaderWidth,
    settings,
  ]);

  const handleMalLogout = async () => {
    const confirmResult = await swalConfirm(
      "Are you sure?",
      "Are you sure you want to logout from MyAnimeList?",
      "Yes, logout",
    );
    if (!confirmResult.isConfirmed) return;
    try {
      const res = await fetch("/mal/logout");
      if (res.ok) {
        swalSuccess("Logged Out", "Logged out from MAL successfully!");
        fetchSettings();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearCache = async () => {
    const confirmResult = await swalConfirm(
      "Clear Image Cache?",
      "This will delete all cached cover and metadata images. They will be re-downloaded when needed.",
      "Yes, clear cache",
    );
    if (!confirmResult.isConfirmed) return;
    setClearingCache(true);
    try {
      const data = await apiPost("/api/cache/clear");
      if (data.success) {
        swalSuccess("Cache Cleared", "Image cache cleared successfully!");
        fetchCacheStats();
      } else {
        swalError("Error", data.error || "Failed to clear cache.");
      }
    } catch (err) {
      console.error(err);
      swalError("Error", err.message || "An error occurred.");
    } finally {
      setClearingCache(false);
    }
  };

  const handleCheckForUpdates = async () => {
    Swal.fire({
      title: "Checking for updates...",
      html: `
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 10px;">
          Please wait while we check the registry.
        </p>
        <div class="custom-swal-spinner"></div>
      `,
      allowOutsideClick: false,
      showConfirmButton: false,
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
    });

    try {
      const updateListener = window.sharedStateAPI.on(
        "update-available",
        (info) => {
          const targetVersion = info?.version || "New Version";
          Swal.fire({
            title: "Update Available!",
            text: `A new version (v${targetVersion}) is available. Would you like to download it?`,
            icon: "info",
            showCancelButton: true,
            confirmButtonText: "Download & Install",
            cancelButtonText: "Later",
            confirmButtonColor: "var(--accent)",
            cancelButtonColor: "var(--bg-tertiary)",
            background: "var(--bg-secondary)",
            color: "var(--text-main)",
          }).then(async (result) => {
            if (result.isConfirmed) {
              Swal.fire({
                title: "Downloading Update...",
                html: `
                <div style="margin: 15px 0;">
                  <div style="background: var(--bg-tertiary); border-radius: 4px; height: 10px; overflow: hidden; width: 100%;">
                    <div id="update-progress-bar" style="background: var(--accent); height: 100%; width: 0%; transition: width 0.2s ease;"></div>
                  </div>
                  <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 13px; color: var(--text-muted);">
                    <span id="update-progress-percent">0%</span>
                    <span id="update-progress-speed">0 MB/s</span>
                  </div>
                </div>
              `,
                allowOutsideClick: false,
                showConfirmButton: false,
                background: "var(--bg-secondary)",
                color: "var(--text-main)",
              });

              const progressListener = window.sharedStateAPI.on(
                "update-download-progress",
                (progress) => {
                  const bar = document.getElementById("update-progress-bar");
                  const text = document.getElementById(
                    "update-progress-percent",
                  );
                  const speed = document.getElementById(
                    "update-progress-speed",
                  );
                  if (bar) bar.style.width = `${progress.percent}%`;
                  if (text) text.innerText = `${progress.percent}%`;
                  if (speed) {
                    const mbSpeed = (
                      progress.bytesPerSecond /
                      (1024 * 1024)
                    ).toFixed(2);
                    speed.innerText = `${mbSpeed} MB/s`;
                  }
                },
              );

              const downloadedListener = window.sharedStateAPI.on(
                "update-downloaded",
                () => {
                  progressListener();
                  downloadedListener();
                  errorListener();

                  Swal.fire({
                    title: "Update Ready!",
                    text: "A new version has been downloaded. Would you like to restart the application now to apply the update?",
                    icon: "success",
                    showCancelButton: true,
                    confirmButtonText: "Restart Now",
                    cancelButtonText: "Later",
                    confirmButtonColor: "var(--accent)",
                    cancelButtonColor: "var(--bg-tertiary)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-main)",
                  }).then((restartResult) => {
                    if (restartResult.isConfirmed) {
                      window.sharedStateAPI.installUpdate();
                    }
                  });
                },
              );

              const errorListener = window.sharedStateAPI.on(
                "update-error",
                (err) => {
                  progressListener();
                  downloadedListener();
                  errorListener();
                  Swal.fire({
                    title: "Download Failed",
                    text: err.message || "Failed to download the update.",
                    icon: "error",
                    confirmButtonColor: "var(--accent)",
                    background: "var(--bg-secondary)",
                    color: "var(--text-main)",
                  });
                },
              );

              const res = await window.sharedStateAPI.downloadUpdate();
              if (!res.success) {
                progressListener();
                downloadedListener();
                errorListener();
                Swal.fire({
                  title: "Download Failed",
                  text: res.error || "Could not trigger update download.",
                  icon: "error",
                  confirmButtonColor: "var(--accent)",
                  background: "var(--bg-secondary)",
                  color: "var(--text-main)",
                });
              }
            }
          });
          updateListener();
          noUpdateListener();
          errorListener();
        },
      );

      const noUpdateListener = window.sharedStateAPI.on(
        "update-not-available",
        () => {
          Swal.fire({
            title: "Up to Date",
            text: "You are already using the latest version of StrawVerse.",
            icon: "success",
            confirmButtonColor: "var(--accent)",
            background: "var(--bg-secondary)",
            color: "var(--text-main)",
          });
          updateListener();
          noUpdateListener();
          errorListener();
        },
      );

      const errorListener = window.sharedStateAPI.on("update-error", (err) => {
        Swal.fire({
          title: "Update Error",
          text: err.message || "Failed to check for updates.",
          icon: "error",
          confirmButtonColor: "var(--accent)",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
        });
        updateListener();
        noUpdateListener();
        errorListener();
      });

      const res = await window.sharedStateAPI.checkForUpdate();
      if (!res.success) {
        updateListener();
        noUpdateListener();
        errorListener();
        Swal.fire({
          title: "Check Failed",
          text: res.error || "Failed to check for updates.",
          icon: "error",
          confirmButtonColor: "var(--accent)",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
        });
      }
    } catch (e) {
      Swal.fire({
        title: "Error",
        text: e.message || "An unexpected error occurred.",
        icon: "error",
        confirmButtonColor: "var(--accent)",
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
      });
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
      <div className="settings-container-inner">
        <header className="settings-header">
          <h1 className="settings-title">App Settings</h1>
          <div className="u-style-66">
            {saving ? (
              <>
                <Loader2 size={14} className="spin" />
                <span>Saving changes...</span>
              </>
            ) : hasChanges ? (
              <span>Unsaved changes...</span>
            ) : (
              <>
                <span className="u-style-67">✓</span>
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
          <button
            type="button"
            onClick={() => setActiveTab("about")}
            className={`settings-tab-btn ${activeTab === "about" ? "active" : ""}`}
          >
            About & Disclaimer
          </button>
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="settings-form">
          {activeTab === "general" && (
            <div className="settings-column">
              {/* General Settings */}
              <div className="settings-section glass-panel">
                <h2 className="settings-section-title">General Settings</h2>
                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">Download Location</div>
                    <div className="settings-row-hint">
                      Directory path where your downloaded media files will be
                      saved.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <input
                      type="text"
                      value={downloadLocation}
                      onChange={(e) => setDownloadLocation(e.target.value)}
                      className="settings-text-input"
                      placeholder="Downloads directory path"
                    />
                  </div>
                </div>{" "}
                <SettingsRow
                  label="Developer Mode"
                  desc="Enable advanced logs viewer tab and debug utilities."
                >
                  <Dropdown
                    value={String(developerMode)}
                    onChange={(val) => setDeveloperMode(val === "true")}
                    options={[
                      { value: "true", label: "Enabled" },
                      { value: "false", label: "Disabled" },
                    ]}
                    minWidth={200}
                  />
                </SettingsRow>
                <SettingsRow
                  label="Pagination Controls"
                  desc="Toggle between numbered pages or infinite scroll loading."
                >
                  <Dropdown
                    value={String(pagination)}
                    onChange={(val) => setPagination(val === "true")}
                    options={[
                      { value: "true", label: "Enabled (Page Buttons)" },
                      { value: "false", label: "Disabled (Infinite Scroll)" },
                    ]}
                    minWidth={200}
                  />
                </SettingsRow>
              </div>

              {/* Watch Together Settings */}
              <div className="settings-section glass-panel">
                <h2 className="settings-section-title">
                  Watch Together Settings
                </h2>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">Server URL</div>
                    <div className="settings-row-hint">
                      The server address used to host and join Watch Together
                      rooms with friends.
                    </div>
                  </div>
                  <div className="settings-row-control u-style-68">
                    <input
                      type="text"
                      className="settings-text-input"
                      placeholder="strawverse-wt.theyogmehta.online"
                      value={wtServerUrl}
                      onChange={(e) => {
                        setWtServerUrl(e.target.value);
                        watchTogetherClient.setServerUrl(e.target.value);
                      }}
                    />
                    <div className="u-style-69">
                      <button
                        type="button"
                        onClick={handleVerifyWtServer}
                        disabled={verifyingWt}
                        className="settings-market-btn u-style-70"
                      >
                        {verifyingWt ? "Verifying..." : "Verify Connection"}
                      </button>
                      <button
                        type="button"
                        onClick={handleResetWtServer}
                        className="settings-logout-btn u-style-71"
                      >
                        Reset to Default
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Storage & Cache */}
              <div className="settings-section glass-panel">
                <h2 className="settings-section-title">Storage & Cache</h2>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">
                      Image Cache Size Limit
                    </div>
                    <div className="settings-row-hint">
                      Maximum storage space allowed for external poster images.
                      (Minimum 5 GB)
                    </div>
                  </div>
                  <div className="settings-row-control u-style-72">
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
                      className="settings-text-input settings-number-input u-style-73"
                    />
                    <span className="u-style-74">GB</span>
                  </div>
                </div>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">
                      Current Cache Usage
                    </div>
                    <div className="settings-row-hint">
                      {cacheStats
                        ? `${(cacheStats.sizeInBytes / (1024 * 1024)).toFixed(1)} MB (${cacheStats.filesCount} files)`
                        : "Calculating..."}
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <button
                      type="button"
                      onClick={handleClearCache}
                      disabled={clearingCache}
                      className="settings-logout-btn u-style-75"
                    >
                      {clearingCache ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                      <span>Clear Image Cache</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Community & Support */}
              <div className="settings-section glass-panel">
                <h2 className="settings-section-title">Community & Support</h2>
                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">
                      Discord Community Server
                    </div>
                    <div className="settings-row-hint">
                      Join our Discord server to get help, request features, and
                      stay up to date.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <a
                      href="https://discord.gg/PzfUBgQ2gt"
                      target="_blank"
                      rel="noreferrer"
                      className="settings-connect-link u-style-76"
                    >
                      <MessageSquare size={16} />
                      <span>Join Discord</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "anime_manga" && (
            <div className="settings-column">
              {/* Anime Settings */}
              <div className="settings-section glass-panel">
                <h2 className="settings-section-title">Anime Settings</h2>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">
                      Active Anime Provider
                    </div>
                    <div className="settings-row-hint">
                      Default scrapers used to search and stream anime episodes.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <Dropdown
                      value={animeProvider || ""}
                      onChange={setAnimeProvider}
                      options={[
                        { value: "", label: "None selected" },
                        ...(settings?.providers?.Anime || []).map((name) => ({
                          value: name,
                          label: name,
                          icon: getProviderIcon(name, "Anime"),
                        })),
                      ]}
                      minWidth={200}
                    />
                  </div>
                </div>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">Preferred Quality</div>
                    <div className="settings-row-hint">
                      Streaming and downloading resolution defaults.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <Dropdown
                      value={quality}
                      onChange={setQuality}
                      options={[
                        { value: "1080p", label: "1080p (Full HD)" },
                        { value: "720p", label: "720p (HD)" },
                        { value: "360p", label: "360p (SD)" },
                      ]}
                      minWidth={200}
                    />
                  </div>
                </div>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">
                      Auto-Skip Intro & Outro
                    </div>
                    <div className="settings-row-hint">
                      Automatically skip intro and outro segments during
                      playback when detected.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <Dropdown
                      value={String(autoSkipIntro)}
                      onChange={(val) => setAutoSkipIntro(val === "true")}
                      options={[
                        { value: "true", label: "Yes" },
                        { value: "false", label: "No" },
                      ]}
                      minWidth={200}
                    />
                  </div>
                </div>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">
                      Merge Soft Subtitles
                    </div>
                    <div className="settings-row-hint">
                      Automatically merge downloaded subtitles into the video
                      file container using FFmpeg.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <Dropdown
                      value={String(mergeSubtitles)}
                      onChange={(val) => setMergeSubtitles(val === "true")}
                      options={[
                        {
                          value: "true",
                          label: "Yes (Merge subtitles inside MP4)",
                        },
                        {
                          value: "false",
                          label: "No (Download subtitles in subfolder)",
                        },
                      ]}
                      minWidth={200}
                    />
                  </div>
                </div>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">Subtitle Format</div>
                    <div className="settings-row-hint">
                      Subtitle file format used for download and merge
                      operations.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <Dropdown
                      value={subtitleFormat}
                      onChange={setSubtitleFormat}
                      options={[
                        { value: "srt", label: "SubRip (.srt)" },
                        { value: "vtt", label: "WebVTT (.vtt)" },
                      ]}
                      minWidth={200}
                    />
                  </div>
                </div>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">Manage Extensions</div>
                    <div className="settings-row-hint">
                      Install, update, or configure anime scraper providers.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <button
                      type="button"
                      onClick={() => onMarketplaceOpen("Anime")}
                      className="settings-market-btn u-style-11"
                    >
                      Open Anime Extensions
                    </button>
                  </div>
                </div>
              </div>

              {/* Manga Settings */}
              <div className="settings-section glass-panel">
                <h2 className="settings-section-title">Manga Settings</h2>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">
                      Active Manga Provider
                    </div>
                    <div className="settings-row-hint">
                      Default scrapers used to search and read manga chapters.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <Dropdown
                      value={mangaProvider || ""}
                      onChange={setMangaProvider}
                      options={(settings?.providers?.Manga || []).map(
                        (name) => ({
                          value: name,
                          label: name,
                          icon: getProviderIcon(name, "Manga"),
                        }),
                      )}
                      minWidth={200}
                    />
                  </div>
                </div>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">
                      Manga Reader Layout
                    </div>
                    <div className="settings-row-hint">
                      Choose how pages are laid out inside the manga reader.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <Dropdown
                      value={mangaReaderLayout}
                      onChange={setMangaReaderLayout}
                      options={[
                        {
                          value: "long-strip",
                          label: "Long Strip (Vertical Scroll)",
                        },
                        { value: "single", label: "Single Page" },
                        { value: "double", label: "Double Page" },
                      ]}
                      minWidth={200}
                    />
                  </div>
                </div>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">
                      Manga Reader Width ({mangaReaderWidth}px)
                    </div>
                    <div className="settings-row-hint">
                      Adjust the maximum page display width inside the manga
                      reader.
                    </div>
                  </div>
                  <div className="settings-row-control u-style-27">
                    <input
                      type="range"
                      min="400"
                      max="1600"
                      step="20"
                      value={mangaReaderWidth}
                      onChange={(e) =>
                        setMangaReaderWidth(parseInt(e.target.value, 10))
                      }
                      className="settings-range-slider u-style-77"
                    />
                  </div>
                </div>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">
                      Auto Load Next Chapter
                    </div>
                    <div className="settings-row-hint">
                      Automatically fetch and display the next chapter when
                      scrolling to the end.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <Dropdown
                      value={String(autoLoadNextChapter)}
                      onChange={(val) => setAutoLoadNextChapter(val === "true")}
                      options={[
                        { value: "true", label: "Enabled" },
                        { value: "false", label: "Disabled" },
                      ]}
                      minWidth={200}
                    />
                  </div>
                </div>

                <div className="settings-row-item">
                  <div className="settings-row-info">
                    <div className="settings-row-label">Manage Extensions</div>
                    <div className="settings-row-hint">
                      Install, update, or configure manga scraper providers.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <button
                      type="button"
                      onClick={() => onMarketplaceOpen("Manga")}
                      className="settings-market-btn u-style-11"
                    >
                      Open Manga Extensions
                    </button>
                  </div>
                </div>
              </div>

              {/* MyAnimeList Connection */}
              <div className="settings-section glass-panel">
                <h2 className="settings-section-title">
                  MyAnimeList Integration
                </h2>

                {malLoggedIn ? (
                  <>
                    <div className="settings-row-item">
                      <div className="settings-row-info">
                        <div className="settings-row-label">
                          Connection Status
                        </div>
                        <div className="settings-row-hint">
                          Syncs watch/read status automatically to your MAL
                          profile.
                        </div>
                      </div>
                      <div className="settings-row-control">
                        <div className="u-style-78">
                          <CheckCircle size={18} />
                          <span>Connected</span>
                        </div>
                      </div>
                    </div>

                    <div className="settings-row-item">
                      <div className="settings-row-info">
                        <div className="settings-row-label">
                          Auto-update Status
                        </div>
                        <div className="settings-row-hint">
                          Default status applied to media when starting or
                          completing.
                        </div>
                      </div>
                      <div className="settings-row-control">
                        <Dropdown
                          value={malStatus}
                          onChange={setMalStatus}
                          options={[
                            { value: "plan_to_watch", label: "Plan To Watch" },
                            { value: "watching", label: "Watching" },
                            { value: "completed", label: "Completed" },
                            { value: "on_hold", label: "On Hold" },
                            { value: "dropped", label: "Dropped" },
                          ]}
                          minWidth={200}
                        />
                      </div>
                    </div>
                    <div className="settings-row-item">
                      <div className="settings-row-info">
                        <div className="settings-row-label">
                          Account Options
                        </div>
                        <div className="settings-row-hint">
                          Disconnect and remove MyAnimeList credentials from
                          StrawVerse.
                        </div>
                      </div>
                      <div className="settings-row-control">
                        <button
                          type="button"
                          onClick={handleMalLogout}
                          className="settings-logout-btn u-style-11"
                        >
                          <LogOut size={16} />
                          <span>Disconnect Account</span>
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="settings-row-item">
                    <div className="settings-row-info">
                      <div className="settings-row-label">
                        MyAnimeList Progress Sync
                      </div>
                      <div className="settings-row-hint">
                        Connect your account to synchronize your watch and read
                        progress automatically.
                      </div>
                    </div>
                    <div className="settings-row-control">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="settings-connect-link u-style-81"
                        >
                          <LinkIcon size={16} />
                          <span>Authenticate Account</span>
                        </a>
                      ) : (
                        <span className="u-style-82">OAuth URL Error</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {activeTab === "history" && (
            <div className="u-style-83">
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
                        {stats?.completedEpisodes || 0} episodes watched (
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
                    <div className="u-style-84">
                      <div className="u-style-85">
                        <h2 className="settings-panel-title u-style-86">
                          Recent Activity History
                        </h2>

                        {/* Segmented Toggle Control */}
                        <div className="segmented-toggle-wrapper">
                          {["All", "Anime", "Manga"].map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setHistoryFilter(t)}
                              className={`segmented-toggle-btn ${historyFilter === t ? "active" : ""}`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>

                      {historyList.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearHistory}
                          className="settings-clear-history-btn u-style-88"
                        >
                          Clear History
                        </button>
                      )}
                    </div>
                    {(() => {
                      const filteredHistory = historyList.filter((item) => {
                        if (historyFilter === "All") return true;
                        return item.type === historyFilter;
                      });

                      if (filteredHistory.length === 0) {
                        return (
                          <p className="u-style-89">
                            {historyFilter === "All"
                              ? "No history records found yet. Go watch some anime or read some manga!"
                              : `No ${historyFilter.toLowerCase()} history records found.`}
                          </p>
                        );
                      }

                      return (
                        <div className="settings-history-list-container">
                          {filteredHistory.map((item, idx) => {
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
                                      item.provider || "local",
                                      "Back to Settings",
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
                                  <div className="u-style-90">
                                    <div className="u-style-91">
                                      <strong className="settings-history-item-title">
                                        {item.title}
                                      </strong>
                                      {item.is_completed === 1 && (
                                        <span className="settings-completed-badge u-style-92">
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
                                <div className="u-style-93">
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
                      );
                    })()}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "changelog" && (
            <div className="settings-panel glass-panel">
              {changelogLoading ? (
                <div className="settings-loading-center">
                  <Loader2 size={32} className="spin" />
                  <p>Loading release notes...</p>
                </div>
              ) : changelog ? (
                <ChangelogRenderer markdown={changelog} />
              ) : (
                <p className="u-style-29">Failed to load release notes.</p>
              )}
            </div>
          )}

          {activeTab === "about" && (
            <div className="settings-panel glass-panel">
              <h3 className="settings-section-title">
                About & Legal Disclaimer
              </h3>
              <div className="disclaimer-text u-style-94">
                <p>
                  <strong>StrawVerse</strong> is an open-source local media
                  manager and indexing application designed for developers and
                  researchers.
                </p>
                <p>
                  <strong>Disclaimer:</strong> The developers of this
                  application do not host, store, stream, or distribute any
                  copyrighted video, audio, or image files. The application
                  functions solely as a client-side parser and downloader
                  wrapper utilizing publicly available web resource links. We do
                  not condone, promote, or encourage copyright infringement of
                  any kind.
                </p>
                <p>
                  By using this software, you agree that you are solely
                  responsible for ensuring that your access, downloading, and
                  usage of any media files complies with all applicable local,
                  national, and international copyright laws, copyrights, and
                  terms of service. The developers assume no liability for
                  misuse, copyright violations, or data download charges.
                </p>
              </div>

              <div className="settings-update-card">
                <span style={{ color: "var(--text-muted)", fontSize: "14px" }}>
                  Version: <strong>v{appVersion || "8.0.2"}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleCheckForUpdates}
                  className="update-btn-premium"
                >
                  <RefreshCw size={13} />
                  Check for Updates
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
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
          const content = line.replace("# ", "").trim();
          if (content.startsWith("[") && content.includes("]")) {
            return (
              <h1 key={idx} className="changelog-h1">
                {content}
              </h1>
            );
          }
          return null;
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
          return <div key={idx} className="u-style-95" />;
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
    const isShortcut =
      /^[a-zA-Z0-9\s+/→←↑↓`&,|-]+$/.test(keysPart) &&
      keysPart.length < 45 &&
      !keysPart.includes("  ") &&
      !/^(http|https|fix|add|implement|split|update|remove|rebranded|re-added|select|choose|join|join\s+our)/i.test(
        keysPart,
      );

    if (isShortcut) {
      const tokens = keysPart.split(/(\s*\/\s*|\s+or\s+|\s*\+\s*|\s*,\s*)/g);
      const renderedKeys = tokens.map((token, index) => {
        const isSeparator = /^\s*(\/|or|\+|,)\s*$/.test(token);
        if (isSeparator) {
          return (
            <span key={index} className="kbd-separator">
              {token}
            </span>
          );
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
