/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useState, useEffect, useRef } from "react";
import {
  Loader2,
  LogOut,
  CheckCircle,
  Trash2,
  MessageSquare,
  Link as LinkIcon,
  RefreshCw,
  Tag,
  GripVertical,
  Plus,
  Eye,
  EyeOff,
  Check,
} from "lucide-react";
import Swal from "sweetalert2";
import { swalSuccess, swalError, swalConfirm } from "../../utils/swal";
import { apiPost, applyThemeVars, hexToRgba } from "../../utils/common";
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
    primary: "#00f0ff",
    secondary: "#ff0055",
    sidebarActive: "#ffe600",
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
  const [preferredSubtitleLanguages, setPreferredSubtitleLanguages] = useState([
    "English",
  ]);
  const [malUsername, setMalUsername] = useState(null);
  const [imageCacheSizeLimit, setImageCacheSizeLimit] = useState(5);
  const [developerMode, setDeveloperMode] = useState(false);
  const [downloadNotification, setDownloadNotification] = useState(true);
  const [autoSkipIntro, setAutoSkipIntro] = useState(true);
  const [mangaReaderLayout, setMangaReaderLayout] = useState("long-strip");
  const [mangaReaderWidth, setMangaReaderWidth] = useState(800);
  const [catalogTitleFontSize, setCatalogTitleFontSize] = useState(14);
  const [catalogTitleLines, setCatalogTitleLines] = useState(2);
  const [catalogColumns, setCatalogColumns] = useState("auto");
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
    const ext = list?.find((e) => e.name === name);
    return ext?.icon || null;
  };

  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

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
    const reservedLower = [
      "watching",
      "plan to watch",
      "reading",
      "plan to read",
      "downloads",
    ];
    if (reservedLower.includes(trimmed.toLowerCase())) {
      swalError(
        "Reserved System Tag",
        `"${trimmed}" is a reserved system tag.`,
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
    const reservedLower = [
      "watching",
      "plan to watch",
      "reading",
      "plan to read",
      "downloads",
    ];
    if (reservedLower.includes(tagName.toLowerCase())) {
      swalError(
        "Cannot Delete Tag",
        `"${tagName}" is a system tag and cannot be deleted.`,
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
        setPreferredSubtitleLanguages(
          s.preferredSubtitleLanguages || ["English"],
        );
        setImageCacheSizeLimit(s.imageCacheSizeLimit || 5);
        setDeveloperMode(s.developerMode);
        setDownloadNotification(
          s.downloadNotification !== undefined ? s.downloadNotification : true,
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
        const presetVal = s.themePreset || "default";
        const accentVal = s.themeAccentColor || "#8b5cf6";
        const secVal = s.themeSecondaryColor || s.themeSubColor || "#3b82f6";
        const sidebarVal = s.themeSidebarColor || "#ec4899";
        const textVal = s.themeTextColor || "#f3f4f6";
        const bgVal = s.themeBgColor || "#0f0d19";

        setCatalogTitleFontSize(fontSizeVal);
        setCatalogTitleLines(linesVal);
        setCatalogColumns(columnsVal);
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

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const timer = setTimeout(() => {
      autoSaveSettings();
    }, 400);
    return () => clearTimeout(timer);
  }, [
    animeProvider,
    quality,
    mangaProvider,
    autoLoadNextChapter,
    pagination,
    malStatus,
    mergeSubtitles,
    subtitleFormat,
    preferredSubtitleLanguages,
    developerMode,
    downloadNotification,
    autoSkipIntro,
    mangaReaderLayout,
    mangaReaderWidth,
    catalogTitleFontSize,
    catalogTitleLines,
    catalogColumns,
    themePreset,
    themeAccentColor,
    themeSecondaryColor,
    themeSidebarColor,
    themeTextColor,
    themeBgColor,
    imageCacheSizeLimit,
  ]);

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
    if (
      JSON.stringify(preferredSubtitleLanguages) !==
      JSON.stringify(settings.preferredSubtitleLanguages || ["English"])
    )
      dirty.preferredSubtitleLanguages = preferredSubtitleLanguages;
    if (developerMode !== settings.developerMode)
      dirty.developerMode = developerMode;
    if (
      downloadNotification !==
      (settings.downloadNotification !== undefined
        ? settings.downloadNotification
        : true)
    )
      dirty.downloadNotification = downloadNotification;
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
      JSON.stringify(preferredSubtitleLanguages) !==
        JSON.stringify(settings.preferredSubtitleLanguages || ["English"]) ||
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
    animeProvider,
    quality,
    mangaProvider,
    autoLoadNextChapter,
    pagination,
    malStatus,
    mergeSubtitles,
    subtitleFormat,
    preferredSubtitleLanguages,
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
                  <div className="catalog-columns-picker">
                    {["auto", "2", "3", "4", "5", "6"].map((col) => (
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
                      max={5}
                      step={1}
                      value={catalogTitleLines}
                      onChange={(e) =>
                        handleCatalogTitleLinesChange(e.target.value)
                      }
                      className="settings-range-slider"
                    />
                    <span className="settings-slider-val">
                      {catalogTitleLines}
                    </span>
                  </div>
                </SettingsRow>

                {/* Live Preview Card Container */}
                <div className="catalog-preview-container">
                  <div className="catalog-preview-header">
                    Title size & layout live preview
                  </div>
                  <div
                    className="catalog-preview-grid"
                    style={{
                      gridTemplateColumns:
                        catalogColumns === "auto"
                          ? "repeat(auto-fill, minmax(105px, 1fr))"
                          : `repeat(${catalogColumns}, 1fr)`,
                    }}
                  >
                    {PREVIEW_SAMPLE_CARDS.map((card) => (
                      <div key={card.id} className="catalog-preview-card">
                        <div className="catalog-preview-img-box">
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
                          onClick={(e) => {
                            e.preventDefault();
                            if (
                              window.Capacitor &&
                              window.Capacitor.Plugins &&
                              window.Capacitor.Plugins.CloudflareBypass
                            ) {
                              window.Capacitor.Plugins.CloudflareBypass.openSystemBrowser(
                                { url },
                              ).catch((err) => {
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
                    const isReserved = [
                      "watching",
                      "plan to watch",
                      "reading",
                      "plan to read",
                      "downloads",
                    ].includes(tagName.toLowerCase());

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
                      <span>
                        Install Update v{updateProgress?.version || ""}
                      </span>
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
        onClick={(e) => {
          e.preventDefault();
          if (
            window.Capacitor &&
            window.Capacitor.Plugins &&
            window.Capacitor.Plugins.CloudflareBypass
          ) {
            window.Capacitor.Plugins.CloudflareBypass.openSystemBrowser({
              url,
            }).catch((err) => {
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

    lastIndex = linkRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}
