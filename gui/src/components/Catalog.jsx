/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, no-unused-vars */
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import "./css/Catalog.css";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
  RotateCcw,
  Clock,
  LogIn,
} from "lucide-react";
import Swal from "sweetalert2";
import { swalSuccess, swalError, swalConfirm } from "../utils/swal";
import { apiPost, parseTags } from "../utils/common";

import CatalogHeader from "./catalog/CatalogHeader";
import LibraryStats from "./catalog/LibraryStats";
import RecentHistory from "./catalog/RecentHistory";
import AiringCalendar from "./catalog/AiringCalendar";
import CatalogGrid from "./catalog/CatalogGrid";
import TagPickerModal from "./catalog/TagPickerModal";

const UNIVERSAL_GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Demons",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Game",
  "Harem",
  "Historical",
  "Horror",
  "Isekai",
  "Josei",
  "Kids",
  "Magic",
  "Martial Arts",
  "Mecha",
  "Military",
  "Music",
  "Mystery",
  "Parody",
  "Psychological",
  "Romance",
  "Samurai",
  "School",
  "Sci-Fi",
  "Seinen",
  "Shoujo",
  "Shounen",
  "Slice of Life",
  "Space",
  "Sports",
  "Supernatural",
  "Suspense",
  "Thriller",
  "Vampire",
];

const SEASONS_LIST = ["Winter", "Spring", "Summer", "Fall"];

const YEARS_LIST = [
  2027,
  2026,
  2025,
  2024,
  2023,
  2022,
  2021,
  2020,
  2019,
  2018,
  2017,
  2016,
  2015,
  2010,
  "Older",
];

const MAPPING_OPTIONS = [
  { label: "All", value: "" },
  { label: "Mapped (MAL Linked)", value: "mapped" },
  { label: "Unmapped (Unique to Extension)", value: "unmapped" },
];

const getMalStatusOptions = (type) => {
  const isManga = type === "Manga";
  return [
    { label: "All", value: "" },
    {
      label: isManga ? "Reading" : "Watching",
      value: isManga ? "reading" : "watching",
    },
    { label: "Completed", value: "completed" },
    {
      label: isManga ? "Plan to Read" : "Plan to Watch",
      value: isManga ? "plan_to_read" : "plan_to_watch",
    },
    { label: "On Hold", value: "on_hold" },
    { label: "Dropped", value: "dropped" },
  ];
};

const STATUS_OPTIONS = [
  { label: "All", value: "" },
  { label: "Currently Airing / Ongoing", value: "airing" },
  { label: "Finished / Completed", value: "completed" },
  { label: "Upcoming", value: "upcoming" },
];

const FORMAT_OPTIONS = [
  { label: "All", value: "" },
  { label: "TV", value: "TV" },
  { label: "Movie", value: "Movie" },
  { label: "OVA", value: "OVA" },
  { label: "ONA", value: "ONA" },
  { label: "Special", value: "Special" },
  { label: "Manga", value: "Manga" },
  { label: "Manhwa", value: "Manhwa" },
  { label: "Manhua", value: "Manhua" },
];

function matchSeasonYearClient(airedStr, season, year) {
  if (!airedStr && (season || year)) return false;
  if (!season && !year) return true;
  const s = String(airedStr).toLowerCase();

  if (year && year !== "All" && year !== "") {
    if (year === "Older") {
      const match = s.match(/\b(19\d\d|200\d)\b/);
      if (!match) return false;
    } else if (!s.includes(String(year).toLowerCase())) {
      return false;
    }
  }

  if (season && season !== "All" && season !== "") {
    const sLower = season.toLowerCase();
    if (s.includes(sLower)) return true;

    const winterMonths = ["jan", "feb", "mar", "-01-", "-02-", "-03-"];
    const springMonths = ["apr", "may", "jun", "-04-", "-05-", "-06-"];
    const summerMonths = ["jul", "aug", "sep", "-07-", "-08-", "-09-"];
    const fallMonths = ["oct", "nov", "dec", "-10-", "-11-", "-12-"];

    let months = [];
    if (sLower === "winter") months = winterMonths;
    else if (sLower === "spring") months = springMonths;
    else if (sLower === "summer") months = summerMonths;
    else if (sLower === "fall") months = fallMonths;

    return months.some((m) => s.includes(m));
  }

  return true;
}

function matchItemFilters(item, filters) {
  if (!item || !filters || Object.keys(filters).length === 0) return true;

  // 1. Tag filter
  if (filters.tag && filters.tag !== "All" && filters.tag !== "") {
    const targetTag = String(filters.tag).toLowerCase().trim();
    if (targetTag === "downloads") {
      const hasDl =
        (Array.isArray(item.Downloaded) && item.Downloaded.length > 0) ||
        (Array.isArray(item.DownloadedChapters) &&
          item.DownloadedChapters.length > 0) ||
        (Array.isArray(item.DownloadedEpisodes) &&
          item.DownloadedEpisodes.length > 0) ||
        (item.DownloadedEpisodes?.sub?.length || 0) +
          (item.DownloadedEpisodes?.dub?.length || 0) >
          0;
      if (hasDl) return true;
      if (!item.CustomTag) return false;
      const tags = parseTags(item.CustomTag);
      return tags.some(
        (t) => t && String(t).toLowerCase().trim() === targetTag,
      );
    } else {
      if (!item.CustomTag) return false;
      const tags = parseTags(item.CustomTag);
      const hasTag = tags.some(
        (t) => t && String(t).toLowerCase().trim() === targetTag,
      );
      if (!hasTag) return false;
    }
  }

  // 2. Mapping filter (mapped vs unmapped aka unique to extension)
  if (filters.mapping && filters.mapping !== "All" && filters.mapping !== "") {
    const isMapped = Boolean(item.malid || item.MalID);
    if (filters.mapping === "mapped" && !isMapped) return false;
    if (filters.mapping === "unmapped" && isMapped) return false;
  }

  // 3. MAL Status filter
  if (
    filters.malStatus &&
    filters.malStatus !== "All" &&
    filters.malStatus !== ""
  ) {
    const targetStatus = String(filters.malStatus).toLowerCase();
    const itemStatus = String(item.malStatus || "").toLowerCase();
    if (targetStatus === "watching" || targetStatus === "reading") {
      if (itemStatus !== "watching" && itemStatus !== "reading") {
        return false;
      }
    } else if (
      targetStatus === "plan_to_watch" ||
      targetStatus === "plan_to_read"
    ) {
      if (itemStatus !== "plan_to_watch" && itemStatus !== "plan_to_read") {
        return false;
      }
    } else if (targetStatus === "completed") {
      if (itemStatus !== "completed") return false;
    } else if (itemStatus !== targetStatus) {
      return false;
    }
  }

  // 4. Genre filter
  if (filters.genre && filters.genre !== "All" && filters.genre !== "") {
    if (item.genres) {
      const targetGenre = String(filters.genre).toLowerCase();
      if (!String(item.genres).toLowerCase().includes(targetGenre))
        return false;
    }
  }

  // 5. Season & Year
  if (filters.season || filters.year) {
    if (item.aired) {
      if (!matchSeasonYearClient(item.aired, filters.season, filters.year)) {
        return false;
      }
    }
  }

  // 6. Source / Extension filter
  if (filters.source && filters.source !== "All" && filters.source !== "") {
    const targetSource = String(filters.source).toLowerCase();
    const itemSource = String(item.provider || "").toLowerCase();
    if (!itemSource.includes(targetSource)) return false;
  }

  // 7. Format / Type filter
  if (filters.format && filters.format !== "All" && filters.format !== "") {
    if (item.type) {
      if (
        String(item.type).toLowerCase() !== String(filters.format).toLowerCase()
      ) {
        return false;
      }
    }
  }

  // 8. Airing / Publishing Status filter
  if (filters.status && filters.status !== "All" && filters.status !== "") {
    if (item.status) {
      const targetStatus = String(filters.status).toLowerCase();
      const itemStatus = String(item.status).toLowerCase();
      if (targetStatus === "airing" || targetStatus === "ongoing") {
        if (!itemStatus.includes("airing") && !itemStatus.includes("ongoing")) {
          return false;
        }
      } else if (targetStatus === "completed" || targetStatus === "finished") {
        if (
          !itemStatus.includes("completed") &&
          !itemStatus.includes("finished")
        ) {
          return false;
        }
      } else if (!itemStatus.includes(targetStatus)) {
        return false;
      }
    }
  }

  return true;
}

