/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState, useRef, useMemo } from "react";
import {
  ArrowLeft,
  Loader2,
  ChevronsDown,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Globe,
  AlertTriangle,
  Play,
  Pause,
  Plus,
  Minus,
  X,
  RotateCcw,
  HelpCircle,
  Keyboard,
  Smartphone,
} from "lucide-react";
import "./css/MangaReader.css";
import { apiPost } from "../utils/common";

function LazyMangaPage({
  src,
  alt,
  page,
  chapterId = null,
  chapterNum = null,
  style,
  shouldLoad = true,
  isVirtualActive = true,
  containerRef,
  isFirstPage = false,
  isPlaceholder = false,
  onPageLoaded = null,
}) {
  const [isVisible, setIsVisible] = useState(shouldLoad || isFirstPage);
  const [loaded, setLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [didProxyRetry, setDidProxyRetry] = useState(false);
  const pageRef = useRef(null);
  const imgRef = useRef(null);
  const measuredHeightRef = useRef(null);

  useEffect(() => {
    if (shouldLoad) {
      setIsVisible(true);
    }
  }, [shouldLoad]);

  useEffect(() => {
    setCurrentSrc(src);
    setDidProxyRetry(false);
    setLoaded(false);
    setHasError(false);
  }, [src]);

  useEffect(() => {
    if (isPlaceholder || !src) return;
    if (isVisible) return;
    const element = pageRef.current;
    if (!element) return;

    if (!window.IntersectionObserver) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry && entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        root: containerRef?.current || null,
        rootMargin: "800px 0px 800px 0px",
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [isVisible, containerRef, isPlaceholder, src]);

  const handleError = () => {
    if (
      !didProxyRetry &&
      src &&
      (src.startsWith("http://") || src.startsWith("https://"))
    ) {
      setDidProxyRetry(true);
      setCurrentSrc(`/api/image?url=${encodeURIComponent(src)}`);
    } else {
      setHasError(true);
      setLoaded(false);
    }
  };

  const handleManualRetry = (e) => {
    e.stopPropagation();
    setHasError(false);
    setLoaded(false);
    setDidProxyRetry(false);
    const sep = src && src.includes("?") ? "&" : "?";
    setCurrentSrc(`${src}${sep}_t=${Date.now()}`);
  };

  const handleImageLoad = (e) => {
    const naturalW = e.target.naturalWidth || 1;
    const naturalH = e.target.naturalHeight || 1;
    const renderedW = e.target.offsetWidth || pageRef.current?.offsetWidth || 0;
    const calculatedH =
      renderedW > 0 ? (renderedW * naturalH) / naturalW : e.target.offsetHeight;
    const measuredHeight = Math.round(
      calculatedH ||
        e.target.offsetHeight ||
        pageRef.current?.offsetHeight ||
        0,
    );
    if (measuredHeight > 50) {
      measuredHeightRef.current = measuredHeight;
    }
    setLoaded(true);
    setHasError(false);
    if (onPageLoaded) {
      onPageLoaded(
        chapterId,
        page,
        measuredHeightRef.current || measuredHeight,
      );
    }
  };

  if (!isVirtualActive && loaded && measuredHeightRef.current) {
    return (
      <div
        ref={pageRef}
        className="lazy-page-container is-virtualized"
        style={{
          ...style,
          height: `${measuredHeightRef.current}px`,
          minHeight: `${measuredHeightRef.current}px`,
        }}
      >
        <div className="virtualized-page-placeholder">
          <span className="placeholder-page-num">
            {chapterNum ? `Ch ${chapterNum} • ` : ""}Page {page}
          </span>
        </div>
        <div className="page-corner-badge" title={`Page ${page}`}>
          {page}
        </div>
      </div>
    );
  }

  if (isPlaceholder || !src || !isVisible) {
    return (
      <div
        ref={pageRef}
        className={`lazy-page-container is-loading ${isPlaceholder ? "is-placeholder-page" : ""}`}
        style={style}
      >
        <div className="lazy-page-placeholder">
          <div className="placeholder-info">
            <span className="placeholder-page-num">
              {chapterNum ? `Ch ${chapterNum} • ` : ""}Page {page}
            </span>
            <Loader2 className="spin-icon placeholder-spinner" size={20} />
            <span className="placeholder-subtext">Loading image...</span>
          </div>
        </div>
        <div className="page-corner-badge" title={`Page ${page}`}>
          {page}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={pageRef}
      className={`lazy-page-container ${loaded ? "is-loaded loaded" : "is-loading"} ${hasError ? "has-error" : ""}`}
      style={style}
    >
      {/* Pure black placeholder with loading spinner */}
      {!loaded && !hasError && (
        <div className="lazy-page-placeholder">
          <div className="placeholder-info">
            <span className="placeholder-page-num">
              {chapterNum ? `Ch ${chapterNum} • ` : ""}Page {page}
            </span>
            <Loader2 className="spin-icon placeholder-spinner" size={20} />
            <span className="placeholder-subtext">Loading image...</span>
          </div>
        </div>
      )}

      {/* Error state with retry button */}
      {hasError && (
        <div className="lazy-page-error">
          <AlertTriangle className="placeholder-error-icon" size={26} />
          <p className="placeholder-error-text">Failed to load Page {page}</p>
          <button
            type="button"
            className="btn-page-retry"
            onClick={handleManualRetry}
          >
            <RotateCcw size={14} />
            <span>Retry Page</span>
          </button>
        </div>
      )}

      {/* Image with progressive fade-in */}
      {!hasError && (
        <img
          ref={imgRef}
          src={currentSrc}
          alt={alt}
          onLoad={handleImageLoad}
          onError={handleError}
          className={`lazy-page-img ${loaded ? "loaded" : "loading"}`}
          loading={isFirstPage ? "eager" : "lazy"}
          {...(isFirstPage ? { fetchpriority: "high" } : {})}
        />
      )}

      {/* Discrete floating page badge in bottom corner */}
      <div className="page-corner-badge" title={`Page ${page}`}>
        {page}
      </div>
    </div>
  );
}

export default function MangaReader({
  id,
  mangaTitle = "",
  chapterNumOrId,
  isDownloaded,
  chaptersList = [],
  downloadedChapters = [],
  provider,
  image,
  onBack,
  malid,
}) {
  const [items, setItems] = useState([]);
  const [activePage, setActivePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [appendingLoading, setAppendingLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const containerRef = useRef(null);

  // Loaded chapters cache (chapterObj.id strings)
  const [loadedChapters, setLoadedChapters] = useState([]);

  // Local navigation states
  const [currentChapter, setCurrentChapter] = useState(chapterNumOrId);
  const [isCurrentDownloaded, setIsCurrentDownloaded] = useState(isDownloaded);
  const [activeChapterInView, setActiveChapterInView] = useState(null);
  const [autoLoadNext, setAutoLoadNext] = useState(true);
  const [readerWidth, setReaderWidth] = useState(800);
  const [readerLayout, setReaderLayout] = useState("long-strip");
  const [readerDirection, setReaderDirection] = useState("rtl");
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [showUI, setShowUI] = useState(true);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [hudMessage, setHudMessage] = useState("");
  const hudTimeoutRef = useRef(null);

  const pendingTargetPageRef = useRef(null);
  const scrollLockTimeoutRef = useRef(null);
  const isProgrammaticScrollRef = useRef(false);

  const startScrollLock = (targetPage, targetChapterId) => {
    const chapId = targetChapterId || activeChapterInView;
    pendingTargetPageRef.current = {
      page: targetPage,
      chapterId: chapId,
      timestamp: Date.now(),
    };
    isProgrammaticScrollRef.current = true;

    if (scrollLockTimeoutRef.current) {
      clearTimeout(scrollLockTimeoutRef.current);
    }
    scrollLockTimeoutRef.current = setTimeout(() => {
      pendingTargetPageRef.current = null;
      isProgrammaticScrollRef.current = false;
    }, 2500);
  };

  const cancelScrollLock = () => {
    if (pendingTargetPageRef.current || isProgrammaticScrollRef.current) {
      pendingTargetPageRef.current = null;
      isProgrammaticScrollRef.current = false;
      if (scrollLockTimeoutRef.current) {
        clearTimeout(scrollLockTimeoutRef.current);
      }
    }
  };

  const handlePageImageLoaded = (loadedChapId, loadedPage) => {
    if (
      pendingTargetPageRef.current &&
      readerLayout === "long-strip" &&
      containerRef.current
    ) {
      const { page, chapterId } = pendingTargetPageRef.current;
      if (loadedChapId === chapterId && loadedPage <= page) {
        const elem = containerRef.current.querySelector(
          `[data-chapter="${chapterId}"][data-page="${page}"]`,
        );
        if (elem) {
          elem.scrollIntoView({ behavior: "instant", block: "start" });
        }
      }
    }
  };

  const showHud = (msg) => {
    setHudMessage(msg);
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    hudTimeoutRef.current = setTimeout(() => {
      setHudMessage("");
    }, 1200);
  };

  const handleZoom = (delta) => {
    setReaderWidth((prev) => {
      const next = Math.max(350, Math.min(2200, prev + delta));
      showHud(`Width: ${next}px`);
      saveReaderWidthToSettings(next);
      return next;
    });
  };

  const handleResetZoom = () => {
    setReaderWidth(800);
    showHud("Width: 800px (Reset)");
    saveReaderWidthToSettings(800);
  };

  // Pinch-to-zoom on touchscreens / mobile
  const pinchRef = useRef({ dist: 0, startWidth: 800, active: false });

  const handleTouchStart = (e) => {
    if (e.touches && e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      pinchRef.current = {
        dist,
        startWidth: readerWidth,
        active: true,
      };
    }
  };

  const handleTouchMove = (e) => {
    if (
      e.touches &&
      e.touches.length === 2 &&
      pinchRef.current.active &&
      pinchRef.current.dist > 0
    ) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      const ratio = currentDist / pinchRef.current.dist;
      const nextWidth = Math.round(
        Math.max(350, Math.min(2200, pinchRef.current.startWidth * ratio)),
      );
      setReaderWidth(nextWidth);
      showHud(`Width: ${nextWidth}px`);
    }
  };

  const handleTouchEnd = (e) => {
    if (pinchRef.current.active && (!e.touches || e.touches.length < 2)) {
      pinchRef.current.active = false;
      saveReaderWidthToSettings(readerWidth);
    }
  };

  // Auto-scroll states & controls
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const [isBufferingImage, setIsBufferingImage] = useState(false);
  const isBufferingRef = useRef(false);
  const bufferingCheckThrottleRef = useRef(0);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(2);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef(null);

  const toggleAutoScroll = () => {
    setIsAutoScrolling((prev) => {
      const next = !prev;
      if (!next) {
        setIsBufferingImage(false);
        isBufferingRef.current = false;
      }
      return next;
    });
  };

  const handleSpeedChange = (newSpeed) => {
    const clamped = Math.max(1, Math.min(6, newSpeed));
    setAutoScrollSpeed(clamped);
    try {
      if (window.sharedStateAPI && window.sharedStateAPI.updateSetting) {
        window.sharedStateAPI.updateSetting("mangaAutoScrollSpeed", clamped);
      } else {
        fetch("/api/settings/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mangaAutoScrollSpeed: clamped }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error("Failed to save manga auto scroll speed:", err);
    }
  };

  const saveWidthTimeoutRef = useRef(null);
  const saveReaderWidthToSettings = (val) => {
    if (saveWidthTimeoutRef.current) {
      clearTimeout(saveWidthTimeoutRef.current);
    }
    saveWidthTimeoutRef.current = setTimeout(async () => {
      try {
        if (window.sharedStateAPI && window.sharedStateAPI.updateSetting) {
          await window.sharedStateAPI.updateSetting("mangaReaderWidth", val);
        }
      } catch (err) {
        console.error("Failed to save reader width:", err);
      }
    }, 500);
  };

  const isTransitioningRef = useRef(false);

  // Sync basic configurations from server
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        let s = null;
        if (window.sharedStateAPI && window.sharedStateAPI.getSettings) {
          const res = await window.sharedStateAPI.getSettings([
            "autoLoadNextChapter",
            "mangaReaderLayout",
            "mangaReaderWidth",
            "mangaReaderDirection",
            "mangaAutoScrollSpeed",
          ]);
          s = res?.settings;
        } else {
          const res = await fetch("/api/settings");
          if (res.ok) {
            const data = await res.json();
            s = data?.settings;
          }
        }
        if (s) {
          if (s.autoLoadNextChapter !== undefined)
            setAutoLoadNext(s.autoLoadNextChapter);
          if (s.mangaReaderLayout) setReaderLayout(s.mangaReaderLayout);
          if (s.mangaReaderWidth)
            setReaderWidth(parseInt(s.mangaReaderWidth, 10));
          if (s.mangaReaderDirection)
            setReaderDirection(s.mangaReaderDirection);
          if (s.mangaAutoScrollSpeed !== undefined) {
            const speedVal = parseInt(s.mangaAutoScrollSpeed, 10);
            if (!isNaN(speedVal)) {
              setAutoScrollSpeed(Math.max(1, Math.min(6, speedVal)));
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch settings:", err);
      }
    };
    fetchSettings();
  }, []);

  // Preload upcoming and previous images in single and double page modes
  useEffect(() => {
    if (readerLayout !== "single" && readerLayout !== "double") return;
    if (!items || items.length === 0) return;

    const preloadAhead = 5;
    const preloadBehind = 2;
    const startIndex = Math.max(0, activeItemIndex - preloadBehind);
    const endIndex = Math.min(items.length - 1, activeItemIndex + preloadAhead);

    for (let i = startIndex; i <= endIndex; i++) {
      if (i === activeItemIndex) continue;
      const it = items[i];
      if (it && it.type === "page" && it.img && !it.isPlaceholder) {
        const img = new Image();
        img.src = it.img;
      }
    }
  }, [activeItemIndex, readerLayout, items]);

  useEffect(() => {
    if (window.sharedStateAPI && window.sharedStateAPI.on) {
      const unsub = window.sharedStateAPI.on("reader-zoom", (action) => {
        if (action === "in") handleZoom(40);
        else if (action === "out") handleZoom(-40);
        else if (action === "reset") handleResetZoom();
      });
      return () => {
        if (typeof unsub === "function") unsub();
      };
    }
  }, []);

  const isChDownloaded = (num) => {
    if (!downloadedChapters) return false;
    return downloadedChapters.map(Number).includes(Number(num));
  };

  const sortedChapters = useMemo(() => {
    return [...chaptersList].sort(
      (a, b) => Number(a.number) - Number(b.number),
    );
  }, [chaptersList]);

  // Sync prop updates to local states & resolve initial active ID
  useEffect(() => {
    setCurrentChapter(chapterNumOrId);
    setIsCurrentDownloaded(isDownloaded);

    const initialChapterObj = sortedChapters.find((c) => {
      if (isDownloaded) {
        return Number(c.number) === Number(chapterNumOrId);
      } else {
        return c.id === chapterNumOrId;
      }
    });
    const initialId = initialChapterObj ? initialChapterObj.id : chapterNumOrId;
    setActiveChapterInView(initialId);
  }, [chapterNumOrId, isDownloaded, sortedChapters]);

  // Helper to extract a clean chapter number from IDs/hashes when sortedChapters is not loaded yet
  const getCleanChapterNum = (chapterId, fallbackValue) => {
    const chObj = sortedChapters.find((c) => c.id === chapterId);
    if (chObj) return chObj.number;

    if (typeof chapterId === "string") {
      const hashMatch = chapterId.match(/_(\d+(?:\.\d+)?)$/);
      if (hashMatch) return hashMatch[1];

      const match = chapterId.match(
        /(?:chapter[-_]|ch[-_]|\b)(\d+(?:\.\d+)?)(?:\b|$)/i,
      );
      if (match) return match[1];
    }
    return fallbackValue || "...";
  };

  // Track the indexes of the chapter currently visible in the viewport using unique IDs
  const currentChapterObj =
    sortedChapters.find(
      (item) =>
        item.id === activeChapterInView ||
        (item.number !== undefined &&
          activeChapterInView !== null &&
          Number(item.number) === Number(activeChapterInView)),
    ) ||
    sortedChapters.find(
      (item) =>
        item.id === currentChapter ||
        (item.number !== undefined &&
          currentChapter !== null &&
          Number(item.number) === Number(currentChapter)),
    );
  const currentIndex = currentChapterObj
    ? sortedChapters.indexOf(currentChapterObj)
    : -1;
  const prevIndex = currentIndex > 0 ? currentIndex - 1 : -1;
  const nextIndex =
    currentIndex !== -1 && currentIndex < sortedChapters.length - 1
      ? currentIndex + 1
      : -1;

  const totalPagesForActiveChapter = useMemo(() => {
    const matchingPages = items.filter(
      (item) => item.type === "page" && item.chapterId === activeChapterInView,
    );
    const realPages = matchingPages.filter((item) => !item.isPlaceholder);
    if (realPages.length > 0) return realPages.length;
    if (matchingPages.length > 0) return matchingPages.length;
    const allReal = items.filter(
      (item) => item.type === "page" && !item.isPlaceholder,
    );
    if (allReal.length > 0) return allReal.length;
    return items.filter((item) => item.type === "page").length;
  }, [items, activeChapterInView]);

  const handleJumpToChapter = (chapterObj) => {
    const isDownloadedLocal = isChDownloaded(chapterObj.number);
    setIsCurrentDownloaded(isDownloadedLocal);
    cancelScrollLock();
    savedResumePageRef.current = null;
    activePageRef.current = 1;
    setActivePage(1);

    // currentChapter uses chapter number for downloaded, chapter ID for online
    const targetVal = isDownloadedLocal ? chapterObj.number : chapterObj.id;
    setCurrentChapter(targetVal);
    setActiveChapterInView(chapterObj.id);
  };

  const getEstimatedPageCount = (targetChapterObj, currentItems) => {
    if (targetChapterObj?.pages && Number(targetChapterObj.pages) > 0) {
      return Number(targetChapterObj.pages);
    }
    if (targetChapterObj?.pageCount && Number(targetChapterObj.pageCount) > 0) {
      return Number(targetChapterObj.pageCount);
    }
    if (
      targetChapterObj?.total_pages &&
      Number(targetChapterObj.total_pages) > 0
    ) {
      return Number(targetChapterObj.total_pages);
    }
    const previousPages = (currentItems || []).filter(
      (item) => item.type === "page" && !item.isPlaceholder,
    );
    if (previousPages.length > 0) {
      return Math.max(30, previousPages.length);
    }
    return 30;
  };

  const fetchChapterPages = async (chapterObj = null, isAppend = false) => {
    if (isAppend) {
      setAppendingLoading(true);
    } else {
      setLoading(true);
      setErrorMsg("");
    }

    try {
      const isDownloadedLocal = isAppend
        ? isChDownloaded(chapterObj.number)
        : isCurrentDownloaded;

      const apiChapterID = isAppend
        ? isDownloadedLocal
          ? chapterObj.number
          : chapterObj.id
        : currentChapter;

      let cacheID = null;
      let targetChNum = null;
      if (isAppend) {
        cacheID = chapterObj.id;
        targetChNum = chapterObj.number;
      } else {
        const initialChapterObj = (
          sortedChaptersRef.current || sortedChapters
        ).find((c) => {
          if (isCurrentDownloaded) {
            return Number(c.number) === Number(currentChapter);
          } else {
            return c.id === currentChapter;
          }
        });
        cacheID = initialChapterObj ? initialChapterObj.id : currentChapter;
        targetChNum =
          (sortedChaptersRef.current || sortedChapters).find(
            (c) => c.id === cacheID,
          )?.number || getCleanChapterNum(cacheID, currentChapter);
      }

      const effectiveChapterObj =
        chapterObj ||
        (sortedChaptersRef.current || sortedChapters).find(
          (c) => c.id === cacheID,
        ) ||
        currentChapterObj;

      const placeholderCount = Math.max(
        30,
        savedResumePageRef.current || 0,
        pendingTargetPageRef.current?.page || 0,
        getEstimatedPageCount(effectiveChapterObj, itemsRef.current || items),
      );

      const placeholderHeader = {
        id: `header-${cacheID}`,
        type: "header",
        chapterNum: targetChNum,
        chapterId: cacheID,
        isDownloaded: isDownloadedLocal,
        isPlaceholder: true,
      };

      const placeholderPages = Array.from(
        { length: placeholderCount },
        (_, idx) => ({
          id: `placeholder-${cacheID}-${idx + 1}`,
          type: "page",
          page: idx + 1,
          chapterNum: targetChNum,
          chapterId: cacheID,
          isPlaceholder: true,
          img: null,
        }),
      );

      if (isAppend) {
        setItems((prev) => {
          if (prev.some((p) => p.chapterId === cacheID)) return prev;
          return [...prev, placeholderHeader, ...placeholderPages];
        });
        setLoadedChapters((prev) =>
          prev.includes(cacheID) ? prev : [...prev, cacheID],
        );
      } else {
        setItems([placeholderHeader, ...placeholderPages]);
        setLoadedChapters([cacheID]);
      }

      const data = await apiPost("/api/read", {
        chapterID: apiChapterID,
        Downloaded: isDownloadedLocal,
        MangaID: id,
        provider: provider,
      });

      if (data && data.length > 0) {
        const sortedPages = [...data].sort((a, b) => a.page - b.page);

        const chNum = isAppend
          ? chapterObj.number
          : (sortedChaptersRef.current || sortedChapters).find(
              (c) => c.id === cacheID,
            )?.number || getCleanChapterNum(cacheID, currentChapter);

        const isActuallyLocal =
          isDownloadedLocal &&
          data[0]?.img &&
          data[0].img.startsWith("data:image/");

        if (isActuallyLocal) {
          const num = Number(chNum);
          if (
            downloadedChapters &&
            !downloadedChapters.map(Number).includes(num)
          ) {
            downloadedChapters.push(num);
          }
        }

        const newHeader = {
          id: `header-${cacheID}`,
          type: "header",
          chapterNum: chNum,
          chapterId: cacheID,
          isDownloaded: isActuallyLocal,
          isPlaceholder: false,
        };

        const newPages = sortedPages.map((p) => ({
          id: `page-${cacheID}-${p.page}`,
          type: "page",
          img: p.img,
          page: p.page,
          chapterNum: chNum,
          chapterId: cacheID,
          isPlaceholder: false,
        }));

        setItems((prev) => {
          const withoutTarget = prev.filter(
            (item) => item.chapterId !== cacheID,
          );
          return [...withoutTarget, newHeader, ...newPages];
        });

        if (!isAppend) {
          setIsCurrentDownloaded(isActuallyLocal);
          if (containerRef.current && savedResumePageRef.current <= 1) {
            containerRef.current.scrollTop = 0;
          }
          setActiveItemIndex(0);
        }
      } else {
        if (!isAppend) {
          setErrorMsg("No pages found or chapter images failed to parse.");
        }
      }
    } catch (err) {
      console.error(err);
      if (!isAppend) {
        setErrorMsg("Failed to fetch chapter pages.");
      }
    } finally {
      if (isAppend) {
        setAppendingLoading(false);
      } else {
        setLoading(false);
      }
      setTimeout(() => {
        isTransitioningRef.current = false;
      }, 500);
    }
  };

  const handlePrevChapter = () => {
    if (prevIndex !== -1) {
      handleJumpToChapter(sortedChapters[prevIndex]);
    }
  };

  const handleNextChapter = () => {
    if (nextIndex !== -1) {
      handleJumpToChapter(sortedChapters[nextIndex]);
    }
  };

  const jumpToPage = (pageNum) => {
    const total = totalPagesForActiveChapter || 30;
    const clamped = Math.max(1, Math.min(total, pageNum));
    setActivePage(clamped);
    activePageRef.current = clamped;

    if (readerLayout === "long-strip") {
      startScrollLock(clamped, activeChapterInView);
      const elem = containerRef.current?.querySelector(
        `[data-chapter="${activeChapterInView}"][data-page="${clamped}"]`,
      );
      if (elem) {
        elem.scrollIntoView({ behavior: "instant", block: "start" });
      }
    } else {
      const targetIdx = items.findIndex(
        (it) => it.chapterId === activeChapterInView && it.page === clamped,
      );
      if (targetIdx !== -1) {
        setActiveItemIndex(targetIdx);
      }
    }
  };

  const handlePageNext = () => {
    if (readerLayout === "long-strip") {
      if (activePage < totalPagesForActiveChapter) {
        jumpToPage(activePage + 1);
      } else if (nextIndex !== -1) {
        const nextChapterObj = sortedChapters[nextIndex];
        if (!loadedChapters.includes(nextChapterObj.id)) {
          isTransitioningRef.current = true;
          fetchChapterPages(nextChapterObj, true);
        } else {
          setActiveChapterInView(nextChapterObj.id);
          activeChapterRef.current = nextChapterObj.id;
          jumpToPage(1);
        }
      }
      return;
    }

    let step = 1;
    if (readerLayout === "double") {
      const currentItem = items[activeItemIndex];
      if (currentItem && currentItem.type === "page") {
        const nextItem = items[activeItemIndex + 1];
        if (
          nextItem &&
          nextItem.type === "page" &&
          nextItem.chapterId === currentItem.chapterId
        ) {
          step = 2;
        }
      }
    }

    const targetIndex = activeItemIndex + step;
    if (targetIndex < items.length) {
      setActiveItemIndex(targetIndex);
    } else {
      if (nextIndex !== -1) {
        const nextChapterObj = sortedChapters[nextIndex];
        if (!loadedChapters.includes(nextChapterObj.id)) {
          isTransitioningRef.current = true;
          fetchChapterPages(nextChapterObj, true);
        }
      }
    }
  };

  const handlePagePrev = () => {
    if (readerLayout === "long-strip") {
      if (activePage > 1) {
        jumpToPage(activePage - 1);
      } else if (prevIndex !== -1) {
        const prevChapterObj = sortedChapters[prevIndex];
        setActiveChapterInView(prevChapterObj.id);
        activeChapterRef.current = prevChapterObj.id;
        const prevElem = document.querySelector(
          `[data-chapter="${prevChapterObj.id}"]`,
        );
        if (prevElem) {
          prevElem.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
      return;
    }

    let step = 1;
    if (readerLayout === "double" && activeItemIndex > 0) {
      const prevItem = items[activeItemIndex - 1];
      const prevPrevItem = items[activeItemIndex - 2];
      if (
        prevItem &&
        prevItem.type === "page" &&
        prevPrevItem &&
        prevPrevItem.type === "page" &&
        prevPrevItem.chapterId === prevItem.chapterId
      ) {
        step = 2;
      }
    }

    const targetIndex = activeItemIndex - step;
    if (targetIndex >= 0) {
      setActiveItemIndex(targetIndex);
    } else {
      if (prevIndex !== -1) {
        handlePrevChapter();
      }
    }
  };

  const handleViewportClick = (e) => {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    if (
      e.target.tagName === "BUTTON" ||
      e.target.tagName === "SELECT" ||
      e.target.tagName === "INPUT" ||
      e.target.tagName === "A" ||
      e.target.closest("button") ||
      e.target.closest("a") ||
      e.target.closest(".header-nav") ||
      e.target.closest(".reader-header") ||
      e.target.closest(".bottom-controls-panel") ||
      e.target.closest(".append-loading-container") ||
      e.target.closest(".autoscroll-floating-controls") ||
      e.target.closest(".btn-page-retry")
    ) {
      return;
    }

    setShowUI((prev) => !prev);

    if (isAutoScrolling) {
      setIsAutoScrolling(false);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;

    if (readerLayout === "long-strip") {
      const isUpperHalf = e.clientY < window.innerHeight / 2;
      const wrapper = document.querySelector(".reader-wrapper");
      if (wrapper) {
        const scrollAmount = window.innerHeight * 0.8;
        wrapper.scrollBy({
          top: isUpperHalf ? -scrollAmount : scrollAmount,
          behavior: "smooth",
        });
      }
    } else {
      const isLeftClick = clickX < width / 2;
      if (isLeftClick) {
        handlePagePrev();
      } else {
        handlePageNext();
      }
    }
  };

  useEffect(() => {
    if (readerLayout === "long-strip") {
      const idx = items.findIndex(
        (item) =>
          item.chapterId === activeChapterInView &&
          (item.type === "header"
            ? activePage === 1
            : item.page === activePage),
      );
      if (idx !== -1) {
        setActiveItemIndex(idx);
      }
    }
  }, [activePage, activeChapterInView, items, readerLayout]);

  useEffect(() => {
    if (readerLayout !== "long-strip" && items[activeItemIndex]) {
      const currentItem = items[activeItemIndex];
      setActiveChapterInView(currentItem.chapterId);
      activeChapterRef.current = currentItem.chapterId;
      const targetObj = sortedChapters.find(
        (item) => item.id === currentItem.chapterId,
      );
      if (targetObj) {
        setIsCurrentDownloaded(isChDownloaded(targetObj.number));
      }

      const newPageVal = currentItem.type === "header" ? 1 : currentItem.page;
      if (newPageVal !== activePageRef.current) {
        activePageRef.current = newPageVal;
        setActivePage(newPageVal);
      }
    }
  }, [activeItemIndex, readerLayout, items]);

  const prevItemsLengthRef = useRef(0);
  useEffect(() => {
    if (
      readerLayout !== "long-strip" &&
      items.length > prevItemsLengthRef.current
    ) {
      if (
        activeItemIndex === prevItemsLengthRef.current - 1 &&
        prevItemsLengthRef.current > 0
      ) {
        setActiveItemIndex(prevItemsLengthRef.current);
      }
    }
    prevItemsLengthRef.current = items.length;
  }, [items, readerLayout, activeItemIndex]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 1. Always prioritize Ctrl / Cmd zoom shortcuts regardless of focus
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (isCtrlOrMeta) {
        if (
          e.key === "=" ||
          e.key === "+" ||
          e.key === "Add" ||
          e.code === "Equal" ||
          e.code === "NumpadAdd" ||
          e.keyCode === 187 ||
          e.which === 187 ||
          e.keyCode === 107
        ) {
          e.preventDefault();
          e.stopPropagation();
          handleZoom(40);
          return;
        }
        if (
          e.key === "-" ||
          e.key === "_" ||
          e.key === "Subtract" ||
          e.code === "Minus" ||
          e.code === "NumpadSubtract" ||
          e.keyCode === 189 ||
          e.which === 189 ||
          e.keyCode === 109
        ) {
          e.preventDefault();
          e.stopPropagation();
          handleZoom(-40);
          return;
        }
      }

      // 2. Ignore plain typing shortcuts if user is typing in a text field
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        return;
      }

      // Help modal toggle
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setShowInfoModal((prev) => !prev);
        return;
      }

      // Escape key to close modal or stop auto-scroll
      if (e.key === "Escape") {
        if (showInfoModal) {
          e.preventDefault();
          setShowInfoModal(false);
          return;
        }
        if (isAutoScrolling) {
          e.preventDefault();
          setIsAutoScrolling(false);
          return;
        }
      }

      // Chapter navigation shortcuts
      if (e.key === "[" || e.code === "BracketLeft") {
        e.preventDefault();
        e.stopPropagation();
        cancelScrollLock();
        handlePrevChapter();
        return;
      }
      if (e.key === "]" || e.code === "BracketRight") {
        e.preventDefault();
        e.stopPropagation();
        cancelScrollLock();
        handleNextChapter();
        return;
      }

      // Space key to toggle auto-scroll in long-strip mode
      if (e.code === "Space" || e.key === " ") {
        if (readerLayout === "long-strip") {
          e.preventDefault();
          cancelScrollLock();
          toggleAutoScroll();
          return;
        }
      }

      // Page Navigation shortcuts (Arrow keys / A & D)
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        e.preventDefault();
        handlePageNext();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        handlePagePrev();
        return;
      }

      // Smooth vertical scroll in long-strip
      if (readerLayout === "long-strip") {
        const wrapper = document.querySelector(".reader-wrapper");
        if (wrapper) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            cancelScrollLock();
            wrapper.scrollBy({ top: 180, behavior: "smooth" });
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            cancelScrollLock();
            wrapper.scrollBy({ top: -180, behavior: "smooth" });
            return;
          }
          if (e.key === "PageDown") {
            e.preventDefault();
            cancelScrollLock();
            wrapper.scrollBy({
              top: window.innerHeight * 0.8,
              behavior: "smooth",
            });
            return;
          }
          if (e.key === "PageUp") {
            e.preventDefault();
            cancelScrollLock();
            wrapper.scrollBy({
              top: -window.innerHeight * 0.8,
              behavior: "smooth",
            });
            return;
          }
        }
      }
    };

    const handleWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY < 0) {
          handleZoom(40);
        } else if (e.deltaY > 0) {
          handleZoom(-40);
        }
      } else {
        cancelScrollLock();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("wheel", handleWheel, {
      passive: false,
      capture: true,
    });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("wheel", handleWheel, true);
    };
  }, [
    readerLayout,
    readerDirection,
    activeItemIndex,
    activePage,
    totalPagesForActiveChapter,
    items,
    nextIndex,
    prevIndex,
    isAutoScrolling,
    autoScrollSpeed,
    showInfoModal,
    sortedChapters,
  ]);

  // Smooth Auto-Scroll requestAnimationFrame loop with auto-pause/resume on image downloading
  useEffect(() => {
    if (!isAutoScrolling || readerLayout !== "long-strip") {
      setIsBufferingImage(false);
      isBufferingRef.current = false;
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    let animationFrameId;
    let lastTimestamp = performance.now();
    let subPixelAccumulator = 0;

    const speedMap = {
      1: 35,
      2: 65,
      3: 110,
      4: 175,
      5: 260,
      6: 380,
    };

    const step = (now) => {
      // Check if image in reading zone is still downloading (throttle checking to every 80ms)
      if (now - bufferingCheckThrottleRef.current > 80) {
        bufferingCheckThrottleRef.current = now;

        let buffering = false;

        // 1. If next chapter is appending and we are near the bottom of loaded content
        if (appendingLoading) {
          const distFromBottom =
            container.scrollHeight -
            container.scrollTop -
            container.clientHeight;
          if (distFromBottom < container.clientHeight * 1.5) {
            buffering = true;
          }
        }

        // 2. Check visible elements in reading zone
        if (!buffering) {
          const containerRect = container.getBoundingClientRect();
          const pageWrappers = container.querySelectorAll(".page-wrapper");

          for (const pageEl of pageWrappers) {
            const rect = pageEl.getBoundingClientRect();
            // Visible reading zone (from top + 20px to bottom - 30px)
            const isInViewZone =
              rect.bottom > containerRect.top + 20 &&
              rect.top < containerRect.bottom - 30;

            if (isInViewZone) {
              if (pageEl.getAttribute("data-placeholder") === "true") {
                buffering = true;
                break;
              }
              const lazyContainer = pageEl.querySelector(
                ".lazy-page-container",
              );
              if (
                lazyContainer &&
                lazyContainer.classList.contains("is-loading") &&
                !lazyContainer.classList.contains("has-error")
              ) {
                buffering = true;
                break;
              }
            }
          }
        }

        if (buffering !== isBufferingRef.current) {
          isBufferingRef.current = buffering;
          setIsBufferingImage(buffering);
        }
      }

      if (isBufferingRef.current) {
        // Pause auto-scroll while image is downloading, reset timestamp so it doesn't jump forward!
        lastTimestamp = now;
        animationFrameId = requestAnimationFrame(step);
        return;
      }

      const deltaTime = Math.min((now - lastTimestamp) / 1000, 0.1);
      lastTimestamp = now;

      const pxPerSec = speedMap[autoScrollSpeed] || 65;
      subPixelAccumulator += pxPerSec * deltaTime;

      if (subPixelAccumulator >= 1) {
        const scrollDelta = Math.floor(subPixelAccumulator);
        subPixelAccumulator -= scrollDelta;
        container.scrollTop += scrollDelta;
      }

      const isAtBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <=
        2;

      if (isAtBottom && (!autoLoadNext || nextIndex === -1)) {
        setIsAutoScrolling(false);
        setIsBufferingImage(false);
        isBufferingRef.current = false;
        return;
      }

      animationFrameId = requestAnimationFrame(step);
    };

    animationFrameId = requestAnimationFrame(step);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      setIsBufferingImage(false);
      isBufferingRef.current = false;
    };
  }, [
    isAutoScrolling,
    autoScrollSpeed,
    readerLayout,
    autoLoadNext,
    nextIndex,
    appendingLoading,
  ]);

  const renderSingleOrDoublePage = () => {
    const currentItem = items[activeItemIndex];
    if (!currentItem) return null;

    if (currentItem.type === "header") {
      return (
        <div
          key={currentItem.id}
          data-chapter={currentItem.chapterId}
          className="splash-card u-style-58"
        >
          <div className="splash-card-overlay" />
          <div className="splash-card-content">
            <span className="splash-manga-title">
              {mangaTitle || id || "Manga Stream"}
            </span>
            <h1 className="splash-chapter-num">
              Chapter{" "}
              {getCleanChapterNum(
                currentItem.chapterId,
                currentItem.chapterNum,
              )}
            </h1>
            <div
              className={`splash-status-badge ${currentItem.isDownloaded ? "local" : "online"}`}
            >
              {currentItem.isDownloaded ? (
                <HardDrive size={13} />
              ) : (
                <Globe size={13} />
              )}
              <span>
                {currentItem.isDownloaded
                  ? "Downloaded Chapter"
                  : "Online Stream"}
              </span>
            </div>

            <div className="splash-chevron splash-scroll-hint u-style-59">
              <span>PRESS RIGHT ARROW OR CLICK RIGHT SIDE TO READ</span>
              <span className="u-style-60">
                PRESS LEFT ARROW OR CLICK LEFT SIDE TO GO BACK
              </span>
            </div>
          </div>
        </div>
      );
    }

    if (readerLayout === "single") {
      return (
        <div
          key={currentItem.id}
          data-chapter={currentItem.chapterId}
          data-page={currentItem.page}
          data-placeholder={currentItem.isPlaceholder ? "true" : undefined}
          className="page-wrapper single-page-mode"
        >
          <LazyMangaPage
            src={currentItem.img}
            alt={`Page ${currentItem.page}`}
            page={currentItem.page}
            chapterId={currentItem.chapterId}
            chapterNum={currentItem.chapterNum}
            isPlaceholder={currentItem.isPlaceholder}
            shouldLoad={true}
            containerRef={containerRef}
            isFirstPage={currentItem.page === 1}
            onPageLoaded={handlePageImageLoaded}
          />
        </div>
      );
    }

    const page1 = currentItem;
    let page2 = null;
    const nextItem = items[activeItemIndex + 1];
    if (
      nextItem &&
      nextItem.type === "page" &&
      nextItem.chapterId === page1.chapterId
    ) {
      page2 = nextItem;
    }

    return (
      <div
        className={`double-page-container ${readerDirection === "rtl" ? "rtl-mode" : "ltr-mode"}`}
      >
        <div
          key={page1.id}
          data-chapter={page1.chapterId}
          data-page={page1.page}
          data-placeholder={page1.isPlaceholder ? "true" : undefined}
          className="page-wrapper double-page-half"
        >
          <LazyMangaPage
            src={page1.img}
            alt={`Page ${page1.page}`}
            page={page1.page}
            chapterId={page1.chapterId}
            chapterNum={page1.chapterNum}
            isPlaceholder={page1.isPlaceholder}
            shouldLoad={true}
            containerRef={containerRef}
            isFirstPage={page1.page === 1}
            onPageLoaded={handlePageImageLoaded}
          />
        </div>

        {page2 && (
          <div
            key={page2.id}
            data-chapter={page2.chapterId}
            data-page={page2.page}
            data-placeholder={page2.isPlaceholder ? "true" : undefined}
            className="page-wrapper double-page-half"
          >
            <LazyMangaPage
              src={page2.img}
              alt={`Page ${page2.page}`}
              page={page2.page}
              chapterId={page2.chapterId}
              chapterNum={page2.chapterNum}
              isPlaceholder={page2.isPlaceholder}
              shouldLoad={true}
              containerRef={containerRef}
              isFirstPage={false}
              onPageLoaded={handlePageImageLoaded}
            />
          </div>
        )}
      </div>
    );
  };

  // History Tracking Ref & Logic
  const lastTickTimeRef = useRef(0);
  const activePageRef = useRef(1);
  const activeChapterRef = useRef(chapterNumOrId);
  const savedResumePageRef = useRef(1);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const sortedChaptersRef = useRef(sortedChapters);
  sortedChaptersRef.current = sortedChapters;

  const saveReadProgress = async (isFinal = false) => {
    const currentActiveChId = activeChapterRef.current || activeChapterInView;
    const chapters = sortedChaptersRef.current || sortedChapters;
    const allItems = itemsRef.current || items;

    const pagesOfCurrentCh = allItems.filter(
      (item) => item.type === "page" && item.chapterId === currentActiveChId,
    );
    if (pagesOfCurrentCh.length === 0) return;

    const allPlaceholders = pagesOfCurrentCh.every(
      (item) => item.isPlaceholder,
    );
    if (allPlaceholders) return;

    const realPages = pagesOfCurrentCh.filter((item) => !item.isPlaceholder);
    const totalPages =
      realPages.length > 0 ? realPages.length : pagesOfCurrentCh.length;

    const chNum =
      chapters.find((c) => c.id === currentActiveChId)?.number ||
      getCleanChapterNum(currentActiveChId, currentChapter);

    const now = Date.now();
    const timeSpent = (now - lastTickTimeRef.current) / 1000;
    lastTickTimeRef.current = now;

    const container = containerRef.current;
    let realLoadedImages = 0;
    if (container) {
      realLoadedImages = container.querySelectorAll(
        `[data-chapter="${currentActiveChId}"][data-page] .lazy-page-img.loaded`,
      ).length;
    }

    const curPage = Math.min(activePageRef.current, totalPages);
    const isNearEnd = totalPages > 0 && curPage / totalPages >= 0.85;
    const hasSufficientImages =
      realLoadedImages >= Math.min(3, Math.ceil(totalPages * 0.4));

    const isCompleted =
      isNearEnd && hasSufficientImages && (timeSpent >= 6 || isFinal);

    if (timeSpent > 0.5 || isFinal) {
      try {
        await apiPost("/api/history/update", {
          mediaId: id,
          type: "Manga",
          title: mangaTitle || "Manga",
          number: chNum,
          currentTime: curPage,
          duration: totalPages,
          timeSpent,
          image,
          provider,
          malid,
          isCompleted,
        });
      } catch (err) {
        console.error("Failed to save read progress:", err);
      }
    }
  };

  const handleExitReader = async () => {
    try {
      await saveReadProgress(true);
    } catch (_) {}
    if (onBack) onBack();
  };

  // Load progress
  useEffect(() => {
    savedResumePageRef.current = 1;
    activePageRef.current = 1;
    setActivePage(1); // Reset active page state on chapter change
    lastTickTimeRef.current = Date.now();

    const loadProgress = async () => {
      try {
        const res = await fetch(
          `/api/history/progress?mediaId=${encodeURIComponent(id)}&type=Manga`,
        );
        const progressData = await res.json();

        const chNum =
          sortedChapters.find((c) => {
            if (isCurrentDownloaded) {
              return Number(c.number) === Number(currentChapter);
            } else {
              return c.id === currentChapter;
            }
          })?.number || getCleanChapterNum(activeChapterInView, currentChapter);

        const currentChStatus = (progressData?.chaptersStatus || []).find(
          (cs) => Number(cs.number) === Number(chNum),
        );
        const targetProgress =
          Number(progressData?.lastProgress?.number) === Number(chNum)
            ? progressData.lastProgress
            : currentChStatus;

        if (targetProgress) {
          const isCompleted = targetProgress.isCompleted;
          const duration = parseInt(targetProgress.duration || 0);
          const savedPage = parseInt(targetProgress.currentPage || 1);
          const isAtEnd = duration > 0 && savedPage >= duration;
          const resumePage =
            isCompleted || isAtEnd ? 1 : Math.max(1, savedPage);

          savedResumePageRef.current = resumePage;
          activePageRef.current = resumePage;
          setActivePage(resumePage);
          if (resumePage > 1) {
            startScrollLock(resumePage, activeChapterInView);
          }
        }
      } catch (err) {
        console.error("Failed to load progress:", err);
      }
    };

    loadProgress();
  }, [id, currentChapter]);

  // Periodic Save progress
  useEffect(() => {
    const interval = setInterval(() => {
      saveReadProgress(false);
    }, 5000);

    return () => {
      clearInterval(interval);
      saveReadProgress(true);
    };
  }, [id, activeChapterInView, items]);

  useEffect(() => {
    if (!loading && items.length > 0 && readerLayout === "long-strip") {
      const container = containerRef.current;
      if (!container) return;

      if (pendingTargetPageRef.current) {
        const { page, chapterId } = pendingTargetPageRef.current;
        const pageEl = container.querySelector(
          `[data-chapter="${chapterId}"][data-page="${page}"]`,
        );
        if (pageEl) {
          pageEl.scrollIntoView({ behavior: "instant", block: "start" });
        }
      } else if (savedResumePageRef.current && savedResumePageRef.current > 1) {
        const targetPage = savedResumePageRef.current;
        const targetChapId = activeChapterRef.current || activeChapterInView;
        savedResumePageRef.current = null;
        startScrollLock(targetPage, targetChapId);
        const pageEl = container.querySelector(
          `[data-chapter="${targetChapId}"][data-page="${targetPage}"]`,
        );
        if (pageEl) {
          pageEl.scrollIntoView({ behavior: "instant", block: "start" });
        }
      }
    }
  }, [loading, items]);

  // Initial loading effect
  useEffect(() => {
    fetchChapterPages(null, false);
  }, [id, currentChapter]);

  // Scroll visibility and viewport detection listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleUserManualScroll = () => {
      cancelScrollLock();
    };

    const handleScroll = () => {
      setIsScrolling(true);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 1800);

      if (isProgrammaticScrollRef.current) {
        return;
      }

      // Check which chapter and page are currently in view
      const pageElements = container.querySelectorAll("[data-chapter]");
      let activeId = null;
      for (const el of pageElements) {
        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (rect.top - containerRect.top <= container.clientHeight / 2) {
          activeId = el.getAttribute("data-chapter");
        }
      }

      const targetChapId =
        activeId || activeChapterRef.current || activeChapterInView;
      const pageWrapperElements = container.querySelectorAll(
        `[data-chapter="${targetChapId}"][data-page]`,
      );
      let activePageVal = 1;
      for (const el of pageWrapperElements) {
        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (rect.top - containerRect.top <= container.clientHeight / 2) {
          activePageVal = parseInt(el.getAttribute("data-page") || "1");
        }
      }
      if (activePageVal !== activePageRef.current) {
        activePageRef.current = activePageVal;
        setActivePage(activePageVal);
      }

      if (activeId && activeId !== activeChapterInView) {
        setActiveChapterInView(activeId);
        activeChapterRef.current = activeId;
        const targetObj = (sortedChaptersRef.current || sortedChapters).find(
          (item) => item.id === activeId,
        );
        if (targetObj) {
          setIsCurrentDownloaded(isChDownloaded(targetObj.number));
        }
      }

      // Check if scrolled near the bottom of the container
      const threshold = 350; // pixels from the bottom
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        threshold;

      if (
        isNearBottom &&
        autoLoadNext &&
        !loading &&
        !appendingLoading &&
        !errorMsg &&
        nextIndex !== -1
      ) {
        if (!isTransitioningRef.current) {
          const nextChapterObj = sortedChapters[nextIndex];
          if (!loadedChapters.includes(nextChapterObj.id)) {
            isTransitioningRef.current = true;
            fetchChapterPages(nextChapterObj, true);
          }
        }
      }
    };

    container.addEventListener("scroll", handleScroll);
    container.addEventListener("wheel", handleUserManualScroll, {
      passive: true,
    });
    container.addEventListener("touchstart", handleUserManualScroll, {
      passive: true,
    });
    container.addEventListener("touchmove", handleUserManualScroll, {
      passive: true,
    });

    return () => {
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", handleUserManualScroll);
      container.removeEventListener("touchstart", handleUserManualScroll);
      container.removeEventListener("touchmove", handleUserManualScroll);
    };
  }, [
    id,
    activeChapterInView,
    autoLoadNext,
    nextIndex,
    loading,
    appendingLoading,
    errorMsg,
    loadedChapters,
    sortedChapters,
  ]);

  return (
    <div ref={containerRef} className="reader-wrapper">
      <style>{`
        @keyframes bounce {
          0%, 20%, 50%, 80%, 100% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(-8px);
          }
          60% {
            transform: translateY(-4px);
          }
        }
        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
        .splash-chevron {
          animation: bounce 2s infinite;
        }
        .spin-icon {
          animation: spin 1s linear infinite;
        }
      `}</style>

      {/* Top Header controls */}
      <div className={`reader-header glass-panel ${!showUI ? "hide-ui" : ""}`}>
        <div className="header-left-section">
          <button onClick={handleExitReader} className="btn-reader-back">
            <ArrowLeft size={18} />
            <span>Exit Reader</span>
          </button>
        </div>

        <div className="header-center-nav">
          {sortedChapters.length > 0 && (
            <div className="reader-navigation">
              <button
                onClick={handlePrevChapter}
                disabled={prevIndex === -1}
                className="btn-nav"
                title="Previous Chapter ([)"
              >
                <ChevronLeft size={16} />
              </button>

              <div className="select-container">
                <select
                  value={activeChapterInView || ""}
                  onChange={(e) => {
                    const selected = sortedChapters.find(
                      (item) => item.id === e.target.value,
                    );
                    if (selected) handleJumpToChapter(selected);
                    e.target.blur();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.preventDefault();
                      e.target.blur();
                    }
                  }}
                  className="select-nav"
                >
                  {sortedChapters.map((item) => (
                    <option key={item.id} value={item.id}>
                      Ch {item.number}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleNextChapter}
                disabled={nextIndex === -1}
                className="btn-nav"
                title="Next Chapter (])"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {totalPagesForActiveChapter > 0 && (
            <div className="reader-page-navigation">
              <button
                onClick={handlePagePrev}
                disabled={activePage <= 1 && prevIndex === -1}
                className="btn-nav page-btn-prev"
                title="Previous Page (Left Arrow / A)"
              >
                <ChevronLeft size={15} />
              </button>

              <div className="select-container page-select-container">
                <span className="page-nav-prefix">Page</span>
                <select
                  value={activePage}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    jumpToPage(val);
                    e.target.blur();
                  }}
                  className="select-nav page-select-nav"
                >
                  {Array.from(
                    { length: totalPagesForActiveChapter },
                    (_, i) => i + 1,
                  ).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <span className="page-nav-total">
                  / {totalPagesForActiveChapter}
                </span>
              </div>

              <button
                onClick={handlePageNext}
                disabled={
                  activePage >= totalPagesForActiveChapter && nextIndex === -1
                }
                className="btn-nav page-btn-next"
                title="Next Page (Right Arrow / D)"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>

        <div className="header-right-section">
          {readerLayout === "long-strip" && (
            <button
              type="button"
              className={`btn-auto-scroll ${isAutoScrolling ? "active" : ""}`}
              onClick={toggleAutoScroll}
              title={
                isAutoScrolling
                  ? "Pause Auto Scroll (Space)"
                  : "Start Auto Scroll (Space)"
              }
            >
              {isAutoScrolling ? (
                isBufferingImage ? (
                  <Loader2 className="spin-icon" size={15} />
                ) : (
                  <Pause size={15} />
                )
              ) : (
                <Play size={15} />
              )}
              <span>
                {isAutoScrolling
                  ? isBufferingImage
                    ? `Buffering... (${autoScrollSpeed}x)`
                    : `Auto Scroll (${autoScrollSpeed}x)`
                  : "Auto Scroll"}
              </span>
            </button>
          )}

          <span
            className={`header-badge ${isCurrentDownloaded ? "local" : "online"}`}
          >
            {isCurrentDownloaded ? (
              <HardDrive size={13} />
            ) : (
              <Globe size={13} />
            )}
            <span>{isCurrentDownloaded ? "Local" : "Online"}</span>
          </span>

          <button
            type="button"
            className="btn-reader-info"
            onClick={() => setShowInfoModal(true)}
            title="Shortcuts & Gestures (?)"
          >
            <HelpCircle size={16} />
          </button>
        </div>
      </div>

      {/* Main Pages viewport */}
      <div
        tabIndex={0}
        className="reader-viewport u-style-65"
        onClick={(e) => {
          if (
            document.activeElement &&
            document.activeElement !== e.currentTarget &&
            typeof document.activeElement.blur === "function"
          ) {
            document.activeElement.blur();
          }
          handleViewportClick(e);
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {loading ? (
          <div className="status-overlay">
            <img
              src="/images/loading.gif"
              alt="loading"
              className="loading-gif"
            />
            <p>
              Loading pages for Chapter{" "}
              {getCleanChapterNum(activeChapterInView, chapterNumOrId)}...
            </p>
          </div>
        ) : errorMsg ? (
          <div className="status-overlay">
            <AlertTriangle className="error-icon" size={32} />
            <p className="error-msg">{errorMsg}</p>
            <button
              onClick={() => fetchChapterPages(null, false)}
              className="btn-retry"
            >
              Retry
            </button>
          </div>
        ) : (
          <div
            className="pages-container"
            style={{
              width: "100%",
              maxWidth: `${readerWidth}px`,
            }}
          >
            {readerLayout === "long-strip"
              ? items.map((item) => {
                  if (item.type === "header") {
                    return (
                      <div
                        key={item.id}
                        data-chapter={item.chapterId}
                        className="splash-card"
                      >
                        <div className="splash-card-overlay" />
                        <div className="splash-card-content">
                          <span className="splash-manga-title">
                            {mangaTitle || id || "Manga Stream"}
                          </span>
                          <h1 className="splash-chapter-num">
                            Chapter{" "}
                            {getCleanChapterNum(
                              item.chapterId,
                              item.chapterNum,
                            )}
                          </h1>
                          <div
                            className={`splash-status-badge ${item.isDownloaded ? "local" : "online"}`}
                          >
                            {item.isDownloaded ? (
                              <HardDrive size={13} />
                            ) : (
                              <Globe size={13} />
                            )}
                            <span>
                              {item.isDownloaded
                                ? "Downloaded Chapter"
                                : "Online Stream"}
                            </span>
                          </div>

                          <div className="splash-chevron splash-scroll-hint">
                            <span>SCROLL TO READ</span>
                            <ChevronsDown size={20} />
                          </div>
                        </div>
                      </div>
                    );
                  } else {
                    const isCurrentChap =
                      item.chapterId === activeChapterInView;
                    const pageDiff = Math.abs(item.page - activePage);
                    let isNearby = false;
                    if (isCurrentChap) {
                      isNearby = pageDiff <= 3;
                    } else {
                      const chapIndex = loadedChapters.indexOf(item.chapterId);
                      const activeChapIndex =
                        loadedChapters.indexOf(activeChapterInView);
                      if (
                        chapIndex === activeChapIndex + 1 &&
                        activePage >= totalPagesForActiveChapter - 2 &&
                        item.page <= 3
                      ) {
                        isNearby = true;
                      } else if (
                        chapIndex === activeChapIndex - 1 &&
                        activePage <= 3 &&
                        item.page >= 15
                      ) {
                        isNearby = true;
                      }
                    }
                    const shouldLoad = isNearby;
                    const isVirtualActive = isCurrentChap
                      ? pageDiff <= 4
                      : isNearby;

                    return (
                      <div
                        key={item.id}
                        data-chapter={item.chapterId}
                        data-page={item.page}
                        data-placeholder={
                          item.isPlaceholder ? "true" : undefined
                        }
                        className={`page-wrapper ${item.isPlaceholder ? "placeholder-page-wrapper" : ""}`}
                      >
                        <LazyMangaPage
                          src={item.img}
                          alt={`Page ${item.page}`}
                          page={item.page}
                          chapterId={item.chapterId}
                          chapterNum={item.chapterNum}
                          isPlaceholder={item.isPlaceholder}
                          shouldLoad={shouldLoad}
                          isVirtualActive={isVirtualActive}
                          containerRef={containerRef}
                          isFirstPage={item.page === 1}
                          onPageLoaded={handlePageImageLoaded}
                        />
                      </div>
                    );
                  }
                })
              : renderSingleOrDoublePage()}

            {/* Subtle pre-fetching loading indicator at bottom */}
            {appendingLoading && (
              <div className="append-loading-container">
                <Loader2 className="spin-icon" size={24} />
                <span>Pre-fetching next chapter...</span>
              </div>
            )}

            {/* Bottom Navigation Controls */}
            {readerLayout === "long-strip" &&
              sortedChapters.length > 0 &&
              !appendingLoading && (
                <div
                  className={`bottom-controls-panel glass-panel ${!showUI ? "hide-ui" : ""}`}
                >
                  <p className="bottom-controls-title">
                    You've reached the end of Chapter{" "}
                    {getCleanChapterNum(activeChapterInView, chapterNumOrId)}
                  </p>
                  <div className="bottom-nav-row">
                    <button
                      onClick={handlePrevChapter}
                      disabled={prevIndex === -1}
                      className="btn-bottom-nav"
                    >
                      <ChevronLeft size={16} />
                      <span>Previous Chapter</span>
                    </button>

                    <select
                      value={activeChapterInView || ""}
                      onChange={(e) => {
                        const selected = sortedChapters.find(
                          (item) => item.id === e.target.value,
                        );
                        if (selected) handleJumpToChapter(selected);
                        e.target.blur();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                          e.preventDefault();
                          e.target.blur();
                        }
                      }}
                      className="bottom-nav-select"
                    >
                      {sortedChapters.map((item) => (
                        <option key={item.id} value={item.id}>
                          Chapter {item.number}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={handleNextChapter}
                      disabled={nextIndex === -1}
                      className="btn-bottom-nav"
                    >
                      <span>Next Chapter</span>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
          </div>
        )}
      </div>

      {/* Floating Auto-Scroll Controls */}
      {isAutoScrolling && readerLayout === "long-strip" && (
        <div className="autoscroll-floating-controls glass-panel">
          {isBufferingImage && (
            <div className="autoscroll-buffering-badge">
              <Loader2 className="spin-icon" size={12} />
              <span>Buffering...</span>
            </div>
          )}
          <button
            type="button"
            className="btn-autoscroll-step"
            onClick={(e) => {
              e.stopPropagation();
              handleSpeedChange(autoScrollSpeed - 1);
            }}
            title="Decrease speed"
            disabled={autoScrollSpeed <= 1}
          >
            <Minus size={13} />
          </button>
          <span className="autoscroll-speed-label">{autoScrollSpeed}x</span>
          <button
            type="button"
            className="btn-autoscroll-step"
            onClick={(e) => {
              e.stopPropagation();
              handleSpeedChange(autoScrollSpeed + 1);
            }}
            title="Increase speed"
            disabled={autoScrollSpeed >= 6}
          >
            <Plus size={13} />
          </button>
          <div className="autoscroll-divider" />
          <button
            type="button"
            className="btn-autoscroll-toggle"
            onClick={(e) => {
              e.stopPropagation();
              toggleAutoScroll();
            }}
            title="Pause auto scroll (Space)"
          >
            <Pause size={13} />
            <span>Pause</span>
          </button>
          <button
            type="button"
            className="btn-autoscroll-close"
            onClick={(e) => {
              e.stopPropagation();
              setIsAutoScrolling(false);
            }}
            title="Stop auto scroll (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Floating Page Indicator Pill */}
      {readerLayout === "long-strip" && totalPagesForActiveChapter > 0 && (
        <div
          className={`floating-page-pill ${!showUI && !isAutoScrolling && !isScrolling ? "dimmed" : ""}`}
        >
          <span>Page {activePage}</span>
          <span className="pill-divider">/</span>
          <span>{totalPagesForActiveChapter}</span>
        </div>
      )}

      {/* Floating HUD Feedback Toast */}
      {hudMessage && (
        <div className="reader-hud-toast" role="status" aria-live="polite">
          {hudMessage}
        </div>
      )}

      {/* Keybinds & Gestures Help Dialog */}
      {showInfoModal && (
        <dialog
          className="reader-info-dialog"
          open
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowInfoModal(false);
          }}
          aria-labelledby="reader-info-modal-title"
        >
          <div className="reader-info-modal-card glass-panel">
            <div className="reader-info-modal-header">
              <div className="reader-info-title-group">
                <HelpCircle size={20} className="reader-info-title-icon" />
                <h3 id="reader-info-modal-title">
                  <span className="reader-info-desktop-only">
                    Reader Keyboard Shortcuts
                  </span>
                  <span className="reader-info-mobile-only">
                    Reader Touch Gestures
                  </span>
                </h3>
              </div>
              <button
                type="button"
                className="reader-info-modal-close"
                onClick={() => setShowInfoModal(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="reader-info-modal-body">
              <div className="reader-info-group reader-info-desktop-only">
                <div className="reader-info-group-heading">
                  <Keyboard size={16} />
                  <span>Desktop Keybinds</span>
                </div>
                <div className="reader-info-grid">
                  <div className="reader-info-item">
                    <span className="reader-info-kbd">
                      <kbd>Ctrl</kbd> + <kbd>+</kbd> / <kbd>-</kbd>
                    </span>
                    <span className="reader-info-text">
                      Zoom page width in/out (auto-saved)
                    </span>
                  </div>
                  <div className="reader-info-item">
                    <span className="reader-info-kbd">
                      <kbd>←</kbd> / <kbd>→</kbd> or <kbd>A</kbd> / <kbd>D</kbd>
                    </span>
                    <span className="reader-info-text">
                      Previous / Next Page
                    </span>
                  </div>
                  <div className="reader-info-item">
                    <span className="reader-info-kbd">
                      <kbd>↑</kbd> / <kbd>↓</kbd>
                    </span>
                    <span className="reader-info-text">
                      Scroll up / down smoothly
                    </span>
                  </div>
                  <div className="reader-info-item">
                    <span className="reader-info-kbd">
                      <kbd>PageUp</kbd> / <kbd>PageDown</kbd>
                    </span>
                    <span className="reader-info-text">
                      Jump one full screen up / down
                    </span>
                  </div>
                  <div className="reader-info-item">
                    <span className="reader-info-kbd">
                      <kbd>[</kbd> / <kbd>]</kbd>
                    </span>
                    <span className="reader-info-text">
                      Previous / Next Chapter
                    </span>
                  </div>
                  {readerLayout === "long-strip" && (
                    <div className="reader-info-item">
                      <span className="reader-info-kbd">
                        <kbd>Space</kbd>
                      </span>
                      <span className="reader-info-text">
                        Toggle Continuous Auto-Scroll
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="reader-info-group reader-info-mobile-only">
                <div className="reader-info-group-heading">
                  <Smartphone size={16} />
                  <span>Mobile & Touch Gestures</span>
                </div>
                <div className="reader-info-grid">
                  <div className="reader-info-item">
                    <span className="reader-info-kbd">2-Finger Pinch</span>
                    <span className="reader-info-text">
                      Pinch in/out to resize page width & save for next use
                    </span>
                  </div>
                  <div className="reader-info-item">
                    <span className="reader-info-kbd">Tap Center</span>
                    <span className="reader-info-text">
                      Toggle reader controls & top header
                    </span>
                  </div>
                  <div className="reader-info-item">
                    <span className="reader-info-kbd">Tap Left / Right</span>
                    <span className="reader-info-text">
                      Flip to previous / next page (Single Page mode)
                    </span>
                  </div>
                  <div className="reader-info-item">
                    <span className="reader-info-kbd">Swipe Up / Down</span>
                    <span className="reader-info-text">
                      Scroll continuously through chapter pages
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="reader-info-modal-footer">
              <button
                type="button"
                className="btn-reader-info-dismiss"
                onClick={() => setShowInfoModal(false)}
              >
                Got It
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}
