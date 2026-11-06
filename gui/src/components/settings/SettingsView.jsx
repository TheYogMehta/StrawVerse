/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useState, useEffect, useRef } from "react";
import {
  Loader2,
  LogOut,
  CheckCircle,
  Trash2,
  Link as LinkIcon,
  RefreshCw,
  Tag,
  GripVertical,
  Plus,
  Eye,
  EyeOff,
  Check,
  FolderOpen,
  RotateCcw,
} from "lucide-react";
import { swalSuccess, swalError, swalConfirm } from "../../utils/swal";
import { isMobileApp } from "../../utils/nativeBridge";
import {
  apiPost,
  applyThemeVars,
  isReservedTag,
  MAL_STATUSES,
  getMalStatusLabel,
} from "../../utils/common";
import SettingsRow from "./SettingsRow";
import Dropdown from "../common/Dropdown";
import "../css/SettingsView.css";

const DiscordIcon = ({ size = 16, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    style={{ display: "inline-block", verticalAlign: "middle" }}
  >
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const ALL_SUBTITLE_LANGUAGES = [
  "English",
  "Japanese",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Russian",
  "Portuguese",
  "Indonesian",
  "Thai",
  "Vietnamese",
  "Chinese",
  "Arabic",
  "Hindi",
];

const SETTINGS_TABS = [
  "general",
  "anime_manga",
  "tags",
  "history",
  "changelog",
  "about",
];

const PREVIEW_SAMPLE_CARDS = [
  {
    id: 1,
    title:
      "Backstabbed in a Backwater Dungeon: My Trusted Companions Tried to Kill Me, but Thanks to the Gift of an Unlimited Gacha I Got LVL 9999 Friends and Am Out for Revenge on My Former Party Members and the World",
  },
  { id: 2, title: "One Peice" },
  { id: 3, title: "Frieren: Beyond Journey's End" },
  { id: 4, title: "fullmetal alchemist: brotherhood" },
  { id: 5, title: "Demon Slayer: Kimetsu no Yaiba Hashira Training Arc" },
  { id: 6, title: "KochiKame: Tokyo Beat Cops" },
];

const PRESET_THEMES = [
  {
    id: "default",
    name: "Midnight Obsidian",
    primary: "#8b5cf6",
    secondary: "#3b82f6",
    sidebarActive: "#ec4899",
    text: "#f3f4f6",
    bg: "#0f0d19",
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk Neon",
    primary: "#06b6d4",
    secondary: "#f43f5e",
    sidebarActive: "#eab308",
    text: "#e2f8ff",
    bg: "#070b19",
  },
  {
    id: "emerald",
    name: "Emerald Forest",
    primary: "#10b981",
    secondary: "#34d399",
    sidebarActive: "#fbbf24",
    text: "#e6f9f3",
    bg: "#051a14",
  },
  {
    id: "sunset",
    name: "Sunset Romance",
    primary: "#ff6b6b",
    secondary: "#ffa502",
    sidebarActive: "#ff4757",
    text: "#ffeef2",
    bg: "#1e0a1c",
  },
  {
    id: "crimson",
    name: "Crimson Blood",
    primary: "#e11d48",
    secondary: "#9333ea",
    sidebarActive: "#f43f5e",
    text: "#ffe8eb",
    bg: "#180509",
  },
];

export default function SettingsView({
  initialTab = "general",
  scrollToSection = null,
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
  const [animeProvider, setAnimeProvider] = useState("");
  const [quality, setQuality] = useState("1080p");
  const [mangaProvider, setMangaProvider] = useState("");
  const [autoLoadNextChapter, setAutoLoadNextChapter] = useState(true);
  const [pagination, setPagination] = useState(false);
  const [malStatus, setMalStatus] = useState("watching");
  const [mergeSubtitles, setMergeSubtitles] = useState(false);
  const [subtitleFormat, setSubtitleFormat] = useState("vtt");
  const [mediaServerNaming, setMediaServerNaming] = useState(false);
  const [preferredSubtitleLanguages, setPreferredSubtitleLanguages] = useState([
    "English",
  ]);
  const [imageCacheSizeLimit, setImageCacheSizeLimit] = useState(5);
  const [developerMode, setDeveloperMode] = useState(false);
  const [downloadNotification, setDownloadNotification] = useState(true);
  const [downloadLocation, setDownloadLocation] = useState("");
  const [browsingFolder, setBrowsingFolder] = useState(false);
  const [animeNamingScheme, setAnimeNamingScheme] = useState("default");
  const [mangaNamingScheme, setMangaNamingScheme] = useState("default");
  const [jellyfinCompatibility, setJellyfinCompatibility] = useState(false);
  const [externalLogEnabled, setExternalLogEnabled] = useState(true);
  const [maxLogFiles, setMaxLogFiles] = useState(5);
  const [logDirectory, setLogDirectory] = useState("");
  const [autoSkipIntro, setAutoSkipIntro] = useState(true);
  const [subFontSize, setSubFontSize] = useState(46);
  const [subColor, setSubColor] = useState("#FFFFFF");
  const [subBorderColor, setSubBorderColor] = useState("#000000");
  const [subBorderSize, setSubBorderSize] = useState(3.0);
  const [subBgColor, setSubBgColor] = useState("transparent");
  const [playerSpeed, setPlayerSpeed] = useState(1.0);
  const [mangaReaderLayout, setMangaReaderLayout] = useState("long-strip");
  const [mangaReaderWidth, setMangaReaderWidth] = useState(800);
  const [catalogTitleFontSize, setCatalogTitleFontSize] = useState(14);
  const [catalogTitleLines, setCatalogTitleLines] = useState(2);
  const [catalogColumns, setCatalogColumns] = useState("auto");
  const [catalogCardMaxHeight, setCatalogCardMaxHeight] = useState("auto");
  const [themePreset, setThemePreset] = useState("default");
  const [themeAccentColor, setThemeAccentColor] = useState("#8b5cf6");
  const [themeSecondaryColor, setThemeSecondaryColor] = useState("#3b82f6");
  const [themeSidebarColor, setThemeSidebarColor] = useState("#ec4899");
  const [themeTextColor, setThemeTextColor] = useState("#f3f4f6");
  const [themeBgColor, setThemeBgColor] = useState("#0f0d19");

  const [cacheStats, setCacheStats] = useState(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [updateStatus, setUpdateStatus] = useState("idle");
  const [updateProgress, setUpdateProgress] = useState(null);
  const [updateErrorMsg, setUpdateErrorMsg] = useState("");

  const handleSelectThemePreset = (theme) => {
    setThemePreset(theme.id);
    setThemeAccentColor(theme.primary);
    setThemeSecondaryColor(theme.secondary);
    setThemeSidebarColor(theme.sidebarActive);
    setThemeTextColor(theme.text);
    setThemeBgColor(theme.bg);
    applyThemeVars({
      themeAccentColor: theme.primary,
      themeSecondaryColor: theme.secondary,
      themeSidebarColor: theme.sidebarActive,
      themeTextColor: theme.text,
      themeBgColor: theme.bg,
    });
  };

  const handleRestoreSubtitleDefaults = () => {
    setPlayerSpeed(1.0);
    setSubFontSize(46);
    setSubColor("#FFFFFF");
    setSubBorderColor("#000000");
    setSubBorderSize(3.0);
    setSubBgColor("transparent");
  };

  const handleColorChange = (key, value) => {
    setThemePreset("custom");
    if (key === "primary") {
      setThemeAccentColor(value);
      applyThemeVars({ themeAccentColor: value });
    } else if (key === "secondary") {
      setThemeSecondaryColor(value);
      applyThemeVars({ themeSecondaryColor: value });
    } else if (key === "sidebar") {
      setThemeSidebarColor(value);
      applyThemeVars({ themeSidebarColor: value });
    } else if (key === "text") {
      setThemeTextColor(value);
      applyThemeVars({ themeTextColor: value });
    } else if (key === "bg") {
      setThemeBgColor(value);
      applyThemeVars({ themeBgColor: value });
    }
  };

  const handleCatalogTitleFontSizeChange = (val) => {
    const size = parseInt(val, 10) || 14;
    setCatalogTitleFontSize(size);
    applyThemeVars({ catalogTitleFontSize: size });
  };

  const handleCatalogTitleLinesChange = (val) => {
    const lines = parseInt(val, 10) || 2;
    setCatalogTitleLines(lines);
    applyThemeVars({ catalogTitleLines: lines });
  };

  const handleCatalogColumnsChange = (val) => {
    setCatalogColumns(val);
    applyThemeVars({ catalogColumns: val });
  };

  const handleCatalogCardMaxHeightChange = (val) => {
    setCatalogCardMaxHeight(val);
    applyThemeVars({ catalogCardMaxHeight: val });
  };

  const handleBrowseDownloadLocation = async () => {
    if (!window.sharedStateAPI?.selectDirectory) {
      swalError(
        "Not Supported",
        "Folder picker is not available on this platform.",
      );
      return;
    }
    setBrowsingFolder(true);
    try {
      const result =
        await window.sharedStateAPI.selectDirectory(downloadLocation);
      if (result?.success && result.path) {
        setDownloadLocation(result.path);
      } else if (result && !result.canceled && result.error) {
        swalError("Could Not Pick Folder", result.error);
      }
    } catch (err) {
      console.error("Failed to pick download folder:", err);
      swalError("Could Not Pick Folder", err.message);
    } finally {
      setBrowsingFolder(false);
    }
  };

  const handleResetDownloadLocation = () => {
    setDownloadLocation("");
  };

  useEffect(() => {
    if (!window.sharedStateAPI || !window.sharedStateAPI.on) return;

    const u1 = window.sharedStateAPI.on("update-available", (data) => {
      setUpdateStatus("downloading");
      setUpdateProgress({ version: data?.version, percent: 0 });
      window.sharedStateAPI.downloadUpdate?.().catch(() => {});
    });

    const u2 = window.sharedStateAPI.on("update-download-progress", (prog) => {
      setUpdateStatus(prog.percent >= 100 ? "ready" : "downloading");
      setUpdateProgress(prog);
    });

    const u3 = window.sharedStateAPI.on("update-downloaded", (data) => {
      setUpdateStatus("ready");
      setUpdateProgress((prev) => ({
        ...(prev || {}),
        percent: 100,
        version: data?.version,
      }));
    });

    const u4 = window.sharedStateAPI.on("update-not-available", () => {
      setUpdateStatus("up-to-date");
    });

    const u5 = window.sharedStateAPI.on("update-error", (err) => {
      setUpdateStatus("error");
      setUpdateErrorMsg(err?.message || "Update error");
    });

    return () => {
      if (u1) u1();
      if (u2) u2();
      if (u3) u3();
      if (u4) u4();
      if (u5) u5();
    };
  }, []);
  const getProviderIcon = (name, type) => {
    if (!name || !settings?.installedExtensions) return null;
    const list =
      type === "Anime"
        ? settings.installedExtensions.Anime
        : settings.installedExtensions.Manga;
    const cleanName = String(name || "")
      .toLowerCase()
      .replace(/^@/, "");
    const ext = list?.find((e) => {
      const eName = String(e.name || "").toLowerCase();
      const eUnique = String(e.uniqueId || "")
        .toLowerCase()
        .replace(/^@/, "");
      return (
        eName === cleanName ||
        eUnique === cleanName ||
        cleanName.endsWith(`/${eName}`) ||
        cleanName === `${(e.repoOwner || "").toLowerCase()}/${eName}`
      );
    });
    return ext?.icon || null;
  };

  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (scrollToSection) {
      const timer = setTimeout(() => {
        const el = document.getElementById(scrollToSection);
        if (el) {
          el.scrollIntoView({ behavior: "auto", block: "start" });
        }
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [scrollToSection, activeTab]);

  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });

  const handleTouchStart = (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    if (e.target.closest("input, textarea, select")) return;

    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    };
  };

  const handleTouchEnd = (e) => {
    if (!e.changedTouches || e.changedTouches.length !== 1) return;
    if (!touchStartRef.current.time) return;

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartRef.current.x;
    const deltaY = touchEndY - touchStartRef.current.y;
    const duration = Date.now() - touchStartRef.current.time;

    touchStartRef.current = { x: 0, y: 0, time: 0 };

    const minSwipeDistance = 50;
    const maxSwipeDuration = 800;

    if (
      duration <= maxSwipeDuration &&
      Math.abs(deltaX) >= minSwipeDistance &&
      Math.abs(deltaX) > Math.abs(deltaY) * 1.2
    ) {
      const currentIndex = SETTINGS_TABS.indexOf(activeTab);
      if (currentIndex === -1) return;

      if (deltaX > 0) {
        // Left to right swipe = prev settings if it exists
        if (currentIndex > 0) {
          setActiveTab(SETTINGS_TABS[currentIndex - 1]);
        }
      } else {
        // Right to left swipe = next settings if it exists
        if (currentIndex < SETTINGS_TABS.length - 1) {
          setActiveTab(SETTINGS_TABS[currentIndex + 1]);
        }
      }
    }
  };

  const handleTouchCancel = () => {
    touchStartRef.current = { x: 0, y: 0, time: 0 };
  };

  const [stats, setStats] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [historyFilter, setHistoryFilter] = useState("All");
  const [statsLoading, setStatsLoading] = useState(false);

  const [changelog, setChangelog] = useState(
    typeof __APP_CHANGELOG__ !== "undefined" && __APP_CHANGELOG__
      ? __APP_CHANGELOG__
      : "",
  );
  const [changelogLoading, setChangelogLoading] = useState(false);

  useEffect(() => {
    if (activeTab === "history") {
      const loadHistoryData = async () => {
        setStatsLoading(true);
        try {
          const statsRes = await fetch("/api/history/stats");
          const statsData = await statsRes.json();
          setStats(statsData);

          const listRes = await fetch(
            "/api/history/list?include_hidden=true&limit=100",
          );
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
    if (activeTab === "changelog") {
      const fetchChangelogData = async () => {
        if (!changelog) setChangelogLoading(true);
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
  }, [activeTab]);

  const fetchCacheStats = async () => {
    try {
      const response = await fetch("/api/cache/stats");
      const data = await response.json();
      setCacheStats(data);
    } catch (err) {
      console.error("Failed to fetch cache stats:", err);
    }
  };

  // Tag Management State & Handlers
  const [tagType, setTagType] = useState("Anime");
  const [tagsList, setTagsList] = useState([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);
  const [draggedTagIndex, setDraggedTagIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const fetchTags = async (type = tagType) => {
    setTagsLoading(true);
    try {
      const res = await fetch(
        `/api/local/tags/view/${type}?includeHidden=true`,
      );
      const data = await res.json();
      if (data && Array.isArray(data.tags)) {
        setTagsList(data.tags);
      } else if (Array.isArray(data)) {
        setTagsList(data.map((t) => ({ name: t, hidden: false })));
      }
    } catch (err) {
      console.error("Failed to fetch tags:", err);
    } finally {
      setTagsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "tags") {
      fetchTags(tagType);
    }
  }, [activeTab, tagType]);

  const handleToggleVisibility = async (tagName, currentHidden) => {
    const nextHidden = !currentHidden;
    try {
      const data = await apiPost("/api/local/tags/toggle-visibility", {
        type: tagType,
        tag: tagName,
        hidden: nextHidden,
      });
      if (data.error) {
        swalError("Error", data.error);
      } else {
        setTagsList((prev) =>
          prev.map((t) => {
            const name = typeof t === "string" ? t : t.name;
            return name === tagName ? { name: tagName, hidden: nextHidden } : t;
          }),
        );
      }
    } catch (err) {
      swalError("Error", err.message || "Failed to update tag visibility");
    }
  };

  const handleCreateTag = async () => {
    if (!newTagInput || !newTagInput.trim()) return;
    const trimmed = newTagInput.trim();
    if (isReservedTag(trimmed, tagType)) {
      swalError(
        "Reserved System Tag",
        `"${trimmed}" is a reserved system tag for ${tagType}.`,
      );
      return;
    }
    if (
      tagsList.some(
        (t) =>
          (typeof t === "string" ? t : t.name).trim().toLowerCase() ===
          trimmed.toLowerCase(),
      )
    ) {
      swalError(
        "Duplicate Tag Name",
        `A tag named "${trimmed}" already exists. Tag names must be unique.`,
      );
      return;
    }

    setCreatingTag(true);
    try {
      const data = await apiPost("/api/local/tags/create", {
        type: tagType,
        tag: trimmed,
      });
      if (data.error) {
        swalError("Error", data.error);
      } else {
        swalSuccess("Tag Created", `Tag "${trimmed}" created successfully!`);
        setNewTagInput("");
        fetchTags(tagType);
      }
    } catch (err) {
      swalError("Error", err.message || "Failed to create tag");
    } finally {
      setCreatingTag(false);
    }
  };

  const handleDeleteTag = async (tagToDelete) => {
    const tagName =
      typeof tagToDelete === "string" ? tagToDelete : tagToDelete.name;
    if (isReservedTag(tagName, tagType)) {
      swalError(
        "Cannot Delete Tag",
        `"${tagName}" is a system tag for ${tagType} and cannot be deleted.`,
      );
      return;
    }

    const confirmResult = await swalConfirm(
      `Delete Tag "${tagName}"?`,
      `This will remove "${tagName}" from your settings and from any library items assigned to it.`,
      "Yes, delete tag",
    );
    if (!confirmResult.isConfirmed) return;

    try {
      const data = await apiPost("/api/local/tags/delete-tag", {
        type: tagType,
        tag: tagName,
      });
      if (data.error) {
        swalError("Error", data.error);
      } else {
        swalSuccess("Tag Deleted", `Tag "${tagName}" deleted successfully.`);
        fetchTags(tagType);
      }
    } catch (err) {
      swalError("Error", err.message || "Failed to delete tag");
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedTagIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedTagIndex === null) return;
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = async (e, targetIndex) => {
    e.preventDefault();
    if (draggedTagIndex === null || draggedTagIndex === targetIndex) {
      setDraggedTagIndex(null);
      setDragOverIndex(null);
      return;
    }

    const updated = [...tagsList];
    const [movedItem] = updated.splice(draggedTagIndex, 1);
    updated.splice(targetIndex, 0, movedItem);

    setTagsList(updated);
    setDraggedTagIndex(null);
    setDragOverIndex(null);

    const tagNames = updated.map((t) => (typeof t === "string" ? t : t.name));

    try {
      const data = await apiPost("/api/local/tags/reorder", {
        type: tagType,
        tags: tagNames,
      });
      if (data.error) {
        swalError("Error", data.error);
        fetchTags(tagType);
      }
    } catch (err) {
      console.error("Failed to reorder tags:", err);
      fetchTags(tagType);
    }
  };

  const handleDragEnd = () => {
    setDraggedTagIndex(null);
    setDragOverIndex(null);
  };

  const fetchSettings = async () => {
    setLoading(true);
    try {
      if (window.sharedStateAPI && window.sharedStateAPI.getSettings) {
        const data = await window.sharedStateAPI.getSettings();
        setSettings(data.settings);
        setUrl(data.url);
        setLogDirectory(data.logDirectory || "");
        setMalLoggedIn(data.MalLoggedIn);

        // Load values into form states
        const s = data.settings;
        setAnimeProvider(s.Animeprovider || "");
        setQuality(s.quality || "1080p");
        setMangaProvider(s.Mangaprovider || "");
        setAutoLoadNextChapter(s.autoLoadNextChapter);
        setPagination(s.Pagination);
        setMalStatus(s.status || "watching");
        setMergeSubtitles(s.mergeSubtitles);
        setSubtitleFormat(s.subtitleFormat || "vtt");
        setMediaServerNaming(s.mediaServerNaming === true);
        setPreferredSubtitleLanguages(
          s.preferredSubtitleLanguages || ["English"],
        );
        setSubFontSize(
          s.subFontSize !== undefined ? parseInt(s.subFontSize, 10) : 46,
        );
        setSubColor(s.subColor || "#FFFFFF");
        setSubBorderColor(s.subBorderColor || "#000000");
        setSubBorderSize(
          s.subBorderSize !== undefined ? parseFloat(s.subBorderSize) : 3.0,
        );
        setSubBgColor(s.subBgColor || "transparent");
        setPlayerSpeed(
          s.playerSpeed !== undefined ? parseFloat(s.playerSpeed) : 1.0,
        );
        setImageCacheSizeLimit(s.imageCacheSizeLimit || 5);
        setDeveloperMode(s.developerMode);
        setDownloadNotification(
          s.downloadNotification !== undefined ? s.downloadNotification : true,
        );
        setDownloadLocation(s.CustomDownloadLocation || "");
        setAnimeNamingScheme(s.animeNamingScheme || "default");
        setMangaNamingScheme(s.mangaNamingScheme || "default");
        setJellyfinCompatibility(Boolean(s.jellyfinCompatibility));
        setExternalLogEnabled(
          s.externalLogEnabled !== undefined ? s.externalLogEnabled : true,
        );
        setMaxLogFiles(
          s.maxLogFiles !== undefined ? parseInt(s.maxLogFiles, 10) || 5 : 5,
        );
        setAutoSkipIntro(s.autoSkipIntro);
        const layoutVal = s.mangaReaderLayout || "long-strip";
        setMangaReaderLayout(layoutVal);

        const widthVal = parseInt(s.mangaReaderWidth, 10) || 800;
        setMangaReaderWidth(widthVal);

        const fontSizeVal =
          s.catalogTitleFontSize !== undefined
            ? parseInt(s.catalogTitleFontSize, 10)
            : 14;
        const linesVal =
          s.catalogTitleLines !== undefined
            ? parseInt(s.catalogTitleLines, 10)
            : 2;
        const columnsVal = s.catalogColumns || "auto";
        const cardMaxHeightVal = s.catalogCardMaxHeight || "auto";
        const presetVal = s.themePreset || "default";
        const accentVal = s.themeAccentColor || "#8b5cf6";
        const secVal = s.themeSecondaryColor || s.themeSubColor || "#3b82f6";
        const sidebarVal = s.themeSidebarColor || "#ec4899";
        const textVal = s.themeTextColor || "#f3f4f6";
        const bgVal = s.themeBgColor || "#0f0d19";

        setCatalogTitleFontSize(fontSizeVal);
        setCatalogTitleLines(linesVal);
        setCatalogColumns(columnsVal);
        setCatalogCardMaxHeight(cardMaxHeightVal);
        setThemePreset(presetVal);
        setThemeAccentColor(accentVal);
        setThemeSecondaryColor(secVal);
        setThemeSidebarColor(sidebarVal);
        setThemeTextColor(textVal);
        setThemeBgColor(bgVal);

        applyThemeVars({
          themeAccentColor: accentVal,
          themeSecondaryColor: secVal,
          themeSidebarColor: sidebarVal,
          themeTextColor: textVal,
          themeBgColor: bgVal,
          catalogTitleFontSize: fontSizeVal,
          catalogTitleLines: linesVal,
          catalogColumns: columnsVal,
          catalogCardMaxHeight: cardMaxHeightVal,
        });

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
        const data = await res.json().catch(() => null);
        if (data?.success) {
          swalSuccess("Deleted!", "Your tracking entry has been deleted.");
          // Refresh statistics and history
          const statsRes = await fetch("/api/history/stats");
          const statsData = await statsRes.json();
          setStats(statsData);

          const listRes = await fetch(
            "/api/history/list?include_hidden=true&limit=100",
          );
          const listData = await listRes.json();
          setHistoryList(listData);
        } else {
          swalError("Error", data?.error || "Failed to delete tracking entry.");
        }
      } catch (err) {
        swalError("Error", err.message || "An error occurred while deleting.");
      }
    }
  };

  const handleUnhideHistory = async (item) => {
    try {
      const res = await fetch("/api/history/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId: item.media_id,
          type: item.type,
          malId: item.mal_id,
          title: item.title,
          unhide: true,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.success) {
        swalSuccess(
          "Restored!",
          `"${item.title}" will now show on continue shelf.`,
        );
        setHistoryList((prev) =>
          prev.map((h) =>
            h.id === item.id ||
            (h.media_id === item.media_id && h.type === item.type)
              ? { ...h, hidden: 0 }
              : h,
          ),
        );
      } else {
        swalError("Error", data?.error || "Failed to restore entry.");
      }
    } catch (err) {
      swalError("Error", err.message || "Failed to restore entry.");
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
      if (data?.success) {
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
        swalError("Error", data?.error || "Failed to clear history.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const autoSaveSettings = async () => {
    const finalLimit = parseInt(imageCacheSizeLimit, 10);
    const isValidLimit = !isNaN(finalLimit) && finalLimit >= 5;

    const dirty = {};
    if (animeProvider !== (settings.Animeprovider || ""))
      dirty.Animeprovider = animeProvider;
    if (quality !== (settings.quality || "1080p")) dirty.quality = quality;
    if (mangaProvider !== (settings.Mangaprovider || ""))
      dirty.Mangaprovider = mangaProvider;
    if (autoLoadNextChapter !== settings.autoLoadNextChapter)
      dirty.autoLoadNextChapter = autoLoadNextChapter;
    if (pagination !== settings.Pagination) dirty.Pagination = pagination;
    if (malStatus !== (settings.status || "watching")) dirty.status = malStatus;
    if (mergeSubtitles !== settings.mergeSubtitles)
      dirty.mergeSubtitles = mergeSubtitles;
    if (subtitleFormat !== (settings.subtitleFormat || "vtt"))
      dirty.subtitleFormat = subtitleFormat;
    if (mediaServerNaming !== (settings.mediaServerNaming === true))
      dirty.mediaServerNaming = mediaServerNaming;
    if (
      JSON.stringify(preferredSubtitleLanguages) !==
      JSON.stringify(settings.preferredSubtitleLanguages || ["English"])
    )
      dirty.preferredSubtitleLanguages = preferredSubtitleLanguages;
    if (
      subFontSize !==
      (settings.subFontSize !== undefined
        ? parseInt(settings.subFontSize, 10)
        : 46)
    )
      dirty.subFontSize = subFontSize;
    if (subColor !== (settings.subColor || "#FFFFFF"))
      dirty.subColor = subColor;
    if (subBorderColor !== (settings.subBorderColor || "#000000"))
      dirty.subBorderColor = subBorderColor;
    if (
      subBorderSize !==
      (settings.subBorderSize !== undefined
        ? parseFloat(settings.subBorderSize)
        : 3.0)
    )
      dirty.subBorderSize = subBorderSize;
    if (subBgColor !== (settings.subBgColor || "transparent"))
      dirty.subBgColor = subBgColor;
    if (
      playerSpeed !==
      (settings.playerSpeed !== undefined
        ? parseFloat(settings.playerSpeed)
        : 1.0)
    )
      dirty.playerSpeed = playerSpeed;
    if (developerMode !== settings.developerMode)
      dirty.developerMode = developerMode;
    if (
      downloadNotification !==
      (settings.downloadNotification !== undefined
        ? settings.downloadNotification
        : true)
    )
      dirty.downloadNotification = downloadNotification;
    if (downloadLocation !== (settings.CustomDownloadLocation || ""))
      dirty.CustomDownloadLocation = downloadLocation;
    if (animeNamingScheme !== (settings.animeNamingScheme || "default"))
      dirty.animeNamingScheme = animeNamingScheme;
    if (mangaNamingScheme !== (settings.mangaNamingScheme || "default"))
      dirty.mangaNamingScheme = mangaNamingScheme;
    if (jellyfinCompatibility !== (settings.jellyfinCompatibility || false))
      dirty.jellyfinCompatibility = jellyfinCompatibility;
    if (
      externalLogEnabled !==
      (settings.externalLogEnabled !== undefined
        ? settings.externalLogEnabled
        : true)
    )
      dirty.externalLogEnabled = externalLogEnabled;
    {
      const finalCount = parseInt(maxLogFiles, 10);
      if (!isNaN(finalCount) && finalCount !== (settings.maxLogFiles || 5))
        dirty.maxLogFiles = finalCount;
    }
    if (autoSkipIntro !== settings.autoSkipIntro)
      dirty.autoSkipIntro = autoSkipIntro;
    if (mangaReaderLayout !== (settings.mangaReaderLayout || "long-strip"))
      dirty.mangaReaderLayout = mangaReaderLayout;
    if (mangaReaderWidth !== (parseInt(settings.mangaReaderWidth, 10) || 800))
      dirty.mangaReaderWidth = mangaReaderWidth;
    if (
      catalogTitleFontSize !==
      (settings.catalogTitleFontSize !== undefined
        ? parseInt(settings.catalogTitleFontSize, 10)
        : 14)
    )
      dirty.catalogTitleFontSize = catalogTitleFontSize;
    if (
      catalogTitleLines !==
      (settings.catalogTitleLines !== undefined
        ? parseInt(settings.catalogTitleLines, 10)
        : 2)
    )
      dirty.catalogTitleLines = catalogTitleLines;
    if (catalogColumns !== (settings.catalogColumns || "auto"))
      dirty.catalogColumns = catalogColumns;
    if (catalogCardMaxHeight !== (settings.catalogCardMaxHeight || "auto"))
      dirty.catalogCardMaxHeight = catalogCardMaxHeight;
    if (themePreset !== (settings.themePreset || "default"))
      dirty.themePreset = themePreset;
    if (themeAccentColor !== (settings.themeAccentColor || "#8b5cf6"))
      dirty.themeAccentColor = themeAccentColor;
    if (
      themeSecondaryColor !==
      (settings.themeSecondaryColor || settings.themeSubColor || "#3b82f6")
    )
      dirty.themeSecondaryColor = themeSecondaryColor;
    if (themeSidebarColor !== (settings.themeSidebarColor || "#ec4899"))
      dirty.themeSidebarColor = themeSidebarColor;
    if (themeTextColor !== (settings.themeTextColor || "#f3f4f6"))
      dirty.themeTextColor = themeTextColor;
    if (themeBgColor !== (settings.themeBgColor || "#0f0d19"))
      dirty.themeBgColor = themeBgColor;
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

        setSettings((prev) => ({ ...prev, ...dirty }));

        if (
          dirty.downloadNotification !== undefined &&
          window.Capacitor &&
          window.Capacitor.Plugins &&
          window.Capacitor.Plugins.CloudflareBypass &&
          window.Capacitor.Plugins.CloudflareBypass
            .setDownloadNotificationEnabled
        ) {
          window.Capacitor.Plugins.CloudflareBypass.setDownloadNotificationEnabled(
            {
              enabled: dirty.downloadNotification,
            },
          ).catch(() => {});
        }

        if (dirty.Animeprovider || dirty.Mangaprovider) {
          if (window.catalogCache) {
            delete window.catalogCache[`Anime_provider`];
            delete window.catalogCache[`Manga_provider`];
          }
        }

        if (onSettingsSaved) {
          onSettingsSaved(dirty);
        }
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
      swalError("Error Saving Settings", err.message);
    } finally {
      setSaving(false);
      setHasChanges(false);
    }
  };

  // Monitor changes and trigger debounced auto-save
  useEffect(() => {
    if (!settings) return;
    const finalLimit = parseInt(imageCacheSizeLimit, 10);
    const isValidLimit = !isNaN(finalLimit) && finalLimit >= 5;

    const changed =
      animeProvider !== (settings.Animeprovider || "") ||
      quality !== (settings.quality || "1080p") ||
      mangaProvider !== (settings.Mangaprovider || "") ||
      autoLoadNextChapter !== settings.autoLoadNextChapter ||
      pagination !== settings.Pagination ||
      malStatus !== (settings.status || "watching") ||
      mergeSubtitles !== settings.mergeSubtitles ||
      subtitleFormat !== (settings.subtitleFormat || "vtt") ||
      mediaServerNaming !== (settings.mediaServerNaming === true) ||
      JSON.stringify(preferredSubtitleLanguages) !==
        JSON.stringify(settings.preferredSubtitleLanguages || ["English"]) ||
      subFontSize !==
        (settings.subFontSize !== undefined
          ? parseInt(settings.subFontSize, 10)
          : 46) ||
      subColor !== (settings.subColor || "#FFFFFF") ||
      subBorderColor !== (settings.subBorderColor || "#000000") ||
      subBorderSize !==
        (settings.subBorderSize !== undefined
          ? parseFloat(settings.subBorderSize)
          : 3.0) ||
      subBgColor !== (settings.subBgColor || "transparent") ||
      playerSpeed !==
        (settings.playerSpeed !== undefined
          ? parseFloat(settings.playerSpeed)
          : 1.0) ||
      developerMode !== settings.developerMode ||
      downloadNotification !==
        (settings.downloadNotification !== undefined
          ? settings.downloadNotification
          : true) ||
      downloadLocation !== (settings.CustomDownloadLocation || "") ||
      animeNamingScheme !== (settings.animeNamingScheme || "default") ||
      mangaNamingScheme !== (settings.mangaNamingScheme || "default") ||
      jellyfinCompatibility !== (settings.jellyfinCompatibility || false) ||
      externalLogEnabled !==
        (settings.externalLogEnabled !== undefined
          ? settings.externalLogEnabled
          : true) ||
      (parseInt(maxLogFiles, 10) || 5) !== (settings.maxLogFiles || 5) ||
      autoSkipIntro !== settings.autoSkipIntro ||
      mangaReaderLayout !== (settings.mangaReaderLayout || "long-strip") ||
      mangaReaderWidth !== (parseInt(settings.mangaReaderWidth, 10) || 800) ||
      catalogTitleFontSize !==
        (settings.catalogTitleFontSize !== undefined
          ? parseInt(settings.catalogTitleFontSize, 10)
          : 14) ||
      catalogTitleLines !==
        (settings.catalogTitleLines !== undefined
          ? parseInt(settings.catalogTitleLines, 10)
          : 2) ||
      catalogColumns !== (settings.catalogColumns || "auto") ||
      catalogCardMaxHeight !== (settings.catalogCardMaxHeight || "auto") ||
      themePreset !== (settings.themePreset || "default") ||
      themeAccentColor !== (settings.themeAccentColor || "#8b5cf6") ||
      themeSecondaryColor !==
        (settings.themeSecondaryColor || settings.themeSubColor || "#3b82f6") ||
      themeSidebarColor !== (settings.themeSidebarColor || "#ec4899") ||
      themeTextColor !== (settings.themeTextColor || "#f3f4f6") ||
      themeBgColor !== (settings.themeBgColor || "#0f0d19") ||
      (isValidLimit && finalLimit !== (settings.imageCacheSizeLimit || 5));

    setHasChanges(changed);

    if (changed) {
      const timer = setTimeout(() => {
        autoSaveSettings();
      }, 500); // 500ms debounce
      return () => clearTimeout(timer);
    }
  }, [
    animeProvider,
    quality,
    mangaProvider,
    autoLoadNextChapter,
    pagination,
    malStatus,
    mergeSubtitles,
    subtitleFormat,
    mediaServerNaming,
    preferredSubtitleLanguages,
    subFontSize,
    subColor,
    subBorderColor,
    subBorderSize,
    subBgColor,
    playerSpeed,
    developerMode,
    downloadNotification,
    downloadLocation,
    animeNamingScheme,
    mangaNamingScheme,
    jellyfinCompatibility,
    externalLogEnabled,
    maxLogFiles,
    autoSkipIntro,
    mangaReaderLayout,
    mangaReaderWidth,
    catalogTitleFontSize,
    catalogTitleLines,
    catalogColumns,
    catalogCardMaxHeight,
    themePreset,
    themeAccentColor,
    themeSecondaryColor,
    themeSidebarColor,
    themeTextColor,
    themeBgColor,
    imageCacheSizeLimit,
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
      if (data?.success) {
        swalSuccess("Cache Cleared", "Image cache cleared successfully!");
        fetchCacheStats();
      } else {
        swalError("Error", data?.error || "Failed to clear cache.");
      }
    } catch (err) {
      console.error(err);
      swalError("Error", err.message || "An error occurred.");
    } finally {
      setClearingCache(false);
    }
  };

  const handleCheckForUpdates = async () => {
    setUpdateStatus("checking");
    setUpdateErrorMsg("");
    try {
      const res = await window.sharedStateAPI.checkForUpdate();
      if (!res?.success) {
        setUpdateStatus("error");
        setUpdateErrorMsg(res?.error || "Failed to check for updates");
      }
    } catch (err) {
      setUpdateStatus("error");
      setUpdateErrorMsg(err.message || "Update check failed");
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
    <div
      className="settings-wrapper"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      <div className="settings-container-inner">
        <div className="settings-top-section">
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
                  <Check
                    size={14}
                    className="u-style-67"
                    style={{
                      display: "inline-block",
                      verticalAlign: "-2px",
                      marginRight: "4px",
                    }}
                  />
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
              onClick={() => setActiveTab("tags")}
              className={`settings-tab-btn ${activeTab === "tags" ? "active" : ""}`}
            >
              Library Tags
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
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="settings-form">
          {activeTab === "general" && (
            <div className="settings-column">
              {/* General Settings */}
              <div className="settings-section glass-panel">
                <h2 className="settings-section-title">General Settings</h2>
                <SettingsRow
                  label="Download Notifications"
                  desc="Show active download progress notification in the Android status bar."
                >
                  <Dropdown
                    value={String(downloadNotification)}
                    onChange={(val) => setDownloadNotification(val === "true")}
                    options={[
                      { value: "true", label: "Enabled" },
                      { value: "false", label: "Disabled" },
                    ]}
                    minWidth={200}
                  />
                </SettingsRow>
                {!isMobileApp() && (
                  <SettingsRow
                    label="Download Location"
                    desc="Where new anime episodes and manga chapters are saved. Takes effect for new downloads; move existing Anime/Manga folders over manually to keep them visible."
                  >
                    <div className="download-location-picker">
                      <input
                        type="text"
                        className="settings-text-input download-location-path"
                        value={downloadLocation}
                        placeholder="Default (system Downloads folder)"
                        readOnly
                        title={
                          downloadLocation ||
                          "Default (system Downloads folder)"
                        }
                      />
                      <button
                        type="button"
                        className="settings-market-btn download-location-btn"
                        onClick={handleBrowseDownloadLocation}
                        disabled={browsingFolder}
                      >
                        <FolderOpen size={14} />
                        {browsingFolder ? "Browsing..." : "Browse"}
                      </button>
                      {downloadLocation && (
                        <button
                          type="button"
                          className="theme-reset-btn"
                          onClick={handleResetDownloadLocation}
                          title="Reset to default Downloads folder"
                          aria-label="Reset download location to default"
                        >
                          <RotateCcw size={16} />
                        </button>
                      )}
                    </div>
                  </SettingsRow>
                )}
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
              {/* Catalog Layout & Appearance */}
              <div className="settings-section glass-panel">
                <h2 className="settings-section-title">
                  Catalog Layout & Title Customization
                </h2>

                <SettingsRow
                  label="Catalog Items Per Row"
                  desc="Control the density and number of cards displayed per row in the catalog grid."
                >
                  <div
                    className="catalog-columns-picker"
                    style={{ flexWrap: "wrap", gap: "6px" }}
                  >
                    {[
                      "auto",
                      "2",
                      "3",
                      "4",
                      "5",
                      "6",
                      "7",
                      "8",
                      "9",
                      "10",
                      "12",
                    ].map((col) => (
                      <button
                        key={col}
                        type="button"
                        className={`catalog-col-btn ${catalogColumns === col ? "active" : ""}`}
                        onClick={() => handleCatalogColumnsChange(col)}
                      >
                        {col === "auto" ? "Auto" : col}
                      </button>
                    ))}
                  </div>
                </SettingsRow>

                <SettingsRow
                  label={`Catalog Card Max Height (${catalogCardMaxHeight === "auto" ? "Auto" : `${parseInt(catalogCardMaxHeight, 10)}px`})`}
                  desc="Limit maximum height of poster images to avoid oversized cards on large displays."
                >
                  <div className="settings-slider-wrapper">
                    <input
                      type="range"
                      min={160}
                      max={460}
                      step={10}
                      value={
                        catalogCardMaxHeight === "auto"
                          ? 460
                          : parseInt(catalogCardMaxHeight, 10)
                      }
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        const finalVal = val >= 460 ? "auto" : `${val}px`;
                        handleCatalogCardMaxHeightChange(finalVal);
                      }}
                      className="settings-range-slider"
                    />
                    <span
                      className="settings-slider-val"
                      style={{ minWidth: "55px" }}
                    >
                      {catalogCardMaxHeight === "auto"
                        ? "Auto"
                        : `${parseInt(catalogCardMaxHeight, 10)}px`}
                    </span>
                    {catalogCardMaxHeight !== "auto" && (
                      <button
                        type="button"
                        className="btn-text-reset"
                        style={{
                          marginLeft: "8px",
                          fontSize: "12px",
                          color: "var(--accent)",
                          cursor: "pointer",
                          background: "none",
                          border: "none",
                          fontWeight: 500,
                        }}
                        onClick={() => handleCatalogCardMaxHeightChange("auto")}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </SettingsRow>

                <SettingsRow
                  label={`Catalog Title Font Size (${catalogTitleFontSize}px)`}
                  desc="Adjust the font size of media item titles below poster images."
                >
                  <div className="settings-slider-wrapper">
                    <input
                      type="range"
                      min={10}
                      max={20}
                      step={1}
                      value={catalogTitleFontSize}
                      onChange={(e) =>
                        handleCatalogTitleFontSizeChange(e.target.value)
                      }
                      className="settings-range-slider"
                    />
                    <span className="settings-slider-val">
                      {catalogTitleFontSize}px
                    </span>
                  </div>
                </SettingsRow>

                <SettingsRow
                  label={`Catalog Title Lines (${catalogTitleLines} ${catalogTitleLines === 1 ? "line" : "lines"})`}
                  desc="Limit the maximum number of text lines shown for titles in the catalog."
                >
                  <div className="settings-slider-wrapper">
                    <input
                      type="range"
                      min={1}
                      max={4}
                      step={1}
                      value={catalogTitleLines}
                      onChange={(e) =>
                        handleCatalogTitleLinesChange(e.target.value)
                      }
                      className="settings-range-slider"
                    />
                    <span className="settings-slider-val">
                      {catalogTitleLines}{" "}
                      {catalogTitleLines === 1 ? "line" : "lines"}
                    </span>
                  </div>
                </SettingsRow>

                {/* Live Preview Box */}
                <div className="catalog-preview-container">
                  <div className="catalog-preview-header">
                    <span className="catalog-preview-desc">
                      Visual preview of how catalog cards appear with your
                      current settings
                    </span>
                  </div>
                  <div
                    className="catalog-preview-grid"
                    style={{
                      gridTemplateColumns:
                        catalogColumns === "auto"
                          ? "repeat(auto-fill, minmax(max(130px, calc((100% - 5 * 10px) / 6)), 1fr))"
                          : `repeat(${catalogColumns}, 1fr)`,
                    }}
                  >
                    {PREVIEW_SAMPLE_CARDS.map((card) => (
                      <div key={card.id} className="catalog-preview-card">
                        <div
                          className="catalog-preview-img-box"
                          style={{
                            maxHeight:
                              catalogCardMaxHeight === "auto"
                                ? undefined
                                : catalogCardMaxHeight,
                            height:
                              catalogCardMaxHeight === "auto"
                                ? undefined
                                : catalogCardMaxHeight,
                          }}
                        >
                          <img
                            src="/images/image-404.png"
                            alt="Preview Poster"
                            className="catalog-preview-img"
                          />
                        </div>
                        <div className="catalog-preview-info">
                          <div
                            className="catalog-preview-title"
                            style={{
                              fontSize: `${catalogTitleFontSize}px`,
                              WebkitLineClamp: catalogTitleLines,
                              maxHeight: `calc(${catalogTitleFontSize * 1.4}px * ${catalogTitleLines})`,
                            }}
                          >
                            {card.title}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>{" "}
              {/* Custom Themes & Component Colors */}
              <div className="settings-section glass-panel">
                <h2 className="settings-section-title">
                  Theme & Color Customization
                </h2>

                <div className="settings-preset-row-block">
                  <div className="settings-row-info">
                    <div className="settings-row-label">Preset Themes</div>
                    <div className="settings-row-hint">
                      Select a pre-designed dark theme to transform accent
                      highlights, secondary elements, sidebar icons, text, and
                      background.
                    </div>
                  </div>
                  <div className="theme-preset-grid">
                    {PRESET_THEMES.map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        className={`theme-preset-card ${themePreset === theme.id ? "active" : ""}`}
                        onClick={() => handleSelectThemePreset(theme)}
                      >
                        <div className="theme-preset-swatches">
                          <span
                            style={{ backgroundColor: theme.primary }}
                            title="Primary Accent"
                          />
                          <span
                            style={{ backgroundColor: theme.secondary }}
                            title="Secondary Accent"
                          />
                          <span
                            style={{ backgroundColor: theme.sidebarActive }}
                            title="Sidebar Active"
                          />
                          <span
                            style={{ backgroundColor: theme.text }}
                            title="Text Color"
                          />
                          <span
                            style={{ backgroundColor: theme.bg }}
                            title="Background"
                          />
                        </div>
                        <span className="theme-preset-name">{theme.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <SettingsRow
                  label="Primary Accent Color"
                  desc="Main highlight color used across buttons, active navigation, sliders, and badges."
                >
                  <div className="color-picker-control">
                    <input
                      type="color"
                      value={themeAccentColor}
                      onChange={(e) =>
                        handleColorChange("primary", e.target.value)
                      }
                      className="settings-color-input"
                    />
                    <span className="color-code">{themeAccentColor}</span>
                  </div>
                </SettingsRow>

                <SettingsRow
                  label="Secondary Accent Color"
                  desc="Complementary color used for secondary tags, sub/dub indicators, and highlights."
                >
                  <div className="color-picker-control">
                    <input
                      type="color"
                      value={themeSecondaryColor}
                      onChange={(e) =>
                        handleColorChange("secondary", e.target.value)
                      }
                      className="settings-color-input"
                    />
                    <span className="color-code">{themeSecondaryColor}</span>
                  </div>
                </SettingsRow>

                <SettingsRow
                  label="Sidebar Active Accent"
                  desc="Glowing highlight color for the active sidebar navigation item."
                >
                  <div className="color-picker-control">
                    <input
                      type="color"
                      value={themeSidebarColor}
                      onChange={(e) =>
                        handleColorChange("sidebar", e.target.value)
                      }
                      className="settings-color-input"
                    />
                    <span className="color-code">{themeSidebarColor}</span>
                  </div>
                </SettingsRow>

                <SettingsRow
                  label="Main Text Color"
                  desc="Custom font color for application titles, labels, and text elements."
                >
                  <div className="color-picker-control">
                    <input
                      type="color"
                      value={themeTextColor}
                      onChange={(e) =>
                        handleColorChange("text", e.target.value)
                      }
                      className="settings-color-input"
                    />
                    <span className="color-code">{themeTextColor}</span>
                  </div>
                </SettingsRow>

                <SettingsRow
                  label="App Background Color"
                  desc="Overall dark background color for the application window."
                >
                  <div className="color-picker-control">
                    <input
                      type="color"
                      value={themeBgColor}
                      onChange={(e) => handleColorChange("bg", e.target.value)}
                      className="settings-color-input"
                    />
                    <span className="color-code">{themeBgColor}</span>
                  </div>
                </SettingsRow>

                <div
                  className="settings-row-item"
                  style={{ justifyContent: "flex-end", paddingTop: "8px" }}
                >
                  <button
                    type="button"
                    className="theme-reset-btn"
                    onClick={() => handleSelectThemePreset(PRESET_THEMES[0])}
                    title="Reset Theme Colors"
                    aria-label="Reset Theme Colors"
                  >
                    <RefreshCw size={16} />
                  </button>
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
                        ? `${((Number(cacheStats.sizeInBytes) || 0) / (1024 * 1024)).toFixed(1)} MB (${Number(cacheStats.filesCount) || 0} files)`
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
                <SettingsRow
                  label="Save Log Files"
                  desc="Keep a log file per app session in a folder outside the app, useful for troubleshooting and sharing."
                >
                  <Dropdown
                    value={String(externalLogEnabled)}
                    onChange={(val) => setExternalLogEnabled(val === "true")}
                    options={[
                      { value: "true", label: "Enabled" },
                      { value: "false", label: "Disabled" },
                    ]}
                    minWidth={200}
                  />
                </SettingsRow>
                {externalLogEnabled && (
                  <>
                    <SettingsRow
                      label="Kept Log Files"
                      desc="How many recent log files to keep (1–10, default 5). Older files are deleted automatically and the total is kept under 500 MB."
                    >
                      <Dropdown
                        value={String(maxLogFiles)}
                        onChange={(val) =>
                          setMaxLogFiles(parseInt(val, 10) || 5)
                        }
                        options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
                          value: String(n),
                          label: `${n} file${n > 1 ? "s" : ""}`,
                        }))}
                        minWidth={200}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Log Folder"
                      desc="Where the log files are stored."
                    >
                      <input
                        type="text"
                        className="settings-text-input download-location-path"
                        value={logDirectory}
                        placeholder="Default log folder"
                        readOnly
                        title={logDirectory || "Default log folder"}
                      />
                    </SettingsRow>
                  </>
                )}
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
                      onClick={(e) => {
                        e.preventDefault();
                        const targetUrl = "https://discord.gg/PzfUBgQ2gt";
                        if (
                          window.Capacitor &&
                          window.Capacitor.Plugins &&
                          window.Capacitor.Plugins.CloudflareBypass
                        ) {
                          window.Capacitor.Plugins.CloudflareBypass.openSystemBrowser(
                            { url: targetUrl },
                          ).catch(() => {
                            window.open(targetUrl, "_blank");
                          });
                        } else {
                          window.open(targetUrl, "_blank");
                        }
                      }}
                      target="_blank"
                      rel="noreferrer"
                      className="settings-connect-link u-style-76"
                    >
                      <DiscordIcon size={16} />
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

                <SettingsRow
                  label="Anime Download Naming"
                  desc="Format for downloaded anime video files. Plex / Jellyfin standard includes dynamic episode zero-padding (e.g. S01E0001 for 1000+ episode anime, S01E01 for standard series)."
                >
                  <Dropdown
                    value={animeNamingScheme}
                    onChange={setAnimeNamingScheme}
                    options={[
                      {
                        value: "plex_jellyfin",
                        label: "Plex / Jellyfin Standard (Auto-padded)",
                      },
                      {
                        value: "default",
                        label: "Default / Compact (1Ep.mp4)",
                      },
                      {
                        value: "series_s_ep",
                        label: "Series S#EP# (One Piece S1EP1.mp4)",
                      },
                      {
                        value: "episode_only",
                        label: "Episode Only (Episode 01.mp4)",
                      },
                    ]}
                    minWidth={220}
                  />
                </SettingsRow>

                {!isMobileApp() && (
                  <SettingsRow
                    label="Jellyfin & Plex Compatibility"
                    desc="Automatically updates anime download file naming to Plex/Jellyfin format and generates .nfo metadata and poster.jpg for existing and new downloads. Disabling keeps existing NFO files."
                  >
                    <Dropdown
                      value={String(jellyfinCompatibility)}
                      onChange={(val) => {
                        const isEnabled = val === "true";
                        setJellyfinCompatibility(isEnabled);
                        if (isEnabled) {
                          setAnimeNamingScheme("plex_jellyfin");
                        } else {
                          setAnimeNamingScheme("default");
                        }
                      }}
                      options={[
                        { value: "true", label: "Enabled" },
                        { value: "false", label: "Disabled" },
                      ]}
                      minWidth={200}
                    />
                  </SettingsRow>
                )}

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
                    <div className="settings-row-label">
                      Media Server Integration (Jellyfin / Plex)
                    </div>
                    <div className="settings-row-hint">
                      Save episodes as "Show/Season 02/Show - S02E05
                      [1080p].mp4", align external subtitles, and automatically
                      generate .nfo metadata and poster artwork for Jellyfin and
                      Plex. Pick the season and show folder on each show's page
                      next to the download buttons.
                    </div>
                  </div>
                  <div className="settings-row-control">
                    <Dropdown
                      value={String(mediaServerNaming)}
                      onChange={(val) => setMediaServerNaming(val === "true")}
                      options={[
                        { value: "true", label: "On (Show - S01E05 [1080p])" },
                        { value: "false", label: "Off (5Ep.mp4)" },
                      ]}
                      minWidth={200}
                    />
                  </div>
                </div>

                <div
                  className="settings-row-item vertical-layout"
                  style={{
                    flexDirection: "column",
                    alignItems: "flex-start",
                    padding: "16px 0",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                  }}
                >
                  <div
                    className="settings-row-info"
                    style={{ marginBottom: "12px" }}
                  >
                    <div className="settings-row-label">
                      Preferred Subtitle Languages
                    </div>
                    <div className="settings-row-hint">
                      Select which subtitle languages to load in player and
                      download during batch downloads. Deselect all to disable
                      automatic subtitle downloads. (English selected by
                      default)
                    </div>
                  </div>
                  <div
                    className="settings-lang-actions"
                    style={{
                      display: "flex",
                      gap: "8px",
                      marginBottom: "12px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setPreferredSubtitleLanguages(ALL_SUBTITLE_LANGUAGES)
                      }
                      style={{
                        padding: "5px 14px",
                        fontSize: "12px",
                        fontWeight: "600",
                        borderRadius: "6px",
                        background: "rgba(59, 130, 246, 0.2)",
                        border: "1px solid rgba(59, 130, 246, 0.4)",
                        color: "#60a5fa",
                        cursor: "pointer",
                      }}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreferredSubtitleLanguages([])}
                      style={{
                        padding: "5px 14px",
                        fontSize: "12px",
                        fontWeight: "600",
                        borderRadius: "6px",
                        background: "rgba(239, 68, 68, 0.2)",
                        border: "1px solid rgba(239, 68, 68, 0.4)",
                        color: "#f87171",
                        cursor: "pointer",
                      }}
                    >
                      Deselect All
                    </button>
                  </div>
                  <div
                    className="settings-lang-pills"
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      width: "100%",
                    }}
                  >
                    {ALL_SUBTITLE_LANGUAGES.map((lang) => {
                      const isSelected =
                        preferredSubtitleLanguages.includes(lang);
                      return (
                        <button
                          key={lang}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setPreferredSubtitleLanguages(
                                preferredSubtitleLanguages.filter(
                                  (l) => l !== lang,
                                ),
                              );
                            } else {
                              setPreferredSubtitleLanguages([
                                ...preferredSubtitleLanguages,
                                lang,
                              ]);
                            }
                          }}
                          style={{
                            padding: "6px 14px",
                            borderRadius: "20px",
                            fontSize: "12px",
                            fontWeight: "600",
                            border: isSelected
                              ? "1px solid #3b82f6"
                              : "1px solid rgba(255, 255, 255, 0.15)",
                            backgroundColor: isSelected
                              ? "rgba(59, 130, 246, 0.25)"
                              : "rgba(255, 255, 255, 0.04)",
                            color: isSelected
                              ? "#93c5fd"
                              : "rgba(255, 255, 255, 0.6)",
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                          }}
                        >
                          {isSelected ? (
                            <Check
                              size={12}
                              style={{
                                display: "inline-block",
                                verticalAlign: "-1px",
                                marginRight: "3px",
                              }}
                            />
                          ) : (
                            "+ "
                          )}
                          {lang}
                        </button>
                      );
                    })}
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

              {/* Subtitle Appearance & Customization */}
              <div
                id="subtitle-customization"
                className="settings-section glass-panel"
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "16px",
                  }}
                >
                  <h2 className="settings-section-title" style={{ margin: 0 }}>
                    Subtitle Customization & Appearance
                  </h2>
                  <button
                    type="button"
                    className="theme-reset-btn"
                    onClick={handleRestoreSubtitleDefaults}
                    title="Restore Subtitle Defaults"
                    aria-label="Restore Subtitle Defaults"
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>

                <SettingsRow
                  label="Default Playback Speed"
                  desc="Default playback speed when launching video player (MPV / Android)."
                >
                  <Dropdown
                    value={String(playerSpeed)}
                    onChange={(val) => setPlayerSpeed(parseFloat(val))}
                    options={[
                      { value: "0.5", label: "0.5x" },
                      { value: "0.75", label: "0.75x" },
                      { value: "1", label: "1.0x (Normal)" },
                      { value: "1.25", label: "1.25x" },
                      { value: "1.5", label: "1.5x" },
                      { value: "1.75", label: "1.75x" },
                      { value: "2", label: "2.0x" },
                      { value: "2.5", label: "2.5x" },
                    ]}
                    minWidth={200}
                  />
                </SettingsRow>

                <SettingsRow
                  label={`Subtitle Font Size (${subFontSize}px)`}
                  desc="Adjust font size of subtitles in video player."
                >
                  <div className="settings-slider-wrapper">
                    <input
                      type="range"
                      min={20}
                      max={72}
                      step={2}
                      value={subFontSize}
                      onChange={(e) =>
                        setSubFontSize(parseInt(e.target.value, 10))
                      }
                      className="settings-range-slider"
                    />
                    <span className="settings-slider-val">{subFontSize}px</span>
                  </div>
                </SettingsRow>

                <SettingsRow
                  label="Subtitle Text Color"
                  desc="Color of subtitle text characters."
                >
                  <div className="theme-color-picker-row">
                    {[
                      "#FFFFFF",
                      "#FFFF00",
                      "#00FFFF",
                      "#00FF00",
                      "#FFCC00",
                    ].map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`color-preset-dot ${subColor.toUpperCase() === c ? "active" : ""}`}
                        style={{ backgroundColor: c }}
                        onClick={() => setSubColor(c)}
                        title={`Select ${c}`}
                      />
                    ))}
                    <input
                      type="color"
                      value={subColor.startsWith("#") ? subColor : "#FFFFFF"}
                      onChange={(e) => setSubColor(e.target.value)}
                      className="settings-color-input"
                    />
                    <span className="color-code">{subColor}</span>
                  </div>
                </SettingsRow>

                <SettingsRow
                  label="Outline / Border Color"
                  desc="Outline border color around text characters (prevents text fading into white video frames)."
                >
                  <div className="theme-color-picker-row">
                    {[
                      "#000000",
                      "#111111",
                      "#333333",
                      "#000080",
                      "#800000",
                    ].map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`color-preset-dot ${subBorderColor.toUpperCase() === c ? "active" : ""}`}
                        style={{ backgroundColor: c }}
                        onClick={() => setSubBorderColor(c)}
                        title={`Select ${c}`}
                      />
                    ))}
                    <input
                      type="color"
                      value={
                        subBorderColor.startsWith("#")
                          ? subBorderColor
                          : "#000000"
                      }
                      onChange={(e) => setSubBorderColor(e.target.value)}
                      className="settings-color-input"
                    />
                    <span className="color-code">{subBorderColor}</span>
                  </div>
                </SettingsRow>

                <SettingsRow
                  label={`Outline / Border Thickness (${subBorderSize}px)`}
                  desc="Thickness of outline border around subtitle text."
                >
                  <div className="settings-slider-wrapper">
                    <input
                      type="range"
                      min={0}
                      max={6}
                      step={0.5}
                      value={subBorderSize}
                      onChange={(e) =>
                        setSubBorderSize(parseFloat(e.target.value))
                      }
                      className="settings-range-slider"
                    />
                    <span className="settings-slider-val">
                      {subBorderSize}px
                    </span>
                  </div>
                </SettingsRow>

                <SettingsRow
                  label="Subtitle Background Box"
                  desc="Background fill behind subtitle text."
                >
                  <div className="theme-color-picker-row">
                    {[
                      { name: "None", value: "transparent" },
                      { name: "Dark (50%)", value: "rgba(0, 0, 0, 0.5)" },
                      { name: "Solid Black", value: "#000000" },
                    ].map((bg) => (
                      <button
                        key={bg.value}
                        type="button"
                        className={`catalog-col-btn ${subBgColor === bg.value ? "active" : ""}`}
                        onClick={() => setSubBgColor(bg.value)}
                      >
                        {bg.name}
                      </button>
                    ))}
                  </div>
                </SettingsRow>

                {/* Subtitle Live Preview */}
                <div
                  className="catalog-preview-container"
                  style={{ marginTop: "16px" }}
                >
                  <div className="catalog-preview-header">
                    Live Subtitle Appearance Preview
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, 1fr)",
                      gap: "12px",
                      marginTop: "8px",
                    }}
                  >
                    {[
                      { label: "Dark Scene", bg: "#111827" },
                      { label: "Medium Scene", bg: "#4b5563" },
                      { label: "White Scene", bg: "#ffffff" },
                    ].map((scene) => (
                      <div
                        key={scene.label}
                        style={{
                          height: "120px",
                          backgroundColor: scene.bg,
                          borderRadius: "8px",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "8px",
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            alignSelf: "flex-start",
                            fontSize: "11px",
                            fontWeight: "600",
                            color:
                              scene.bg === "#ffffff" ? "#111827" : "#e5e7eb",
                            opacity: 0.7,
                          }}
                        >
                          {scene.label}
                        </span>
                        <div
                          style={{
                            display: "inline-block",
                            maxWidth: "92%",
                            textAlign: "center",
                            fontSize: `${Math.max(13, Math.min(20, subFontSize * 0.42))}px`,
                            fontWeight: "700",
                            fontFamily:
                              '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                            color: subColor,
                            backgroundColor:
                              subBgColor === "transparent"
                                ? "transparent"
                                : subBgColor,
                            padding:
                              subBgColor === "transparent"
                                ? "2px 4px"
                                : "4px 10px",
                            borderRadius: "4px",
                            paintOrder: "stroke fill",
                            WebkitPaintOrder: "stroke fill",
                            WebkitTextStroke:
                              subBorderSize > 0
                                ? `${Math.min(subBorderSize * 0.5, 1.8)}px ${subBorderColor}`
                                : "none",
                            textShadow:
                              subBorderSize > 0
                                ? `-1px -1px 0 ${subBorderColor}, 1px -1px 0 ${subBorderColor}, -1px 1px 0 ${subBorderColor}, 1px 1px 0 ${subBorderColor}, 0 2px 4px rgba(0, 0, 0, 0.8)`
                                : "0 2px 4px rgba(0, 0, 0, 0.8)",
                            marginBottom: "8px",
                            lineHeight: "1.25",
                            letterSpacing: "0.02em",
                          }}
                        >
                          Subtitle Preview Text
                        </div>
                      </div>
                    ))}
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
                      options={[
                        { value: "", label: "None selected" },
                        ...(settings?.providers?.Manga || []).map((name) => ({
                          value: name,
                          label: name,
                          icon: getProviderIcon(name, "Manga"),
                        })),
                      ]}
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

                <SettingsRow
                  label="Manga Download Naming"
                  desc="Naming format for downloaded manga chapter archives (.cbz files)."
                >
                  <Dropdown
                    value={mangaNamingScheme}
                    onChange={setMangaNamingScheme}
                    options={[
                      {
                        value: "default",
                        label: "Default (Chapter 1052.cbz)",
                      },
                      {
                        value: "series_chapter",
                        label:
                          "Series - Chapter (One Piece - Chapter 1052.cbz)",
                      },
                      { value: "short", label: "Short (Ch. 1052.cbz)" },
                    ]}
                    minWidth={220}
                  />
                </SettingsRow>

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
                          options={MAL_STATUSES.Anime.map((s) => ({
                            value: s,
                            label: getMalStatusLabel(s),
                          }))}
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
                          onClick={(e) => {
                            e.preventDefault();
                            if (
                              window.Capacitor &&
                              window.Capacitor.Plugins &&
                              window.Capacitor.Plugins.CloudflareBypass
                            ) {
                              window.Capacitor.Plugins.CloudflareBypass.openSystemBrowser(
                                { url },
                              ).catch(() => {
                                window.open(url, "_blank");
                              });
                            } else {
                              window.open(url, "_blank");
                            }
                          }}
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
                        {stats?.distinctAnime || 0} Anime)
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
                        {stats?.distinctManga || 0} Manga)
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
                                      {item.hidden === 1 && (
                                        <span
                                          className="settings-hidden-badge"
                                          title="Hidden from Continue Watching/Reading shelf"
                                        >
                                          Hidden from shelf
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
                                  {item.hidden === 1 && (
                                    <button
                                      type="button"
                                      className="history-unhide-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleUnhideHistory(item);
                                      }}
                                      title="Restore to Continue shelf"
                                    >
                                      <Eye size={16} />
                                    </button>
                                  )}
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

          {activeTab === "tags" && (
            <div className="settings-panel glass-panel">
              <div className="tags-management-header">
                <div>
                  <h3 className="settings-section-title">
                    Library Tag Management
                  </h3>
                  <p className="settings-row-hint" style={{ marginTop: "4px" }}>
                    Create, delete, and drag-and-drop reorder custom tags for
                    your local Anime and Manga library.
                  </p>
                </div>

                <div className="tag-type-toggle">
                  <button
                    type="button"
                    onClick={() => setTagType("Anime")}
                    className={`tag-type-btn ${tagType === "Anime" ? "active" : ""}`}
                  >
                    Anime Tags
                  </button>
                  <button
                    type="button"
                    onClick={() => setTagType("Manga")}
                    className={`tag-type-btn ${tagType === "Manga" ? "active" : ""}`}
                  >
                    Manga Tags
                  </button>
                </div>
              </div>

              {/* Create Tag Bar */}
              <div className="create-tag-container">
                <div className="create-tag-input-group">
                  <Tag size={16} className="create-tag-icon" />
                  <input
                    type="text"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleCreateTag();
                      }
                    }}
                    placeholder={`Enter new ${tagType} tag name...`}
                    className="settings-text-input create-tag-input"
                  />
                  <button
                    type="button"
                    onClick={handleCreateTag}
                    disabled={creatingTag || !newTagInput.trim()}
                    className="btn-create-tag"
                  >
                    <Plus size={16} />
                    Create Tag
                  </button>
                </div>
              </div>

              {/* Draggable Tag List */}
              {tagsLoading ? (
                <div className="settings-loading-center">
                  <Loader2 size={32} className="spin" />
                  <p>Loading tags...</p>
                </div>
              ) : tagsList.length === 0 ? (
                <div className="no-tags-notice">
                  No tags available. Create one above!
                </div>
              ) : (
                <div className="tag-reorder-list">
                  {tagsList.map((tagObj, index) => {
                    const tagName =
                      typeof tagObj === "string" ? tagObj : tagObj.name;
                    const isHidden =
                      typeof tagObj === "object" ? !!tagObj.hidden : false;
                    const isReserved = isReservedTag(tagName, tagType);

                    return (
                      <div
                        key={tagName}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        onDragEnd={handleDragEnd}
                        className={`tag-item-card ${
                          draggedTagIndex === index ? "dragging" : ""
                        } ${dragOverIndex === index ? "drag-over" : ""} ${
                          isHidden ? "tag-hidden-card" : ""
                        }`}
                      >
                        <div className="tag-item-left">
                          <span
                            className="tag-drag-handle"
                            title="Drag to reorder"
                          >
                            <GripVertical size={16} />
                          </span>
                          <span className="tag-item-name">{tagName}</span>
                          <span
                            className={`tag-item-badge ${
                              isReserved ? "badge-system" : "badge-custom"
                            }`}
                          >
                            {isReserved ? "System Tag" : "Custom Tag"}
                          </span>
                          {isHidden && (
                            <span className="tag-item-badge badge-hidden">
                              Hidden
                            </span>
                          )}
                        </div>

                        <div className="tag-item-actions">
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleVisibility(tagName, isHidden)
                            }
                            className={`tag-action-btn ${
                              isHidden ? "unhide-btn" : "hide-btn"
                            }`}
                            title={
                              isHidden
                                ? `Unhide tag "${tagName}" in UI`
                                : `Hide tag "${tagName}" from UI`
                            }
                          >
                            {isHidden ? (
                              <EyeOff size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </button>

                          {!isReserved && (
                            <button
                              type="button"
                              onClick={() => handleDeleteTag(tagName)}
                              className="tag-delete-btn"
                              title={`Delete tag "${tagName}"`}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
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
                <div className="settings-version-info">
                  <span className="settings-version-label">Version</span>
                  <span className="settings-version-value">
                    v{appVersion || "9.5.0"}
                  </span>
                </div>

                <div className="settings-update-action">
                  {updateStatus === "idle" && (
                    <button
                      type="button"
                      onClick={handleCheckForUpdates}
                      className="update-btn-premium"
                    >
                      <RefreshCw size={13} />
                      <span>Check for Updates</span>
                    </button>
                  )}

                  {updateStatus === "checking" && (
                    <div className="update-status-checking">
                      <RefreshCw size={14} className="update-spin-icon" />
                      <span>Checking for updates...</span>
                    </div>
                  )}

                  {updateStatus === "up-to-date" && (
                    <div className="update-status-uptodate">
                      <span className="update-uptodate-badge">
                        <Check size={14} /> Up to date
                      </span>
                      <button
                        type="button"
                        onClick={handleCheckForUpdates}
                        className="update-btn-secondary"
                      >
                        Check Again
                      </button>
                    </div>
                  )}

                  {updateStatus === "ready" && (
                    <button
                      type="button"
                      onClick={() => window.sharedStateAPI.installUpdate?.()}
                      className="update-btn-ready"
                    >
                      <CheckCircle size={14} />
                      <span>Update App</span>
                    </button>
                  )}

                  {updateStatus === "error" && (
                    <div className="update-status-error">
                      <span className="update-error-text">Check failed</span>
                      <button
                        type="button"
                        onClick={handleCheckForUpdates}
                        className="update-btn-secondary"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline Loading Progress Bar inside Settings tab */}
                {updateStatus === "downloading" && updateProgress && (
                  <div className="update-progress-container">
                    <div className="update-progress-header">
                      <span>
                        Downloading v{updateProgress.version || ""}...
                      </span>
                      <span>
                        {Math.min(
                          100,
                          Math.max(0, updateProgress.percent || 0),
                        ).toFixed(0)}
                        %
                        {updateProgress.bytesPerSecond > 0 &&
                          ` (${(
                            updateProgress.bytesPerSecond /
                            (1024 * 1024)
                          ).toFixed(2)} MB/s)`}
                      </span>
                    </div>
                    <div className="update-progress-bar-bg">
                      <div
                        className="update-progress-bar-fill"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(0, updateProgress.percent || 0),
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {updateStatus === "error" && updateErrorMsg && (
                  <div
                    style={{
                      color: "var(--danger)",
                      fontSize: "12px",
                      marginTop: "8px",
                    }}
                  >
                    {updateErrorMsg}
                  </div>
                )}
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
              {parseMarkdownLinks(line.replace("## ", ""))}
            </h2>
          );
        }
        if (line.startsWith("### ")) {
          return (
            <h3 key={idx} className="changelog-h3">
              {parseMarkdownLinks(line.replace("### ", ""))}
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
  if (typeof text !== "string") return text;
  const regex = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      parts.push(text.substring(lastIndex, matchIndex));
    }

    if (match[1] && match[2]) {
      const linkText = match[1];
      const url = match[2];
      parts.push(
        <a
          key={`link-${matchIndex}`}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            if (
              window.Capacitor &&
              window.Capacitor.Plugins &&
              window.Capacitor.Plugins.CloudflareBypass
            ) {
              window.Capacitor.Plugins.CloudflareBypass.openSystemBrowser({
                url,
              }).catch(() => {
                window.open(url, "_blank");
              });
            } else {
              window.open(url, "_blank");
            }
          }}
          target="_blank"
          rel="noreferrer"
          className="changelog-link"
        >
          {linkText}
        </a>,
      );
    } else if (match[3]) {
      parts.push(
        <strong key={`bold-${matchIndex}`} className="changelog-bold">
          {match[3]}
        </strong>,
      );
    } else if (match[4]) {
      parts.push(
        <code key={`code-${matchIndex}`} className="changelog-code">
          {match[4]}
        </code>,
      );
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}
