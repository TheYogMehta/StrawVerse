/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, no-unused-vars */
import { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import Swal from "sweetalert2";
import "./css/InfoView.css";

export default function InfoView({
  id: propId,
  type,
  localMalProvider: propLocalMalProvider,
  backText,
  onBack,
  onWatch,
  onRead,
}) {
  const [id, setId] = useState(propId);
  const [localMalProvider, setLocalMalProvider] =
    useState(propLocalMalProvider);
  const [details, setDetails] = useState(null);
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

  const [sortOrder, setSortOrder] = useState("asc"); // 'asc' or 'desc'

  const sortedItems = useMemo(() => {
    return [...episodesOrChapters].sort((a, b) => {
      const numA = parseFloat(a.number) || 0;
      const numB = parseFloat(b.number) || 0;
      return sortOrder === "asc" ? numA - numB : numB - numA;
    });
  }, [episodesOrChapters, sortOrder]);

  const filteredItems = useMemo(() => {
    if (!episodeSearchQuery.trim()) return sortedItems;
    const query = episodeSearchQuery.toLowerCase().trim();
    return sortedItems.filter((item) => {
      const numStr = String(item.number || "");
      const titleStr = String(item.title || "").toLowerCase();
      return numStr.includes(query) || titleStr.includes(query);
    });
  }, [sortedItems, episodeSearchQuery]);

  // Selection for bulk downloads
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [dubSelect, setDubSelect] = useState("sub"); // sub or dub for anime downloads

  // MAL Status Sync form states
  const [malSyncing, setMalSyncing] = useState(false);
  const [malStatus, setMalStatus] = useState("plan_to_watch");
  const [malWatched, setMalWatched] = useState(0);
  const [customTags, setCustomTags] = useState([]);
  const [currentTags, setCurrentTags] = useState([]);
  const [newTagInput, setNewTagInput] = useState("");

  // Inline MAL Search states
  const [malSearchQuery, setMalSearchQuery] = useState("");
  const [malSearchResults, setMalSearchResults] = useState(null);
  const [malSearchLoading, setMalSearchLoading] = useState(false);
  const [isLinkingMal, setIsLinkingMal] = useState(false);

  const [historyProgress, setHistoryProgress] = useState(null);
  const [hasProgress, setHasProgress] = useState(false);

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

      if (isInitial) {
        const isAnimePahe =
          data?.provider?.toLowerCase() === "animepahe" ||
          data?.provider?.toLowerCase() === "pahe";
        if (isAnimePahe) {
          setSortOrder("desc");
        } else {
          setSortOrder("asc");
        }
      }

      if (data?.watched !== undefined) setMalWatched(data.watched);
      if (data?.status) setMalStatus(data.status);

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
      const tagsRes = await fetch(`/api/local/tags/${type}`);
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
  }, [propId, propLocalMalProvider]);

  useEffect(() => {
    fetchDetails(true);
  }, [id, type, localMalProvider]);

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
  const handleSelectToggle = (itemId) => {
    const nextSelected = new Set(selectedItems);
    if (nextSelected.has(itemId)) {
      nextSelected.delete(itemId);
    } else {
      nextSelected.add(itemId);
    }
    setSelectedItems(nextSelected);
  };

  const handleSelectAll = () => {
    const selectableItems = episodesOrChapters.filter(
      (item) => !isItemUnavailable(item),
    );
    const selectableIds = selectableItems.map((item) => item.id);
    const allSelected =
      selectableIds.length > 0 &&
      selectableIds.every((id) => selectedItems.has(id));

    if (allSelected) {
      const nextSelected = new Set(selectedItems);
      selectableIds.forEach((id) => nextSelected.delete(id));
      setSelectedItems(nextSelected);
    } else {
      const nextSelected = new Set(selectedItems);
      selectableIds.forEach((id) => nextSelected.add(id));
      setSelectedItems(nextSelected);
    }
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
        if (singleItem) {
          const hasSub =
            singleItem.lang === "sub" ||
            singleItem.lang === "both" ||
            !singleItem.lang;
          const hasDub =
            singleItem.lang === "dub" || singleItem.lang === "both";

          if (hasSub && hasDub) {
            const result = await Swal.fire({
              title: "Select Language",
              text: `Choose language to download for Episode ${singleItem.number}`,
              icon: "question",
              showDenyButton: true,
              showCancelButton: true,
              confirmButtonText: "Download SUB",
              denyButtonText: "Download DUB",
              cancelButtonText: "Cancel",
              background: "var(--bg-secondary)",
              color: "var(--text-main)",
              confirmButtonColor: "var(--accent)",
              denyButtonColor: "var(--bg-tertiary)",
            });

            if (result.isDismissed && !result.isConfirmed && !result.isDenied) {
              return; // user cancelled
            }

            chosenLang = result.isConfirmed ? "sub" : "dub";
          } else if (hasDub) {
            chosenLang = "dub";
          } else {
            chosenLang = "sub";
          }
        } else {
          // Bulk download
          if (details?.subOrDub === "both") {
            const result = await Swal.fire({
              title: "Select Language",
              text: "Choose language to download for selected episodes",
              icon: "question",
              showDenyButton: true,
              showCancelButton: true,
              confirmButtonText: "Download SUB",
              denyButtonText: "Download DUB",
              cancelButtonText: "Cancel",
              background: "var(--bg-secondary)",
              color: "var(--text-main)",
              confirmButtonColor: "var(--accent)",
              denyButtonColor: "var(--bg-tertiary)",
            });

            if (result.isDismissed && !result.isConfirmed && !result.isDenied) {
              return; // user cancelled
            }

            chosenLang = result.isConfirmed ? "sub" : "dub";
          } else if (details?.subOrDub === "dub") {
            chosenLang = "dub";
          } else {
            chosenLang = "sub";
          }
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
        const selectedList = episodesOrChapters.filter((item) =>
          selectedItems.has(item.id),
        );
        const selectedNotDownloaded = selectedList.filter(
          (item) => !isItemFullyDownloaded(item) && !isItemUnavailable(item),
        );
        const itemsToDownload = selectedNotDownloaded;
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

  const handleSetSingleTag = async (tagText) => {
    const trimmed = tagText ? tagText.trim() : "";
    const updatedTags = trimmed ? [trimmed] : [];
    await saveTags(updatedTags);
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
      if (trimmed.toLowerCase() === "myanimelist") {
        Swal.fire({
          title: "Reserved Tag Name",
          text: 'The tag name "MyAnimeList" is reserved for system integration.',
          icon: "warning",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
        });
        return;
      }
      if (trimmed) {
        handleSetSingleTag(trimmed);
      }
    }
  };

  const saveTags = async (updatedTags) => {
    try {
      const response = await fetch("/api/local/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: type,
          id: details.id,
          title: details.title,
          ImageUrl: details.image,
          description: details.description,
          genres: details.genres,
          provider: details.provider,
          CustomTags: updatedTags,
        }),
      });
      const data = await response.json();
      if (!data.error) {
        setCurrentTags(updatedTags);

        // Refresh custom tag list
        fetch(`/api/local/tags/${type}`)
          .then((res) => res.json())
          .then((tags) => setCustomTags(tags))
          .catch((err) => console.error(err));

        Swal.fire({
          title: "Library Updated",
          text:
            updatedTags.length > 0
              ? `Status set to "${updatedTags[0]}"`
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
        setMalStatus(data.status || "plan_to_watch");
      } else {
        setMalWatched(0);
        setMalStatus("");
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

  const handleProviderSwitch = (newId, newProvider) => {
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
          ImageUrl: details.image,
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
      const response = await fetch("/api/local/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type }),
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
        onBack();
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
    const selectedList = episodesOrChapters.filter((item) =>
      selectedItems.has(item.id),
    );
    const selectedDownloaded = selectedList.filter((item) =>
      isItemFullyDownloaded(item),
    );
    if (selectedDownloaded.length === 0) return;

    const numbersToDelete = selectedDownloaded.map((item) => item.number);
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

  const selectableItems = episodesOrChapters.filter(
    (item) => !isItemUnavailable(item),
  );
  const allSelectableSelected =
    selectableItems.length > 0 &&
    selectableItems.every((item) => selectedItems.has(item.id));

  const selectedList = episodesOrChapters.filter((item) =>
    selectedItems.has(item.id),
  );
  const selectedDownloaded = selectedList.filter((item) =>
    isItemFullyDownloaded(item),
  );
  const selectedNotDownloaded = selectedList.filter(
    (item) => !isItemFullyDownloaded(item) && !isItemUnavailable(item),
  );

  const numToDownload = selectedNotDownloaded.length;
  const numToDelete = selectedDownloaded.length;

  return (
    <div className="info-wrapper">
      {/* Back Header */}
      <div className="back-header">
        <button onClick={onBack} className="btn-back">
          <ArrowLeft size={20} />
          <span>{backText || "Back to Collection"}</span>
        </button>
        {localMalProvider === "local" && (
          <button onClick={handleDeleteLocal} className="btn-delete-show">
            <Trash2 size={16} />
            <span>Delete All Downloads</span>
          </button>
        )}
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
              <span className="info-tag-schedule" title="Next release countdown">
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
          {details?.provider && (
            <div className="meta-item">
              <strong>Source Provider:</strong>{" "}
              {details.linkedProviders && details.linkedProviders.length > 1 ? (
                <select
                  value={details.provider}
                  onChange={(e) => {
                    const selectedRecord = details.linkedProviders.find(
                      (p) => p.provider === e.target.value,
                    );
                    if (selectedRecord) {
                      handleProviderSwitch(selectedRecord.id, "provider");
                    }
                  }}
                  style={{
                    background: "var(--bg-tertiary)",
                    color: "var(--text-main)",
                    border: "1.5px solid var(--accent)",
                    borderRadius: "20px",
                    padding: "4px 16px 4px 12px",
                    marginLeft: "8px",
                    cursor: "pointer",
                    outline: "none",
                    fontWeight: "600",
                    fontSize: "13px",
                    boxShadow: "0 0 8px rgba(168, 85, 247, 0.25)",
                    transition: "all 0.2s ease-in-out",
                  }}
                >
                  {details.linkedProviders
                    .filter(
                      (p, index, self) =>
                        self.findIndex((t) => t.provider === p.provider) ===
                        index,
                    )
                    .map((p) => (
                      <option key={p.provider} value={p.provider}>
                        {p.provider}
                      </option>
                    ))}
                </select>
              ) : (
                details.provider
              )}
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
                {!hasAnyProgress
                  ? type === "Anime"
                    ? "Watch from Episode 1"
                    : "Read from Chapter 1"
                  : isFinished
                    ? type === "Anime"
                      ? "Rewatch from Episode 1"
                      : "Rewatch from Chapter 1"
                    : type === "Anime"
                      ? `Continue Watching Episode ${nextToPlay}`
                      : `Continue Reading Chapter ${nextToPlay}`}
              </button>
              <button
                onClick={handleWatchReadLatest}
                className="btn-action-base btn-watch-latest"
              >
                <Play size={16} style={{ marginRight: "6px" }} />
                {type === "Anime"
                  ? "Watch Latest Episode"
                  : "Read Latest Chapter"}
              </button>
            </div>

            {/* Library Tags & MAL Connection */}
            <div className="tracking-group">
              <div className="input-group" style={{ minWidth: "250px" }}>
                <label className="input-label">Library Tags</label>
                {/* Select tag dropdown */}
                <select
                  value={currentTags[0] || ""}
                  onChange={(e) => {
                    if (e.target.value === "__new_tag__") {
                      handleCreateCustomTag();
                    } else {
                      handleSetSingleTag(e.target.value);
                    }
                  }}
                  className="select-val"
                >
                  <option value="">None (Not in Library)</option>
                  {customTags
                    .filter((tag) => tag.toLowerCase() !== "myanimelist")
                    .map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  <option value="__new_tag__">+ Create Custom Tag...</option>
                </select>

                {/* Assigned tags */}
                {currentTags.length > 0 ? (
                  <div className="tag-chips-row">
                    <span className="tag-chip-with-remove">
                      Status: {currentTags[0]}
                      <button
                        onClick={() => handleSetSingleTag("")}
                        className="btn-tag-chip-remove"
                        title="Remove from Library"
                      >
                        &times;
                      </button>
                    </span>
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--text-muted)",
                      fontStyle: "italic",
                      margin: "4px 0",
                    }}
                  >
                    Not in Library. Choose status above to add.
                  </div>
                )}
              </div>

              {/* MyAnimeList Connection */}
              {details && details.MalLoggedIn && (
                <div className="input-group" style={{ minWidth: "180px" }}>
                  <label className="input-label">MyAnimeList Connection</label>
                  {details.malid ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        height: "38px",
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
                    <button
                      onClick={startMalLink}
                      className="btn-link-mal"
                      style={{ height: "38px" }}
                    >
                      Link MAL Title
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* MAL Configuration sync Panel */}
          {details?.malid && details?.MalLoggedIn && (
            <div className="mal-box">
              <h3 className="mal-title">MyAnimeList Sync</h3>
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
                <div className="input-group">
                  <label className="input-label">Status</label>
                  <select
                    value={malStatus}
                    onChange={(e) => setMalStatus(e.target.value)}
                    className="select-val"
                  >
                    {type === "Anime" ? (
                      <>
                        <option value="plan_to_watch">Plan To Watch</option>
                        <option value="watching">Watching</option>
                        <option value="completed">Completed</option>
                        <option value="on_hold">On Hold</option>
                        <option value="dropped">Dropped</option>
                      </>
                    ) : (
                      <>
                        <option value="plan_to_read">Plan To Read</option>
                        <option value="reading">Reading</option>
                        <option value="completed">Completed</option>
                        <option value="on_hold">On Hold</option>
                        <option value="dropped">Dropped</option>
                      </>
                    )}
                  </select>
                </div>
                <button
                  onClick={handleMalSync}
                  disabled={malSyncing}
                  className="btn-sync glow-button"
                >
                  {malSyncing ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    "Save status"
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Episodes / Chapters List */}
      <div className="items-section">
        <div className="section-header">
          <h2>{type === "Anime" ? "Episodes List" : "Chapters List"}</h2>
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
              {/* Sort Button */}
              <button
                onClick={() => {
                  const newOrder = sortOrder === "asc" ? "desc" : "asc";
                  setSortOrder(newOrder);
                  const isAnimePahe =
                    details?.provider?.toLowerCase() === "animepahe" ||
                    details?.provider?.toLowerCase() === "pahe";
                  if (isAnimePahe) {
                    if (newOrder === "asc") {
                      fetchItems(totalPages);
                    } else {
                      fetchItems(1);
                    }
                  }
                }}
                className="btn-bulk"
                title={`Sort by number: ${sortOrder === "asc" ? "Ascending" : "Descending"}`}
              >
                <ArrowUpDown
                  size={14}
                  style={{
                    marginRight: "6px",
                    verticalAlign: "middle",
                    display: "inline-block",
                  }}
                />
                Sort: {sortOrder.toUpperCase()}
              </button>

              {/* Action buttons if online provider is available */}
              {details?.provider && details?.provider !== "local source" && (
                <>
                  {type === "Anime" &&
                    details?.subOrDub === "both" &&
                    episodesOrChapters.some(
                      (ep) => ep.lang === "both" || ep.lang === "dub",
                    ) && (
                      <select
                        value={dubSelect}
                        onChange={(e) => setDubSelect(e.target.value)}
                        className="select-val"
                      >
                        <option value="sub">SUB</option>
                        <option value="dub">DUB</option>
                      </select>
                    )}
                  <button
                    onClick={handleSelectAll}
                    style={{
                      opacity: selectableItems.length === 0 ? 0.5 : 1,
                      cursor:
                        selectableItems.length === 0
                          ? "not-allowed"
                          : "pointer",
                    }}
                    className="btn-bulk"
                    disabled={selectableItems.length === 0}
                  >
                    {allSelectableSelected ? "Deselect All" : "Select All"}
                  </button>
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
        </div>

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
            const showOnlineActions =
              details?.provider && details?.provider !== "local source";

            return (
              <div
                key={item.id}
                className={`item-card glass-panel ${customBorderClass}`}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    flex: 1,
                  }}
                >
                  {showOnlineActions && (
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      disabled={isItemUnavailable(item)}
                      onChange={() => handleSelectToggle(item.id)}
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
                  <span className="item-num">
                    {type === "Anime"
                      ? `Episode ${item.number}`
                      : item.title || `Chapter ${item.number}`}
                  </span>
                </div>

                <div
                  style={{ display: "flex", alignItems: "center", gap: "12px" }}
                >
                  {/* Local download status & deletion buttons */}
                  {type === "Anime" ? (
                    <>
                      {/* SUB stream / delete */}
                      {hasSub ? (
                        <div className="badge-and-action">
                          <span className="badge-subdub sub">
                            SUB Downloaded
                          </span>
                          <button
                            onClick={() =>
                              onWatch(
                                id,
                                item.number,
                                true,
                                "sub",
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
                                handleDeleteEpisode(item.number, "sub")
                              }
                              className="btn-action-trash"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      ) : (
                        showOnlineActions &&
                        hasSubLang && (
                          <button
                            onClick={() =>
                              onWatch(
                                id,
                                item.id,
                                false,
                                "sub",
                                episodesOrChapters,
                                details?.DownloadedEpisodes,
                                details?.title,
                                details?.provider,
                                details?.image,
                              )
                            }
                            className="btn-stream"
                          >
                            <span>Stream SUB</span>
                          </button>
                        )
                      )}

                      {/* DUB stream / delete */}
                      {hasDub ? (
                        <div className="badge-and-action">
                          <span className="badge-subdub dub">
                            DUB Downloaded
                          </span>
                          <button
                            onClick={() =>
                              onWatch(
                                id,
                                item.number,
                                true,
                                "dub",
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
                                handleDeleteEpisode(item.number, "dub")
                              }
                              className="btn-action-trash"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      ) : (
                        showOnlineActions &&
                        hasDubLang && (
                          <button
                            onClick={() =>
                              onWatch(
                                id,
                                item.id,
                                false,
                                "dub",
                                episodesOrChapters,
                                details?.DownloadedEpisodes,
                                details?.title,
                                details?.provider,
                                details?.image,
                              )
                            }
                            className="btn-stream"
                          >
                            <span>Stream DUB</span>
                          </button>
                        )
                      )}
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
