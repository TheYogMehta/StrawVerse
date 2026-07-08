/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, no-unused-vars */
import { useState, useEffect, useMemo, useRef } from "react";
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
} from "lucide-react";
import Swal from "sweetalert2";
import "./css/InfoView.css";

export default function InfoView({
  id: propId,
  type,
  localMalProvider: propLocalMalProvider,
  backText,
  autoPlay,
  onBack,
  onWatch: propOnWatch,
  onRead: propOnRead,
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
    const newArgs = [...args];
    while (newArgs.length < 9) {
      newArgs.push(undefined);
    }
    newArgs[9] = details?.malid;
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
  const [dubSelect, setDubSelect] = useState("sub");
  const [rangeInput, setRangeInput] = useState("");
  const [lastClickedId, setLastClickedId] = useState(null);
  const [isRangeInputInvalid, setIsRangeInputInvalid] = useState(false);
  const [sortOrder, setSortOrder] = useState(
    () => localStorage.getItem("info_sort_order") || "asc",
  );
  const [sortDirection, setSortDirection] = useState(
    () => localStorage.getItem("info_sort_direction") || "asc",
  );

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

  const isDownloaded = (itemNum, subdub = "sub") => {
    const num = parseFloat(itemNum);
    if (isNaN(num)) return false;
    if (type === "Anime") {
      const list = details?.DownloadedEpisodes?.[subdub] || [];
      return list.map(Number).includes(num);
    } else {
      const list = details?.DownloadedChapters || [];
      return list.map(Number).includes(num);
    }
  };

  const isItemFullyDownloaded = (item) => {
    if (type !== "Anime") {
      return isDownloaded(item.number, "sub");
    }
    if (dubSelect === "sub") {
      return isDownloaded(item.number, "sub");
    } else if (dubSelect === "dub") {
      return isDownloaded(item.number, "dub");
    }
    return false;
  };

  const hasDownloads =
    type === "Anime"
      ? details?.DownloadedEpisodes?.sub?.length > 0 ||
        details?.DownloadedEpisodes?.dub?.length > 0
      : details?.DownloadedChapters?.length > 0;

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

      allDownloadedNums.sort((a, b) =>
        sortDirection === "asc" ? a - b : b - a,
      );

      return allDownloadedNums.map((num) => {
        const existingItem = episodesOrChapters.find(
          (item) => Number(item.number) === num,
        );
        if (existingItem) return existingItem;

        if (type === "Anime") {
          const subList = details?.DownloadedEpisodes?.sub || [];
          const dubList = details?.DownloadedEpisodes?.dub || [];
          return {
            id: `local-ep-${num}`,
            number: String(num),
            title: `Episode ${num}`,
            hasDub: dubList.map(Number).includes(num),
            lang:
              subList.map(Number).includes(num) &&
              dubList.map(Number).includes(num)
                ? "both"
                : dubList.map(Number).includes(num)
                  ? "dub"
                  : "sub",
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

  // Custom dropdown states
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
  const providerDropdownRef = useRef(null);
  const [isMalStatusDropdownOpen, setIsMalStatusDropdownOpen] = useState(false);
  const malStatusDropdownRef = useRef(null);
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef(null);
  const [isDubDropdownOpen, setIsDubDropdownOpen] = useState(false);
  const dubDropdownRef = useRef(null);
  const hasAutoPlayed = useRef(false);

  const fetchDetails = async (isInitial = false) => {
    if (isInitial) {
      setLoading(true);
    }
    try {
      const response = await fetch(`/api/info/${type}/${localMalProvider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      setDetails(data);
      if (data && data.id && data.id !== id) {
        setId(data.id);
      }
      if (data && data.provider && data.provider !== localMalProvider) {
        setLocalMalProvider(data.provider);
      }

      if (isInitial) {
        const savedSort = localStorage.getItem("info_sort_order");
        if (savedSort) {
          setSortOrder(savedSort);
          const savedDir = localStorage.getItem("info_sort_direction");
          if (savedDir) setSortDirection(savedDir);
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

      let hasDownloadsOnDisk = false;
      if (type === "Anime") {
        const subList = data?.DownloadedEpisodes?.sub || [];
        const dubList = data?.DownloadedEpisodes?.dub || [];
        hasDownloadsOnDisk = subList.length > 0 || dubList.length > 0;
      } else {
        const chList = data?.DownloadedChapters || [];
        hasDownloadsOnDisk = chList.length > 0;
      }

      const isDownloadsTag = parsedTags[0] === "Downloads";
      if (isDownloadsTag && !hasDownloadsOnDisk) {
        try {
          const dlRes = await fetch("/downloads", { method: "POST" });
          const dlData = await dlRes.json();
          const activeId = dlData?.id;
          const isQueued = (dlData?.queue || []).some(
            (item) =>
              String(item.id) === String(id) ||
              String(item.id) === String(data?.id),
          );
          const isActive =
            String(activeId) === String(id) ||
            String(activeId) === String(data?.id);

          if (!isQueued && !isActive) {
            await saveTags("");
            triggerPulse();
          }
        } catch (dlErr) {
          console.error("Failed to check active downloads", dlErr);
        }
      }

      // Fetch custom tags
      const tagsRes = await fetch(`/api/local/tags/view/${type}`);
      const tagsData = await tagsRes.json();
      setCustomTags(tagsData);

      // Fetch history progress
      try {
        const progressRes = await fetch(
          `/api/history/progress?mediaId=${encodeURIComponent(id)}&type=${type}`,
        );
        const progressData = await progressRes.json();
        setHasProgress(progressData.hasProgress || false);
        setHistoryProgress(progressData);
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
      const endpoint = isAnime ? "/api/episodes" : "/api/chapters";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: isAnime ? fetchedDetails?.dataId || id : id,
          page: page,
          provider: providerName || fetchedDetails?.provider || "local source",
        }),
      });
      const data = await response.json();

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
      const subList = targetDetails?.DownloadedEpisodes?.sub || [];
      const dubList = targetDetails?.DownloadedEpisodes?.dub || [];
      const allNums = Array.from(new Set([...subList, ...dubList])).sort(
        (a, b) => a - b,
      );
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
      const subList = details?.DownloadedEpisodes?.sub || [];
      const dubList = details?.DownloadedEpisodes?.dub || [];
      const isDownloadedLocal =
        dubSelect === "dub"
          ? dubList.includes(Number(targetItem.number))
          : subList.includes(Number(targetItem.number));

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
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(event.target)
      ) {
        setIsSortDropdownOpen(false);
      }
      if (
        dubDropdownRef.current &&
        !dubDropdownRef.current.contains(event.target)
      ) {
        setIsDubDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
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

  // Sync dubSelect automatically with details.subOrDub
  useEffect(() => {
    if (details && type === "Anime") {
      if (details.subOrDub === "sub" || details.subOrDub === "dub") {
        setDubSelect(details.subOrDub);
      }
    }
  }, [details, type]);

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
      const subList = details.DownloadedEpisodes?.sub || [];
      const dubList = details.DownloadedEpisodes?.dub || [];
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
        const subList = details?.DownloadedEpisodes?.sub || [];
        const dubList = details?.DownloadedEpisodes?.dub || [];
        const isDownloadedLocal =
          dubSelect === "dub"
            ? dubList.includes(Number(targetItem.number))
            : subList.includes(Number(targetItem.number));

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
        const subList = details?.DownloadedEpisodes?.sub || [];
        const dubList = details?.DownloadedEpisodes?.dub || [];
        const isDownloadedLocal =
          dubSelect === "dub"
            ? dubList.includes(Number(targetItem.number))
            : subList.includes(Number(targetItem.number));

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
          let langs = [];
          if (ep.langs && Array.isArray(ep.langs)) {
            langs = ep.langs;
          } else if (ep.lang) {
            if (ep.lang === "both") {
              langs = ["sub", "dub"];
            } else {
              langs = [ep.lang];
            }
          } else {
            if (details?.subOrDub === "both") {
              langs = ["sub", "dub"];
            } else if (details?.subOrDub) {
              langs = [details.subOrDub];
            } else {
              langs = ["sub"];
            }
          }

          if (langs.includes("sub")) hasSub = true;
          if (langs.includes("dub")) hasDub = true;
          if (langs.includes("hsub") || ep.hasHsub) hasHsub = true;
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
          malid: details?.malid,
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
          malid: details?.malid,
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
          await saveTags("Downloads");
          triggerPulse();
        }
      }

      Swal.fire({
        title: "Queue Updated",
        text: data.message || "Added to download queue!",
        icon: "success",
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
        confirmButtonColor: "var(--accent)",
      });
      setSelectedItems(new Set());
    } catch (err) {
      console.error(err);
      Swal.fire({
        title: "Error",
        text: "Failed to add to download queue.",
        icon: "error",
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
        confirmButtonColor: "var(--accent)",
      });
    }
  };

  // MAL Status sync
  const handleMalSync = async () => {
    if (!details?.malid) return;
    if (malStatus === "not_in_list") {
      Swal.fire({
        title: "Status Required",
        text: "Please select a watch status (e.g., Watching, Plan to Watch) to add this title to MyAnimeList.",
        icon: "warning",
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
        confirmButtonColor: "var(--accent)",
      });
      return;
    }
    setMalSyncing(true);
    try {
      const response = await fetch("/api/mal/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          malid: details.malid,
          episodes: malWatched,
          status: malStatus,
          type: type,
        }),
      });
      const data = await response.json();
      Swal.fire({
        title: "MAL Synced",
        text: data.text || data.title || "Updated MyAnimeList successfully!",
        icon: "success",
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
        confirmButtonColor: "var(--accent)",
      });
    } catch (err) {
      console.error(err);
      Swal.fire({
        title: "Sync Failed",
        text: "MAL update failed.",
        icon: "error",
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
        confirmButtonColor: "var(--accent)",
      });
    } finally {
      setMalSyncing(false);
    }
  };

  const handleMalRemove = async () => {
    if (!details?.malid) return;

    const result = await Swal.fire({
      title: "Remove from MyAnimeList?",
      text: "Are you sure you want to remove this title from your MyAnimeList list?",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, Remove",
      cancelButtonText: "Cancel",
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      confirmButtonColor: "var(--danger)",
      cancelButtonColor: "var(--bg-tertiary)",
    });

    if (!result.isConfirmed) return;

    setMalSyncing(true);
    try {
      const response = await fetch("/api/mal/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          malid: details.malid,
          type: type,
        }),
      });
      const data = await response.json();

      if (data.icon === "success") {
        setMalStatus("not_in_list");
        Swal.fire({
          title: "Removed",
          text: data.title || "Successfully removed from MyAnimeList!",
          icon: "success",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
        });
      } else {
        Swal.fire({
          title: "Failed",
          text: data.text || "Failed to remove entry.",
          icon: "error",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
        });
      }
    } catch (err) {
      console.error(err);
      Swal.fire({
        title: "Remove Failed",
        text: "MyAnimeList removal request failed.",
        icon: "error",
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
        confirmButtonColor: "var(--accent)",
      });
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

  const saveTags = async (updatedTag) => {
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
        setCurrentTags(updatedTag ? [updatedTag] : []);

        // Refresh custom tag list
        fetch(`/api/local/tags/view/${type}`)
          .then((res) => res.json())
          .then((tags) => setCustomTags(tags))
          .catch((err) => console.error(err));

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
      const subs = details?.DownloadedEpisodes?.sub || [];
      const dubs = details?.DownloadedEpisodes?.dub || [];
      const hsubs = details?.DownloadedEpisodes?.hsub || [];
      const uniqueNums = new Set([...subs, ...dubs, ...hsubs].map(Number));
      allDownloaded.push(...uniqueNums);
    } else {
      const chapters = details?.DownloadedChapters || [];
      allDownloaded.push(...chapters.map(Number));
    }

    if (allDownloaded.length === 0) return;

    const confirmResult = await Swal.fire({
      title: "Are you sure?",
      text: `Are you sure you want to delete all downloaded files for ${details?.title}?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, delete all",
      cancelButtonText: "Cancel",
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      confirmButtonColor: "var(--danger)",
      cancelButtonColor: "var(--bg-tertiary)",
    });
    if (!confirmResult.isConfirmed) return;
    try {
      const response = await fetch("/api/local/delete-multiple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type, numbers: allDownloaded }),
      });
      const data = await response.json();
      if (!data.error) {
        Swal.fire({
          title: "Deleted",
          text: "Deleted successfully.",
          icon: "success",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
        });
        fetchDetails(false);
      } else {
        Swal.fire({
          title: "Error",
          text: data.message,
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
  // Delete single local episode file
  const handleDeleteEpisode = async (epNum, subdub) => {
    const confirmResult = await Swal.fire({
      title: "Delete Episode?",
      text: `Delete downloaded file for Episode ${epNum} (${subdub})?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, delete it",
      cancelButtonText: "Cancel",
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      confirmButtonColor: "var(--danger)",
      cancelButtonColor: "var(--bg-tertiary)",
    });
    if (!confirmResult.isConfirmed) return;
    try {
      const response = await fetch("/api/local/delete-episode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, epnum: epNum, subdub }),
      });
      const data = await response.json();
      if (!data.error) {
        Swal.fire({
          title: "Deleted",
          text: "Episode file deleted.",
          icon: "success",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
        });
        fetchDetails(); // Reload metadata and checks
      } else {
        Swal.fire({
          title: "Error",
          text: data.message,
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

  // Delete single local manga chapter file
  const handleDeleteChapter = async (chapNum) => {
    const confirmResult = await Swal.fire({
      title: "Delete Chapter?",
      text: `Delete downloaded file for Chapter ${chapNum}?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, delete it",
      cancelButtonText: "Cancel",
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      confirmButtonColor: "var(--danger)",
      cancelButtonColor: "var(--bg-tertiary)",
    });
    if (!confirmResult.isConfirmed) return;
    try {
      const response = await fetch("/api/local/delete-multiple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type, numbers: [chapNum] }),
      });
      const data = await response.json();
      if (!data.error) {
        Swal.fire({
          title: "Deleted",
          text: "Chapter file deleted.",
          icon: "success",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
        });
        fetchDetails(); // Reload metadata and checks
      } else {
        Swal.fire({
          title: "Error",
          text: data.message,
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
    const confirmResult = await Swal.fire({
      title: `Delete Selected ${isAnime ? "Episode(s)" : "Chapter(s)"}?`,
      text: `Are you sure you want to delete ${numbersToDelete.length} downloaded ${isAnime ? "episode(s)" : "chapter(s)"}?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, delete",
      cancelButtonText: "Cancel",
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      confirmButtonColor: "var(--danger)",
      cancelButtonColor: "var(--bg-tertiary)",
    });
    if (!confirmResult.isConfirmed) return;

    try {
      const response = await fetch("/api/local/delete-multiple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          type,
          numbers: numbersToDelete,
          ...(isAnime ? { subdub: dubSelect } : {}),
        }),
      });
      const data = await response.json();
      if (!data.error) {
        Swal.fire({
          title: "Deleted",
          text: `Successfully deleted ${numbersToDelete.length} ${isAnime ? "episode(s)" : "chapter(s)"}.`,
          icon: "success",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
        });
        setSelectedItems(new Set());
        fetchDetails(); // Reload metadata and checks
      } else {
        Swal.fire({
          title: "Error",
          text: data.message,
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

  const isItemUnavailable = (item) => {
    if (type !== "Anime") return false;
    const hasSubLang =
      item.lang === "sub" || item.lang === "both" || !item.lang;
    const hasDubLang = item.lang === "dub" || item.lang === "both";
    if (dubSelect === "sub") {
      return !hasSubLang;
    } else if (dubSelect === "dub") {
      return !hasDubLang;
    }
    return false;
  };

  if (loading) {
    return (
      <div className="loading-center-spinner">
        <img
          src="/images/loading.gif"
          alt="loading"
          style={{ width: "64px", height: "64px" }}
        />
        <p style={{ marginTop: "16px", color: "var(--text-muted)" }}>
          Loading details...
        </p>
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
        <div
          className="glass-panel"
          style={{ padding: "40px", textAlign: "center", marginTop: "20px" }}
        >
          <img
            src="/images/image-404.png"
            alt="404 Not Found"
            style={{
              width: "180px",
              height: "auto",
              marginBottom: "24px",
              opacity: 0.85,
            }}
          />
          <h2 style={{ color: "var(--text-main)", marginBottom: "10px" }}>
            {type === "Anime" ? "Anime" : "Manga"} Data Not Found
          </h2>
          <p style={{ color: "var(--text-muted)", marginBottom: "20px" }}>
            {details?.message ||
              `The requested ${type.toLowerCase()} could not be found or failed to load.`}
          </p>
          <button
            onClick={onBack}
            className="btn-back"
            style={{ display: "inline-flex", padding: "10px 20px" }}
          >
            <span>Go Back</span>
          </button>
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
                <Film size={12} style={{ marginRight: "4px" }} />
                {details.nextEpisodeIn}
              </span>
            )}
          </div>

          <p className="info-description">
            {details?.description || "No description available for this title."}
          </p>

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
                <Play size={16} style={{ marginRight: "6px" }} />
                {isFinished
                  ? type === "Anime"
                    ? "Rewatch from Episode 1"
                    : "Rewatch from Chapter 1"
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
                  className="btn-action-base"
                  style={{
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1.5px solid var(--danger)",
                    color: "var(--danger)",
                    marginLeft: "8px",
                  }}
                >
                  <Trash2 size={16} style={{ marginRight: "6px" }} />
                  <span>Delete All Downloads</span>
                </button>
              )}
            </div>

            {/* Library Tags & Source Provider Selection */}
            <div className="tracking-group">
              <div
                className="input-group"
                style={{ minWidth: "240px", position: "relative" }}
                ref={dropdownRef}
              >
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
                      <Plus size={14} style={{ marginRight: "6px" }} />
                      Create Custom Tag...
                    </div>
                  </div>
                )}
              </div>

              {/* Source Provider selector */}
              {details?.provider && (
                <div
                  className="input-group"
                  style={{ minWidth: "180px", position: "relative" }}
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
                      >
                        <span className="custom-dropdown-trigger-text">
                          {details.provider}
                        </span>
                        <ChevronDown
                          className="custom-dropdown-chevron"
                          size={16}
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
                              >
                                {p.provider}
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
          {details?.MalLoggedIn && (
            <div className="mal-box glass-panel">
              <div
                className="mal-box-header"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                  borderBottom: "1px solid var(--border)",
                  paddingBottom: "12px",
                  marginBottom: "14px",
                }}
              >
                <h3 className="mal-title" style={{ margin: 0 }}>
                  MyAnimeList Integration
                </h3>
                {details.malid ? (
                  <div
                    className="mal-link-status"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
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

              {details.malid ? (
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
                    className="input-group"
                    style={{ minWidth: "160px", position: "relative" }}
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
                      className="btn-unlink"
                      style={{
                        background: "rgba(239, 68, 68, 0.15)",
                        borderColor: "var(--danger)",
                        color: "var(--danger)",
                      }}
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
                <p
                  className="mal-unlinked-placeholder"
                  style={{
                    fontSize: "13px",
                    color: "var(--text-muted)",
                    margin: 0,
                    fontStyle: "italic",
                  }}
                >
                  This title is not linked to a MyAnimeList entry. Link it to
                  synchronize your status and watch history automatically.
                </p>
              )}
            </div>
          )}
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
            {/* Sort Selector */}
            <div
              className="input-group"
              style={{ minWidth: "120px", position: "relative" }}
              ref={sortDropdownRef}
            >
              <div
                className={`custom-dropdown-trigger ${isSortDropdownOpen ? "open" : ""}`}
                onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                style={{ minHeight: "38px" }}
              >
                <span className="custom-dropdown-trigger-text">
                  Sort:{" "}
                  {sortOrder === "downloaded"
                    ? `DOWNLOADED (${sortDirection.toUpperCase()})`
                    : sortOrder.toUpperCase()}
                </span>
                <ChevronDown className="custom-dropdown-chevron" size={16} />
              </div>

              {isSortDropdownOpen && (
                <div className="custom-dropdown-menu" style={{ width: "100%" }}>
                  <div
                    className={`custom-dropdown-item ${sortOrder === "asc" ? "selected" : ""}`}
                    onClick={() => {
                      setSortOrder("asc");
                      setSortDirection("asc");
                      localStorage.setItem("info_sort_order", "asc");
                      localStorage.setItem("info_sort_direction", "asc");
                      setIsSortDropdownOpen(false);
                      const isAnimePahe =
                        details?.provider?.toLowerCase() === "animepahe" ||
                        details?.provider?.toLowerCase() === "pahe";
                      if (isAnimePahe) {
                        fetchItems(totalPages);
                      }
                    }}
                  >
                    Sort: ASC
                  </div>
                  <div
                    className={`custom-dropdown-item ${sortOrder === "desc" ? "selected" : ""}`}
                    onClick={() => {
                      setSortOrder("desc");
                      setSortDirection("desc");
                      localStorage.setItem("info_sort_order", "desc");
                      localStorage.setItem("info_sort_direction", "desc");
                      setIsSortDropdownOpen(false);
                      const isAnimePahe =
                        details?.provider?.toLowerCase() === "animepahe" ||
                        details?.provider?.toLowerCase() === "pahe";
                      if (isAnimePahe) {
                        fetchItems(1);
                      }
                    }}
                  >
                    Sort: DESC
                  </div>
                  {hasDownloads && (
                    <div
                      className={`custom-dropdown-item ${sortOrder === "downloaded" ? "selected" : ""}`}
                      onClick={() => {
                        setSortOrder("downloaded");
                        localStorage.setItem("info_sort_order", "downloaded");
                        setIsSortDropdownOpen(false);
                      }}
                    >
                      Sort: DOWNLOADED
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Action buttons if online provider is available */}
            {details?.provider && details?.provider !== "local source" && (
              <>
                {type === "Anime" &&
                  (episodesOrChapters.some(
                    (ep) => ep.lang === "both" || ep.lang === "dub",
                  ) ||
                    (details?.DownloadedEpisodes?.dub &&
                      details.DownloadedEpisodes.dub.length > 0)) && (
                    <div
                      className="input-group"
                      style={{ minWidth: "80px", position: "relative" }}
                      ref={dubDropdownRef}
                    >
                      <div
                        className={`custom-dropdown-trigger ${isDubDropdownOpen ? "open" : ""}`}
                        onClick={() => setIsDubDropdownOpen(!isDubDropdownOpen)}
                        style={{ minHeight: "38px" }}
                      >
                        <span className="custom-dropdown-trigger-text">
                          {dubSelect.toUpperCase()}
                        </span>
                        <ChevronDown
                          className="custom-dropdown-chevron"
                          size={16}
                        />
                      </div>

                      {isDubDropdownOpen && (
                        <div
                          className="custom-dropdown-menu"
                          style={{ width: "100%" }}
                        >
                          <div
                            className={`custom-dropdown-item ${dubSelect === "sub" ? "selected" : ""}`}
                            onClick={() => {
                              setDubSelect("sub");
                              setIsDubDropdownOpen(false);
                            }}
                          >
                            SUB
                          </div>
                          <div
                            className={`custom-dropdown-item ${dubSelect === "dub" ? "selected" : ""}`}
                            onClick={() => {
                              setDubSelect("dub");
                              setIsDubDropdownOpen(false);
                            }}
                          >
                            DUB
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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
                    className="btn-bulk"
                    style={{
                      backgroundColor: "rgba(239, 68, 68, 0.15)",
                      color: "var(--danger)",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                    }}
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
                    className="input-val"
                    style={{
                      width: "120px",
                      padding: "0",
                      fontSize: "13px",
                      border: "none",
                      background: "transparent",
                      color: "white",
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={() => handleSelectRange(rangeInput, true)}
                    className="btn-bulk"
                    style={{
                      padding: "5px 10px",
                      fontSize: "13px",
                      border: "none",
                      backgroundColor: "rgba(124, 58, 237, 0.15)",
                      color: "#a78bfa",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: "600",
                    }}
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

            const hasSubLang =
              item.lang === "sub" || item.lang === "both" || !item.lang;
            const hasDubLang = item.lang === "dub" || item.lang === "both";
            const hasHsubLang = !!item.hasHsub;
            const showOnlineActions =
              details?.provider && details?.provider !== "local source";

            const isSelected = selectedItems.has(Number(item.number));
            return (
              <div
                key={item.id}
                className={`item-card glass-panel ${customBorderClass} ${isSelected ? "selected" : ""}`}
                onClick={(e) => handleItemClick(e, item)}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    width: "220px",
                    flexShrink: 0,
                  }}
                >
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
                      }}
                    />
                  )}
                  <span
                    className="item-num"
                    style={{ fontWeight: "600", fontSize: "14px" }}
                  >
                    {type === "Anime"
                      ? `Episode ${item.number}`
                      : `Chapter ${item.number}`}
                  </span>
                </div>

                <div
                  className="item-middle-progress"
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: "24px",
                    padding: "0 16px",
                    overflow: "hidden",
                  }}
                >
                  {type === "Anime" &&
                    item.title &&
                    item.title !== `Episode ${item.number}` && (
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--text-muted)",
                          fontWeight: "500",
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          maxWidth: "280px",
                        }}
                        title={item.title}
                      >
                        {item.title}
                      </span>
                    )}
                  {type === "Manga" &&
                    item.title &&
                    item.title !== `Chapter ${item.number}` && (
                      <span
                        style={{
                          fontSize: "13px",
                          color: "var(--text-muted)",
                          fontWeight: "500",
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          maxWidth: "280px",
                        }}
                        title={item.title}
                      >
                        {item.title}
                      </span>
                    )}
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          flex: 1,
                          minWidth: "160px",
                          maxWidth: "300px",
                        }}
                      >
                        <div
                          style={{
                            width: "70px",
                            height: "4px",
                            backgroundColor: "rgba(255, 255, 255, 0.08)",
                            borderRadius: "2px",
                            overflow: "hidden",
                            flexShrink: 0,
                          }}
                        >
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
                        <span
                          style={{
                            fontSize: "11px",
                            color: "var(--text-muted)",
                            fontWeight: "500",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {type === "Anime"
                            ? `${formatTime(curVal)} / ${formatTime(totVal)}`
                            : `Page ${curVal}/${totVal}`}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                <div
                  style={{ display: "flex", alignItems: "center", gap: "12px" }}
                >
                  {/* Local download status & deletion buttons */}
                  {type === "Anime" ? (
                    <>
                      {(() => {
                        let availableLangs = [];
                        if (item.langs && Array.isArray(item.langs)) {
                          availableLangs = item.langs;
                        } else {
                          if (item.lang === "both") {
                            availableLangs = ["sub", "dub"];
                          } else if (item.lang === "dub") {
                            availableLangs = ["dub"];
                          } else {
                            availableLangs = ["sub"];
                          }
                        }

                        return availableLangs.map((langKey) => {
                          const isLangDownloaded = isDownloaded(
                            item.number,
                            langKey,
                          );
                          if (isLangDownloaded) {
                            return (
                              <div className="badge-and-action" key={langKey}>
                                <span className={`badge-subdub ${langKey}`}>
                                  {langKey.toUpperCase()} Downloaded
                                </span>
                                <button
                                  onClick={() =>
                                    onWatch(
                                      id,
                                      item.number,
                                      true,
                                      langKey,
                                      episodesOrChapters,
                                      details?.DownloadedEpisodes,
                                      details?.title,
                                      details?.provider,
                                      details?.image,
                                    )
                                  }
                                  className="btn-play"
                                >
                                  <Play size={18} />
                                </button>
                                {isLocal && (
                                  <button
                                    onClick={() =>
                                      handleDeleteEpisode(item.number, langKey)
                                    }
                                    className="btn-action-trash"
                                  >
                                    <Trash2 size={18} />
                                  </button>
                                )}
                              </div>
                            );
                          } else {
                            return (
                              showOnlineActions && (
                                <button
                                  key={langKey}
                                  onClick={() =>
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
                                    )
                                  }
                                  className="btn-stream"
                                >
                                  <span>Stream {langKey.toUpperCase()}</span>
                                </button>
                              )
                            );
                          }
                        });
                      })()}
                    </>
                  ) : (
                    /* Manga reader buttons */
                    <>
                      {hasSub ? (
                        <div className="badge-and-action">
                          <span className="badge-manga">Downloaded</span>
                          <button
                            onClick={() =>
                              onRead(
                                id,
                                item.number,
                                true,
                                sortedItems,
                                details?.DownloadedChapters,
                                details?.title,
                                details?.provider,
                                details?.image,
                              )
                            }
                            className="btn-read"
                          >
                            <BookOpen size={18} />
                          </button>
                          {isLocal && (
                            <button
                              onClick={() => handleDeleteChapter(item.number)}
                              className="btn-action-trash"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      ) : (
                        showOnlineActions && (
                          <button
                            onClick={() =>
                              onRead(
                                id,
                                item.id,
                                false,
                                sortedItems,
                                details?.DownloadedChapters,
                                details?.title,
                                details?.provider,
                                details?.image,
                              )
                            }
                            className="btn-stream"
                          >
                            <span>Read Online</span>
                          </button>
                        )
                      )}
                    </>
                  )}

                  {/* Single Download button */}
                  {showOnlineActions &&
                    !isItemFullyDownloaded(item) &&
                    !isItemUnavailable(item) && (
                      <button
                        onClick={() => handleDownload(item)}
                        className="btn-single-dl"
                        title={
                          type === "Anime"
                            ? "Download Episode"
                            : "Download Chapter"
                        }
                      >
                        <Download size={18} />
                      </button>
                    )}
                </div>
              </div>
            );
          })}
        </div>

        {(() => {
          if (sortOrder === "downloaded") return null;
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
