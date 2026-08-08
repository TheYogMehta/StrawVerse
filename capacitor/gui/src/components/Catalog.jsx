/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, no-unused-vars */
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import "./css/Catalog.css";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import Swal from "sweetalert2";
import { swalSuccess, swalError, swalConfirm } from "../utils/swal";
import { apiPost } from "../utils/common";

import CatalogHeader from "./catalog/CatalogHeader";
import LibraryStats from "./catalog/LibraryStats";
import RecentHistory from "./catalog/RecentHistory";
import AiringCalendar from "./catalog/AiringCalendar";
import CatalogGrid from "./catalog/CatalogGrid";
import TagPickerModal from "./catalog/TagPickerModal";

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
  const [tagModalMedia, setTagModalMedia] = useState(null);
  const tagChipsRef = useRef(null);

  const getItemTagInfo = useCallback((item) => {
    if (!item || !item.CustomTag) return null;
    let parsed = [];
    try {
      parsed = JSON.parse(item.CustomTag);
    } catch (e) {
      parsed = [item.CustomTag];
    }
    const tags = Array.isArray(parsed)
      ? parsed.filter((t) => typeof t === "string" && t.trim())
      : [parsed];
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

    window.catalogCache[cacheKey].scrollPosition = scrollTop;

    if (scrollTop <= 10) {
      window.catalogCache[cacheKey].lastActivePage = 1;
      window.catalogCache[cacheKey].cardIndexInPage = 0;
      window.catalogCache[cacheKey].cardTopOffset = 0;
      return;
    }

    if (wrapperRef.current) {
      const cards = wrapperRef.current.querySelectorAll(".media-card");
      const headerEl = wrapperRef.current.querySelector(".catalog-header");
      const headerHeight = headerEl ? headerEl.offsetHeight : 80;
      const visibleTop = scrollTop + headerHeight;

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

        window.catalogCache[cacheKey].lastActivePage = activePage;
        window.catalogCache[cacheKey].cardIndexInPage = cardInPage;
        window.catalogCache[cacheKey].cardTopOffset = cardOffset;
      }
    }
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
        if (
          (!cache.lastActivePage || cache.lastActivePage === 1) &&
          cache.cardIndexInPage === 0 &&
          (!cache.scrollPosition || cache.scrollPosition <= 10)
        ) {
          wrapperRef.current.scrollTop = 0;
          return;
        }

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
      isRestoredRef.current = true;
      return () => cancelAnimationFrame(raf);
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

  const getCustomOrderKey = (currentTag = activeFilters.tag) => {
    return `${type}_${provider}_${currentTag || "all"}`;
  };

  const applyCustomOrder = (resultsList, currentFilters = activeFilters) => {
    if (!resultsList || resultsList.length === 0) return resultsList;
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

  const siteFilterDefs = {};

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
    const startP = Math.max(1, targetPage - 1);
    const endP = targetPage + 1;
    const endpoint = getApiEndpoint(currentFilters.tag);

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
      const listRes = await fetch("/api/history/list?limit=15");
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

    if (cache && !initialSearchQuery) {
      lastLoadedKeyRef.current = cacheKey;
      setSearchQuery(cache.searchQuery);
      setCurrentPage(cache.lastActivePage || cache.currentPage || 1);
      setActiveFilters(cache.activeFilters);
      setAvailableFilters(cache.availableFilters);
      setErrorMsg(cache.errorMsg);
      setDiscoverTab(cache.discoverTab);
      setInfiniteScroll(cache.infiniteScroll);

      const targetP = cache.lastActivePage || cache.currentPage || 1;
      const startP = Math.max(1, targetP - 1);
      const endP = targetP + 1;
      const fp = cache.fetchedPages || {};

      let hasAllPages = true;
      for (let p = startP; p <= endP; p++) {
        if (!fp[p]) {
          hasAllPages = false;
          break;
        }
      }

      if (hasAllPages) {
        const windowResults = [];
        for (let p = startP; p <= endP; p++) {
          if (fp[p]) windowResults.push(...fp[p]);
        }
        setFetchedPages(fp);
        setLoadedPageStart(startP);
        setLoadedPageEnd(endP);
        setData({
          ...cache.data,
          currentPage: targetP,
          results: windowResults,
        });
        isRestoredRef.current = false;
        didFetchRef.current = true;
      } else if (targetP > 1 && provider === "provider") {
        setFetchedPages(fp);
        isRestoredRef.current = false;
        preloadPagesAround(targetP, cache.activeFilters || {});
      } else {
        setData(cache.data);
        setFetchedPages(fp);
        setLoadedPageStart(cache.loadedPageStart || 1);
        setLoadedPageEnd(cache.loadedPageEnd || 1);
        isRestoredRef.current = false;
        didFetchRef.current = true;
      }
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
      fetch("/api/local/tags")
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
      return () => {
        if (unsubscribe) unsubscribe();
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

    const isMalActive = provider === "mal";
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

    if (isMalActive && (!item.allMatches || item.allMatches.length === 0)) {
      triggerScrapeSearch(item.title);
      return;
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
        onSelectMedia={onSelectMedia}
        onDismissHistory={handleDismissHistory}
      />

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
          onSelectMedia={onSelectMedia}
          triggerScrapeSearch={triggerScrapeSearch}
        />
      ) : (
        <CatalogGrid
          loading={loading}
          data={data}
          type={type}
          provider={provider}
          activeFilters={activeFilters}
          searchQuery={searchQuery}
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
