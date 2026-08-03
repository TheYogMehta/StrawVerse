/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, no-unused-vars */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Loader2,
  ArrowLeft,
  Download,
  Play,
  BookOpen,
  Trash2,
  CheckCircle,
  ExternalLink,
  ArrowUpDown,
  Search,
  X,
  Film,
  ChevronDown,
  Plus,
  FolderOpen,
} from "lucide-react";
import Swal from "sweetalert2";
import { swalSuccess, swalError, swalConfirm } from "../utils/swal";
import { apiPost } from "../utils/common";
import Dropdown from "./common/Dropdown";
import "./css/InfoView.css";

const getItemLangs = (item, details, dubSelect) => {
  let langs = [];
  if (Array.isArray(item.langs) && item.langs.length > 0) {
    langs = item.langs.map((l) => String(l).toLowerCase());
  } else if (item.lang) {
    if (item.lang === "both") {
      langs = ["sub", "dub"];
    } else {
      langs = [String(item.lang).toLowerCase()];
    }
  } else {
    const hasSub =
      item.hasSub !== undefined
        ? item.hasSub
        : details?.hasSub !== undefined
          ? details.hasSub
          : true;
    const hasDub =
      item.hasDub !== undefined
        ? item.hasDub
        : details?.hasDub ||
          details?.subOrDub === "both" ||
          details?.subOrDub === "dub";
    const hasHsub = item.hasHsub || details?.hasHsub;
    const hasSoftsub =
      item.hasSoftsub || item.hasSoftSub || details?.hasSoftsub;
    const hasSoftdub =
      item.hasSoftdub || item.hasSoftDub || details?.hasSoftdub;

    if (hasSub) langs.push("sub");
    if (hasDub) langs.push("dub");
    if (hasHsub) langs.push("hsub");
    if (hasSoftsub) langs.push("softsub");
    if (hasSoftdub) langs.push("softdub");

    if (langs.length === 0) {
      langs = ["sub"];
      if (
        details?.subOrDub === "both" ||
        details?.subOrDub === "dub" ||
        dubSelect === "dub"
      ) {
        langs.push("dub");
      }
    }
  }
  return [...new Set(langs)];
};

