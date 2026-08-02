/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState, useRef, useMemo } from "react";
import {
  ArrowLeft,
  Loader2,
  ChevronsUp,
  ChevronsDown,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Globe,
  Maximize2,
  Minimize2,
} from "lucide-react";
import "./css/MangaReader.css";
import { apiPost } from "../utils/common";

// Lazy-loaded page component with CSS transition fade-in
function LazyMangaPage({ src, alt, style, shouldLoad }) {
  const [isVisible, setIsVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (shouldLoad) {
      setIsVisible(true);
    }
  }, [shouldLoad]);

  return (
    <div className="lazy-page-container" style={style}>
      {isVisible ? (
        <>
          {!loaded && (
            <div className="lazy-page-loading-overlay">
              <Loader2 className="spin-icon" size={24} />
            </div>
          )}
          <img
            src={src}
            alt={alt}
            onLoad={() => setLoaded(true)}
            style={{
              opacity: loaded ? 1 : 0,
            }}
            className="lazy-page-img"
            loading="lazy"
            onError={(e) => {
              e.target.src = "/images/image-404.png";
              setLoaded(true);
            }}
          />
        </>
      ) : (
        <div className="reader-viewport-loading">
          <Loader2 className="spin-icon" size={24} />
        </div>
      )}
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
  const [showScrollTop, setShowScrollTop] = useState(false);
  const containerRef = useRef(null);

  // Loaded chapters cache (chapterObj.id strings)
  const [loadedChapters, setLoadedChapters] = useState([]);

  // Local navigation states
  const [currentChapter, setCurrentChapter] = useState(chapterNumOrId);
  const [isCurrentDownloaded, setIsCurrentDownloaded] = useState(isDownloaded);
  const [activeChapterInView, setActiveChapterInView] = useState(null);
  const [autoLoadNext, setAutoLoadNext] = useState(true);
  const [readerWidth, setReaderWidth] = useState(
    () => parseInt(localStorage.getItem("manga_reader_width"), 10) || 800,
  );
  const [readerLayout, setReaderLayout] = useState(
    () => localStorage.getItem("manga_reader_layout") || "long-strip",
  );
  const [readerDirection, setReaderDirection] = useState(
    () => localStorage.getItem("manga_reader_direction") || "rtl",
  );
  const [activeItemIndex, setActiveItemIndex] = useState(0);

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
        if (window.sharedStateAPI && window.sharedStateAPI.getSettings) {
          const res = await window.sharedStateAPI.getSettings([
            "autoLoadNextChapter",
            "mangaReaderLayout",
            "mangaReaderWidth",
          ]);
          const s = res?.settings;
          if (s) {
            setAutoLoadNext(s.autoLoadNextChapter);
            if (s.mangaReaderLayout) {
              setReaderLayout(s.mangaReaderLayout);
              localStorage.setItem("manga_reader_layout", s.mangaReaderLayout);
            }
            if (s.mangaReaderWidth) {
              const widthVal = parseInt(s.mangaReaderWidth, 10);
              setReaderWidth(widthVal);
              localStorage.setItem("manga_reader_width", widthVal);
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch settings:", err);
      }
    };
    fetchSettings();
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
  const currentChapterObj = sortedChapters.find(
    (item) => item.id === activeChapterInView,
  );
  const currentIndex = currentChapterObj
    ? sortedChapters.indexOf(currentChapterObj)
    : -1;
  const prevIndex = currentIndex > 0 ? currentIndex - 1 : -1;
  const nextIndex =
    currentIndex !== -1 && currentIndex < sortedChapters.length - 1
      ? currentIndex + 1
      : -1;

  const handleJumpToChapter = (chapterObj) => {
    const isDownloadedLocal = isChDownloaded(chapterObj.number);
    setIsCurrentDownloaded(isDownloadedLocal);

    // currentChapter uses chapter number for downloaded, chapter ID for online
    const targetVal = isDownloadedLocal ? chapterObj.number : chapterObj.id;
    setCurrentChapter(targetVal);
    setActiveChapterInView(chapterObj.id);
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

  const handlePageNext = () => {
    if (readerLayout === "long-strip") return;

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
    if (readerLayout === "long-strip") return;

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
      e.target.closest(".bottom-controls-panel") ||
      e.target.closest(".append-loading-container")
    ) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

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

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (readerLayout === "long-strip") return;

      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable)
      ) {
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        handlePageNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePagePrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    readerLayout,
    readerDirection,
    activeItemIndex,
    items,
    nextIndex,
    prevIndex,
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
          className="page-wrapper single-page-mode"
        >
          <LazyMangaPage
            src={currentItem.img}
            alt={`Page ${currentItem.page}`}
            shouldLoad={true}
          />
          <div className="page-num u-style-61">Page {currentItem.page}</div>
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
          className="page-wrapper double-page-half"
        >
          <LazyMangaPage
            src={page1.img}
            alt={`Page ${page1.page}`}
            shouldLoad={true}
          />
          <div className="page-num u-style-61">Page {page1.page}</div>
        </div>

        {page2 && (
          <div
            key={page2.id}
            data-chapter={page2.chapterId}
            data-page={page2.page}
            className="page-wrapper double-page-half"
          >
            <LazyMangaPage
              src={page2.img}
              alt={`Page ${page2.page}`}
              shouldLoad={true}
            />
            <div className="page-num u-style-61">Page {page2.page}</div>
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

  const saveReadProgress = async (isFinal = false) => {
    const chNum =
      sortedChapters.find((c) => c.id === activeChapterInView)?.number ||
      getCleanChapterNum(activeChapterInView, currentChapter);
    const pagesOfCurrentCh = items.filter(
      (item) => item.type === "page" && item.chapterId === activeChapterInView,
    );
    if (pagesOfCurrentCh.length === 0) return;
    const totalPages = pagesOfCurrentCh.length;

    const now = Date.now();
    const timeSpent = (now - lastTickTimeRef.current) / 1000;
    lastTickTimeRef.current = now;

    if (timeSpent > 0.5 || isFinal) {
      try {
        await apiPost("/api/history/update", {
          mediaId: id,
          type: "Manga",
          title: mangaTitle || "Manga",
          number: chNum,
          currentTime: activePageRef.current,
          duration: totalPages,
          timeSpent,
          image,
          provider,
          malid,
        });
      } catch (err) {
        console.error("Failed to save read progress:", err);
      }
    }
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

        if (
          progressData?.lastProgress &&
          Number(progressData.lastProgress.number) === Number(chNum)
        ) {
          const savedPage = parseInt(
            progressData.lastProgress.currentPage || 1,
          );
          const resumePage = Math.max(1, savedPage); // Go to the exact page they left from
          savedResumePageRef.current = resumePage;
          activePageRef.current = resumePage;
          setActivePage(resumePage);
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

  // Auto Scroll to last read page when items load
  useEffect(() => {
    if (!loading && items.length > 0 && savedResumePageRef.current > 1) {
      setTimeout(() => {
        const container = containerRef.current;
        if (container) {
          const pageEl = container.querySelector(
            `[data-page="${savedResumePageRef.current}"]`,
          );
          if (pageEl) {
            pageEl.scrollIntoView();
          }
        }
      }, 300);
    }
  }, [loading, items]);

  // Fetch chapter pages (supports full reset or background append mode)
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

      // API expects chapter number if downloaded, ID if online
      const apiChapterID = isAppend
        ? isDownloadedLocal
          ? chapterObj.number
          : chapterObj.id
        : currentChapter;

      // Cache and elements should always use chapterObj.id
      let cacheID = null;
      if (isAppend) {
        cacheID = chapterObj.id;
      } else {
        const initialChapterObj = sortedChapters.find((c) => {
          if (isCurrentDownloaded) {
            return Number(c.number) === Number(currentChapter);
          } else {
            return c.id === currentChapter;
          }
        });
        cacheID = initialChapterObj ? initialChapterObj.id : currentChapter;
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
          : sortedChapters.find((c) => c.id === cacheID)?.number ||
            getCleanChapterNum(cacheID, currentChapter);

        const isActuallyLocal =
          data[0].img && data[0].img.startsWith("data:image/");

        // Auto-heal downloaded list and state
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
        };

        const newPages = sortedPages.map((p) => ({
          id: `page-${cacheID}-${p.page}`,
          type: "page",
          img: p.img,
          page: p.page,
          chapterNum: chNum,
          chapterId: cacheID,
        }));

        if (isAppend) {
          setItems((prev) => [...prev, newHeader, ...newPages]);
          setLoadedChapters((prev) => [...prev, cacheID]);
        } else {
          setItems([newHeader, ...newPages]);
          setLoadedChapters([cacheID]);
          setIsCurrentDownloaded(isActuallyLocal);
          if (containerRef.current) {
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

  // Initial loading effect
  useEffect(() => {
    fetchChapterPages(null, false);
  }, [id, currentChapter]);

  // Scroll visibility and viewport detection listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Toggle scroll-to-top button
      if (container.scrollTop > 800) {
        setShowScrollTop(true);
      } else {
        setShowScrollTop(false);
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

      const pageWrapperElements = container.querySelectorAll("[data-page]");
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
        const targetObj = sortedChapters.find((item) => item.id === activeId);
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
    return () => container.removeEventListener("scroll", handleScroll);
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

  const scrollToTop = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

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
      <div className="reader-header glass-panel">
        <div className="header-left-section">
          <button onClick={onBack} className="btn-reader-back">
            <ArrowLeft size={18} />
            <span>Exit Reader</span>
          </button>
        </div>

        {sortedChapters.length > 0 && (
          <div className="reader-navigation">
            <button
              onClick={handlePrevChapter}
              disabled={prevIndex === -1}
              className="btn-nav"
              title="Previous Chapter"
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
                    {isChDownloaded(item.number) ? " (Downloaded)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleNextChapter}
              disabled={nextIndex === -1}
              className="btn-nav"
              title="Next Chapter"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <div className="header-right-section">
          <div className="reader-size-controls u-style-62">
            <span className="u-style-63">Width: {readerWidth}px</span>
            <input
              type="range"
              min="400"
              max="1600"
              step="20"
              value={readerWidth}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setReaderWidth(val);
                localStorage.setItem("manga_reader_width", val);
                saveReaderWidthToSettings(val);
              }}
              className="u-style-64"
            />
          </div>

          <span className="chapter-title" title={mangaTitle || id}>
            {mangaTitle
              ? `${mangaTitle.slice(0, 20)}${mangaTitle.length > 20 ? "..." : ""}`
              : "Manga"}{" "}
            - Ch {getCleanChapterNum(activeChapterInView, chapterNumOrId)}
          </span>
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
        </div>
      </div>

      {/* Main Pages viewport */}
      <div className="reader-viewport u-style-65" onClick={handleViewportClick}>
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
            <span className="error-icon">⚠️</span>
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
            style={{ maxWidth: `${readerWidth}px` }}
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
                    const shouldLoad =
                      item.chapterId === activeChapterInView &&
                      Math.abs(item.page - activePage) <= 3;
                    return (
                      <div
                        key={item.id}
                        data-chapter={item.chapterId}
                        data-page={item.page}
                        className="page-wrapper"
                      >
                        <LazyMangaPage
                          src={item.img}
                          alt={`Page ${item.page}`}
                          shouldLoad={shouldLoad}
                        />
                        <div className="page-num">Page {item.page}</div>
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
                <div className="bottom-controls-panel glass-panel">
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
                          {isChDownloaded(item.number) ? " (Downloaded)" : ""}
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

      {/* Floating Scroll Top button */}
      {showScrollTop && (
        <button onClick={scrollToTop} className="btn-scroll-top">
          <ChevronsUp size={24} />
        </button>
      )}
    </div>
  );
}