export default function Catalog({
  type,
  provider,
  onSelectMedia,
  onTypeChange,
  initialSearchQuery = "",
  malLoggedIn = false,
  onNavigate,
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
  const [activeFilters, setActiveFilters] = useState(() => {
    if (cache?.activeFilters && Object.keys(cache.activeFilters).length > 0) {
      return cache.activeFilters;
    }
    if (provider === "local") {
      const savedTag = sessionStorage.getItem(`active_tag_${type}`);
      const defaultTag =
        savedTag || (type === "Manga" ? "Reading" : "Watching");
      return { tag: defaultTag };
    }
    return {};
  });
  const [availableFilters, setAvailableFilters] = useState(
    () => cache?.availableFilters || null,
  );
  const [errorMsg, setErrorMsg] = useState(() => cache?.errorMsg || "");
  const [localTags, setLocalTags] = useState([]);
  const [tagModalMedia, setTagModalMedia] = useState(null);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(
    () => provider === "mal",
  );
  const [installedProvidersList, setInstalledProvidersList] = useState([]);
  const [providerMetadataList, setProviderMetadataList] = useState([]);
  const [catalogSource, setCatalogSource] = useState(() => {
    return sessionStorage.getItem(`catalog_source_${type}`) || "mal";
  });
  const [totalCount, setTotalCount] = useState(null);
  const tagChipsRef = useRef(null);

  const filteredProviders = useMemo(() => {
    return providerMetadataList.filter(
      (p) => p.media_type === type && p.table_name !== "anineko",
    );
  }, [providerMetadataList, type]);

  useEffect(() => {
    const fetchProviderMetadata = async () => {
      try {
        const res = await fetch("/api/providers/metadata").then((r) =>
          r.json(),
        );
        if (res?.providers && Array.isArray(res.providers)) {
          setProviderMetadataList(res.providers);
          if (catalogSource && catalogSource.startsWith("unique:")) {
            const match = res.providers.find(
              (p) =>
                p.media_type === type &&
                `unique:${p.table_name}` === catalogSource,
            );
            if (!match) {
              setCatalogSource("mal");
              sessionStorage.setItem(`catalog_source_${type}`, "mal");
            }
          }
        }
      } catch (_) {}
    };
    fetchProviderMetadata();
  }, [type]);

  useEffect(() => {
    const fetchInstalledProviders = async () => {
      try {
        if (window.sharedStateAPI && window.sharedStateAPI.getSettings) {
          const res = await window.sharedStateAPI.getSettings([
            "providers",
            "installedExtensions",
          ]);
          const pList = res?.settings?.providers?.[type] || [];
          setInstalledProvidersList(pList);
        }
      } catch (_) {}
    };
    fetchInstalledProviders();
  }, [type]);

  const allAvailableProviders = useMemo(() => {
    const set = new Set(installedProvidersList);
    if (data?.results && Array.isArray(data.results)) {
      data.results.forEach((i) => {
        if (
          i.provider &&
          i.provider !== "local source" &&
          i.provider !== "provider"
        ) {
          set.add(i.provider);
        }
      });
    }
    return Array.from(set).sort();
  }, [installedProvidersList, data?.results]);

  const activeFilterCount = useMemo(() => {
    return Object.entries(activeFilters).filter(([k, v]) => {
      if (k === "page") return false;
      if (v === "" || v === "All" || v == null) return false;
      return true;
    }).length;
  }, [activeFilters]);

  const displayResults = useMemo(() => {
    if (!data?.results || !Array.isArray(data.results)) return [];
    return data.results.filter((item) => matchItemFilters(item, activeFilters));
  }, [data?.results, activeFilters]);

  const displayData = useMemo(
    () => ({
      ...data,
      results: displayResults,
    }),
    [data, displayResults],
  );

  const handleResetFilters = () => {
    setActiveFilters({});
    setCurrentPage(1);
    fetchData(1, {});
  };

  const getItemTagInfo = useCallback((item) => {
    if (!item || !item.CustomTag) return null;
    const tags = parseTags(item.CustomTag);
    if (tags.length === 0) return null;
    return { tags };
  }, []);

  const handleOpenTagModal = (e, item) => {
    if (e && e.stopPropagation) e.stopPropagation();
    setTagModalMedia(item);
    if (!localTags || localTags.length === 0) {
      fetch(`/api/local/tags/view/${type}`)
        .then((res) => res.json())
        .then((tags) => {
          if (Array.isArray(tags)) setLocalTags(tags);
        })
        .catch((err) => console.error("Failed to fetch tags on demand:", err));
    }
  };

  const handleSelectTagInModal = async (selectedTag) => {
    if (!tagModalMedia) return;
    try {
      const activeProvider =
        tagModalMedia.provider &&
        tagModalMedia.provider !== "provider" &&
        tagModalMedia.provider !== "local source"
          ? tagModalMedia.provider
          : provider !== "provider" && provider !== "local"
            ? provider
            : undefined;

      const response = await apiPost("/api/local/tags/add", {
        type: type,
        id: tagModalMedia.id,
        provider: activeProvider,
        MalID: tagModalMedia.malid || tagModalMedia.MalID || tagModalMedia.id,
        CustomTag: selectedTag,
      });

      if (!response?.error) {
        if (window.catalogCache) {
          delete window.catalogCache[`Anime_local`];
          delete window.catalogCache[`Manga_local`];
          delete window.catalogCache[`Movies_local`];
        }
        if (provider === "local") {
          setData((prev) => {
            if (!prev || !prev.results) return prev;
            return {
              ...prev,
              results: prev.results.filter(
                (i) =>
                  i.id !== tagModalMedia.id &&
                  (!i.malid ||
                    !tagModalMedia.malid ||
                    i.malid !== tagModalMedia.malid),
              ),
            };
          });
        } else {
          setData((prev) => {
            if (!prev || !prev.results) return prev;
            const updated = prev.results.map((i) =>
              i.id === tagModalMedia.id ||
              (i.malid &&
                tagModalMedia.malid &&
                i.malid === tagModalMedia.malid)
                ? { ...i, CustomTag: JSON.stringify([selectedTag]) }
                : i,
            );
            return { ...prev, results: updated };
          });
        }
        swalSuccess(
          "Tag Updated",
          `Set tag to "${selectedTag}" for ${tagModalMedia.title || "media"}.`,
        );
      } else {
        swalError("Error", response?.message || "Failed to update tag.");
      }
    } catch (err) {
      console.error("Error setting tag:", err);
    } finally {
      setTagModalMedia(null);
    }
  };

  const handleRemoveTagInModal = async () => {
    if (!tagModalMedia) return;
    try {
      const response = await apiPost("/api/local/tags/add", {
        type: type,
        id: tagModalMedia.id,
        provider:
          tagModalMedia.provider !== "provider" &&
          tagModalMedia.provider !== "local source"
            ? tagModalMedia.provider
            : undefined,
        MalID: tagModalMedia.malid || tagModalMedia.MalID || tagModalMedia.id,
        CustomTag: "",
      });

      if (!response?.error) {
        if (window.catalogCache) {
          delete window.catalogCache[`Anime_local`];
          delete window.catalogCache[`Manga_local`];
          delete window.catalogCache[`Movies_local`];
        }
        if (provider === "local") {
          setData((prev) => {
            if (!prev || !prev.results) return prev;
            return {
              ...prev,
              results: prev.results.filter(
                (i) =>
                  i.id !== tagModalMedia.id &&
                  (!i.malid ||
                    !tagModalMedia.malid ||
                    i.malid !== tagModalMedia.malid),
              ),
            };
          });
        } else {
          setData((prev) => {
            if (!prev || !prev.results) return prev;
            const updated = prev.results.map((i) =>
              i.id === tagModalMedia.id ||
              (i.malid &&
                tagModalMedia.malid &&
                i.malid === tagModalMedia.malid)
                ? { ...i, CustomTag: "" }
                : i,
            );
            return { ...prev, results: updated };
          });
        }
        swalSuccess(
          "Tag Removed",
          `Removed tag from ${tagModalMedia.title || "media"}.`,
        );
      }
    } catch (err) {
      console.error("Error removing tag:", err);
    } finally {
      setTagModalMedia(null);
    }
  };

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkTagScroll = useCallback(() => {
    const el = tagChipsRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollWidth - (scrollLeft + clientWidth) > 10);
  }, []);

  const isMouseDownRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    checkTagScroll();
    const el = tagChipsRef.current;
    if (!el) return;

    const animId = requestAnimationFrame(checkTagScroll);
    el.addEventListener("scroll", checkTagScroll, { passive: true });
    window.addEventListener("resize", checkTagScroll);

    const handleWheel = (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };

    const handleMouseDown = (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      isMouseDownRef.current = true;
      isDraggingRef.current = false;
      startXRef.current = e.pageX - el.offsetLeft;
      scrollLeftRef.current = el.scrollLeft;
      el.classList.add("is-dragging");
    };

    const handleMouseMove = (e) => {
      if (!isMouseDownRef.current) return;
      const x = e.pageX - el.offsetLeft;
      const walk = x - startXRef.current;
      if (Math.abs(walk) > 5) {
        isDraggingRef.current = true;
      }
      el.scrollLeft = scrollLeftRef.current - walk;
    };

    const handleMouseUp = () => {
      if (isMouseDownRef.current) {
        isMouseDownRef.current = false;
        el.classList.remove("is-dragging");
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 50);
      }
    };

    const handleContextMenu = (e) => {
      if (isDraggingRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("mousedown", handleMouseDown);
    el.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    const ro = new ResizeObserver(() => checkTagScroll());
    ro.observe(el);

    return () => {
      cancelAnimationFrame(animId);
      el.removeEventListener("scroll", checkTagScroll);
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("mousedown", handleMouseDown);
      el.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("resize", checkTagScroll);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      ro.disconnect();
    };
  }, [localTags, checkTagScroll]);

  const scrollTags = (direction) => {
    if (tagChipsRef.current) {
      const scrollAmount = tagChipsRef.current.clientWidth * 0.75;
      tagChipsRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
      setTimeout(checkTagScroll, 350);
    }
  };

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
  const scrollDebounceRef = useRef(null);

  const handleScroll = (e) => {
    const scrollTop = e.target.scrollTop;
    const cacheKey = `${type}_${provider}`;
    if (!window.catalogCache) {
      window.catalogCache = {};
    }
    if (!window.catalogCache[cacheKey]) {
      window.catalogCache[cacheKey] = {};
    }

    if (discoverTab === "calendar") {
      window.catalogCache[cacheKey].calendarScrollPosition = scrollTop;
      return;
    }

    // CRITICAL: If the view was just mounted and scroll restoration hasn't completed,
    // do not allow an initial mount event (scrollTop = 0) to wipe out the saved scroll position!
    if (
      !isRestoredRef.current &&
      ((window.catalogCache[cacheKey]?.scrollPosition || 0) > 10 ||
        (window.catalogCache[cacheKey]?.lastActivePage || 1) > 1)
    ) {
      return;
    }

    window.catalogCache[cacheKey].scrollPosition = scrollTop;

    if (scrollTop <= 10) {
      window.catalogCache[cacheKey].lastActivePage = 1;
      window.catalogCache[cacheKey].cardIndexInPage = 0;
      window.catalogCache[cacheKey].cardTopOffset = 0;
      return;
    }

    // Debounce layout-thrashing DOM queries and offset measurements during fast scrolling
    if (scrollDebounceRef.current) {
      clearTimeout(scrollDebounceRef.current);
    }
    scrollDebounceRef.current = setTimeout(() => {
      if (wrapperRef.current) {
        const cards = wrapperRef.current.querySelectorAll(".media-card");
        const headerEl = wrapperRef.current.querySelector(".catalog-header");
        const headerHeight = headerEl ? headerEl.offsetHeight : 80;
        const visibleTop =
          (wrapperRef.current ? wrapperRef.current.scrollTop : scrollTop) +
          headerHeight;

        if (cards && cards.length > 0) {
          let topCardIdx = 0;
          for (let i = 0; i < cards.length; i++) {
            if (cards[i].offsetTop + cards[i].offsetHeight > visibleTop + 10) {
              topCardIdx = i;
              break;
            }
          }

          let accumulated = 0;
          let activePage = loadedPageStart;
          let cardInPage = 0;

          for (let p = loadedPageStart; p <= loadedPageEnd; p++) {
            const pLen = fetchedPages[p]?.length || 0;
            if (topCardIdx < accumulated + pLen) {
              activePage = p;
              cardInPage = topCardIdx - accumulated;
              break;
            }
            accumulated += pLen;
          }

          const cardEl = cards[topCardIdx];
          const cardOffset = cardEl ? visibleTop - cardEl.offsetTop : 0;

          if (window.catalogCache && window.catalogCache[cacheKey]) {
            window.catalogCache[cacheKey].lastActivePage = activePage;
            window.catalogCache[cacheKey].cardIndexInPage = cardInPage;
            window.catalogCache[cacheKey].cardTopOffset = cardOffset;
          }
        }
      }
    }, 150);
  };

  useEffect(() => {
    const activeKey = lastLoadedKeyRef.current;
    if (!activeKey) return;
    if (!didFetchRef.current) return;
    if (!window.catalogCache) {
      window.catalogCache = {};
    }
    const existingScroll = window.catalogCache[activeKey]?.scrollPosition || 0;
    const existingLastActivePage =
      window.catalogCache[activeKey]?.lastActivePage || currentPage;
    const existingCardIndexInPage =
      window.catalogCache[activeKey]?.cardIndexInPage || 0;
    const existingCardTopOffset =
      window.catalogCache[activeKey]?.cardTopOffset || 0;
    const existingCalendarScroll =
      window.catalogCache[activeKey]?.calendarScrollPosition || 0;

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
      lastActivePage: existingLastActivePage,
      cardIndexInPage: existingCardIndexInPage,
      cardTopOffset: existingCardTopOffset,
      calendarScrollPosition: existingCalendarScroll,
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
      wrapperRef.current &&
      data?.results &&
      data.results.length > 0 &&
      !isRestoredRef.current
    ) {
      if (discoverTab === "calendar") {
        wrapperRef.current.scrollTop = cache.calendarScrollPosition || 0;
        isRestoredRef.current = true;
        return;
      }

      const applyScroll = () => {
        if (!wrapperRef.current) return;
        let restoredScroll = cache.scrollPosition || 0;
        const headerEl = wrapperRef.current.querySelector(".catalog-header");
        const headerHeight = headerEl ? headerEl.offsetHeight : 80;

        if (cache.lastActivePage && cache.cardIndexInPage !== undefined) {
          const cards = wrapperRef.current.querySelectorAll(".media-card");
          let targetCardIdx = 0;
          for (let p = loadedPageStart; p < cache.lastActivePage; p++) {
            targetCardIdx += fetchedPages[p]?.length || 0;
          }
          targetCardIdx += cache.cardIndexInPage || 0;

          if (cards && cards[targetCardIdx]) {
            restoredScroll = Math.max(
              0,
              cards[targetCardIdx].offsetTop -
                headerHeight +
                (cache.cardTopOffset || 0),
            );
          }
        }
        wrapperRef.current.scrollTop = restoredScroll;
      };

      applyScroll();
      const raf = requestAnimationFrame(applyScroll);
      const timer = setTimeout(() => {
        applyScroll();
        isRestoredRef.current = true;
      }, 60);

      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
  }, [data?.results, discoverTab]);

  useLayoutEffect(() => {
    if (pendingScrollAdjustRef.current && wrapperRef.current) {
      const adjust = pendingScrollAdjustRef.current;
      if (typeof adjust === "number") {
        wrapperRef.current.scrollTop += adjust;
      } else if (adjust.type === "prepend") {
        const { pageSize } = adjust;
        const cards = wrapperRef.current.querySelectorAll(".media-card");
        if (cards && cards[0] && cards[pageSize]) {
          const h = cards[pageSize].offsetTop - cards[0].offsetTop;
          wrapperRef.current.scrollTop += h;
        }
      }
      pendingScrollAdjustRef.current = null;
    }
  });

  const canReorder =
    provider === "local" &&
    (!searchQuery || searchQuery.trim().length === 0) &&
    !linkingMalItem;

  const getCustomOrderKey = (currentTag = activeFilters.tag) => {
    return `${type}_local_${currentTag || "all"}`;
  };

  const applyCustomOrder = (resultsList, currentFilters = activeFilters) => {
    if (!resultsList || resultsList.length === 0) return resultsList;
    return resultsList;
  };

  const handleDragStart = (e, index) => {
    if (!canReorder) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index);
  };

  const handleDragOver = (e, index) => {
    if (!canReorder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = (e, index) => {
    if (!canReorder) return;
    if (dragOverIndex === index) {
      setDragOverIndex(null);
    }
  };

  const handleDrop = async (e, dropIndex) => {
    if (!canReorder) return;
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

    if (window.sharedStateAPI && window.sharedStateAPI.updateSetting) {
      window.sharedStateAPI
        .updateSetting(`custom_order_${key}`, orderIds)
        .catch(() => {});
    }

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
    if (!canReorder) return;
    setDraggedIndex(index);
  };

  const handleTouchMove = (e) => {
    if (!canReorder || draggedIndex === null) return;
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
    if (!canReorder || draggedIndex === null) return;
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

      if (window.sharedStateAPI && window.sharedStateAPI.updateSetting) {
        window.sharedStateAPI
          .updateSetting(`custom_order_${key}`, orderIds)
          .catch(() => {});
      }

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

  // Per-provider Discover filters. The panel renders one dropdown per key
  // and sends the chosen value as filters[key] to /api/list. Only providers
  // listed here show filters (no studio/producer/licensor facets by design).
  const siteFilterDefs = {
    anikoto: {
      genre: {
        label: "Genre",
        options: {
          All: "",
          Action: "1",
          Adventure: "2",
          Comedy: "8",
          Demons: "119",
          Drama: "62",
          Ecchi: "214",
          Fantasy: "3",
          Game: "180",
          Harem: "215",
          Historical: "70",
          Horror: "222",
          Isekai: "74",
          Josei: "404",
          Kids: "46",
          Magic: "203",
          "Martial Arts": "114",
          Mecha: "123",
          Military: "125",
          Music: "242",
          Mystery: "57",
          Parody: "162",
          Police: "136",
          Psychological: "73",
          Romance: "28",
          Samurai: "163",
          School: "14",
          "Sci-Fi": "12",
          Seinen: "50",
          Shoujo: "252",
          Shounen: "15",
          "Slice of Life": "35",
          Space: "124",
          Sports: "29",
          "Super Power": "16",
          Supernatural: "9",
          Suspense: "2316",
          Thriller: "54",
          Vampire: "58",
        },
      },
      status: {
        label: "Status",
        options: {
          All: "",
          Ongoing: "currently-airing",
          Completed: "finished-airing",
        },
      },
      type: {
        label: "Type",
        options: {
          All: "",
          TV: "TV",
          Movie: "Movie",
          ONA: "ONA",
          OVA: "OVA",
          Special: "Special",
        },
      },
      sort: {
        label: "Sort",
        options: {
          Latest: "latest-updated",
          Popular: "most-viewed",
          Score: "score",
          "Name A-Z": "name-az",
        },
      },
    },
    mangafire: {
      genre: {
        label: "Genre",
        options: {
          All: "",
          Action: "391b0423-d847-456f-aff0-8b0cfc03066b",
          Adventure: "87cc87cd-a395-47af-b27a-93258283bbc6",
          Comedy: "4d32cc48-9f00-4cca-9b5a-a839f0764984",
          Crime: "5ca48985-9a9d-4bd8-be29-80dc0303db72",
          Drama: "b9af3a63-f058-46de-a9a0-e0c13906197a",
          Fantasy: "cdc58593-87dd-415e-bbc0-2ec27bf404cc",
          Harem: "aafb99c1-7f60-43fa-b75f-fc9502ce29c7",
          Historical: "33771934-028e-4cb3-8744-691e866a923e",
          Horror: "cdad7e68-1419-41dd-bdce-27753074a640",
          Isekai: "ace04997-f6bd-436e-b261-779182193d3d",
          "Martial Arts": "799c202e-7daa-44eb-9cf7-8a3c0441531e",
          Mecha: "50880a9d-5440-4732-9afb-8f457127e836",
          Medical: "c8cbe35b-1b2b-4a3f-9c37-db84c4514856",
          Music: "f42fbf9e-188a-447b-9fdc-f19dc1e4d685",
          Mystery: "ee968100-4191-4968-93d3-f82d72be7e46",
          Philosophical: "b1e97889-25b4-4258-b28b-cd7f4d28ea9b",
          Psychological: "3b60b75c-a2d7-4860-ab56-05f391bb889c",
          Romance: "423e2eae-a7a2-4a8b-ac03-a8351462d71d",
          "School Life": "caaa44eb-cd40-4177-b930-79d3ef2afe87",
          "Sci-Fi": "256c8bd9-4904-4360-bf4f-508a76d67183",
          "Slice of Life": "e5301a23-ebd9-49dd-a0cb-2add944c7fe9",
          Sports: "69964a64-2f90-4d33-beeb-f3ed2875eb4c",
          Supernatural: "eabc5b4c-6aff-42f3-b657-3e90cbd00b75",
          Thriller: "07251805-a27e-4d59-b488-f0bfbec15168",
          Tragedy: "f8f62932-27da-4fe4-8ee1-6779a8c5edba",
        },
      },
      status: {
        label: "Status",
        options: {
          All: "",
          Ongoing: "ongoing",
          Completed: "completed",
          Hiatus: "hiatus",
          Cancelled: "cancelled",
        },
      },
      sort: {
        label: "Sort",
        options: {
          Latest: "latest-updated",
          "Most Followed": "most-followed",
          Rating: "rating",
          "Title A-Z": "title-az",
        },
      },
    },
  };

  const getApiEndpoint = (
    currentTag = activeFilters.tag,
    source = catalogSource,
  ) => {
    if (provider === "local") {
      return `/api/list/${type}/local`;
    }
    if (provider === "provider") {
      return `/api/list/${type}/provider`;
    }
    if (source && source.startsWith("unique:")) {
      const p = source.split(":")[1];
      return `/api/list/${type}/unique_${p}`;
    }
    return `/api/list/${type}/mal`;
  };

  const preloadPagesAround = async (targetPage, currentFilters) => {
    const startP = Math.max(1, targetPage - 1);
    const endP = targetPage + 1;
    const endpoint = getApiEndpoint(currentFilters.tag, catalogSource);

    let updatedPages = {};
    setFetchedPages((prev) => {
      updatedPages = { ...prev };
      return prev;
    });

    const pagesToFetch = [];
    for (let p = startP; p <= endP; p++) {
      if (!updatedPages[p]) {
        pagesToFetch.push(p);
      }
    }

    if (pagesToFetch.length > 0) {
      await Promise.all(
        pagesToFetch.map(async (p) => {
          try {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                filters: { ...currentFilters, page: p },
              }),
            });
            if (response.ok) {
              const resData = await response.json();
              if (resData?.results) {
                updatedPages[p] = applyCustomOrder(
                  resData.results,
                  currentFilters,
                );
              }
            }
          } catch (e) {
            console.error(`Failed to preload page ${p}:`, e);
          }
        }),
      );
    }

    setFetchedPages(updatedPages);

    let actualEnd = endP;
    const windowResults = [];
    for (let p = startP; p <= endP; p++) {
      if (updatedPages[p]) {
        windowResults.push(...updatedPages[p]);
      } else if (p > targetPage) {
        actualEnd = p - 1;
      }
    }

    setLoadedPageStart(startP);
    setLoadedPageEnd(actualEnd);
    setData((prev) => ({
      ...prev,
      currentPage: targetPage,
      results: windowResults,
    }));
    didFetchRef.current = true;
  };

  const handleCatalogSourceChange = (newSource) => {
    setCatalogSource(newSource);
    sessionStorage.setItem(`catalog_source_${type}`, newSource);
    setCurrentPage(1);
    setData(null);
    setFetchedPages({});
    setLoadedPageStart(1);
    setLoadedPageEnd(1);
    fetchData(1, activeFilters, null, undefined, false, newSource);
  };

  const fetchData = async (
    page = 1,
    currentFilters = activeFilters,
    searchOverride = null,
    linkingOverride = undefined,
    isAppend = false,
    sourceOverride = null,
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
      const activeSource = sourceOverride || catalogSource;

      let endpoint;
      if (isLinking) {
        endpoint = `/api/list/${type}/search?query=${encodeURIComponent(activeSearch)}`;
      } else {
        endpoint = getApiEndpoint(currentFilters.tag, activeSource);
      }

      if (provider === "mal" && !isAppend && page === 1) {
        const countEndpoint = `/api/count/${type}/${activeSource || "mal"}`;
        fetch(countEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filters: currentFilters,
            keyword: activeSearch,
          }),
        })
          .then((r) => r.json())
          .then((cRes) => {
            if (cRes && typeof cRes.count === "number") {
              setTotalCount(cRes.count);
            }
          })
          .catch(() => {});
      }

      const mappedFilters = {
        ...currentFilters,
        page: page,
      };
      if (activeSearch) {
        mappedFilters.keyword = activeSearch;
      }
      const activeSite = data?.site || provider;
      if (siteFilterDefs[activeSite]) {
        const defs = siteFilterDefs[activeSite];
        if (
          currentFilters.genre &&
          defs.genre?.options?.[currentFilters.genre]
        ) {
          mappedFilters.genre = defs.genre.options[currentFilters.genre];
        }
        if (
          currentFilters.status &&
          defs.status?.options?.[currentFilters.status]
        ) {
          mappedFilters.status = defs.status.options[currentFilters.status];
        }
        if (currentFilters.type && defs.type?.options?.[currentFilters.type]) {
          mappedFilters.type = defs.type.options[currentFilters.type];
        }
        if (currentFilters.sort && defs.sort?.options?.[currentFilters.sort]) {
          mappedFilters.sort = defs.sort.options[currentFilters.sort];
        }
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: mappedFilters,
          keyword: activeSearch || undefined,
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

  const fetchHistoryData = useCallback(async () => {
    if (provider !== "local") return;
    try {
      const statsRes = await fetch("/api/history/stats");
      if (statsRes.ok) {
        const sData = await statsRes.json();
        setStats(sData);
      }
    } catch (err) {
      console.error("Failed to fetch history stats:", err);
    }

    try {
      const listRes = await fetch("/api/history/list?shelf=true&limit=15");
      if (listRes.ok) {
        const hData = await listRes.json();
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
      }
    } catch (err) {
      console.error("Failed to fetch history list:", err);
    }
  }, [type, provider]);

  useEffect(() => {
    const cacheKey = `${type}_${provider}`;
    const cache = window.catalogCache[cacheKey];

    if (
      cache &&
      (!initialSearchQuery || cache.searchQuery === initialSearchQuery)
    ) {
      lastLoadedKeyRef.current = cacheKey;
      setSearchQuery(cache.searchQuery || "");
      setCurrentPage(cache.currentPage || cache.lastActivePage || 1);
      setActiveFilters(cache.activeFilters || {});
      setAvailableFilters(cache.availableFilters || null);
      setErrorMsg(cache.errorMsg || "");
      if (cache.discoverTab) setDiscoverTab(cache.discoverTab);
      if (cache.infiniteScroll !== undefined)
        setInfiniteScroll(cache.infiniteScroll);

      if (cache.data?.results && cache.data.results.length > 0) {
        setData(cache.data);
        setFetchedPages(cache.fetchedPages || {});
        setLoadedPageStart(cache.loadedPageStart || 1);
        setLoadedPageEnd(cache.loadedPageEnd || cache.currentPage || 1);
        isRestoredRef.current = false;
        didFetchRef.current = true;
      } else {
        isRestoredRef.current = false;
        didFetchRef.current = true;
        fetchData(cache.currentPage || 1, cache.activeFilters || {});
      }
    } else {
      if ((provider !== "provider" && provider !== "mal") || type !== "Anime") {
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

      const savedTag = sessionStorage.getItem(`active_tag_${type}`);
      const defaultTag =
        provider === "local"
          ? savedTag || (type === "Manga" ? "Reading" : "Watching")
          : "";
      const initFilters = defaultTag ? { tag: defaultTag } : {};
      setActiveFilters(initFilters);
      fetchData(1, initFilters, startQuery, null);
    }

    if (provider === "local") {
      fetch(`/api/local/tags/view/${type || "Anime"}`)
        .then((res) => res.json())
        .then((tData) => {
          if (Array.isArray(tData)) setLocalTags(tData);
        })
        .catch((err) => console.error("Failed to fetch local tags:", err));

      fetchHistoryData();
      window.refreshCatalogHistory = fetchHistoryData;

      const handleFocus = () => fetchHistoryData();
      const handleVisibility = () => {
        if (!document.hidden) fetchHistoryData();
      };

      window.addEventListener("focus", handleFocus);
      document.addEventListener("visibilitychange", handleVisibility);
      const timer = setInterval(fetchHistoryData, 4000);

      return () => {
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener("visibilitychange", handleVisibility);
        clearInterval(timer);
        if (window.refreshCatalogHistory === fetchHistoryData) {
          delete window.refreshCatalogHistory;
        }
      };
    } else {
      setLocalTags([]);
      setStats(null);
      setRecentHistory([]);
    }
  }, [type, provider, fetchHistoryData]);

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
      (provider === "provider" || provider === "mal") &&
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
    if (discoverTab !== "calendar") return;
    const ticker = setInterval(() => {
      setTimeTicker(Date.now());
    }, 30000);
    return () => clearInterval(ticker);
  }, [discoverTab]);

  const triggerScrapeSearch = (title) => {
    setDiscoverTab("latest");
    sessionStorage.setItem("discover_tab", "latest");
    isRestoredRef.current = false;
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
      const unsubscribeMigration = window.sharedStateAPI.on(
        "anime-id-updated",
        (data) => {
          if (!data?.oldId || !data?.newId) return;
          setRecentHistory((prev) =>
            (prev || []).map((item) => {
              if (
                String(item.id) === String(data.oldId) ||
                String(item.anime_id) === String(data.oldId) ||
                String(item.media_id) === String(data.oldId)
              ) {
                return {
                  ...item,
                  id: data.newId,
                  anime_id: data.newId,
                  media_id: data.newId,
                };
              }
              return item;
            }),
          );
          setData((prev) =>
            (prev || []).map((item) => {
              if (
                String(item.id) === String(data.oldId) ||
                String(item.media_id) === String(data.oldId)
              ) {
                return {
                  ...item,
                  id: data.newId,
                  media_id: data.newId,
                };
              }
              return item;
            }),
          );
        },
      );
      return () => {
        if (unsubscribe) unsubscribe();
        if (unsubscribeMigration) unsubscribeMigration();
      };
    }
  }, [type]);

  const handleRemoveFromLibrary = async (item) => {
    const isDownloaded =
      item.provider === "local source" ||
      provider === "local source" ||
      activeFilters?.tag?.toLowerCase() === "downloads" ||
      activeFilters?.provider?.toLowerCase() === "local source" ||
      (Array.isArray(item.DownloadedEpisodes) &&
        item.DownloadedEpisodes.length > 0) ||
      (item.DownloadedEpisodes?.sub?.length || 0) +
        (item.DownloadedEpisodes?.dub?.length || 0) >
        0 ||
      (Array.isArray(item.DownloadedChapters) &&
        item.DownloadedChapters.length > 0);

    const promptTitle = isDownloaded
      ? "Delete & Remove from Library?"
      : "Remove from Library";
    const promptMessage = isDownloaded
      ? `Are you sure you want to remove "${item.title}"? This will delete all downloaded episodes/chapters and folder as well as remove the entry from your database.`
      : `Are you sure you want to remove "${item.title}" from your library?`;
    const confirmButtonText = isDownloaded ? "Delete & Remove" : "Remove";

    const confirmed = await swalConfirm(
      promptTitle,
      promptMessage,
      confirmButtonText,
    );

    if (confirmed) {
      setData((prev) => ({
        ...prev,
        results: (prev?.results || []).filter((x) => x.id !== item.id),
      }));
      setFetchedPages((prev) => {
        const next = { ...prev };
        for (const page in next) {
          if (Array.isArray(next[page])) {
            next[page] = next[page].filter((x) => x.id !== item.id);
          }
        }
        return next;
      });

      try {
        const response = await apiPost("/api/local/tags/add", {
          type: type,
          id: item.id,
          provider:
            item.provider !== "provider" && item.provider !== "local source"
              ? item.provider
              : undefined,
          MalID: item.MalID || item.malid || item.id,
          CustomTag: "",
          deleteFiles: isDownloaded,
        });

        if (!response?.error) {
          if (window.catalogCache) {
            delete window.catalogCache[`Anime_local`];
            delete window.catalogCache[`Manga_local`];
            delete window.catalogCache[`Movies_local`];
          }
          swalSuccess(
            "Removed",
            isDownloaded
              ? `"${item.title}" and its downloaded files have been deleted.`
              : `"${item.title}" has been removed from your library.`,
          );
        } else {
          swalError(
            "Error",
            response?.message || "Failed to remove item from library.",
          );
          fetchData(currentPage, activeFilters, searchQuery, null);
        }
      } catch (err) {
        swalError(
          "Error",
          err.message || "Failed to remove item from library.",
        );
        fetchData(currentPage, activeFilters, searchQuery, null);
      }
    }
  };

  const handleMediaClick = (item) => {
    if (linkingMalItem) {
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

    const isMalActive =
      provider === "mal" ||
      (!catalogSource?.startsWith("unique:") && provider !== "local");
    let backText = "Back to Collection";
    if (searchQuery.trim().length > 0) {
      backText = "Back to Search";
    } else if (provider === "local") {
      if (activeFilters.tag) {
        backText = `Back to ${activeFilters.tag}`;
      } else {
        backText = "Back to Collection";
      }
    } else if (provider === "mal") {
      backText = "Back to Filters";
    } else {
      backText = "Back to Discover";
    }

    const resolvedProv =
      item.provider && item.provider !== "mal"
        ? item.provider
        : catalogSource?.startsWith("unique:")
          ? catalogSource.replace(/^unique[:_]/, "")
          : null;

    if (resolvedProv) {
      handleSelectMediaWithCache(item.id, resolvedProv, backText);
      return;
    }

    handleSelectMediaWithCache(item.id, "mal", backText);
  };

  const handleSelectMediaWithCache = (
    id,
    prov,
    backText,
    autoPlay,
    targetNum,
  ) => {
    const cacheKey = `${type}_${provider}`;
    if (!window.catalogCache) {
      window.catalogCache = {};
    }
    const currentScroll = wrapperRef.current ? wrapperRef.current.scrollTop : 0;
    window.catalogCache[cacheKey] = {
      ...window.catalogCache[cacheKey],
      data,
      searchQuery,
      currentPage,
      activeFilters,
      availableFilters,
      errorMsg,
      discoverTab,
      infiniteScroll,
      fetchedPages,
      loadedPageStart: loadedPageStart || 1,
      loadedPageEnd: loadedPageEnd || currentPage,
      scrollPosition: currentScroll,
      lastActivePage: currentPage,
    };
    onSelectMedia(id, prov, backText, autoPlay, targetNum);
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
    if (filterName === "tag" && provider === "local") {
      if (val) {
        sessionStorage.setItem(`active_tag_${type}`, val);
      } else {
        sessionStorage.removeItem(`active_tag_${type}`);
      }
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
          (data?.hasNextPage || loadedPageEnd < (data?.totalPages || 0))
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
    data?.hasNextPage,
    data?.totalPages,
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
      <CatalogHeader
        provider={provider}
        type={type}
        discoverTab={discoverTab}
        onSubTabChange={(tab) => {
          setDiscoverTab(tab);
          sessionStorage.setItem("discover_tab", tab);
          isRestoredRef.current = false;
        }}
        linkingMalItem={linkingMalItem}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onSearchSubmit={handleSearchSubmit}
        onTypeChange={onTypeChange}
        isFilterOpen={isFilterPanelOpen}
        onToggleFilter={() => setIsFilterPanelOpen((prev) => !prev)}
        activeFilterCount={activeFilterCount}
        catalogSource={catalogSource}
        onCatalogSourceChange={handleCatalogSourceChange}
        availableProviders={providerMetadataList}
      />

      <LibraryStats
        type={type}
        stats={stats}
        provider={provider}
        linkingMalItem={linkingMalItem}
      />

      <RecentHistory
        type={type}
        provider={provider}
        linkingMalItem={linkingMalItem}
        recentHistory={recentHistory}
        onSelectMedia={handleSelectMediaWithCache}
        onDismissHistory={handleDismissHistory}
      />

      {/* Universal Filter panel */}
      {provider === "mal" && (
        <div className="filter-panel">
          <div className="filter-panel-header">
            <div className="filter-panel-left">
              <div className="filter-panel-title">
                <SlidersHorizontal size={15} />
                <span>Filters</span>
                {activeFilterCount > 0 && (
                  <span className="filter-count-label">
                    ({activeFilterCount} active)
                  </span>
                )}
              </div>
              <div className="filter-source-wrapper">
                <span className="filter-source-label">Source</span>
                <div className="catalog-source-dropdown-wrapper">
                  <select
                    value={catalogSource || "mal"}
                    onChange={(e) => handleCatalogSourceChange(e.target.value)}
                    className="catalog-source-select"
                    aria-label="Select Catalog Source"
                  >
                    <option value="mal">On MAL (Default)</option>
                    {filteredProviders.map((p) => (
                      <option
                        key={p.table_name}
                        value={`unique:${p.table_name}`}
                      >
                        Unique to {p.display_name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="catalog-source-chevron" />
                </div>
              </div>
            </div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="filter-reset-btn"
                title="Clear all filters"
              >
                <RotateCcw size={13} />
                <span>Reset All</span>
              </button>
            )}
          </div>

          <div className="filter-grid">
            {/* 1. User Tags */}
            {localTags.length > 0 && (
              <div className="filter-group">
                <label className="filter-label">Tag</label>
                <select
                  value={activeFilters.tag || ""}
                  onChange={(e) => handleFilterChange("tag", e.target.value)}
                  className={`filter-select ${activeFilters.tag ? "is-active" : ""}`}
                >
                  <option value="">All Tags</option>
                  {localTags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 2. Genre */}
            <div className="filter-group">
              <label className="filter-label">Genre</label>
              <select
                value={activeFilters.genre || ""}
                onChange={(e) => handleFilterChange("genre", e.target.value)}
                className={`filter-select ${activeFilters.genre ? "is-active" : ""}`}
              >
                <option value="">All Genres</option>
                {UNIVERSAL_GENRES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Season */}
            <div className="filter-group">
              <label className="filter-label">Season</label>
              <select
                value={activeFilters.season || ""}
                onChange={(e) => handleFilterChange("season", e.target.value)}
                className={`filter-select ${activeFilters.season ? "is-active" : ""}`}
              >
                <option value="">All Seasons</option>
                {SEASONS_LIST.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* 4. Year */}
            <div className="filter-group">
              <label className="filter-label">Year</label>
              <select
                value={activeFilters.year || ""}
                onChange={(e) => handleFilterChange("year", e.target.value)}
                className={`filter-select ${activeFilters.year ? "is-active" : ""}`}
              >
                <option value="">All Years</option>
                {YEARS_LIST.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            {/* MAL Watch / Reading Status */}
            <div className="filter-group">
              <label className="filter-label">
                {type === "Manga" ? "MAL Reading Status" : "MAL Watch Status"}
              </label>
              <select
                value={activeFilters.malStatus || ""}
                onChange={(e) =>
                  handleFilterChange("malStatus", e.target.value)
                }
                className={`filter-select ${activeFilters.malStatus ? "is-active" : ""}`}
              >
                {getMalStatusOptions(type).map((opt) => (
                  <option key={opt.label} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 8. Format / Type */}
            <div className="filter-group">
              <label className="filter-label">Format</label>
              <select
                value={activeFilters.format || ""}
                onChange={(e) => handleFilterChange("format", e.target.value)}
                className={`filter-select ${activeFilters.format ? "is-active" : ""}`}
              >
                {FORMAT_OPTIONS.map((opt) => (
                  <option key={opt.label} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 9. Airing / Status */}
            <div className="filter-group">
              <label className="filter-label">Status</label>
              <select
                value={activeFilters.status || ""}
                onChange={(e) => handleFilterChange("status", e.target.value)}
                className={`filter-select ${activeFilters.status ? "is-active" : ""}`}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.label} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 10. Provider-native Sort (e.g. Anikoto / MangaFire sort) */}
            {availableFilters?.sort && (
              <div className="filter-group">
                <label className="filter-label">Sort</label>
                <select
                  value={activeFilters.sort || ""}
                  onChange={(e) => handleFilterChange("sort", e.target.value)}
                  className={`filter-select ${activeFilters.sort ? "is-active" : ""}`}
                >
                  {Object.entries(availableFilters.sort.options).map(
                    ([optLabel, optVal]) => (
                      <option key={optLabel} value={optVal}>
                        {optLabel}
                      </option>
                    ),
                  )}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Discover Provider-native Filter panel */}
      {provider === "provider" && availableFilters && (
        <div className="filter-panel">
          <div className="filter-panel-header">
            <div className="filter-panel-left">
              <div className="filter-panel-title">
                <SlidersHorizontal size={15} />
                <span>Filters</span>
                {Object.keys(activeFilters).filter((k) => k !== "page" && activeFilters[k]).length > 0 && (
                  <span className="filter-count-label">
                    ({Object.keys(activeFilters).filter((k) => k !== "page" && activeFilters[k]).length} active)
                  </span>
                )}
              </div>
            </div>
            {Object.keys(activeFilters).filter((k) => k !== "page" && activeFilters[k]).length > 0 && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="filter-reset-btn"
                title="Clear all filters"
              >
                <RotateCcw size={13} />
                <span>Reset All</span>
              </button>
            )}
          </div>
          <div className="filter-grid">
            {Object.entries(availableFilters).map(([key, filter]) => (
              <div key={key} className="filter-group">
                <label className="filter-label">{filter.label}</label>
                <select
                  value={activeFilters[key] || ""}
                  onChange={(e) => handleFilterChange(key, e.target.value)}
                  className={`filter-select ${activeFilters[key] ? "is-active" : ""}`}
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
        </div>
      )}

      {/* Local Tag Filter panel */}
      {provider === "local" && !linkingMalItem && (
        <div className="tag-chips-wrapper">
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => scrollTags("left")}
              className="tag-scroll-btn scroll-left-btn"
              title="Scroll left"
            >
              <ChevronLeft size={16} />
            </button>
          )}

          <div className="tag-chips-container" ref={tagChipsRef}>
            {localTags.map((tag) => (
              <button
                key={tag}
                onClick={() =>
                  !isDraggingRef.current && handleFilterChange("tag", tag)
                }
                className={`tag-chip ${activeFilters.tag === tag ? "active" : ""}`}
              >
                {tag}
              </button>
            ))}
          </div>

          {canScrollRight && (
            <button
              type="button"
              onClick={() => scrollTags("right")}
              className="tag-scroll-btn scroll-right-btn"
              title="Scroll right"
            >
              <ChevronRight size={16} />
            </button>
          )}
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
        <AiringCalendar
          calendarLoading={calendarLoading}
          scheduleUpdating={scheduleUpdating}
          scheduleData={scheduleData}
          calendarDayFilter={calendarDayFilter}
          setCalendarDayFilter={setCalendarDayFilter}
          timeTicker={timeTicker}
          onSelectMedia={handleSelectMediaWithCache}
          triggerScrapeSearch={triggerScrapeSearch}
        />
      ) : (
        <>
          {provider === "mal" && (
            <div className="unique-provider-banner">
              <div className="banner-left">
                <Clock size={14} className="banner-icon" />
                <span>
                  Last updated on{" "}
                  <strong>
                    {data?.lastFetched
                      ? new Date(data.lastFetched).toLocaleDateString(
                          undefined,
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          },
                        )
                      : "Recently"}
                  </strong>
                </span>
              </div>
              {totalCount != null && (
                <div className="banner-right">
                  <span>{totalCount.toLocaleString()} results found</span>
                </div>
              )}
            </div>
          )}
          {activeFilters.malStatus &&
          !(data?.malLoggedIn ?? malLoggedIn ?? false) ? (
            <div
              className="empty-center-panel"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "80px 20px",
                textAlign: "center",
              }}
            >
              <LogIn
                size={44}
                style={{ color: "var(--accent)", marginBottom: "14px" }}
              />
              <h3
                style={{
                  fontSize: "18px",
                  fontWeight: "600",
                  marginBottom: "8px",
                  color: "#fff",
                }}
              >
                Not connected to MyAnimeList
              </h3>
              <p
                style={{
                  maxWidth: "440px",
                  marginBottom: "18px",
                  color: "rgba(255, 255, 255, 0.7)",
                  fontSize: "14px",
                  lineHeight: "1.5",
                }}
              >
                Log in to your MyAnimeList account in Settings to view and
                filter your personal {type === "Manga" ? "reading" : "watch"}{" "}
                list.
              </p>
              <button
                type="button"
                onClick={() =>
                  onNavigate
                    ? onNavigate("settings")
                    : (window.location.hash = "#settings")
                }
                className="primary-btn"
                style={{
                  padding: "10px 24px",
                  borderRadius: "8px",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                Go to Settings
              </button>
            </div>
          ) : (
            <CatalogGrid
              loading={loading}
              data={displayData}
              type={type}
              provider={provider}
              activeFilters={activeFilters}
              searchQuery={searchQuery}
              canReorder={canReorder}
              infiniteScroll={infiniteScroll}
              infiniteLoading={infiniteLoading}
              currentPage={currentPage}
              loadedPageStart={loadedPageStart}
              topSentinelRef={topSentinelRef}
              sentinelRef={sentinelRef}
              draggedIndex={draggedIndex}
              dragOverIndex={dragOverIndex}
              handleDragStart={handleDragStart}
              handleDragOver={handleDragOver}
              handleDragLeave={handleDragLeave}
              handleDrop={handleDrop}
              handleDragEnd={handleDragEnd}
              handleTouchStart={handleTouchStart}
              handleTouchMove={handleTouchMove}
              handleTouchEnd={handleTouchEnd}
              handleMediaClick={handleMediaClick}
              handlePageChange={handlePageChange}
              handleRemoveFromLibrary={handleRemoveFromLibrary}
              getItemTagInfo={getItemTagInfo}
              onOpenTagModal={handleOpenTagModal}
            />
          )}
        </>
      )}

      {tagModalMedia && (
        <TagPickerModal
          item={tagModalMedia}
          type={type}
          availableTags={localTags}
          currentTags={getItemTagInfo(tagModalMedia)?.tags || []}
          onSelectTag={handleSelectTagInModal}
          onRemoveTag={handleRemoveTagInModal}
          onClose={() => setTagModalMedia(null)}
        />
      )}
    </div>
  );
}
