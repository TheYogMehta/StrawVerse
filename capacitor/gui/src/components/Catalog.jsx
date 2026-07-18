/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, no-unused-vars */
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
} from "react";
import "./css/Catalog.css";
import {
  Search,
  Loader2,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Download,
  Eye,
  Film,
  Plus,
  Folder,
  Clock,
  CheckSquare,
  Tv,
  BookOpen,
  Play,
  X,
} from "lucide-react";
import Swal from "sweetalert2";
import { swalSuccess, swalError } from "../utils/swal";
import { apiPost } from "../utils/common";

export default function Catalog({
  type,
  provider,
  onSelectMedia,
  onTypeChange,
  initialSearchQuery = "",
}) {
  const lastRequestRef = useRef(null);
  const sentinelRef = useRef(null);
  const infiniteObserverRef = useRef(null);
  const isFetchingMoreRef = useRef(false);

  const wrapperRef = useRef(null);
  const topSentinelRef = useRef(null);
  const topObserverRef = useRef(null);
  const isFetchingPrevRef = useRef(false);
  const lastScrollHeightRef = useRef(0);
  const pendingScrollAdjustRef = useRef(null);
  const isRestoredRef = useRef(false);
  const didFetchRef = useRef(false);
  const lastTypeRef = useRef(type);
  const lastProviderRef = useRef(provider);

  if (lastTypeRef.current !== type || lastProviderRef.current !== provider) {
    lastTypeRef.current = type;
    lastProviderRef.current = provider;
    didFetchRef.current = false;
  }

  if (!window.catalogCache) {
    window.catalogCache = {};
  }
  const cacheKey = `${type}_${provider}`;
  const cache = window.catalogCache[cacheKey];

  const [data, setData] = useState(
    () =>
      cache?.data || {
        results: [],
        totalPages: 0,
        currentPage: 1,
        hasNextPage: false,
      },
  );
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState(
    () => cache?.searchQuery || "",
  );
  const [currentPage, setCurrentPage] = useState(() => cache?.currentPage || 1);
  const [activeFilters, setActiveFilters] = useState(
    () => cache?.activeFilters || {},
  );
  const [availableFilters, setAvailableFilters] = useState(
    () => cache?.availableFilters || null,
  );
  const [errorMsg, setErrorMsg] = useState(() => cache?.errorMsg || "");
  const [localTags, setLocalTags] = useState([]);

  const [linkingMalItem, setLinkingMalItem] = useState(null);
  const [stats, setStats] = useState(null);
  const [recentHistory, setRecentHistory] = useState([]);
  const [infiniteScroll, setInfiniteScroll] = useState(() =>
    cache?.infiniteScroll !== undefined ? cache.infiniteScroll : true,
  );
  const [infiniteLoading, setInfiniteLoading] = useState(false);

  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const [discoverTab, setDiscoverTab] = useState(
    () =>
      cache?.discoverTab || sessionStorage.getItem("discover_tab") || "latest",
  );

  const [fetchedPages, setFetchedPages] = useState(
    () => cache?.fetchedPages || {},
  );
  const [loadedPageStart, setLoadedPageStart] = useState(
    () => cache?.loadedPageStart || 1,
  );
  const [loadedPageEnd, setLoadedPageEnd] = useState(
    () => cache?.loadedPageEnd || 1,
  );
  const [scheduleData, setScheduleData] = useState([]);
  const [calendarDayFilter, setCalendarDayFilter] = useState("Today");
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [scheduleUpdating, setScheduleUpdating] = useState(false);
  const [timeTicker, setTimeTicker] = useState(Date.now());
  const lastLoadedKeyRef = useRef(`${type}_${provider}`);

  const handleScroll = (e) => {
    const scrollTop = e.target.scrollTop;
    const cacheKey = `${type}_${provider}`;
    if (!window.catalogCache) {
      window.catalogCache = {};
    }
    if (!window.catalogCache[cacheKey]) {
      window.catalogCache[cacheKey] = {};
    }
    window.catalogCache[cacheKey].scrollPosition = scrollTop;
  };

  useEffect(() => {
    const activeKey = lastLoadedKeyRef.current;
    if (!activeKey) return;
    if (!didFetchRef.current) return;
    if (!window.catalogCache) {
      window.catalogCache = {};
    }
    const existingScroll = window.catalogCache[activeKey]?.scrollPosition || 0;
    window.catalogCache[activeKey] = {
      data,
      searchQuery,
      currentPage,
      activeFilters,
      availableFilters,
      errorMsg,
      discoverTab,
      infiniteScroll,
      fetchedPages,
      loadedPageStart,
      loadedPageEnd,
      scrollPosition: existingScroll,
    };
  }, [
    data,
    searchQuery,
    currentPage,
    activeFilters,
    availableFilters,
    errorMsg,
    discoverTab,
    infiniteScroll,
    fetchedPages,
    loadedPageStart,
    loadedPageEnd,
  ]);

  useEffect(() => {
    const cacheKey = `${type}_${provider}`;
    const cache = window.catalogCache[cacheKey];
    if (
      cache &&
      cache.scrollPosition &&
      wrapperRef.current &&
      data?.results &&
      data.results.length > 0 &&
      !isRestoredRef.current
    ) {
      wrapperRef.current.scrollTop = cache.scrollPosition;
      isRestoredRef.current = true;
    }
  }, [data?.results]);

  useLayoutEffect(() => {
    if (pendingScrollAdjustRef.current && wrapperRef.current) {
      const adjust = pendingScrollAdjustRef.current;
      if (typeof adjust === "number") {
        wrapperRef.current.scrollTop += adjust;
      } else if (adjust.type === "prepend") {
        const { pageSize } = adjust;
        const cards = wrapperRef.current.querySelectorAll(".media-card");
        if (cards && cards[0] && cards[pageSize]) {
          const h =
            cards[pageSize].getBoundingClientRect().top -
            cards[0].getBoundingClientRect().top;
          wrapperRef.current.scrollTop += h;
        }
      }
      pendingScrollAdjustRef.current = null;
    }
  });

  const getCustomOrderKey = (currentTag = activeFilters.tag) => {
    return `${type}_${provider}_${currentTag || "all"}`;
  };

  const applyCustomOrder = (resultsList, currentFilters = activeFilters) => {
    if (!resultsList || resultsList.length === 0) return resultsList;
    const key = getCustomOrderKey(currentFilters.tag);
    let savedOrder = null;
    try {
      const stored = localStorage.getItem(`custom_order_${key}`);
      if (stored) savedOrder = JSON.parse(stored);
    } catch (_) {}

    if (savedOrder && Array.isArray(savedOrder) && savedOrder.length > 0) {
      const orderMap = new Map();
      savedOrder.forEach((id, idx) => orderMap.set(id, idx));

      return [...resultsList].sort((a, b) => {
        const indexA = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
        const indexB = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
        return indexA - indexB;
      });
    }
    return resultsList;
  };

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = (e, index) => {
    if (dragOverIndex === index) {
      setDragOverIndex(null);
    }
  };

  const handleDrop = async (e, dropIndex) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex || !data?.results) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const updated = [...data.results];
    const [movedItem] = updated.splice(draggedIndex, 1);
    updated.splice(dropIndex, 0, movedItem);

    setData((prev) => ({
      ...prev,
      results: updated,
    }));

    const orderIds = updated.map((item) => item.id);
    const key = getCustomOrderKey();

    try {
      localStorage.setItem(`custom_order_${key}`, JSON.stringify(orderIds));
    } catch (_) {}

    try {
      await fetch("/api/local/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, order: orderIds }),
      });
    } catch (err) {
      console.error("Failed to persist title reorder:", err);
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleTouchStart = (e, index) => {
    if (provider !== "local") return;
    setDraggedIndex(index);
  };

  const handleTouchMove = (e) => {
    if (draggedIndex === null || provider !== "local") return;
    const touch = e.touches[0];
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!element) return;
    const card = element.closest(".media-card");
    if (card) {
      const indexAttr = card.getAttribute("data-index");
      if (indexAttr !== null) {
        const index = parseInt(indexAttr, 10);
        if (dragOverIndex !== index) {
          setDragOverIndex(index);
        }
      }
    }
  };

  const handleTouchEnd = async (e) => {
    if (draggedIndex === null || provider !== "local") return;
    const dropIndex = dragOverIndex;
    if (dropIndex !== null && draggedIndex !== dropIndex && data?.results) {
      const updated = [...data.results];
      const [movedItem] = updated.splice(draggedIndex, 1);
      updated.splice(dropIndex, 0, movedItem);

      setData((prev) => ({
        ...prev,
        results: updated,
      }));

      const orderIds = updated.map((item) => item.id);
      const key = getCustomOrderKey();

      try {
        localStorage.setItem(`custom_order_${key}`, JSON.stringify(orderIds));
      } catch (_) {}

      try {
        await fetch("/api/local/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, order: orderIds }),
        });
      } catch (err) {
        console.error("Failed to persist title reorder:", err);
      }
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Define supported filter maps matching index.js
  const siteFilterDefs = {
    // legacy for now..
  };

  const getApiEndpoint = (currentTag = activeFilters.tag) => {
    if (provider === "local") {
      return `/api/list/${type}/local`;
    }
    if (provider === "mal") return `/api/list/${type}/mal`;
    if (searchQuery.trim().length > 0)
      return `/api/list/${type}/search?query=${encodeURIComponent(searchQuery)}`;
    return `/api/list/${type}/provider`;
  };

  const preloadPagesAround = async (targetPage, currentFilters) => {
    const pageBelow = targetPage + 1;
    let belowResults = [];
    try {
      let endpoint = getApiEndpoint(currentFilters.tag);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: { ...currentFilters, page: pageBelow },
        }),
      });
      if (response.ok) {
        if (!wrapperRef.current) return;
        const resData = await response.json();
        if (resData?.results) {
          belowResults = applyCustomOrder(resData.results, currentFilters);
          setFetchedPages((prev) => ({ ...prev, [pageBelow]: belowResults }));
          setLoadedPageEnd(pageBelow);
          setData((prevData) => ({
            ...prevData,
            results: [...(prevData?.results || []), ...belowResults],
          }));
        }
      }
    } catch (e) {
      console.error("Failed to preload page below:", e);
    }

    for (let p = targetPage - 1; p >= Math.max(1, targetPage - 3); p--) {
      try {
        let endpoint = getApiEndpoint(currentFilters.tag);
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filters: { ...currentFilters, page: p },
          }),
        });
        if (response.ok) {
          if (!wrapperRef.current) return;
          const resData = await response.json();
          const sortedResults = applyCustomOrder(
            resData?.results || [],
            currentFilters,
          );

          if (wrapperRef.current) {
            pendingScrollAdjustRef.current = {
              type: "prepend",
              pageSize: sortedResults.length,
            };
          }

          setFetchedPages((prev) => {
            const nextPages = { ...prev, [p]: sortedResults };
            setLoadedPageStart(p);

            const newResults = [];
            for (let pageNum = p; pageNum <= pageBelow; pageNum++) {
              const pageData =
                pageNum === p ? sortedResults : nextPages[pageNum];
              if (pageData) {
                newResults.push(...pageData);
              }
            }

            setData((prevData) => ({
              ...prevData,
              results: newResults,
            }));

            return nextPages;
          });
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } catch (e) {
        console.error(`Failed to preload page ${p}:`, e);
      }
    }
  };

  const fetchData = async (
    page = 1,
    currentFilters = activeFilters,
    searchOverride = null,
    linkingOverride = undefined,
    isAppend = false,
  ) => {
    const currentRequestId = Math.random();
    lastRequestRef.current = currentRequestId;

    if (!isAppend) {
      setLoading(true);
      setErrorMsg("");
    } else {
      setInfiniteLoading(true);
    }
    try {
      const activeSearch =
        searchOverride !== null ? searchOverride : searchQuery;
      const isLinking =
        linkingOverride !== undefined ? linkingOverride : linkingMalItem;

      let endpoint;
      if (isLinking) {
        endpoint = `/api/list/${type}/search?query=${encodeURIComponent(activeSearch)}`;
      } else {
        endpoint = getApiEndpoint(currentFilters.tag);
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: {
            ...currentFilters,
            page: page,
          },
        }),
      });

      if (!response.ok) throw new Error("Network error fetching catalog data.");
      const resData = await response.json();

      if (lastRequestRef.current !== currentRequestId) {
        return;
      }

      if (resData?.extension_missing) {
        if (!isAppend) {
          setErrorMsg(
            `Extension missing. Please install a provider for ${type} in Settings.`,
          );
          setFetchedPages({});
          setLoadedPageStart(1);
          setLoadedPageEnd(1);
          setData({
            results: [],
            totalPages: 0,
            currentPage: 1,
            hasNextPage: false,
          });
        }
      } else if (resData?.error) {
        const lowerMsg = (resData.message || "").toLowerCase();
        const isNoResultsError =
          lowerMsg.includes("no anime found") ||
          lowerMsg.includes("no manga found") ||
          lowerMsg.includes("no results found");

        if (!isAppend) {
          if (!isNoResultsError) {
            setErrorMsg(resData.message || "Failed to fetch catalog.");
          } else {
            setErrorMsg("");
          }
          setFetchedPages({});
          setLoadedPageStart(1);
          setLoadedPageEnd(1);
          setData({
            results: [],
            totalPages: 0,
            currentPage: 1,
            hasNextPage: false,
          });
        }
      } else {
        lastLoadedKeyRef.current = `${type}_${provider}`;
        const sortedResults = applyCustomOrder(
          resData?.results || [],
          currentFilters,
        );
        if (isAppend) {
          setFetchedPages((prev) => ({ ...prev, [page]: sortedResults }));
          setLoadedPageEnd(page);

          setData((prevData) => ({
            ...resData,
            currentPage: page,
            results: [...(prevData?.results || []), ...sortedResults],
          }));
        } else {
          setFetchedPages({ [page]: sortedResults });
          setLoadedPageStart(page);
          setLoadedPageEnd(page);

          setData({
            ...resData,
            currentPage: page,
            results: sortedResults,
          });

          if (infiniteScroll && page > 1) {
            preloadPagesAround(page, currentFilters);
          }
        }
        if (resData?.site && siteFilterDefs[resData.site]) {
          setAvailableFilters(siteFilterDefs[resData.site]);
        } else {
          setAvailableFilters(null);
        }
        didFetchRef.current = true;
      }
    } catch (err) {
      if (lastRequestRef.current !== currentRequestId) {
        return;
      }
      console.error(err);
      if (!isAppend) {
        setErrorMsg(
          "Failed to load data. Please verify your settings or server connection.",
        );
        setFetchedPages({});
        setLoadedPageStart(1);
        setLoadedPageEnd(1);
        setData({
          results: [],
          totalPages: 0,
          currentPage: 1,
          hasNextPage: false,
        });
      }
    } finally {
      if (lastRequestRef.current === currentRequestId) {
        setLoading(false);
        setInfiniteLoading(false);
        isFetchingMoreRef.current = false;
      }
    }
  };

  const handleCancelLinking = () => {
    setLinkingMalItem(null);
    setSearchQuery("");
    fetchData(1, activeFilters, "", null);
  };

  useEffect(() => {
    const cacheKey = `${type}_${provider}`;
    const cache = window.catalogCache[cacheKey];

    if (cache && !initialSearchQuery) {
      lastLoadedKeyRef.current = cacheKey;
      setData(cache.data);
      setSearchQuery(cache.searchQuery);
      setCurrentPage(cache.currentPage);
      setActiveFilters(cache.activeFilters);
      setAvailableFilters(cache.availableFilters);
      setErrorMsg(cache.errorMsg);
      setDiscoverTab(cache.discoverTab);
      setInfiniteScroll(cache.infiniteScroll);
      setFetchedPages(cache.fetchedPages);
      setLoadedPageStart(cache.loadedPageStart);
      setLoadedPageEnd(cache.loadedPageEnd);
      isRestoredRef.current = false;
      didFetchRef.current = true;
    } else {
      if (provider !== "provider" || type !== "Anime") {
        setDiscoverTab("latest");
        sessionStorage.setItem("discover_tab", "latest");
      }

      setCurrentPage(1);
      setLinkingMalItem(null);
      const startQuery = initialSearchQuery || "";
      setSearchQuery(startQuery);
      setFetchedPages({});
      setLoadedPageStart(1);
      setLoadedPageEnd(1);
      isRestoredRef.current = false;
      didFetchRef.current = false;

      const defaultTag =
        provider === "local" ? (type === "Manga" ? "Reading" : "Watching") : "";
      const initFilters = defaultTag ? { tag: defaultTag } : {};
      setActiveFilters(initFilters);
      fetchData(1, initFilters, startQuery, null);
    }

    if (provider === "local") {
      fetch(`/api/local/tags/view/${type}`)
        .then((res) => res.json())
        .then((tags) => setLocalTags(tags))
        .catch((err) => console.error(err));

      // Fetch history stats
      fetch("/api/history/stats")
        .then((res) => res.json())
        .then((sData) => setStats(sData))
        .catch((err) => console.error("Failed to fetch history stats:", err));

      // Fetch recent history
      fetch("/api/history/list?limit=15")
        .then((res) => res.json())
        .then((hData) => {
          const filtered = (hData || []).filter((item) => item.type === type);
          const getGroupKey = (item) => {
            if (item.mal_id) {
              return `mal_${item.mal_id}`;
            }
            const cleanTitle = (item.title || "")
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "");
            return `title_${cleanTitle}`;
          };

          const grouped = {};
          for (const item of filtered) {
            const key = getGroupKey(item);
            const currentNum = Number(item.number) || 0;
            if (
              !grouped[key] ||
              currentNum > (Number(grouped[key].number) || 0)
            ) {
              grouped[key] = item;
            }
          }
          const unique = [];
          const added = new Set();
          for (const item of filtered) {
            const key = getGroupKey(item);
            if (!added.has(key)) {
              added.add(key);
              unique.push(grouped[key]);
            }
          }
          setRecentHistory(unique);
        })
        .catch((err) => console.error("Failed to fetch history list:", err));
    } else {
      setLocalTags([]);
      setStats(null);
      setRecentHistory([]);
    }
  }, [type, provider]);

  const handleDismissHistory = async (item) => {
    setRecentHistory((prev) =>
      prev.filter((x) => {
        if (x.media_id === item.media_id && x.type === item.type) return false;
        if (item.mal_id && x.mal_id === item.mal_id && x.type === item.type)
          return false;
        if (!item.mal_id && !x.mal_id && x.type === item.type) {
          const clean1 = (item.title || "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
          const clean2 = (x.title || "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
          if (clean1 === clean2) return false;
        }
        return true;
      }),
    );

    try {
      await fetch("/api/history/hide", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mediaId: item.media_id,
          type: item.type,
          malId: item.mal_id,
          title: item.title,
        }),
      });
    } catch (err) {
      console.error("Failed to hide entry:", err);
    }
  };

  useEffect(() => {
    if (
      provider === "provider" &&
      type === "Anime" &&
      discoverTab === "calendar"
    ) {
      const fetchCalendar = async () => {
        setCalendarLoading(true);
        try {
          const schedRes = await fetch("/api/schedule/weekly");

          if (schedRes.ok) {
            const sched = await schedRes.json();

            if (sched && typeof sched === "object" && !Array.isArray(sched)) {
              setScheduleData(sched.results || []);
              setScheduleUpdating(!!sched.updating);
            } else {
              setScheduleData(Array.isArray(sched) ? sched : []);
              setScheduleUpdating(false);
            }
          }
        } catch (err) {
          console.error("Failed to load schedule/seasonal calendar:", err);
        } finally {
          setCalendarLoading(false);
        }
      };

      fetchCalendar();
    }
  }, [provider, type, discoverTab]);

  useEffect(() => {
    const ticker = setInterval(() => {
      setTimeTicker(Date.now());
    }, 30000);
    return () => clearInterval(ticker);
  }, []);

  const getCountdownString = (airTimestamp) => {
    const diffMs = airTimestamp * 1000 - timeTicker;
    if (diffMs <= 0) return "Aired";

    const totalMins = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMins / (24 * 60));
    const hours = Math.floor((totalMins % (24 * 60)) / 60);
    const mins = totalMins % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);

    return `In ${parts.join(" ")}`;
  };

  const triggerScrapeSearch = (title) => {
    setDiscoverTab("latest");
    sessionStorage.setItem("discover_tab", "latest");
    const cleanTitle = title.replace(/LiveChart\s+\d+/i, "").trim();
    setSearchQuery(cleanTitle);
    fetchData(1, activeFilters, cleanTitle);
  };

  useEffect(() => {
    const loadPaginationSettings = async () => {
      try {
        if (window.sharedStateAPI && window.sharedStateAPI.getSettings) {
          const resData = await window.sharedStateAPI.getSettings([
            "Pagination",
          ]);
          setInfiniteScroll(resData?.settings?.Pagination === false);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    };
    loadPaginationSettings();
  }, []);

  useEffect(() => {
    if (window.sharedStateAPI && window.sharedStateAPI.on) {
      const handleDownloadComplete = (downloadData) => {
        if (downloadData.Type !== type) return;

        setData((prevData) => {
          if (!prevData || !prevData.results) return prevData;
          const updatedResults = prevData.results.map((item) => {
            const itemBaseId = item.id.replace(/-(sub|dub|both)$/, "");
            const dlBaseId = downloadData.id.replace(/-(sub|dub|both)$/, "");

            if (itemBaseId === dlBaseId) {
              const epNum = parseFloat(downloadData.EpNum);
              if (isNaN(epNum)) return item;

              const currentDownloaded = item.Downloaded || [];
              if (!currentDownloaded.includes(epNum)) {
                return {
                  ...item,
                  Downloaded: [...currentDownloaded, epNum].sort(
                    (a, b) => a - b,
                  ),
                };
              }
            }
            return item;
          });
          return {
            ...prevData,
            results: updatedResults,
          };
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
  }, [type]);

  const handleAddLocalTag = async () => {
    const { value: tagName } = await Swal.fire({
      title: "Create Custom Tag",
      input: "text",
      inputPlaceholder: "Enter tag name...",
      showCancelButton: true,
      confirmButtonText: "Create Tag",
      cancelButtonText: "Cancel",
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      confirmButtonColor: "var(--accent)",
      cancelButtonColor: "var(--bg-tertiary)",
      customClass: {
        confirmButton: "swal-confirm-btn",
        cancelButton: "swal-cancel-btn",
        popup: "swal-custom-popup",
      },
    });
    if (tagName && tagName.trim()) {
      const trimmed = tagName.trim();
      const forbidden = [
        "watching",
        "plan to watch",
        "reading",
        "plan to read",
        "downloads",
      ];
      if (forbidden.includes(trimmed.toLowerCase())) {
        swalError(
          "Reserved Tag Name",
          `"${trimmed}" is a reserved system tag and cannot be created manually.`,
        );
        return;
      }
      if (!localTags.includes(trimmed)) {
        setLocalTags((prev) => [...prev, trimmed]);
        Swal.fire({
          title: "Tag Created",
          text: `Tag "${trimmed}" created. You can now assign it to items in their details page!`,
          icon: "success",
          toast: true,
          position: "top-end",
          showConfirmButton: false,
          timer: 3000,
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
        });
      }
    }
  };

  const handleMediaClick = (item) => {
    if (linkingMalItem) {
      // Link the clicked provider item to the MAL item!
      Swal.fire({
        title: "Link Title",
        text: `Link "${item.title}" to MyAnimeList entry "${linkingMalItem.title}"?`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Yes, link it",
        cancelButtonText: "Cancel",
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
        confirmButtonColor: "var(--accent)",
        cancelButtonColor: "var(--bg-tertiary)",
      }).then((result) => {
        if (result.isConfirmed) {
          Swal.fire({
            title: "Linking...",
            allowOutsideClick: false,
            didOpen: () => {
              Swal.showLoading();
            },
          });

          apiPost("/api/local/tags/add", {
            type: type,
            id: item.id,
            provider:
              item.provider !== "provider" && item.provider !== "local source"
                ? item.provider
                : undefined,
            MalID: linkingMalItem.MalID || linkingMalItem.id,
          }).then((linkRes) => {
            if (!linkRes.error) {
              swalSuccess(
                "Linked!",
                `Successfully linked to "${item.title}"!`,
              ).then(() => {
                setLinkingMalItem(null);
                setSearchQuery("");
                fetchData(1, activeFilters, "", null);
              });
            } else {
              swalError("Error", linkRes.message || "Failed to link title.");
            }
          });
        }
      });
      return;
    }

    const isMalActive = provider === "mal";

    // Determine what back text to display
    let backText = "Back to Collection";
    if (searchQuery.trim().length > 0) {
      backText = "Back to Search";
    } else if (provider === "local") {
      if (activeFilters.tag) {
        backText = `Back to ${activeFilters.tag}`;
      } else {
        backText = "Back to Collection";
      }
    } else if (provider === "provider") {
      backText = "Back to Recently Updated";
    } else if (provider === "mal") {
      backText = "Back to MAL Library";
    }

    if (isMalActive && item.allMatches && item.allMatches.length > 1) {
      const inputOptions = {};
      item.allMatches.forEach((m) => {
        inputOptions[m.id] = m.provider.toUpperCase();
      });

      Swal.fire({
        title: "Select Provider",
        text: `Choose which provider to open "${item.title}" with:`,
        icon: "question",
        input: "select",
        inputOptions,
        inputValue: item.id,
        showCancelButton: true,
        confirmButtonText: "Open",
        cancelButtonText: "Cancel",
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
        confirmButtonColor: "var(--accent)",
        cancelButtonColor: "var(--bg-tertiary)",
      }).then((result) => {
        if (result.isConfirmed && result.value) {
          onSelectMedia(result.value, "mal", backText);
        }
      });
      return;
    }

    onSelectMedia(item.id, isMalActive ? "mal" : provider, backText);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchData(1);
  };

  const handleFilterChange = (filterName, val) => {
    const nextFilters = { ...activeFilters };
    if (val === "") {
      delete nextFilters[filterName];
    } else {
      nextFilters[filterName] = val;
    }
    setActiveFilters(nextFilters);
    setCurrentPage(1);
    fetchData(1, nextFilters);
  };

  const handlePageChange = (page) => {
    if (page < 1) return;
    setCurrentPage(page);
    fetchData(page);
  };

  const handleLoadPrevPage = async (prevPage) => {
    if (fetchedPages[prevPage]) {
      if (wrapperRef.current) {
        lastScrollHeightRef.current = wrapperRef.current.scrollHeight;
        pendingScrollAdjustRef.current = {
          type: "prepend",
          pageSize: fetchedPages[prevPage].length,
        };
      }

      setFetchedPages((prev) => {
        let newStart = prevPage;
        let newEnd = loadedPageEnd;
        if (newEnd - newStart + 1 > 3) {
          newEnd -= 1;
        }

        const newResults = [];
        for (let p = newStart; p <= newEnd; p++) {
          const pageData = prev[p];
          if (pageData) {
            newResults.push(...pageData);
          }
        }

        setLoadedPageStart(newStart);
        setLoadedPageEnd(newEnd);
        setData((prevData) => ({
          ...prevData,
          currentPage: prevPage,
          results: newResults,
        }));

        return prev;
      });
      isFetchingPrevRef.current = false;
      return;
    }

    if (wrapperRef.current) {
      lastScrollHeightRef.current = wrapperRef.current.scrollHeight;
      pendingScrollAdjustRef.current = "prepend";
    }
    setInfiniteLoading(true);
    try {
      const activeSearch = searchQuery;
      let endpoint = getApiEndpoint(activeFilters.tag);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: {
            ...activeFilters,
            page: prevPage,
          },
        }),
      });
      if (response.ok) {
        const resData = await response.json();
        const sortedResults = applyCustomOrder(
          resData?.results || [],
          activeFilters,
        );

        if (wrapperRef.current) {
          pendingScrollAdjustRef.current = {
            type: "prepend",
            pageSize: sortedResults.length,
          };
        }

        setFetchedPages((prev) => {
          const nextPages = { ...prev, [prevPage]: sortedResults };

          let newStart = prevPage;
          let newEnd = loadedPageEnd;

          const newResults = [];
          for (let p = newStart; p <= newEnd; p++) {
            const pageData = p === prevPage ? sortedResults : prev[p];
            if (pageData) {
              newResults.push(...pageData);
            }
          }

          setLoadedPageStart(newStart);
          setLoadedPageEnd(newEnd);
          setData((prevData) => ({
            ...prevData,
            currentPage: prevPage,
            results: newResults,
          }));

          return nextPages;
        });
      }
    } catch (err) {
      console.error("Failed to fetch prev page:", err);
    } finally {
      setInfiniteLoading(false);
      isFetchingPrevRef.current = false;
    }
  };

  useEffect(() => {
    if (infiniteObserverRef.current) {
      infiniteObserverRef.current.disconnect();
      infiniteObserverRef.current = null;
    }
    if (!infiniteScroll || !sentinelRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          entry.isIntersecting &&
          !loading &&
          !infiniteLoading &&
          !isFetchingMoreRef.current &&
          (data.hasNextPage || loadedPageEnd < (data.totalPages || 0))
        ) {
          const nextPage = loadedPageEnd + 1;
          isFetchingMoreRef.current = true;
          fetchData(nextPage, activeFilters, searchQuery, undefined, true);
        }
      },
      { root: wrapperRef.current, threshold: 0.1 },
    );

    observer.observe(sentinelRef.current);
    infiniteObserverRef.current = observer;

    return () => observer.disconnect();
  }, [
    infiniteScroll,
    loading,
    infiniteLoading,
    data.hasNextPage,
    data.totalPages,
    loadedPageEnd,
    activeFilters,
    searchQuery,
    discoverTab,
  ]);

  useEffect(() => {
    if (topObserverRef.current) {
      topObserverRef.current.disconnect();
      topObserverRef.current = null;
    }
    if (!infiniteScroll || !topSentinelRef.current || loadedPageStart <= 1)
      return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          entry.isIntersecting &&
          !loading &&
          !infiniteLoading &&
          !isFetchingPrevRef.current
        ) {
          const prevPage = loadedPageStart - 1;
          isFetchingPrevRef.current = true;
          handleLoadPrevPage(prevPage);
        }
      },
      { root: wrapperRef.current, threshold: 0.1 },
    );

    observer.observe(topSentinelRef.current);
    topObserverRef.current = observer;

    return () => observer.disconnect();
  }, [
    infiniteScroll,
    loading,
    infiniteLoading,
    loadedPageStart,
    loadedPageEnd,
    fetchedPages,
    activeFilters,
    searchQuery,
    discoverTab,
  ]);

  return (
    <div ref={wrapperRef} onScroll={handleScroll} className="catalog-wrapper">
      <header className="catalog-header">
        <div className="catalog-header-row">
          <h1 className="catalog-title">
            {provider === "local"
              ? "Home"
              : provider === "mal"
                ? `MyAnimeList`
                : "Discover"}
          </h1>
          <div className="market-tabs-wrapper">
            <button
              type="button"
              onClick={() => onTypeChange && onTypeChange("Anime")}
              className={`market-tab-btn ${type === "Anime" ? "active" : ""}`}
            >
              Anime
            </button>
            <button
              type="button"
              onClick={() => onTypeChange && onTypeChange("Manga")}
              className={`market-tab-btn ${type === "Manga" ? "active" : ""}`}
            >
              Manga
            </button>
          </div>
        </div>

        {provider === "provider" && type === "Anime" && (
          <div className="discover-sub-tabs">
            <button
              onClick={() => {
                setDiscoverTab("latest");
                sessionStorage.setItem("discover_tab", "latest");
              }}
              className={`discover-sub-tab ${discoverTab === "latest" ? "active" : ""}`}
            >
              Latest
            </button>
            <button
              onClick={() => {
                setDiscoverTab("calendar");
                sessionStorage.setItem("discover_tab", "calendar");
              }}
              className={`discover-sub-tab ${discoverTab === "calendar" ? "active" : ""}`}
            >
              Airing Calendar
            </button>
          </div>
        )}

        {((provider !== "local" && provider !== "mal") || linkingMalItem) &&
          discoverTab !== "calendar" && (
            <form
              onSubmit={handleSearchSubmit}
              className="search-form"
            >
              <input
                type="text"
                placeholder={`Search ${type}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
              <button type="submit" className="btn-search">
                <Search size={18} />
              </button>
            </form>
          )}
      </header>

      {/* Local Library Stats Dashboard */}
      {provider === "local" && stats && !linkingMalItem && (
        <div className="library-stats-container">
          <div className="library-stat-card glass-panel">
            <div className="stat-icon-wrapper purple-glow">
              <Clock size={16} className="stat-icon" />
            </div>
            <span className="stat-value">
              {type === "Anime"
                ? `${stats.watchHours || 0} hrs`
                : `${stats.readHours || 0} hrs`}
            </span>
          </div>

          <div className="library-stat-card glass-panel">
            <div className="stat-icon-wrapper green-glow">
              <CheckSquare size={16} className="stat-icon" />
            </div>
            <span className="stat-value">
              {type === "Anime"
                ? `${stats.completedEpisodes || 0} eps`
                : `${stats.completedChapters || 0} chs`}
            </span>
          </div>

          <div className="library-stat-card glass-panel">
            <div className="stat-icon-wrapper blue-glow">
              {type === "Anime" ? (
                <Tv size={16} className="stat-icon" />
              ) : (
                <BookOpen size={16} className="stat-icon" />
              )}
            </div>
            <span className="stat-value">
              {type === "Anime"
                ? `${stats.distinctAnime || 0} Anime`
                : `${stats.distinctManga || 0} Manga`}
            </span>
          </div>
        </div>
      )}

      {/* Continue Watching / Continue Reading Shelf */}
      {provider === "local" &&
        !linkingMalItem &&
        (() => {
          const displayable = (recentHistory || []).filter((item) => {
            if (item.is_completed === 0) return true;
            if (
              item.total_count === null ||
              item.total_count === undefined ||
              item.number < item.total_count
            ) {
              return true;
            }
            return false;
          });

          if (displayable.length === 0) return null;

          return (
            <div className="continue-shelf-container">
              <h2 className="shelf-title">
                {type === "Anime" ? "Continue Watching" : "Continue Reading"}
              </h2>
              <div className="continue-shelf-scroll">
                {displayable.slice(0, 4).map((item) => {
                  const isItemCompleted = item.is_completed === 1;
                  const nextNum = isItemCompleted
                    ? item.number + 1
                    : item.number;
                  const progress = isItemCompleted
                    ? 0
                    : item.duration > 0
                      ? Math.min(
                          100,
                          Math.max(
                            0,
                            Math.round(
                              (item.current_time / item.duration) * 100,
                            ),
                          ),
                        )
                      : 0;

                  return (
                    <div
                      key={`${item.media_id}-${item.number}`}
                      className="continue-card glass-panel"
                      onClick={() =>
                        onSelectMedia(
                          item.media_id,
                          "local",
                          "Back to Collection",
                          true,
                        )
                      }
                    >
                      <div className="continue-img-container">
                        <button
                          className="continue-dismiss-btn"
                          title={`Hide from Continue ${type === "Anime" ? "Watching" : "Reading"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDismissHistory(item);
                          }}
                        >
                          <X size={14} />
                        </button>
                        <img
                          src={item.image || "/images/image-404.png"}
                          alt={item.title}
                          className="continue-img"
                          onError={(e) => {
                            e.target.src = "/images/image-404.png";
                          }}
                        />
                        <div className="continue-play-overlay">
                          <Play size={28} className="continue-play-icon" />
                        </div>
                        <div className="continue-progress-container">
                          <div
                            className="continue-progress-bar"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                      <div className="continue-info">
                        <span className="continue-number">
                          {type === "Anime"
                            ? `Episode ${nextNum}`
                            : `Chapter ${nextNum}`}
                        </span>
                        <h4 className="continue-title" title={item.title}>
                          {item.title}
                        </h4>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

      {/* Filter panel */}
      {availableFilters && (
        <div className="filter-panel">
          {Object.entries(availableFilters).map(([key, filter]) => (
            <div key={key} className="filter-group">
              <label className="filter-label">{filter.label}</label>
              <select
                value={activeFilters[key] || ""}
                onChange={(e) => handleFilterChange(key, e.target.value)}
                className="filter-select"
              >
                {Object.entries(filter.options).map(([optLabel, optVal]) => (
                  <option key={optLabel} value={optVal}>
                    {optLabel}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Local Tag Filter panel */}
      {provider === "local" && !linkingMalItem && (
        <div className="tag-chips-container">
          {localTags.map((tag) => (
            <button
              key={tag}
              onClick={() => handleFilterChange("tag", tag)}
              className={`tag-chip ${activeFilters.tag === tag ? "active" : ""}`}
            >
              {tag}
            </button>
          ))}
          <button
            onClick={handleAddLocalTag}
            className="tag-chip btn-add-tag"
            title="Create Custom Tag"
          >
            <Plus size={14} className="u-style-16" />
            Add Tag
          </button>
        </div>
      )}

      {/* Linking Banner */}
      {linkingMalItem && (
        <div className="linking-banner">
          <span className="linking-banner-text">
            Linking MyAnimeList title: <strong>{linkingMalItem.title}</strong>.
            Select the matching card below to link it.
          </span>
          <button onClick={handleCancelLinking} className="btn-cancel-link">
            Cancel Link
          </button>
        </div>
      )}

      {errorMsg && <div className="error-banner">{errorMsg}</div>}

      {discoverTab === "calendar" ? (
        calendarLoading ? (
          <div className="loading-center-panel">
            <img
              src="/images/loading.gif"
              alt="loading"
              className="u-style-17"
            />
            <p className="u-style-18">Loading calendar & airing schedule...</p>
          </div>
        ) : (
          <div className="calendar-view-container">
            {/* Weekly Airing Schedule Section */}
            <div className="calendar-section">
              <h2 className="calendar-section-title">Weekly Airing Schedule</h2>
              {scheduleUpdating && (
                <div className="schedule-updating-banner u-style-19">
                  <div className="pulse-dot u-style-20" />
                  <span className="u-style-21">
                    Refreshing airing schedule from LiveChart...
                  </span>
                  <span className="u-style-22">
                    Fresh episodes will display automatically
                  </span>
                </div>
              )}
              {/* Horizontal Day Tabs Navigation */}
              {(() => {
                const daysOfWeek = [
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ];
                const today = new Date();
                const tabs = ["All", "Today", "Tomorrow"];
                for (let i = 2; i < 7; i++) {
                  const nextDate = new Date(
                    today.getTime() + i * 24 * 60 * 60 * 1000,
                  );
                  tabs.push(daysOfWeek[nextDate.getDay()]);
                }

                return (
                  <div className="calendar-tabs-container">
                    {tabs.map((day) => {
                      const isActive = calendarDayFilter === day;
                      return (
                        <button
                          key={day}
                          className={`calendar-day-tab ${isActive ? "active" : ""}`}
                          onClick={() => setCalendarDayFilter(day)}
                        >
                          {day === "All"
                            ? "ALL"
                            : day === "Today"
                              ? "TODAY"
                              : day === "Tomorrow"
                                ? "TOMORROW"
                                : day.substring(0, 3).toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              <div className="schedule-feed-container">
                {(() => {
                  const days = [
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ];
                  const scheduleByDay = [];
                  const today = new Date();

                  for (let i = 0; i < 7; i++) {
                    const targetDate = new Date(
                      today.getTime() + i * 24 * 60 * 60 * 1000,
                    );
                    const dayName = days[targetDate.getDay()];
                    const dateStr = targetDate.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    });

                    const dayStart =
                      new Date(
                        targetDate.getFullYear(),
                        targetDate.getMonth(),
                        targetDate.getDate(),
                        0,
                        0,
                        0,
                      ).getTime() / 1000;
                    const dayEnd = dayStart + 24 * 3600;

                    const dayEpisodes = scheduleData.filter(
                      (ep) => ep.date >= dayStart && ep.date < dayEnd,
                    );

                    scheduleByDay.push({
                      dayName:
                        i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayName,
                      dateStr,
                      episodes: dayEpisodes,
                    });
                  }

                  const filteredGroups = scheduleByDay.filter((group) => {
                    if (calendarDayFilter === "All") return true;
                    return group.dayName === calendarDayFilter;
                  });

                  const totalEpisodesCount = filteredGroups.reduce(
                    (acc, g) => acc + g.episodes.length,
                    0,
                  );

                  if (totalEpisodesCount === 0) {
                    return (
                      <div className="schedule-empty-state glass-panel">
                        <div className="empty-state-icon">
                          <Tv size={36} className="u-style-23" />
                        </div>
                        <h3>
                          No episodes airing{" "}
                          {calendarDayFilter !== "All"
                            ? calendarDayFilter.toLowerCase()
                            : "this week"}
                        </h3>
                        <p>
                          Check back later or view other days in the calendar.
                        </p>
                      </div>
                    );
                  }

                  return filteredGroups.map((group) => {
                    if (group.episodes.length === 0) return null;

                    return (
                      <div key={group.dayName} className="schedule-day-section">
                        <div className="schedule-section-header">
                          <span className="section-day-name">
                            {group.dayName}
                          </span>
                          <span className="section-day-date">
                            {group.dateStr}
                          </span>
                        </div>

                        <div className="schedule-vertical-list">
                          {group.episodes.map((ep) => {
                            const airTime = new Date(
                              ep.date * 1000,
                            ).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            });

                            const isAired = ep.date * 1000 <= timeTicker;
                            const countdownStr = getCountdownString(ep.date);

                            return (
                              <div
                                key={`${ep.livechart_id}-${ep.episode}`}
                                className="schedule-row-card glass-panel"
                                onClick={() => {
                                  if (ep.malid) {
                                    onSelectMedia(
                                      ep.malid,
                                      "mal",
                                      "Back to Calendar",
                                      undefined,
                                      ep.title,
                                    );
                                  } else {
                                    triggerScrapeSearch(ep.title);
                                  }
                                }}
                              >
                                <div className="schedule-row-left">
                                  {ep.image ? (
                                    <img
                                      src={ep.image}
                                      alt={ep.title}
                                      className="schedule-row-img"
                                    />
                                  ) : (
                                    <div className="schedule-row-no-img">
                                      <Tv size={20} />
                                    </div>
                                  )}
                                </div>
                                <div className="schedule-row-middle">
                                  <h4
                                    className="schedule-row-title"
                                    title={ep.title}
                                  >
                                    {ep.title}
                                  </h4>
                                  <span className="schedule-row-num">
                                    Episode {ep.episode}
                                  </span>
                                </div>
                                <div className="schedule-row-right">
                                  <span className="schedule-row-time">
                                    <Clock size={12} className="u-style-16" />
                                    {airTime}
                                  </span>
                                  <span
                                    className={`schedule-row-countdown ${isAired ? "aired" : "airing"}`}
                                  >
                                    {countdownStr}
                                  </span>
                                  {isAired && (
                                    <button
                                      className="schedule-row-scrape-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        triggerScrapeSearch(ep.title);
                                      }}
                                    >
                                      <Search size={12} />
                                      <span>Find Stream</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )
      ) : /* Content grid */
      loading ? (
        <div className="loading-center-panel">
          <img src="/images/loading.gif" alt="loading" className="u-style-17" />
          <p className="u-style-18">Fetching collection...</p>
        </div>
      ) : data?.results?.length === 0 ? (
        <div className="empty-center-panel">
          <span className="u-style-24">🍉</span>
          <h3>
            {provider === "local" ? "Empty Collection" : "No results found"}
          </h3>
          <p className="u-style-25">
            {provider === "local"
              ? activeFilters.tag
                ? `No items found tagged with "${activeFilters.tag}".`
                : `Your local ${type.toLowerCase()} library is empty.`
              : provider === "mal"
                ? `No items found in your MyAnimeList ${type.toLowerCase()} library.`
                : searchQuery.trim().length > 0
                  ? "Try checking your spelling or using different search terms."
                  : "Try changing your selected filters."}
          </p>
        </div>
      ) : (
        <div className="content-container">
          {infiniteScroll && loadedPageStart > 1 && (
            <div
              ref={topSentinelRef}
              className="infinite-sentinel-top"
              style={{ height: "1px" }}
            />
          )}
          <div className="content-grid">
            {data.results.map((item, index) => (
              <div
                key={item.id}
                draggable
                data-index={index}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={(e) => handleDragLeave(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                onTouchStart={(e) => handleTouchStart(e, index)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onClick={() => handleMediaClick(item)}
                className={`media-card glass-panel ${draggedIndex === index ? "is-dragging" : ""} ${dragOverIndex === index ? "is-drag-over" : ""}`}
                title="Hold & drag to reorder title"
              >
                <div className="img-container">
                  <img
                    src={item.image || "/images/image-404.png"}
                    alt={item.title}
                    className="media-img"
                    onError={(e) => {
                      e.target.src = "/images/image-404.png";
                    }}
                  />

                  {/* Indicator badges for downloaded or watched counts */}
                  <div className="card-badges-container">
                    {item.Downloaded && item.Downloaded.length > 0 && (
                      <div className="indicator-badge">
                        <Download size={12} className="u-style-16" />
                        {item.Downloaded.length}{" "}
                        {type === "Anime" ? "Eps" : "Chs"}
                      </div>
                    )}

                    {item.nextEpisodeIn ? (
                      <div
                        className="indicator-badge schedule-badge"
                        title="Next release countdown"
                      >
                        <Film size={12} className="u-style-16" />
                        {item.nextEpisodeIn}
                      </div>
                    ) : (
                      item.watched !== undefined &&
                      item.watched !== null && (
                        <div className="indicator-badge">
                          <Eye size={12} className="u-style-16" />
                          {item.watched}/{item.totalEpisodes || "?"}
                        </div>
                      )
                    )}
                  </div>
                </div>

                <div className="card-info">
                  <h4 className="card-title">{item.title}</h4>
                </div>
              </div>
            ))}
          </div>

          {/* Infinite scroll sentinel */}
          {infiniteScroll && (
            <div ref={sentinelRef} className="infinite-sentinel">
              {infiniteLoading && (
                <div className="infinite-loading-indicator">
                  <Loader2 size={22} className="infinite-spin" />
                  <span>Loading more...</span>
                </div>
              )}
              {!infiniteLoading &&
                !data.hasNextPage &&
                currentPage >= (data.totalPages || 1) &&
                data.results.length > 0 && (
                  <div className="infinite-end-label">
                    You've reached the end ✨
                  </div>
                )}
            </div>
          )}

          {/* Pagination */}
          {!infiniteScroll &&
            (data.totalPages > 1 || data.hasNextPage || currentPage > 1) && (
              <div className="pagination-container">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="btn-page"
                >
                  <ArrowLeft size={16} />
                </button>
                <span className="page-info">
                  Page {currentPage}{" "}
                  {data.totalPages ? `of ${data.totalPages}` : ""}
                </span>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={
                    !data.hasNextPage && currentPage >= (data.totalPages || 999)
                  }
                  className="btn-page"
                >
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// Deterministic colour from provider name string
function providerColour(name) {
  const palette = [
    "#7c3aed",
    "#db2777",
    "#d97706",
    "#059669",
    "#0891b2",
    "#4f46e5",
    "#c026d3",
    "#dc2626",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

// Small provider badge rendered bottom-right of card image
function ProviderBadge({ providerName, iconUrl }) {
  const [imgFailed, setImgFailed] = useState(false);
  const label =
    providerName === "local source"
      ? "📁"
      : providerName.substring(0, 2).toUpperCase();
  const colour = providerColour(providerName);
  const friendlyName =
    providerName === "local source" ? "Local file" : providerName;

  return (
    <div
      title={friendlyName}
      className="provider-badge-wrapper"
      style={{
        border: `1px solid ${colour}55`,
        boxShadow: `0 0 0 1px ${colour}33`,
      }}
    >
      {iconUrl && !imgFailed ? (
        <img
          src={iconUrl}
          alt={providerName}
          width={14}
          height={14}
          className="provider-badge-img"
          onError={() => setImgFailed(true)}
        />
      ) : providerName === "local source" ? (
        <Folder size={14} className="u-style-26" />
      ) : (
        <span
          className="provider-badge-text-icon"
          style={{ backgroundColor: colour }}
        >
          {label.charAt(0)}
        </span>
      )}
      <span className="provider-badge-label">{friendlyName}</span>
    </div>
  );
}