export default function InfoView({
  id: propId,
  type,
  localMalProvider: propLocalMalProvider,
  backText,
  autoPlay,
  sortOrder,
  setSortOrder,
  onBack,
  onWatch: propOnWatch,
  onRead: propOnRead,
  title: propTitle,
  onSearchFallback,
}) {
  const [id, setId] = useState(propId);
  const [localMalProvider, setLocalMalProvider] =
    useState(propLocalMalProvider);
  const [details, setDetails] = useState(null);

  const onWatch = async (...args) => {
    const isNotInLibrary =
      !currentTags || currentTags.length === 0 || !currentTags[0];
    if (isNotInLibrary) {
      await saveTags("Watching");
      triggerPulse();
    }

    if (window.Capacitor?.Plugins?.CloudflareBypass) {
      const animeId = args[0];
      const epIdOrNum = args[1];
      const isDownloaded = args[2];
      const subdub = args[3];
      const animeTitle = details?.title || "Anime Stream";
      const provider = details?.provider;

      const targetItem = (episodesOrChapters || []).find(
        (item) =>
          item.id === epIdOrNum || Number(item.number) === Number(epIdOrNum),
      );
      const finalEpNum = targetItem
        ? Number(targetItem.number)
        : typeof epIdOrNum === "number"
          ? epIdOrNum
          : parseFloat(epIdOrNum) || 0;

      console.log(
        "[NATIVE VIDEO PLAYBACK] Initiating native PlayerActivity from InfoView",
      );
      window.Capacitor.Plugins.CloudflareBypass.playVideo({
        animeId: animeId,
        episodeId:
          typeof epIdOrNum === "string"
            ? epIdOrNum
            : epIdOrNum !== undefined && epIdOrNum !== null
              ? String(epIdOrNum)
              : undefined,
        episodeNumber: finalEpNum,
        downloaded: !!isDownloaded,
        subdub: subdub || "sub",
        provider: provider,
        animeTitle: animeTitle,
        malid: String(details?.malid || details?.MalID || ""),
        image: details?.image || "",
        episodesList: JSON.stringify(episodesOrChapters || []),
      }).catch((err) => {
        console.error("Failed to start native player:", err);
      });
      return;
    }

    const newArgs = [...args];
    while (newArgs.length < 9) {
      newArgs.push(undefined);
    }
    newArgs[9] = details?.malid || details?.MalID;
    propOnWatch(...newArgs);
  };

  const onRead = async (...args) => {
    const isNotInLibrary =
      !currentTags || currentTags.length === 0 || !currentTags[0];
    if (isNotInLibrary) {
      await saveTags("Reading");
      triggerPulse();
    }
    const newArgs = [...args];
    while (newArgs.length < 8) {
      newArgs.push(undefined);
    }
    newArgs[8] = details?.malid;
    propOnRead(...newArgs);
  };

  const [loading, setLoading] = useState(true);
  const [episodesOrChapters, setEpisodesOrChapters] = useState([]);
  const [itemsPage, setItemsPage] = useState(1);
  const [itemsHasNext, setItemsHasNext] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [episodeSearchQuery, setEpisodeSearchQuery] = useState("");
  const [totalPages, setTotalPages] = useState(1);
  const [totalItemsCount, setTotalItemsCount] = useState(0);
  const [pendingPlayEpisodeNum, setPendingPlayEpisodeNum] = useState(null);
  const [detectedPageSize, setDetectedPageSize] = useState(30);

  const [selectedItems, setSelectedItems] = useState(new Set());
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [dubSelect, setDubSelect] = useState("sub");
  const [rangeInput, setRangeInput] = useState("");
  const [lastClickedId, setLastClickedId] = useState(null);
  const [isRangeInputInvalid, setIsRangeInputInvalid] = useState(false);

  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds === null) return "";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const pad = (n) => String(n).padStart(2, "0");
    if (h > 0) {
      return `${h}:${pad(m)}:${pad(s)}`;
    }
    return `${m}:${pad(s)}`;
  };

  const isDownloaded = (itemNum, subdub = null) => {
    const num = parseFloat(itemNum);
    if (isNaN(num)) return false;
    if (type === "Anime") {
      const episodes = details?.DownloadedEpisodes;
      if (Array.isArray(episodes)) {
        return episodes.map(Number).includes(num);
      }
      if (subdub && episodes?.[subdub]) {
        return episodes[subdub].map(Number).includes(num);
      }
      const list = [
        ...(episodes?.sub || []),
        ...(episodes?.dub || []),
        ...(episodes?.hsub || []),
      ];
      return list.map(Number).includes(num);
    } else {
      const list = details?.DownloadedChapters || [];
      return list.map(Number).includes(num);
    }
  };

  const isItemFullyDownloaded = (item) => {
    return isDownloaded(item.number);
  };

  const hasDownloads =
    type === "Anime"
      ? Array.isArray(details?.DownloadedEpisodes)
        ? details.DownloadedEpisodes.length > 0
        : (details?.DownloadedEpisodes?.sub?.length || 0) +
            (details?.DownloadedEpisodes?.dub?.length || 0) >
          0
      : details?.DownloadedChapters?.length > 0;

  // MAL Status Sync form states
  const [malSyncing, setMalSyncing] = useState(false);
  const [malStatus, setMalStatus] = useState("not_in_list");
  const [malWatched, setMalWatched] = useState(0);
  const [customTags, setCustomTags] = useState([]);
  const [currentTags, setCurrentTags] = useState([]);
  const [pulseDropdown, setPulseDropdown] = useState(false);

  const triggerPulse = () => {
    setPulseDropdown(true);
    setTimeout(() => setPulseDropdown(false), 1500);
  };

  const getMalStatusLabel = (status) => {
    const labels = {
      not_in_list: "Not In List",
      plan_to_watch: "Plan To Watch",
      watching: "Watching",
      completed: "Completed",
      on_hold: "On Hold",
      dropped: "Dropped",
      plan_to_read: "Plan To Read",
      reading: "Reading",
    };
    return (
      labels[status] ||
      status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    );
  };

  const malStatusOptions =
    type === "Anime"
      ? ["plan_to_watch", "watching", "completed", "on_hold", "dropped"]
      : ["plan_to_read", "reading", "completed", "on_hold", "dropped"];
  const [newTagInput, setNewTagInput] = useState("");

  // Inline MAL Search states
  const [malSearchQuery, setMalSearchQuery] = useState("");
  const [malSearchResults, setMalSearchResults] = useState(null);
  const [malSearchLoading, setMalSearchLoading] = useState(false);
  const [isLinkingMal, setIsLinkingMal] = useState(false);

  const [historyProgress, setHistoryProgress] = useState(null);
  const [hasProgress, setHasProgress] = useState(false);

  const [downloadsState, setDownloadsState] = useState({
    activeTask: null,
    queue: [],
  });

  useEffect(() => {
    let intervalId = null;
    const fetchDownloadsState = async () => {
      try {
        const res = await fetch("/downloads", { method: "POST" });
        const data = await res.json();
        let active = null;
        if (data.totalSegments && data.totalSegments > 0) {
          active = {
            caption: data.caption,
            totalSegments: data.totalSegments,
            currentSegments: data.currentSegments,
            epid: data.epid,
            id: data.id,
          };
        }
        setDownloadsState({
          activeTask: active,
          queue: data.queue || [],
        });
      } catch (err) {}
    };

    fetchDownloadsState();
    intervalId = setInterval(fetchDownloadsState, 1500);

    if (window.sharedStateAPI && window.sharedStateAPI.on) {
      window.sharedStateAPI.on("download-logger", (data) => {
        let active = null;
        if (data.totalSegments && data.totalSegments > 0) {
          active = {
            caption: data.caption,
            totalSegments: data.totalSegments,
            currentSegments: data.currentSegments,
            epid: data.epid,
            id: data.id,
          };
        }
        setDownloadsState({
          activeTask: active,
          queue: data.queue || [],
        });
      });
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const getItemQueueStatus = useCallback(
    (itemNum) => {
      const active = downloadsState.activeTask;
      const queueList = downloadsState.queue || [];

      if (active) {
        const activeNum = active.EpNum || active.episodeNumber;
        const activeTitle = active.Title || active.title;
        const matchesTitle =
          activeTitle &&
          details?.title &&
          activeTitle.trim().toLowerCase() ===
            details.title.trim().toLowerCase();
        const matchesId = active.id && id && String(active.id) === String(id);

        if (
          (matchesId || matchesTitle) &&
          Number(activeNum) === Number(itemNum)
        ) {
          const total = active.totalSegments || 1;
          const current = active.currentSegments || 0;
          const pct = Math.min(100, Math.floor((current / total) * 100));
          return { inProgress: true, pct, isQueued: false };
        }
      }

      const queuedItem = queueList.find((q) => {
        const qNum = q.EpNum || q.episodeNumber || q.number;
        const qTitle = q.Title || q.title;
        const matchesTitle =
          qTitle &&
          details?.title &&
          qTitle.trim().toLowerCase() === details.title.trim().toLowerCase();
        const matchesId = q.id && id && String(q.id) === String(id);

        return (matchesId || matchesTitle) && Number(qNum) === Number(itemNum);
      });

      if (queuedItem) {
        return { inProgress: true, pct: 0, isQueued: true };
      }

      return { inProgress: false, pct: 0, isQueued: false };
    },
    [downloadsState, id, details?.title],
  );

  // Custom dropdown states
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
  const providerDropdownRef = useRef(null);
  const [isMalStatusDropdownOpen, setIsMalStatusDropdownOpen] = useState(false);
  const malStatusDropdownRef = useRef(null);
  const [installedExtensions, setInstalledExtensions] = useState(null);
  const [sortDirection, setSortDirection] = useState(() =>
    sortOrder === "desc" ? "desc" : "asc",
  );

  useEffect(() => {
    if (sortOrder === "asc" || sortOrder === "desc") {
      setSortDirection(sortOrder);
    }
  }, [sortOrder]);

  const isItemWatched = useCallback(
    (item) => {
      const epStatus =
        type === "Anime"
          ? (historyProgress?.episodesStatus || []).find(
              (h) => Number(h.number) === Number(item.number),
            )
          : (historyProgress?.chaptersStatus || []).find(
              (h) => Number(h.number) === Number(item.number),
            );
      const isMalCompleted =
        malWatched && Number(item.number) <= Number(malWatched);
      return Boolean((epStatus && epStatus.isCompleted) || isMalCompleted);
    },
    [historyProgress, malWatched, type],
  );

  const watchedCount = useMemo(() => {
    if (!episodesOrChapters || episodesOrChapters.length === 0) return 0;
    return episodesOrChapters.filter((item) => isItemWatched(item)).length;
  }, [episodesOrChapters, isItemWatched]);

  const showWatchedSort =
    watchedCount > 0 && watchedCount < (episodesOrChapters?.length || 0);

  const sortedItems = useMemo(() => {
    if (sortOrder === "downloaded") {
      const allDownloadedNums =
        type === "Anime"
          ? Array.from(
              new Set(
                [
                  ...(details?.DownloadedEpisodes?.sub || []),
                  ...(details?.DownloadedEpisodes?.dub || []),
                ].map(Number),
              ),
            ).sort((a, b) => a - b)
          : Array.from(
              new Set((details?.DownloadedChapters || []).map(Number)),
            ).sort((a, b) => a - b);

      allDownloadedNums.sort((a, b) => a - b);

      return allDownloadedNums.map((num) => {
        const existingItem = episodesOrChapters.find(
          (item) => Number(item.number) === num,
        );
        if (existingItem) return existingItem;

        if (type === "Anime") {
          const subList = details?.DownloadedEpisodes?.sub || [];
          const dubList = details?.DownloadedEpisodes?.dub || [];
          const localLangs = [];
          if (subList.map(Number).includes(num)) localLangs.push("sub");
          if (dubList.map(Number).includes(num)) localLangs.push("dub");
          if (localLangs.length === 0) localLangs.push("sub");
          return {
            id: `local-ep-${num}`,
            number: String(num),
            title: `Episode ${num}`,
            hasDub: dubList.map(Number).includes(num),
            langs: localLangs,
          };
        } else {
          return {
            id: `local-ch-${num}`,
            number: String(num),
            title: `Chapter ${num}`,
          };
        }
      });
    }

    if (sortOrder === "watched") {
      const watchedList = episodesOrChapters.filter((item) =>
        isItemWatched(item),
      );
      return watchedList.sort((a, b) => {
        const numA = parseFloat(a.number) || 0;
        const numB = parseFloat(b.number) || 0;
        return sortDirection === "desc" ? numB - numA : numA - numB;
      });
    }

    if (sortOrder === "unwatched") {
      const unwatchedList = episodesOrChapters.filter(
        (item) => !isItemWatched(item),
      );
      return unwatchedList.sort((a, b) => {
        const numA = parseFloat(a.number) || 0;
        const numB = parseFloat(b.number) || 0;
        return sortDirection === "desc" ? numB - numA : numA - numB;
      });
    }

    return [...episodesOrChapters].sort((a, b) => {
      const numA = parseFloat(a.number) || 0;
      const numB = parseFloat(b.number) || 0;
      return sortOrder === "asc" ? numA - numB : numB - numA;
    });
  }, [
    episodesOrChapters,
    sortOrder,
    sortDirection,
    details?.DownloadedEpisodes,
    details?.DownloadedChapters,
    dubSelect,
    isItemWatched,
  ]);

  const filteredItems = useMemo(() => {
    if (!episodeSearchQuery.trim()) return sortedItems;
    const query = episodeSearchQuery.toLowerCase().trim();
    return sortedItems.filter((item) => {
      const numStr = String(item.number || "");
      const titleStr = String(item.title || "").toLowerCase();
      return numStr.includes(query) || titleStr.includes(query);
    });
  }, [sortedItems, episodeSearchQuery]);

  useEffect(() => {
    if (window.sharedStateAPI && window.sharedStateAPI.getSettings) {
      window.sharedStateAPI
        .getSettings(["installedExtensions"])
        .then((settingsData) => {
          setInstalledExtensions(
            settingsData.settings?.installedExtensions || null,
          );
        })
        .catch((err) =>
          console.error("Failed to load extensions for icons:", err),
        );
    }
  }, []);

  const getProviderIcon = (name) => {
    if (!name || !installedExtensions) return null;
    const list = installedExtensions[type];
    const ext = list?.find((e) => e.name === name);
    return ext?.icon || null;
  };

  const hasAutoPlayed = useRef(false);
  const lastFetchedKeyRef = useRef(null);

  const fetchDetails = async (isInitial = false) => {
    if (isInitial) {
      setLoading(true);
    }
    try {
      const currentKey = `${id}_${type}_${localMalProvider}`;
      lastFetchedKeyRef.current = currentKey;

      const response = await fetch(`/api/info/${type}/${localMalProvider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      setDetails(data);
      if (data && data.id) {
        if (data.id !== id) {
          setId(data.id);
        }
      }
      if (data && data.provider && data.provider !== localMalProvider) {
        lastFetchedKeyRef.current = `${id}_${type}_${data.provider}`;
        setLocalMalProvider(data.provider);
      }

      if (isInitial) {
        let savedSort = null;
        if (window.sharedStateAPI && window.sharedStateAPI.getSettings) {
          try {
            const res = await window.sharedStateAPI.getSettings([
              "infoSortOrder",
            ]);
            savedSort = res?.settings?.infoSortOrder;
          } catch (_) {}
        }
        if (
          savedSort &&
          (savedSort === "asc" ||
            savedSort === "desc" ||
            savedSort === "downloaded")
        ) {
          setSortOrder(savedSort);
        } else {
          const isAnimePahe =
            data?.provider?.toLowerCase() === "animepahe" ||
            data?.provider?.toLowerCase() === "pahe";
          if (isAnimePahe) {
            setSortOrder("desc");
          } else {
            setSortOrder("asc");
          }
        }
      }

      if (data?.watched !== undefined) setMalWatched(data.watched);
      setMalStatus(data?.malStatus || "not_in_list");

      if (data?.MalLoggedIn && !data?.malid && data?.title) {
        setMalSearchQuery(data.title);
      }

      // Parse CustomTag JSON array
      let parsedTags = [];
      if (data?.CustomTag) {
        try {
          const parsed = JSON.parse(data.CustomTag);
          if (Array.isArray(parsed)) {
            parsedTags = parsed;
          } else if (typeof parsed === "string" && parsed) {
            parsedTags = [parsed];
          }
        } catch (e) {
          if (typeof data.CustomTag === "string" && data.CustomTag) {
            parsedTags = [data.CustomTag];
          }
        }
      }
      setCurrentTags(parsedTags);

      // Fetch custom tags
      const tagsRes = await fetch(`/api/local/tags/view/${type}`);
      const tagsData = await tagsRes.json();
      setCustomTags(tagsData);

      // Fetch history progress
      try {
        await fetchHistoryProgress();
      } catch (err) {
        console.error("Failed to fetch history progress:", err);
      }

      // Load first page of episodes/chapters
      await fetchItems(isInitial ? 1 : itemsPage, data?.provider, data);
    } catch (err) {
      console.error(err);
    } finally {
      if (isInitial) {
        setLoading(false);
      }
    }
  };

  const fetchItems = async (
    page = 1,
    providerName = details?.provider,
    fetchedDetails = details,
    append = false,
  ) => {
    setItemsLoading(true);
    try {
      const isAnime = type === "Anime";
      const response = await fetch("/api/info/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: isAnime ? fetchedDetails?.dataId || id : id,
          page: page,
          provider: providerName || fetchedDetails?.provider || "local source",
          type: type,
        }),
      });
      const data = await response.json();

      if (data?.DownloadedEpisodes || data?.DownloadedChapters) {
        setDetails((prev) => ({
          ...prev,
          DownloadedEpisodes:
            data.DownloadedEpisodes || prev?.DownloadedEpisodes,
          DownloadedChapters:
            data.DownloadedChapters || prev?.DownloadedChapters,
        }));
      }

      const resList = isAnime ? data?.episodes : data?.Chapters;

      if (resList && resList.length > 0) {
        if (append) {
          setEpisodesOrChapters((prev) => [...prev, ...resList]);
        } else {
          setEpisodesOrChapters(resList);
        }
        const hasNext = !!(
          data.hasNextPage ||
          (data.totalPages && data.currentPage
            ? data.currentPage < data.totalPages
            : false)
        );
        setItemsHasNext(hasNext);
        setItemsPage(page);
        if (data.totalPages) {
          setTotalPages(data.totalPages);
        } else {
          setTotalPages(1);
        }
        if (data.total) {
          setTotalItemsCount(data.total);
        } else if (data.totalItems) {
          setTotalItemsCount(data.totalItems);
        } else {
          setTotalItemsCount(resList.length);
        }
        if (hasNext && resList.length > 0) {
          setDetectedPageSize(resList.length);
        }
      } else {
        fallbackToDownloaded(fetchedDetails);
        setTotalPages(1);
      }
    } catch (err) {
      console.error(err);
      fallbackToDownloaded(fetchedDetails);
    } finally {
      setItemsLoading(false);
    }
  };

  const fallbackToDownloaded = (targetDetails = details) => {
    if (type === "Anime") {
      const dl = targetDetails?.DownloadedEpisodes;
      const subList = Array.isArray(dl) ? dl : dl?.sub || [];
      const dubList = Array.isArray(dl) ? dl : dl?.dub || [];
      const allNums = Array.from(new Set([...subList, ...dubList]))
        .map(Number)
        .sort((a, b) => a - b);
      if (allNums.length > 0) {
        const localEps = allNums.map((num) => ({
          id: `local-ep-${num}`,
          number: num,
          title: `Episode ${num}`,
          hasDub: dubList.includes(num),
        }));
        setEpisodesOrChapters(localEps);
        setItemsHasNext(false);
        setTotalItemsCount(allNums.length);
      } else {
        setEpisodesOrChapters([]);
        setItemsHasNext(false);
        setTotalItemsCount(0);
      }
    } else {
      const chList = targetDetails?.DownloadedChapters || [];
      const allNums = [...chList].sort((a, b) => a - b);
      if (allNums.length > 0) {
        const localChs = allNums.map((num) => ({
          id: `local-ch-${num}`,
          number: num,
          title: `Chapter ${num}`,
        }));
        setEpisodesOrChapters(localChs);
        setItemsHasNext(false);
        setTotalItemsCount(allNums.length);
      } else {
        setEpisodesOrChapters([]);
        setItemsHasNext(false);
        setTotalItemsCount(0);
      }
    }
  };

  const getEpsPerPage = () => {
    const isAnimePahe =
      details?.provider?.toLowerCase() === "animepahe" ||
      details?.provider?.toLowerCase() === "pahe";
    if (isAnimePahe) {
      return detectedPageSize;
    }
    return 30;
  };

  const playItem = (targetItem) => {
    if (type === "Anime") {
      const dl = details?.DownloadedEpisodes;
      const isDownloadedLocal = Array.isArray(dl)
        ? dl.map(Number).includes(Number(targetItem.number))
        : dubSelect === "dub"
          ? (dl?.dub || []).map(Number).includes(Number(targetItem.number))
          : (dl?.sub || []).map(Number).includes(Number(targetItem.number));

      onWatch(
        id,
        isDownloadedLocal ? targetItem.number : targetItem.id,
        isDownloadedLocal,
        dubSelect,
        episodesOrChapters,
        details?.DownloadedEpisodes,
        details?.title,
        details?.provider,
        details?.image,
      );
    } else {
      const isDownloadedLocal = (details?.DownloadedChapters || [])
        .map(Number)
        .includes(Number(targetItem.number));

      onRead(
        id,
        isDownloadedLocal ? targetItem.number : targetItem.id,
        isDownloadedLocal,
        episodesOrChapters,
        details?.DownloadedChapters,
        details?.title,
        details?.provider,
        details?.image,
      );
    }
  };

  const fetchHistoryProgress = useCallback(async () => {
    if (!id || !type) return;
    try {
      const progressRes = await fetch(
        `/api/history/progress?mediaId=${encodeURIComponent(id)}&type=${type}`,
      );
      if (progressRes.ok) {
        const progressData = await progressRes.json();
        setHasProgress(progressData.hasProgress || false);
        setHistoryProgress(progressData);
      }
    } catch (err) {
      console.error("Failed to fetch history progress:", err);
    }
  }, [id, type]);

  useEffect(() => {
    fetchHistoryProgress();
    window.refreshInfoViewProgress = fetchHistoryProgress;

    const handleFocus = () => fetchHistoryProgress();
    const handleVisibility = () => {
      if (!document.hidden) fetchHistoryProgress();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    const timer = setInterval(fetchHistoryProgress, 3000);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(timer);
      if (window.refreshInfoViewProgress === fetchHistoryProgress) {
        delete window.refreshInfoViewProgress;
      }
    };
  }, [fetchHistoryProgress]);

  useEffect(() => {
    setId(propId);
    setLocalMalProvider(propLocalMalProvider);
    hasAutoPlayed.current = false;
  }, [propId, propLocalMalProvider]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
      if (
        providerDropdownRef.current &&
        !providerDropdownRef.current.contains(event.target)
      ) {
        setIsProviderDropdownOpen(false);
      }
      if (
        malStatusDropdownRef.current &&
        !malStatusDropdownRef.current.contains(event.target)
      ) {
        setIsMalStatusDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const currentKey = `${id}_${type}_${localMalProvider}`;
    if (lastFetchedKeyRef.current === currentKey) {
      return;
    }
    fetchDetails(true);
  }, [id, type, localMalProvider]);

  useEffect(() => {
    if (window.sharedStateAPI && window.sharedStateAPI.on) {
      const handleDownloadComplete = (data) => {
        if (data.Type !== type) return;

        setDetails((prevDetails) => {
          if (!prevDetails) return prevDetails;

          if (data.id === id || data.id === prevDetails.id) {
            const epNum = parseFloat(data.EpNum);
            if (isNaN(epNum)) return prevDetails;

            const updated = { ...prevDetails };
            if (type === "Anime") {
              const subdub = data.SubDub || "sub";
              const currentList = updated.DownloadedEpisodes?.[subdub] || [];
              if (!currentList.includes(epNum)) {
                updated.DownloadedEpisodes = {
                  ...updated.DownloadedEpisodes,
                  [subdub]: [...currentList, epNum].sort((a, b) => a - b),
                };
              }
            } else {
              const currentList = updated.DownloadedChapters || [];
              if (!currentList.includes(epNum)) {
                updated.DownloadedChapters = [...currentList, epNum].sort(
                  (a, b) => a - b,
                );
              }
            }
            return updated;
          }
          return prevDetails;
        });
      };

      const unsubscribe = window.sharedStateAPI.on(
        "download-complete",
        handleDownloadComplete,
      );
      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
  }, [id, type]);

  // Reset selection when switching dubSelect
  useEffect(() => {
    setSelectedItems(new Set());
  }, [dubSelect]);

  useEffect(() => {
    if (pendingPlayEpisodeNum && !itemsLoading) {
      const targetItem = episodesOrChapters.find(
        (item) => Number(item.number) === Number(pendingPlayEpisodeNum),
      );
      if (targetItem) {
        setPendingPlayEpisodeNum(null);
        playItem(targetItem);
      } else {
        setPendingPlayEpisodeNum(null);
      }
    }
  }, [episodesOrChapters, pendingPlayEpisodeNum, itemsLoading]);

  // Debounced search page auto-navigation
  useEffect(() => {
    const timer = setTimeout(() => {
      const num = parseInt(episodeSearchQuery);
      if (!isNaN(num) && num > 0) {
        const isAnimePahe =
          details?.provider?.toLowerCase() === "animepahe" ||
          details?.provider?.toLowerCase() === "pahe";
        if (isAnimePahe && totalPages > 1 && totalItemsCount > 0) {
          const epsPerPage = getEpsPerPage();
          const targetPage =
            1 + Math.floor((totalItemsCount - num) / epsPerPage);
          const safePage = Math.max(1, Math.min(totalPages, targetPage));
          if (safePage !== itemsPage) {
            fetchItems(safePage);
          }
        }
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [
    episodeSearchQuery,
    totalPages,
    totalItemsCount,
    details,
    detectedPageSize,
    itemsPage,
  ]);

  // Calculate next episode/chapter number and progress
  const maxEpNumber =
    episodesOrChapters.length > 0
      ? Math.max(...episodesOrChapters.map((item) => Number(item.number) || 0))
      : 0;

  const hasAnyDownloads = useMemo(() => {
    if (!details) return false;
    if (type === "Anime") {
      const dl = details.DownloadedEpisodes;
      if (Array.isArray(dl)) return dl.length > 0;
      const subList = dl?.sub || [];
      const dubList = dl?.dub || [];
      return subList.length > 0 || dubList.length > 0;
    } else {
      const chList = details.DownloadedChapters || [];
      return chList.length > 0;
    }
  }, [details, type]);

  const localNext =
    historyProgress?.suggestedNumber ||
    historyProgress?.lastProgress?.number ||
    0;
  const malNext = details?.malid && malWatched ? Number(malWatched) + 1 : 0;

  let nextToPlay = 1;
  let hasAnyProgress = false;
  if (localNext > 0 || malNext > 0) {
    hasAnyProgress = true;
    nextToPlay = Math.max(localNext, malNext);
  }

  const isFinished =
    hasAnyProgress && maxEpNumber > 0 && nextToPlay > maxEpNumber;

  // Bulk Selection Helper
  const handleSelectToggle = (itemNum) => {
    const nextSelected = new Set(selectedItems);
    const num = Number(itemNum);
    if (nextSelected.has(num)) {
      nextSelected.delete(num);
    } else {
      nextSelected.add(num);
    }
    setSelectedItems(nextSelected);
  };

  const isNumberInRange = (num, rangeStr) => {
    const parts = rangeStr.split(",");
    for (let part of parts) {
      part = part.trim();
      if (!part) continue;
      if (part.includes("-")) {
        const [startStr, endStr] = part.split("-");
        const start = parseFloat(startStr);
        const end = parseFloat(endStr);
        if (!isNaN(start) && !isNaN(end)) {
          const min = Math.min(start, end);
          const max = Math.max(start, end);
          if (num >= min && num <= max) return true;
        }
      } else {
        const single = parseFloat(part);
        if (!isNaN(single) && num === single) return true;
      }
    }
    return false;
  };

  const validateRangeInput = (str) => {
    if (!str.trim()) return true;
    const parts = str.split(",");
    const partRegex = /^\s*\d+(?:\.\d+)?\s*(?:-\s*\d+(?:\.\d+)?\s*)?$/;
    return parts.every((part) => {
      const trimmed = part.trim();
      if (!trimmed) return false;
      return partRegex.test(trimmed);
    });
  };

  const handleSelectRange = (rangeStr, isSelect = true) => {
    if (!rangeStr.trim() || !validateRangeInput(rangeStr)) return;
    const nextSelected = new Set(selectedItems);

    const parts = rangeStr.split(",");
    for (let part of parts) {
      part = part.trim();
      if (!part) continue;
      if (part.includes("-")) {
        const [startStr, endStr] = part.split("-");
        const start = parseFloat(startStr);
        const end = parseFloat(endStr);
        if (!isNaN(start) && !isNaN(end)) {
          const min = Math.min(start, end);
          const max = Math.max(start, end);
          for (let i = Math.ceil(min); i <= Math.floor(max); i++) {
            if (isSelect) {
              nextSelected.add(i);
            } else {
              nextSelected.delete(i);
            }
          }
          if (isSelect) {
            nextSelected.add(start);
            nextSelected.add(end);
          } else {
            nextSelected.delete(start);
            nextSelected.delete(end);
          }
        }
      } else {
        const single = parseFloat(part);
        if (!isNaN(single)) {
          if (isSelect) {
            nextSelected.add(single);
          } else {
            nextSelected.delete(single);
          }
        }
      }
    }

    episodesOrChapters.forEach((item) => {
      if (!isItemUnavailable(item)) {
        const num = parseFloat(item.number);
        if (!isNaN(num) && isNumberInRange(num, rangeStr)) {
          if (isSelect) {
            nextSelected.add(num);
          } else {
            nextSelected.delete(num);
          }
        }
      }
    });

    setSelectedItems(nextSelected);
  };

  const handleItemClick = (e, item) => {
    if (isItemUnavailable(item)) return;

    if (
      e.target.closest("button") ||
      e.target.closest("select") ||
      e.target.closest("a")
    ) {
      return;
    }

    if (e.shiftKey) {
      return;
    }

    const nextSelected = new Set(selectedItems);
    const visibleNumbers = filteredItems.map((x) => Number(x.number));
    const currentNum = Number(item.number);
    const currentIndex = visibleNumbers.indexOf(currentNum);

    const isCtrl = e.ctrlKey || e.metaKey;

    if (isCtrl && lastClickedId !== null) {
      const lastIndex = visibleNumbers.indexOf(lastClickedId);
      if (lastIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);

        for (let i = start; i <= end; i++) {
          const targetItem = filteredItems[i];
          if (!isItemUnavailable(targetItem)) {
            nextSelected.add(Number(targetItem.number));
          }
        }
      }
    } else {
      if (nextSelected.has(currentNum)) {
        nextSelected.delete(currentNum);
      } else {
        nextSelected.add(currentNum);
      }
      setLastClickedId(currentNum);
    }
    setSelectedItems(nextSelected);
  };

  const handleSelectAll = () => {
    const nextSelected = new Set(selectedItems);
    const allSelected =
      selectableItems.length > 0 &&
      selectableItems.every((item) => selectedItems.has(Number(item.number)));

    if (allSelected) {
      selectableItems.forEach((item) => {
        nextSelected.delete(Number(item.number));
      });
    } else {
      selectableItems.forEach((item) => {
        nextSelected.add(Number(item.number));
      });
    }
    setSelectedItems(nextSelected);
  };

  const handleContinueWatchRead = async () => {
    const targetNum = isFinished ? 1 : nextToPlay;
    const sorted = [...episodesOrChapters].sort(
      (a, b) => Number(a.number) - Number(b.number),
    );
    let targetItem = sorted.find(
      (item) => Number(item.number) === Number(targetNum),
    );

    if (targetItem) {
      playItem(targetItem);
    } else {
      const isAnimePahe =
        details?.provider?.toLowerCase() === "animepahe" ||
        details?.provider?.toLowerCase() === "pahe";
      if (isAnimePahe && totalPages > 1 && totalItemsCount > 0) {
        const epsPerPage = getEpsPerPage();
        const targetPage =
          1 + Math.floor((totalItemsCount - targetNum) / epsPerPage);
        const safePage = Math.max(1, Math.min(totalPages, targetPage));
        setPendingPlayEpisodeNum(targetNum);
        await fetchItems(safePage);
      } else if (sorted.length > 0) {
        playItem(sorted[0]);
      }
    }
  };

  useEffect(() => {
    if (autoPlay && !loading && !itemsLoading && !hasAutoPlayed.current) {
      hasAutoPlayed.current = true;
      handleContinueWatchRead();
    }
  }, [autoPlay, loading, itemsLoading]);

  const handleStartFromBegin = () => {
    const sorted = [...episodesOrChapters].sort(
      (a, b) => Number(a.number) - Number(b.number),
    );
    if (sorted.length > 0) {
      const targetItem = sorted[0];
      if (type === "Anime") {
        const dl = details?.DownloadedEpisodes;
        const isDownloadedLocal = Array.isArray(dl)
          ? dl.map(Number).includes(Number(targetItem.number))
          : dubSelect === "dub"
            ? (dl?.dub || []).map(Number).includes(Number(targetItem.number))
            : (dl?.sub || []).map(Number).includes(Number(targetItem.number));

        onWatch(
          id,
          isDownloadedLocal ? targetItem.number : targetItem.id,
          isDownloadedLocal,
          dubSelect,
          episodesOrChapters,
          details?.DownloadedEpisodes,
          details?.title,
          details?.provider,
          details?.image,
        );
      } else {
        const isDownloadedLocal = (details?.DownloadedChapters || [])
          .map(Number)
          .includes(Number(targetItem.number));

        onRead(
          id,
          isDownloadedLocal ? targetItem.number : targetItem.id,
          isDownloadedLocal,
          episodesOrChapters,
          details?.DownloadedChapters,
          details?.title,
          details?.provider,
          details?.image,
        );
      }
    }
  };

  const handleWatchReadLatest = () => {
    const sorted = [...episodesOrChapters].sort(
      (a, b) => Number(a.number) - Number(b.number),
    );
    if (sorted.length > 0) {
      const targetItem = sorted[sorted.length - 1];
      if (type === "Anime") {
        const dl = details?.DownloadedEpisodes;
        const isDownloadedLocal = Array.isArray(dl)
          ? dl.map(Number).includes(Number(targetItem.number))
          : dubSelect === "dub"
            ? (dl?.dub || []).map(Number).includes(Number(targetItem.number))
            : (dl?.sub || []).map(Number).includes(Number(targetItem.number));

        onWatch(
          id,
          isDownloadedLocal ? targetItem.number : targetItem.id,
          isDownloadedLocal,
          dubSelect,
          episodesOrChapters,
          details?.DownloadedEpisodes,
          details?.title,
          details?.provider,
          details?.image,
        );
      } else {
        const isDownloadedLocal = (details?.DownloadedChapters || [])
          .map(Number)
          .includes(Number(targetItem.number));

        onRead(
          id,
          isDownloadedLocal ? targetItem.number : targetItem.id,
          isDownloadedLocal,
          episodesOrChapters,
          details?.DownloadedChapters,
          details?.title,
          details?.provider,
          details?.image,
        );
      }
    }
  };

  // Download Trigger
  const handleDownload = async (singleItem = null) => {
    try {
      const isAnime = type === "Anime";
      const singleMulti = singleItem ? "Single" : "Multi";
      const endpoint = `/api/download/${type}/${singleMulti}`;

      let chosenLang = null;

      if (isAnime) {
        const targetEpisodes = singleItem
          ? [singleItem]
          : episodesOrChapters.filter((item) =>
              selectedItems.has(Number(item.number)),
            );

        let hasSub = false;
        let hasDub = false;
        let hasHsub = false;

        targetEpisodes.forEach((ep) => {
          const langs =
            ep.langs && Array.isArray(ep.langs) && ep.langs.length > 0
              ? ep.langs
              : ["sub"];

          if (langs.includes("sub")) hasSub = true;
          if (langs.includes("dub")) hasDub = true;
          if (langs.includes("hsub")) hasHsub = true;
        });

        const availableLangs = [];
        if (hasSub) availableLangs.push("sub");
        if (hasDub) availableLangs.push("dub");
        if (hasHsub) availableLangs.push("hsub");

        if (availableLangs.length > 1) {
          const inputOptions = {};
          if (hasSub) inputOptions.sub = "SUB";
          if (hasDub) inputOptions.dub = "DUB";
          if (hasHsub) inputOptions.hsub = "Hardsub (HSUB)";

          const result = await Swal.fire({
            title: "Select Version",
            html: `
              <style>
                .swal2-html-container {
                  overflow: visible !important;
                  z-index: 20 !important;
                  position: relative !important;
                }
                .swal2-popup {
                  overflow: visible !important;
                }
                .swal2-actions {
                  z-index: 10 !important;
                  position: relative !important;
                }
                #swal-version-menu {
                  border: 1px solid var(--border);
                  border-radius: 8px;
                  background: var(--bg-secondary);
                  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
                }
              </style>
              <div style="margin-bottom: 16px; font-size: 14px; color: var(--text-muted); line-height: 1.5; text-align: center;">
                ${
                  singleItem
                    ? `Choose the language version to download for Episode <strong>${singleItem.number}</strong>:`
                    : `Choose the language version to download for the <strong>${targetEpisodes.length}</strong> selected episodes:`
                }
              </div>
              <div class="input-group" style="position: relative; width: 100%; text-align: left; box-sizing: border-box;">
                <div class="custom-dropdown-trigger" id="swal-version-trigger" style="display: flex; align-items: center; justify-content: space-between; min-height: 38px;">
                  <span class="custom-dropdown-trigger-text" id="swal-version-text" style="color: var(--text-muted);">Select version</span>
                  <svg class="custom-dropdown-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div class="custom-dropdown-menu" id="swal-version-menu" style="display: none; position: absolute; top: calc(100% + 4px); left: 0; width: 100%; box-sizing: border-box; z-index: 9999;">
                  ${Object.entries(inputOptions)
                    .map(
                      ([key, label]) => `
                    <div class="custom-dropdown-item" data-value="${key}" style="display: flex; align-items: center; padding: 8px 12px; cursor: pointer;">
                      ${label}
                    </div>
                  `,
                    )
                    .join("")}
                </div>
              </div>
            `,
            showCancelButton: true,
            confirmButtonText: "Confirm",
            cancelButtonText: "Cancel",
            background: "var(--bg-secondary)",
            color: "var(--text-main)",
            confirmButtonColor: "var(--accent)",
            cancelButtonColor: "var(--bg-tertiary)",
            didOpen: () => {
              const trigger = Swal.getHtmlContainer().querySelector(
                "#swal-version-trigger",
              );
              const menu =
                Swal.getHtmlContainer().querySelector("#swal-version-menu");
              const items = Swal.getHtmlContainer().querySelectorAll(
                ".custom-dropdown-item",
              );
              const textSpan =
                Swal.getHtmlContainer().querySelector("#swal-version-text");

              let selectedVal = "";

              const handleOutsideClick = (e) => {
                if (!trigger.contains(e.target) && !menu.contains(e.target)) {
                  trigger.classList.remove("open");
                  menu.style.display = "none";
                }
              };

              trigger.addEventListener("click", (e) => {
                e.stopPropagation();
                const isOpen = trigger.classList.contains("open");
                if (isOpen) {
                  trigger.classList.remove("open");
                  menu.style.display = "none";
                  document.removeEventListener("click", handleOutsideClick);
                } else {
                  trigger.classList.add("open");
                  menu.style.display = "block";
                  document.addEventListener("click", handleOutsideClick);
                }
              });

              items.forEach((item) => {
                item.addEventListener("click", (e) => {
                  e.stopPropagation();
                  selectedVal = item.getAttribute("data-value");
                  textSpan.textContent = item.textContent.trim();
                  textSpan.style.color = "white";

                  items.forEach((i) => i.classList.remove("selected"));
                  item.classList.add("selected");

                  trigger.classList.remove("open");
                  menu.style.display = "none";
                  document.removeEventListener("click", handleOutsideClick);

                  trigger.setAttribute("data-selected-value", selectedVal);
                  Swal.resetValidationMessage();
                });
              });
            },
            preConfirm: () => {
              const trigger = Swal.getHtmlContainer().querySelector(
                "#swal-version-trigger",
              );
              const selectedValue = trigger.getAttribute("data-selected-value");
              if (!selectedValue) {
                Swal.showValidationMessage("Please select a version");
                return false;
              }
              return selectedValue;
            },
          });

          if (!result.value) {
            return; // user cancelled
          }
          chosenLang = result.value;
        } else if (availableLangs.length === 1) {
          chosenLang = availableLangs[0];
        } else {
          chosenLang = "sub";
        }
      }

      let bodyData = {};
      if (singleItem) {
        bodyData = {
          id: id,
          ep: { id: singleItem.id, number: singleItem.number },
          Title: details?.title,
          number: singleItem.number,
          provider: details?.provider,
          malid: details?.malid || details?.MalID,
          ...(isAnime ? { subdub: chosenLang } : {}),
        };
      } else {
        const itemsToDownload = [];
        selectedItems.forEach((num) => {
          const loadedItem = episodesOrChapters.find(
            (item) => Number(item.number) === num,
          );
          if (loadedItem) {
            if (
              !isItemFullyDownloaded(loadedItem) &&
              !isItemUnavailable(loadedItem)
            ) {
              itemsToDownload.push({
                id: loadedItem.id,
                number: loadedItem.number,
              });
            }
          } else {
            itemsToDownload.push({ id: null, number: num });
          }
        });
        bodyData = {
          id: id,
          [isAnime ? "Episodes" : "Chapters"]: itemsToDownload,
          Title: details?.title,
          provider: details?.provider,
          malid: details?.malid || details?.MalID,
          ...(isAnime ? { SubDub: chosenLang } : {}),
        };
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyData),
      });
      const data = await response.json();

      if (!data.error) {
        const isNotInLibrary =
          !currentTags || currentTags.length === 0 || !currentTags[0];
        if (isNotInLibrary) {
          await saveTags("Downloads", false);
          triggerPulse();
        }
      }

      swalSuccess("Queue Updated", data.message || "Added to download queue!");
      setSelectedItems(new Set());
    } catch (err) {
      console.error(err);
      swalError("Error", "Failed to add to download queue.");
    }
  };

  // MAL Status sync
  const handleMalSync = async () => {
    if (!details?.malid) return;
    if (malStatus === "not_in_list") {
      swalInfo(
        "Status Required",
        "Please select a watch status (e.g., Watching, Plan to Watch) to add this title to MyAnimeList.",
      );
      return;
    }
    setMalSyncing(true);
    try {
      const data = await apiPost("/api/mal/update", {
        malid: details.malid,
        episodes: malWatched,
        status: malStatus,
        type: type,
      });
      swalSuccess(
        "MAL Synced",
        data.text || data.title || "Updated MyAnimeList successfully!",
      );
    } catch (err) {
      console.error(err);
      swalError("Sync Failed", "MAL update failed.");
    } finally {
      setMalSyncing(false);
    }
  };

  const handleMalRemove = async () => {
    if (!details?.malid) return;

    const result = await swalConfirm(
      "Remove from MyAnimeList?",
      "Are you sure you want to remove this title from your MyAnimeList list?",
      "Yes, Remove",
    );

    if (!result.isConfirmed) return;

    setMalSyncing(true);
    try {
      const data = await apiPost("/api/mal/remove", {
        malid: details.malid,
        type: type,
      });

      if (data.icon === "success") {
        setMalStatus("not_in_list");
        swalSuccess(
          "Removed",
          data.title || "Successfully removed from MyAnimeList!",
        );
      } else {
        swalError("Failed", data.text || "Failed to remove entry.");
      }
    } catch (err) {
      console.error(err);
      swalError("Remove Failed", "MyAnimeList removal request failed.");
    } finally {
      setMalSyncing(false);
    }
  };

  const handleSetSingleTag = async (tagText) => {
    const trimmed = tagText ? tagText.trim() : "";
    await saveTags(trimmed);
  };

  const handleCreateCustomTag = async () => {
    const { value: customTagName } = await Swal.fire({
      title: "Create Custom Tag",
      input: "text",
      inputPlaceholder: "Enter tag name...",
      showCancelButton: true,
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      confirmButtonColor: "var(--accent)",
      cancelButtonColor: "var(--bg-tertiary)",
    });
    if (customTagName) {
      const trimmed = customTagName.trim();
      if (trimmed) {
        handleSetSingleTag(trimmed);
      }
    }
  };

  const saveTags = async (updatedTag, showSwal = true) => {
    try {
      const activeProvider =
        details?.provider &&
        details.provider !== "provider" &&
        details.provider !== "local source"
          ? details.provider
          : localMalProvider !== "provider" && localMalProvider !== "local"
            ? localMalProvider
            : undefined;

      const response = await fetch("/api/local/tags/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: type,
          id: details?.id || id,
          provider: activeProvider,
          MalID: details?.malid || details?.MalID,
          CustomTag: updatedTag,
        }),
      });
      const data = await response.json();
      if (!data.error) {
        if (window.catalogCache) {
          delete window.catalogCache[`Anime_local`];
          delete window.catalogCache[`Manga_local`];
        }
        setCurrentTags(updatedTag ? [updatedTag] : []);

        // Refresh custom tag list
        fetch(`/api/local/tags/view/${type}`)
          .then((res) => res.json())
          .then((tags) => setCustomTags(tags))
          .catch((err) => console.error(err));

        if (showSwal) {
          Swal.fire({
            title: "Library Updated",
            text: updatedTag
              ? `Status set to "${updatedTag}"`
              : "Removed from Library",
            icon: "success",
            toast: true,
            position: "top-end",
            showConfirmButton: false,
            timer: 2000,
            background: "var(--bg-secondary)",
            color: "var(--text-main)",
          });
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const startMalLink = () => {
    setIsLinkingMal(true);
    const initialQuery = details?.title || "";
    setMalSearchQuery(initialQuery);
    if (initialQuery) {
      performMalSearch(initialQuery);
    }
  };

  const performMalSearch = async (query) => {
    if (!query) return;
    setMalSearchLoading(true);
    try {
      const searchType = type === "Anime" ? "anime" : "manga";
      const response = await fetch(
        `/api/mal/search?query=${encodeURIComponent(query)}&type=${searchType}`,
      );
      const malResults = await response.json();
      setMalSearchResults(malResults);
    } catch (err) {
      console.error(err);
      setMalSearchResults([]);
    } finally {
      setMalSearchLoading(false);
    }
  };

  const updateLinkedState = async (newMalId) => {
    try {
      const response = await fetch(`/api/info/${type}/${localMalProvider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      setDetails(data);
      if (data?.malid) {
        setMalWatched(data.watched !== undefined ? data.watched : 0);
        setMalStatus(data.malStatus || "not_in_list");
      } else {
        setMalWatched(0);
        setMalStatus("not_in_list");
      }
    } catch (err) {
      console.error(err);
      setDetails((prev) => ({ ...prev, malid: newMalId }));
      if (!newMalId) {
        setMalWatched(0);
        setMalStatus("");
      }
    }
  };

  const handleProviderSwitch = async (newId, newProvider) => {
    const oldId = id;
    try {
      await fetch("/api/metadata/switch-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: type,
          oldId: oldId,
          newId: newId,
          newProvider: newProvider,
        }),
      });
    } catch (err) {
      console.error("Failed to migrate provider in database:", err);
    }
    setId(newId);
    setLocalMalProvider(newProvider);
  };

  const selectMalTitle = async (selectedMalId) => {
    try {
      const linkRes = await fetch("/api/mal/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: type,
          id: details.id,
          provider: details.provider,
          MalID: selectedMalId,
          title: details.title,
        }),
      });
      const linkData = await linkRes.json();
      if (!linkData.error) {
        setIsLinkingMal(false);
        setMalSearchResults(null);
        Swal.fire({
          title: "Linked!",
          text: "Successfully linked to MyAnimeList!",
          icon: "success",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
          toast: true,
          position: "top-end",
          showConfirmButton: false,
          timer: 3000,
        });
        updateLinkedState(selectedMalId);
      } else {
        Swal.fire({
          title: "Error",
          text: linkData.message || "Failed to link.",
          icon: "error",
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUnlinkMal = async () => {
    const confirmResult = await Swal.fire({
      title: "Unlink MyAnimeList?",
      text: "Are you sure you want to unlink this item from MyAnimeList?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, unlink",
      cancelButtonText: "Cancel",
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      confirmButtonColor: "var(--danger)",
      cancelButtonColor: "var(--bg-tertiary)",
    });
    if (!confirmResult.isConfirmed) return;

    try {
      const response = await fetch("/api/mal/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: type,
          id: details.id,
          provider: details.provider,
          MalID: "",
          title: details.title,
        }),
      });
      const data = await response.json();
      if (!data.error) {
        Swal.fire({
          title: "Unlinked",
          text: "MyAnimeList link removed.",
          icon: "success",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
        }).then(() => {
          updateLinkedState(null);
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete local catalog entry
  const handleDeleteLocal = async () => {
    const isAnime = type === "Anime";
    const allDownloaded = [];
    if (isAnime) {
      const dl = details?.DownloadedEpisodes;
      const subs = Array.isArray(dl) ? dl : dl?.sub || [];
      const dubs = Array.isArray(dl) ? [] : dl?.dub || [];
      const hsubs = Array.isArray(dl) ? [] : dl?.hsub || [];
      const uniqueNums = new Set([...subs, ...dubs, ...hsubs].map(Number));
      allDownloaded.push(...uniqueNums);
    } else {
      const chapters = details?.DownloadedChapters || [];
      allDownloaded.push(...chapters.map(Number));
    }

    if (allDownloaded.length === 0) return;

    await handleLocalDeleteFlow({
      numbers: allDownloaded,
      confirmTitle: "Are you sure?",
      confirmText: `Are you sure you want to delete all downloaded files for ${details?.title}?`,
      confirmBtn: "Yes, delete all",
      successTitle: "Deleted",
      successText: "Deleted successfully.",
      onComplete: () => fetchDetails(false),
    });
  };

  const handleLocalDeleteFlow = async ({
    numbers,
    subdub,
    confirmTitle,
    confirmText,
    confirmBtn,
    successTitle,
    successText,
    onComplete,
  }) => {
    const confirmResult = await swalConfirm(
      confirmTitle,
      confirmText,
      confirmBtn,
    );
    if (!confirmResult.isConfirmed) return;
    try {
      const data = await apiPost("/api/local/delete", {
        id,
        type,
        numbers,
        subdub,
      });
      if (!data.error) {
        swalSuccess(successTitle, successText);
        if (onComplete) onComplete();
      } else {
        swalError("Error", data.message);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Delete single local episode file
  const handleDeleteEpisode = async (epNum, subdub) => {
    await handleLocalDeleteFlow({
      numbers: [epNum],
      subdub,
      confirmTitle: "Delete Episode?",
      confirmText: `Delete downloaded file for Episode ${epNum} (${subdub})?`,
      confirmBtn: "Yes, delete it",
      successTitle: "Deleted",
      successText: "Episode file deleted.",
      onComplete: () => fetchDetails(),
    });
  };

  // Delete single local manga chapter file
  const handleDeleteChapter = async (chapNum) => {
    await handleLocalDeleteFlow({
      numbers: [chapNum],
      confirmTitle: "Delete Chapter?",
      confirmText: `Delete downloaded file for Chapter ${chapNum}?`,
      confirmBtn: "Yes, delete it",
      successTitle: "Deleted",
      successText: "Chapter file deleted.",
      onComplete: () => fetchDetails(),
    });
  };

  // Open file or folder in File Explorer / system default player
  const handleOpenFile = async (
    number = null,
    subdub = null,
    action = "open_file",
  ) => {
    try {
      const res = await apiPost("/api/local/open", {
        type,
        id,
        number,
        subdub,
        action,
      });
      if (res.error) {
        swalError(
          "Error Opening File",
          res.message || "Failed to open file or directory.",
        );
      }
    } catch (err) {
      console.error(err);
      swalError("Error", "Failed to open file or directory.");
    }
  };

  // Bulk Delete Trigger
  const handleBulkDelete = async () => {
    const isAnime = type === "Anime";
    const selectedDownloaded = Array.from(selectedItems).filter((num) => {
      if (isAnime) {
        return isDownloaded(num, "sub") || isDownloaded(num, "dub");
      } else {
        return isDownloaded(num);
      }
    });
    if (selectedDownloaded.length === 0) return;

    const numbersToDelete = selectedDownloaded;
    await handleLocalDeleteFlow({
      numbers: numbersToDelete,
      subdub: isAnime ? dubSelect : undefined,
      confirmTitle: `Delete Selected ${isAnime ? "Episode(s)" : "Chapter(s)"}?`,
      confirmText: `Are you sure you want to delete ${numbersToDelete.length} downloaded ${isAnime ? "episode(s)" : "chapter(s)"}?`,
      confirmBtn: "Yes, delete",
      successTitle: "Deleted",
      successText: `Successfully deleted ${numbersToDelete.length} ${isAnime ? "episode(s)" : "chapter(s)"}.`,
      onComplete: () => {
        setSelectedItems(new Set());
        fetchDetails();
      },
    });
  };

  const isItemUnavailable = (item) => {
    if (type !== "Anime") return false;
    const langs = (item.langs || []).map((l) => String(l).toLowerCase());
    if (dubSelect === "sub") return !langs.includes("sub");
    if (dubSelect === "dub") return !langs.includes("dub");
    if (dubSelect === "hsub") return !langs.includes("hsub");
    return false;
  };

  if (loading) {
    return (
      <div className="loading-center-spinner">
        <img src="/images/loading.gif" alt="loading" className="u-style-17" />
        <p className="u-style-18">Loading details...</p>
      </div>
    );
  }

  if (!details || details.error) {
    return (
      <div className="info-wrapper">
        <div className="back-header">
          <button onClick={onBack} className="btn-back">
            <ArrowLeft size={20} />
            <span>{backText || "Back to Collection"}</span>
          </button>
        </div>
        <div className="glass-panel u-style-30">
          <img
            src="/images/image-404.png"
            alt="404 Not Found"
            className="u-style-31"
          />
          <h2 className="u-style-32">
            {type === "Anime" ? "Anime" : "Manga"} Data Not Found
          </h2>
          <p className="u-style-33">
            {details?.message ||
              `The requested ${type.toLowerCase()} could not be found or failed to load.`}
          </p>
          <div
            style={{
              display: "flex",
              gap: "10px",
              marginTop: "15px",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <button
              onClick={onBack}
              className="btn-back u-style-34"
              style={{ margin: 0 }}
            >
              <span>Go Back</span>
            </button>
            {propTitle && onSearchFallback && (
              <button
                onClick={() => onSearchFallback(propTitle)}
                className="btn-back u-style-34"
                style={{
                  backgroundColor: "var(--accent-blue, #3b82f6)",
                  border: "none",
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Search size={16} />
                <span>Search Title</span>
              </button>
            )}
            {currentTags && currentTags.length > 0 && (
              <button
                onClick={async () => {
                  const confirmed = await swalConfirm(
                    "Remove from Library",
                    "Are you sure you want to remove this entry from your library/watchlist?",
                  );
                  if (confirmed) {
                    await saveTags("");
                    if (onBack) onBack();
                  }
                }}
                className="btn-back u-style-34"
                style={{
                  backgroundColor: "var(--accent-red, #ef4444)",
                  border: "none",
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Trash2 size={16} />
                <span>Remove from Library</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const selectableItems = episodesOrChapters.filter(
    (item) => !isItemUnavailable(item),
  );
  const allSelectableSelected =
    selectableItems.length > 0 &&
    selectableItems.every((item) => selectedItems.has(Number(item.number)));

  const numToDownload = Array.from(selectedItems).filter((num) => {
    const downloaded =
      type === "Anime"
        ? isDownloaded(num, "sub") || isDownloaded(num, "dub")
        : isDownloaded(num);
    return !downloaded;
  }).length;

  const numToDelete = Array.from(selectedItems).filter((num) => {
    const downloaded =
      type === "Anime"
        ? isDownloaded(num, "sub") || isDownloaded(num, "dub")
        : isDownloaded(num);
    return downloaded;
  }).length;

  return (
    <div className="info-wrapper">
      {details?.image && (
        <div
          className="info-blur-bg"
          style={{ backgroundImage: `url(${details.image})` }}
        />
      )}
      {/* Back Header */}
      <div className="back-header">
        <button onClick={onBack} className="btn-back">
          <ArrowLeft size={20} />
          <span>{backText || "Back to Collection"}</span>
        </button>
      </div>

      {/* Main Details Panel */}
      <div className="details-grid glass-panel">
        <div className="cover-wrapper">
          <img
            src={details?.image}
            alt={details?.title}
            className="cover-img"
            onError={(e) => {
              e.target.src = "/images/image-404.png";
            }}
          />
        </div>

        <div className="info-content">
          <h1 className="info-title">{details?.title}</h1>

          <div className="tag-list">
            {(Array.isArray(details?.genres)
              ? details.genres
              : (details?.genres || "")
                  .split(",")
                  .map((g) => g.trim())
                  .filter(Boolean)
            ).map((genre) => (
              <span key={genre} className="info-tag">
                {genre}
              </span>
            ))}
            {details?.type && (
              <span className="info-tag-meta">
                {details.type.toUpperCase()}
              </span>
            )}
            {details?.nextEpisodeIn && (
              <span
                className="info-tag-schedule"
                title="Next release countdown"
              >
                <Film size={12} className="u-style-16" />
                {details.nextEpisodeIn}
              </span>
            )}
          </div>

          {(() => {
            const rawDescription = (details?.description || "")
              .replace(/\s*\[\s*more\s*\]\s*$/i, "")
              .trim();
            const isLongDesc = rawDescription.length > 200;
            const displayDesc =
              isLongDesc && !isDescExpanded
                ? rawDescription.slice(0, 200) + "..."
                : rawDescription || "No description available for this title.";
            return (
              <p className="info-description">
                {displayDesc}
                {isLongDesc && (
                  <button
                    type="button"
                    onClick={() => setIsDescExpanded(!isDescExpanded)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent-blue, #60a5fa)",
                      cursor: "pointer",
                      fontWeight: 600,
                      marginLeft: "6px",
                      padding: 0,
                      fontSize: "13px",
                    }}
                  >
                    {isDescExpanded ? "Show Less" : "Show More"}
                  </button>
                )}
              </p>
            );
          })()}

          {details?.released && (
            <div className="meta-item">
              <strong>Released:</strong> {details.released}
            </div>
          )}
          {details?.author && (
            <div className="meta-item">
              <strong>Author:</strong> {details.author}
            </div>
          )}

          {/* Action Row containing Play Actions & Library/Tracking Controls */}
          <div className="actions-row">
            {/* Quick Resumption / Play Actions */}
            <div className="quick-actions-wrapper">
              <button
                onClick={handleContinueWatchRead}
                className="btn-action-base btn-continue"
              >
                {type === "Manga" ? (
                  <BookOpen size={16} className="u-style-35" />
                ) : (
                  <Play size={16} className="u-style-35" />
                )}
                {isFinished
                  ? type === "Anime"
                    ? "Rewatch from Episode 1"
                    : "Reread from Chapter 1"
                  : type === "Anime"
                    ? nextToPlay === 1
                      ? "Start watching Episode 1"
                      : `Continue Watching Episode ${nextToPlay}`
                    : nextToPlay === 1
                      ? "Start reading Chapter 1"
                      : `Continue Reading Chapter ${nextToPlay}`}
              </button>

              {hasAnyDownloads && (
                <button
                  onClick={handleDeleteLocal}
                  className="btn-action-base u-style-36"
                >
                  <Trash2 size={16} className="u-style-35" />
                  <span>Delete All Downloads</span>
                </button>
              )}
            </div>

            {/* Library Tags & Source Provider Selection */}
            <div className="tracking-group">
              <div className="input-group u-style-37" ref={dropdownRef}>
                <label className="input-label">Library Tags</label>
                <div
                  className={`custom-dropdown-trigger ${isDropdownOpen ? "open" : ""} ${pulseDropdown ? "pulse-highlight" : ""}`}
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                >
                  <span className="custom-dropdown-trigger-text">
                    {currentTags[0] || "None (Not in Library)"}
                  </span>
                  <ChevronDown className="custom-dropdown-chevron" size={16} />
                </div>

                {isDropdownOpen && (
                  <div className="custom-dropdown-menu">
                    <div
                      className={`custom-dropdown-item ${!currentTags[0] ? "selected" : ""}`}
                      onClick={() => {
                        handleSetSingleTag("");
                        setIsDropdownOpen(false);
                      }}
                    >
                      None (Not in Library)
                    </div>
                    {customTags.map((tag) => (
                      <div
                        key={tag}
                        className={`custom-dropdown-item ${currentTags[0] === tag ? "selected" : ""}`}
                        onClick={() => {
                          handleSetSingleTag(tag);
                          setIsDropdownOpen(false);
                        }}
                      >
                        {tag}
                      </div>
                    ))}
                    <div className="custom-dropdown-divider"></div>
                    <div
                      className="custom-dropdown-item create-new"
                      onClick={() => {
                        handleCreateCustomTag();
                        setIsDropdownOpen(false);
                      }}
                    >
                      <Plus size={14} className="u-style-35" />
                      Create Custom Tag...
                    </div>
                  </div>
                )}
              </div>

              {/* Source Provider selector */}
              {details?.provider && (
                <div
                  className="input-group u-style-38"
                  ref={providerDropdownRef}
                >
                  <label className="input-label">Source Provider</label>
                  {details.linkedProviders &&
                  details.linkedProviders.length > 1 ? (
                    <>
                      <div
                        className={`custom-dropdown-trigger ${isProviderDropdownOpen ? "open" : ""}`}
                        onClick={() =>
                          setIsProviderDropdownOpen(!isProviderDropdownOpen)
                        }
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        {getProviderIcon(details.provider) && (
                          <img
                            src={getProviderIcon(details.provider)}
                            alt=""
                            style={{
                              width: "16px",
                              height: "16px",
                              borderRadius: "3px",
                              objectFit: "contain",
                            }}
                          />
                        )}
                        <span
                          className="custom-dropdown-trigger-text"
                          style={{ flex: 1 }}
                        >
                          {details.provider}
                        </span>
                        <ChevronDown
                          className="custom-dropdown-chevron"
                          size={16}
                          style={{ flexShrink: 0 }}
                        />
                      </div>

                      {isProviderDropdownOpen && (
                        <div className="custom-dropdown-menu">
                          {details.linkedProviders
                            .filter(
                              (p, index, self) =>
                                p.provider !== "provider" &&
                                self.findIndex(
                                  (t) => t.provider === p.provider,
                                ) === index,
                            )
                            .map((p) => (
                              <div
                                key={p.provider}
                                className={`custom-dropdown-item ${details.provider === p.provider ? "selected" : ""}`}
                                onClick={() => {
                                  const selectedRecord =
                                    details.linkedProviders.find(
                                      (record) =>
                                        record.provider === p.provider,
                                    );
                                  if (selectedRecord) {
                                    handleProviderSwitch(
                                      selectedRecord.id,
                                      p.provider,
                                    );
                                  }
                                  setIsProviderDropdownOpen(false);
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                }}
                              >
                                {getProviderIcon(p.provider) && (
                                  <img
                                    src={getProviderIcon(p.provider)}
                                    alt=""
                                    style={{
                                      width: "16px",
                                      height: "16px",
                                      borderRadius: "3px",
                                      objectFit: "contain",
                                    }}
                                  />
                                )}
                                <span>{p.provider}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="provider-static-badge">
                      {details.provider === "local source"
                        ? "📁 Local Source"
                        : details.provider}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Consolidated MyAnimeList Integration Box */}
          <div className="mal-box glass-panel">
            <div className="mal-box-header u-style-39">
              <h3 className="mal-title u-style-11">MyAnimeList Integration</h3>
              {details?.malid ? (
                <div className="mal-link-status u-style-27">
                  <span className="mal-link-badge">
                    Linked (ID: {details.malid})
                  </span>
                  <button onClick={handleUnlinkMal} className="btn-unlink">
                    Unlink
                  </button>
                </div>
              ) : (
                <button onClick={startMalLink} className="btn-link-mal">
                  Link MyAnimeList Title
                </button>
              )}
            </div>

            {details?.malid ? (
              details?.MalLoggedIn ? (
                <div className="mal-row">
                  <div className="input-group">
                    <label className="input-label">
                      {type === "Anime" ? "Watched Episodes" : "Read Chapters"}
                    </label>
                    <input
                      type="number"
                      value={malWatched}
                      onChange={(e) =>
                        setMalWatched(parseInt(e.target.value) || 0)
                      }
                      className="input-val"
                    />
                  </div>
                  <div
                    className="input-group u-style-40"
                    ref={malStatusDropdownRef}
                  >
                    <label className="input-label">Status</label>
                    <div
                      className={`custom-dropdown-trigger ${isMalStatusDropdownOpen ? "open" : ""}`}
                      onClick={() =>
                        setIsMalStatusDropdownOpen(!isMalStatusDropdownOpen)
                      }
                    >
                      <span className="custom-dropdown-trigger-text">
                        {getMalStatusLabel(malStatus)}
                      </span>
                      <ChevronDown
                        className="custom-dropdown-chevron"
                        size={16}
                      />
                    </div>

                    {isMalStatusDropdownOpen && (
                      <div className="custom-dropdown-menu">
                        {malStatusOptions.map((statusOption) => (
                          <div
                            key={statusOption}
                            className={`custom-dropdown-item ${malStatus === statusOption ? "selected" : ""}`}
                            onClick={() => {
                              setMalStatus(statusOption);
                              setIsMalStatusDropdownOpen(false);
                            }}
                          >
                            {getMalStatusLabel(statusOption)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleMalSync}
                    disabled={malSyncing}
                    className="btn-sync glow-button"
                  >
                    {malSyncing ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      "Save Status"
                    )}
                  </button>
                  {malStatus !== "not_in_list" && (
                    <button
                      onClick={handleMalRemove}
                      disabled={malSyncing}
                      className="btn-unlink u-style-41"
                    >
                      {malSyncing ? (
                        <Loader2 size={16} className="spin" />
                      ) : (
                        "Remove from List"
                      )}
                    </button>
                  )}
                </div>
              ) : (
                <p className="mal-unlinked-placeholder u-style-42">
                  Log in to MyAnimeList in Settings to synchronize your status
                  and progress automatically.
                </p>
              )
            ) : (
              <p className="mal-unlinked-placeholder u-style-42">
                This title is not linked to a MyAnimeList entry. Link it to
                synchronize your status and watch history automatically.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Episodes / Chapters List */}
      <div className="items-section">
        <div className="section-header">
          <h2>{type === "Anime" ? "Episodes List" : "Chapters List"}</h2>
        </div>
        {episodesOrChapters.length > 0 && (
          <div className="bulk-actions">
            {/* In-Page Search Input */}
            <div className="search-wrapper">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                placeholder={
                  type === "Anime" ? "Search episode..." : "Search chapter..."
                }
                value={episodeSearchQuery}
                onChange={(e) => setEpisodeSearchQuery(e.target.value)}
                className="search-input-box"
              />
              {episodeSearchQuery && (
                <button
                  onClick={() => setEpisodeSearchQuery("")}
                  className="btn-search-clear"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {/* Sort & Sub/Dub Controls Row */}
            <div className="sort-subdub-row">
              {/* Sort Selector */}
              <Dropdown
                label="Sort:"
                value={sortOrder}
                onChange={(newOrder) => {
                  setSortOrder(newOrder);
                  if (newOrder === "asc" || newOrder === "desc") {
                    setSortDirection(newOrder);
                    if (
                      window.sharedStateAPI &&
                      window.sharedStateAPI.updateSetting
                    ) {
                      window.sharedStateAPI
                        .updateSetting("infoSortOrder", newOrder)
                        .catch((e) => console.error(e));
                    }

                    const isAnimePahe =
                      details?.provider?.toLowerCase() === "animepahe" ||
                      details?.provider?.toLowerCase() === "pahe";
                    if (isAnimePahe) {
                      fetchItems(newOrder === "asc" ? totalPages : 1);
                    }
                  }
                }}
                options={[
                  { value: "asc", label: "ASC" },
                  { value: "desc", label: "DESC" },
                  ...(showWatchedSort
                    ? [
                        {
                          value: "watched",
                          label: type === "Anime" ? "WATCHED" : "READ",
                        },
                        {
                          value: "unwatched",
                          label: type === "Anime" ? "UNWATCHED" : "UNREAD",
                        },
                      ]
                    : []),
                  ...(hasDownloads
                    ? [{ value: "downloaded", label: "DOWNLOADED" }]
                    : []),
                ]}
                className="u-style-43"
                triggerClassName="u-style-44"
                menuClassName="u-style-45"
              />

              {details?.provider &&
                details?.provider !== "local source" &&
                type === "Anime" && (
                  <Dropdown
                    value={dubSelect}
                    onChange={setDubSelect}
                    options={(() => {
                      const opts = [
                        { value: "sub", label: "SUB" },
                        { value: "dub", label: "DUB" },
                      ];
                      if (
                        episodesOrChapters.some(
                          (ep) =>
                            (ep.langs && ep.langs.includes("hsub")) ||
                            ep.hasHsub,
                        )
                      ) {
                        opts.push({ value: "hsub", label: "HSUB" });
                      }
                      return opts;
                    })()}
                    className="u-style-46"
                    triggerClassName="u-style-44"
                    menuClassName="u-style-45"
                  />
                )}
            </div>

            {/* Action buttons if online provider is available */}
            {details?.provider && details?.provider !== "local source" && (
              <>
                <button
                  onClick={handleSelectAll}
                  style={{
                    opacity: selectableItems.length === 0 ? 0.5 : 1,
                    cursor:
                      selectableItems.length === 0 ? "not-allowed" : "pointer",
                  }}
                  className="btn-bulk"
                  disabled={selectableItems.length === 0}
                >
                  {allSelectableSelected ? "Deselect All" : "Select All"}
                </button>
                {selectedItems.size > 0 && (
                  <button
                    onClick={() => setSelectedItems(new Set())}
                    className="btn-bulk u-style-47"
                  >
                    Clear Selected
                  </button>
                )}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "var(--bg-tertiary)",
                    padding: "0 8px 0 12px",
                    borderRadius: "6px",
                    height: "38px",
                    boxSizing: "border-box",
                    border: isRangeInputInvalid
                      ? "1.5px solid var(--danger)"
                      : "1px solid var(--border)",
                    boxShadow: isRangeInputInvalid
                      ? "0 0 4px rgba(239, 68, 68, 0.25)"
                      : "none",
                    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
                  }}
                >
                  <input
                    type="text"
                    placeholder="Range 1-10 / 5"
                    value={rangeInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRangeInput(val);
                      setIsRangeInputInvalid(!validateRangeInput(val));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSelectRange(rangeInput, true);
                      }
                    }}
                    className="input-val u-style-48"
                  />
                  <button
                    onClick={() => handleSelectRange(rangeInput, true)}
                    className="btn-bulk u-style-49"
                    title="Select range of episodes"
                  >
                    Select
                  </button>
                </div>
                {numToDownload > 0 && (
                  <button
                    onClick={() => handleDownload()}
                    className="btn-download-all"
                  >
                    <Download size={16} />
                    <span>Download Checked ({numToDownload})</span>
                  </button>
                )}
                {numToDelete > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    className="btn-delete-show"
                  >
                    <Trash2 size={16} />
                    <span>Delete Checked ({numToDelete})</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <div className="items-list">
          {filteredItems.map((item) => {
            const hasSub = isDownloaded(item.number, "sub");
            const hasDub = isDownloaded(item.number, "dub");
            const isLocal = localMalProvider === "local";

            const epStatus =
              type === "Anime"
                ? (historyProgress?.episodesStatus || []).find(
                    (h) => Number(h.number) === Number(item.number),
                  )
                : (historyProgress?.chaptersStatus || []).find(
                    (h) => Number(h.number) === Number(item.number),
                  );

            const isMalCompleted =
              malWatched && Number(item.number) <= Number(malWatched);
            const isCompleted =
              (epStatus && epStatus.isCompleted) || isMalCompleted;
            const isStarted = epStatus && !epStatus.isCompleted;

            let customBorderClass = "";
            if (isCompleted) {
              customBorderClass = "completed";
            } else if (isStarted) {
              customBorderClass = "started";
            }
            const itemLangs = getItemLangs(item, details, dubSelect);
            const showOnlineActions =
              details?.provider && details?.provider !== "local source";

            const isSelected = selectedItems.has(Number(item.number));
            return (
              <div
                key={item.id}
                className={`item-card glass-panel ${customBorderClass} ${isSelected ? "selected" : ""}`}
                onClick={(e) => handleItemClick(e, item)}
              >
                {/* LINE 1: Episode Number, Title (if exists), Progress Bar */}
                <div className="item-card-row-top">
                  <div className="item-card-title-group">
                    {showOnlineActions && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={isItemUnavailable(item)}
                        readOnly
                        style={{
                          cursor: isItemUnavailable(item)
                            ? "not-allowed"
                            : "pointer",
                          width: "18px",
                          height: "18px",
                          opacity: isItemUnavailable(item) ? 0.4 : 1,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span className="item-num">
                      {type === "Anime"
                        ? `Episode ${item.number}`
                        : `Chapter ${item.number}`}
                    </span>
                    {type === "Anime" &&
                      item.title &&
                      item.title !== `Episode ${item.number}` && (
                        <span title={item.title} className="item-title-sub">
                          {item.title}
                        </span>
                      )}
                    {type === "Manga" &&
                      item.title &&
                      item.title !== `Chapter ${item.number}` && (
                        <span title={item.title} className="item-title-sub">
                          {item.title}
                        </span>
                      )}
                  </div>

                  {(() => {
                    if (!epStatus) return null;
                    const curVal =
                      type === "Anime"
                        ? epStatus.currentTime
                        : epStatus.currentPage;
                    const totVal =
                      type === "Anime"
                        ? epStatus.duration
                        : epStatus.totalPages;
                    if (
                      curVal === undefined ||
                      curVal === null ||
                      totVal === undefined ||
                      totVal === null
                    )
                      return null;

                    return (
                      <div className="item-progress-bar-wrap">
                        <div className="item-progress-bar-bg">
                          <div
                            style={{
                              width: `${Math.min(100, Math.max(0, (curVal / (totVal || 1)) * 100))}%`,
                              height: "100%",
                              backgroundColor: epStatus.isCompleted
                                ? "#34d399"
                                : "var(--accent)",
                              borderRadius: "2px",
                            }}
                          />
                        </div>
                        <span className="item-progress-text">
                          {type === "Anime"
                            ? `${formatTime(curVal)} / ${formatTime(totVal)}`
                            : `Page ${curVal}/${totVal}`}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {/* LINE 2: All sub, dub, hsub, download button */}
                <div className="item-card-row-bottom">
                  {type === "Anime" ? (
                    <>
                      {isDownloaded(item.number) ? (
                        <div className="badge-and-action">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const downloadedLang =
                                itemLangs.find((langKey) =>
                                  isDownloaded(item.number, langKey),
                                ) ||
                                dubSelect ||
                                "sub";
                              onWatch(
                                id,
                                item.number,
                                true,
                                downloadedLang,
                                episodesOrChapters,
                                details?.DownloadedEpisodes,
                                details?.title,
                                details?.provider,
                                details?.image,
                              );
                            }}
                            className="badge-subdub sub"
                            title="Play Downloaded Episode"
                          >
                            <Play size={11} fill="currentColor" />
                            <span>PLAY</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenFile(item.number, "sub", "open_file");
                            }}
                            className="btn-action-open"
                            title="Open File / File Explorer"
                          >
                            <FolderOpen size={16} />
                          </button>
                          {isLocal && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteEpisode(item.number);
                              }}
                              className="btn-action-trash"
                              title="Delete Download"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      ) : (
                        (() => {
                          const qStatus = getItemQueueStatus(item.number);
                          if (qStatus.inProgress) {
                            return (
                              <div
                                className="badge-and-action"
                                style={{ width: "100%", padding: "4px 0" }}
                              >
                                <div
                                  style={{
                                    flex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                  }}
                                >
                                  <div
                                    style={{
                                      flex: 1,
                                      height: "6px",
                                      background: "rgba(255,255,255,0.1)",
                                      borderRadius: "3px",
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        height: "100%",
                                        width: `${qStatus.pct}%`,
                                        background:
                                          "var(--accent-color, #3b82f6)",
                                        transition: "width 0.3s ease",
                                      }}
                                    />
                                  </div>
                                  <span
                                    style={{
                                      fontSize: "11px",
                                      fontWeight: "600",
                                      color: "var(--accent-color, #3b82f6)",
                                      minWidth: "32px",
                                    }}
                                  >
                                    {qStatus.pct}%
                                  </span>
                                </div>
                              </div>
                            );
                          }
                          return (
                            showOnlineActions && (
                              <div className="badge-and-action">
                                {itemLangs.map((langKey) => {
                                  let label = langKey.toUpperCase();
                                  if (
                                    langKey === "softsub" ||
                                    langKey === "soft_sub"
                                  )
                                    label = "SOFT SUB";
                                  else if (
                                    langKey === "softdub" ||
                                    langKey === "soft_dub"
                                  )
                                    label = "SOFT DUB";
                                  else if (langKey === "hsub") label = "HSUB";
                                  else if (langKey === "sub") label = "SUB";
                                  else if (langKey === "dub") label = "DUB";

                                  return (
                                    <button
                                      key={langKey}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onWatch(
                                          id,
                                          item.id,
                                          false,
                                          langKey,
                                          episodesOrChapters,
                                          details?.DownloadedEpisodes,
                                          details?.title,
                                          details?.provider,
                                          details?.image,
                                        );
                                      }}
                                      className={`badge-subdub ${langKey}`}
                                      title={`Play ${label}`}
                                    >
                                      <Play size={11} fill="currentColor" />
                                      <span>{label}</span>
                                    </button>
                                  );
                                })}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownload(item);
                                  }}
                                  className="badge-subdub download-btn"
                                  title="Download Episode"
                                >
                                  <Download size={11} />
                                  <span>DOWNLOAD</span>
                                </button>
                              </div>
                            )
                          );
                        })()
                      )}
                    </>
                  ) : (
                    /* Manga reader buttons */
                    <>
                      {hasSub ? (
                        <div className="badge-and-action">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRead(
                                id,
                                item.number,
                                true,
                                sortedItems,
                                details?.DownloadedChapters,
                                details?.title,
                                details?.provider,
                                details?.image,
                              );
                            }}
                            className="btn-read"
                            title="Read Downloaded Chapter"
                          >
                            <BookOpen size={11} />
                            <span>READ</span>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenFile(item.number, null, "open_file");
                            }}
                            className="btn-action-open"
                            title="Open File / File Explorer"
                          >
                            <FolderOpen size={16} />
                          </button>
                          {isLocal && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteChapter(item.number);
                              }}
                              className="btn-action-trash"
                              title="Delete Download"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      ) : (
                        (() => {
                          const qStatus = getItemQueueStatus(item.number);
                          if (qStatus.inProgress) {
                            return (
                              <div
                                className="badge-and-action"
                                style={{ width: "100%", padding: "4px 0" }}
                              >
                                <div
                                  style={{
                                    flex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                  }}
                                >
                                  <div
                                    style={{
                                      flex: 1,
                                      height: "6px",
                                      background: "rgba(255,255,255,0.1)",
                                      borderRadius: "3px",
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        height: "100%",
                                        width: `${qStatus.pct}%`,
                                        background:
                                          "var(--accent-color, #3b82f6)",
                                        transition: "width 0.3s ease",
                                      }}
                                    />
                                  </div>
                                  <span
                                    style={{
                                      fontSize: "11px",
                                      fontWeight: "600",
                                      color: "var(--accent-color, #3b82f6)",
                                      minWidth: "32px",
                                    }}
                                  >
                                    {qStatus.pct}%
                                  </span>
                                </div>
                              </div>
                            );
                          }
                          return (
                            showOnlineActions && (
                              <div className="badge-and-action">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRead(
                                      id,
                                      item.id,
                                      false,
                                      sortedItems,
                                      details?.DownloadedChapters,
                                      details?.title,
                                      details?.provider,
                                      details?.image,
                                    );
                                  }}
                                  className="btn-read"
                                  title="Read Online"
                                >
                                  <BookOpen size={11} />
                                  <span>READ</span>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownload(item);
                                  }}
                                  className="badge-subdub download-btn"
                                  title="Download Chapter"
                                >
                                  <Download size={11} />
                                  <span>DOWNLOAD</span>
                                </button>
                              </div>
                            )
                          );
                        })()
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {(() => {
          if (
            sortOrder === "downloaded" ||
            sortOrder === "watched" ||
            sortOrder === "unwatched"
          )
            return null;
          const isAnimePahe =
            details?.provider?.toLowerCase() === "animepahe" ||
            details?.provider?.toLowerCase() === "pahe";
          const disableFirstPrev =
            isAnimePahe && sortOrder === "asc"
              ? itemsPage === totalPages
              : itemsPage === 1;
          const disableNextLast =
            isAnimePahe && sortOrder === "asc"
              ? itemsPage === 1
              : itemsPage === totalPages;
          const firstPageTarget =
            isAnimePahe && sortOrder === "asc" ? totalPages : 1;
          const lastPageTarget =
            isAnimePahe && sortOrder === "asc" ? 1 : totalPages;
          const prevPageTarget =
            isAnimePahe && sortOrder === "asc" ? itemsPage + 1 : itemsPage - 1;
          const nextPageTarget =
            isAnimePahe && sortOrder === "asc" ? itemsPage - 1 : itemsPage + 1;

          const logicalPage =
            isAnimePahe && sortOrder === "asc"
              ? totalPages - itemsPage + 1
              : itemsPage;

          return totalPages > 1 ? (
            <div className="pagination-controls">
              <button
                onClick={() => fetchItems(firstPageTarget)}
                disabled={itemsLoading || disableFirstPrev}
                className="btn-pagination"
              >
                First
              </button>
              <button
                onClick={() => fetchItems(prevPageTarget)}
                disabled={itemsLoading || disableFirstPrev}
                className="btn-pagination"
              >
                Prev
              </button>

              <span className="pagination-label">
                Page {logicalPage} of {totalPages}
              </span>

              <select
                value={logicalPage}
                onChange={(e) => {
                  const targetLogical = Number(e.target.value);
                  const targetBackend =
                    isAnimePahe && sortOrder === "asc"
                      ? totalPages - targetLogical + 1
                      : targetLogical;
                  fetchItems(targetBackend);
                }}
                disabled={itemsLoading}
                className="pagination-select"
              >
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (p) => (
                    <option key={p} value={p}>
                      Page {p}
                    </option>
                  ),
                )}
              </select>

              <button
                onClick={() => fetchItems(nextPageTarget)}
                disabled={itemsLoading || disableNextLast}
                className="btn-pagination"
              >
                Next
              </button>
              <button
                onClick={() => fetchItems(lastPageTarget)}
                disabled={itemsLoading || disableNextLast}
                className="btn-pagination"
              >
                Last
              </button>
            </div>
          ) : (
            itemsHasNext && (
              <button
                onClick={() =>
                  fetchItems(itemsPage + 1, details?.provider, details, true)
                }
                disabled={itemsLoading}
                className="btn-load-more"
              >
                {itemsLoading ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  "Load More"
                )}
              </button>
            )
          );
        })()}
      </div>

      {/* MAL Link Modal Overlay */}
      {isLinkingMal && (
        <div className="mal-modal-overlay">
          <div className="mal-modal-card">
            <div className="mal-modal-header">
              <h2 className="mal-modal-title">Link MyAnimeList Title</h2>
              <button
                className="mal-modal-close"
                onClick={() => {
                  setIsLinkingMal(false);
                  setMalSearchResults(null);
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mal-modal-search-bar">
              <input
                type="text"
                value={malSearchQuery}
                onChange={(e) => setMalSearchQuery(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && performMalSearch(malSearchQuery)
                }
                className="mal-modal-search-input"
                placeholder="Search MyAnimeList..."
                autoFocus
              />
              <button
                onClick={() => performMalSearch(malSearchQuery)}
                className="mal-modal-search-btn"
              >
                <Search size={16} />
                <span>Search</span>
              </button>
            </div>

            <div className="mal-modal-results-container">
              {malSearchLoading ? (
                <div className="mal-modal-status">
                  <Loader2 size={24} className="spin" />
                  <span>Searching MyAnimeList...</span>
                </div>
              ) : malSearchResults ? (
                malSearchResults.length > 0 ? (
                  <ul className="mal-modal-results-list">
                    {malSearchResults.map((res) => (
                      <li
                        key={res.id}
                        className="mal-modal-result-item"
                        onClick={() => selectMalTitle(res.id)}
                      >
                        {res.image && (
                          <img
                            src={res.image}
                            alt={res.title}
                            className="mal-modal-result-image"
                            onError={(e) => {
                              e.target.src = "/images/image-404.png";
                            }}
                          />
                        )}
                        <div className="mal-modal-result-info">
                          <div className="mal-modal-result-title">
                            {res.title}
                          </div>
                          <div className="mal-modal-result-meta">
                            {type === "Anime" ? (
                              <span>
                                {res.totalEpisodes
                                  ? `${res.totalEpisodes} Episodes`
                                  : "Unknown Episodes"}
                              </span>
                            ) : (
                              <span>
                                {res.totalChapters
                                  ? `${res.totalChapters} Chapters`
                                  : "Unknown Chapters"}
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mal-modal-status">
                    No results found. Try a different query.
                  </div>
                )
              ) : (
                <div className="mal-modal-status-initial">
                  Ready to search. Adjust title above if needed and click
                  Search.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
