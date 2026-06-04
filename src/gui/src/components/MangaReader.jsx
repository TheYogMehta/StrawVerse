import React, { useEffect, useState, useRef, useMemo } from "react";
import { ArrowLeft, Loader2, ChevronsUp, ChevronsDown, ChevronLeft, ChevronRight, BookOpen, HardDrive, Globe } from "lucide-react";

// Lazy-loaded page component with CSS transition fade-in
function LazyMangaPage({ src, alt, style }) {
  const [isVisible, setIsVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "800px 0px" } // Load pages within 800px of viewport
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ ...style, display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh", width: "100%", position: "relative" }}>
      {isVisible ? (
        <>
          {!loaded && (
            <div style={{ position: "absolute", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 0 }}>
              <Loader2 className="spin-icon" size={24} style={{ color: "var(--accent)" }} />
            </div>
          )}
          <img
            src={src}
            alt={alt}
            onLoad={() => setLoaded(true)}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              transition: "opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
              opacity: loaded ? 1 : 0,
              zIndex: 1,
            }}
            loading="lazy"
            onError={(e) => {
              e.target.src = "/images/image-404.png";
              setLoaded(true);
            }}
          />
        </>
      ) : (
        <div style={{ width: "100%", height: "80vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#08090b" }}>
          <Loader2 className="spin-icon" size={24} style={{ color: "var(--accent)" }} />
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
  onBack,
}) {
  const [items, setItems] = useState([]);
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

  const isTransitioningRef = useRef(false);

  // Sync basic configurations from server
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch("/api/settings");
        const data = await response.json();
        if (data && data.autoLoadNextChapter) {
          setAutoLoadNext(data.autoLoadNextChapter === "on");
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
    return [...chaptersList].sort((a, b) => Number(a.number) - Number(b.number));
  }, [chaptersList]);

  // Sync prop updates to local states & resolve initial active ID
  useEffect(() => {
    setCurrentChapter(chapterNumOrId);
    setIsCurrentDownloaded(isDownloaded);

    const initialChapterObj = sortedChapters.find(c => {
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
    const chObj = sortedChapters.find(c => c.id === chapterId);
    if (chObj) return chObj.number;
    
    if (typeof chapterId === 'string') {
      const hashMatch = chapterId.match(/_(\d+(?:\.\d+)?)$/);
      if (hashMatch) return hashMatch[1];

      const match = chapterId.match(/(?:chapter[-_]|ch[-_]|\b)(\d+(?:\.\d+)?)(?:\b|$)/i);
      if (match) return match[1];
    }
    return fallbackValue || "...";
  };

  // Track the indexes of the chapter currently visible in the viewport using unique IDs
  const currentChapterObj = sortedChapters.find((item) => item.id === activeChapterInView);
  const currentIndex = currentChapterObj ? sortedChapters.indexOf(currentChapterObj) : -1;
  const prevIndex = currentIndex > 0 ? currentIndex - 1 : -1;
  const nextIndex = currentIndex !== -1 && currentIndex < sortedChapters.length - 1 ? currentIndex + 1 : -1;

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

  // History Tracking Ref & Logic
  const lastTickTimeRef = useRef(Date.now());
  const activePageRef = useRef(1);
  const activeChapterRef = useRef(chapterNumOrId);
  const savedResumePageRef = useRef(1);

  const saveReadProgress = async (isFinal = false) => {
    const chNum = sortedChapters.find(c => c.id === activeChapterInView)?.number || getCleanChapterNum(activeChapterInView, currentChapter);
    const pagesOfCurrentCh = items.filter(item => item.type === "page" && item.chapterId === activeChapterInView);
    const totalPages = pagesOfCurrentCh.length || 1;

    const now = Date.now();
    const timeSpent = (now - lastTickTimeRef.current) / 1000;
    lastTickTimeRef.current = now;

    if (timeSpent > 0.5 || isFinal) {
      try {
        await fetch('/api/history/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mediaId: id,
            type: 'Manga',
            title: mangaTitle || 'Manga',
            number: chNum,
            currentTime: activePageRef.current,
            duration: totalPages,
            timeSpent
          })
        });
      } catch (err) {
        console.error('Failed to save read progress:', err);
      }
    }
  };

  // Load progress
  useEffect(() => {
    savedResumePageRef.current = 1;
    lastTickTimeRef.current = Date.now();

    const loadProgress = async () => {
      try {
        const res = await fetch(`/api/history/progress?mediaId=${encodeURIComponent(id)}&type=Manga`);
        const progressData = await res.json();
        
        const chNum = sortedChapters.find(c => {
          if (isCurrentDownloaded) {
            return Number(c.number) === Number(currentChapter);
          } else {
            return c.id === currentChapter;
          }
        })?.number || getCleanChapterNum(activeChapterInView, currentChapter);

        if (progressData?.lastProgress && Number(progressData.lastProgress.number) === Number(chNum)) {
          const savedPage = parseInt(progressData.lastProgress.currentPage || 1);
          const resumePage = Math.max(1, savedPage - 1);
          savedResumePageRef.current = resumePage;
        }
      } catch (err) {
        console.error('Failed to load progress:', err);
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
          const pageEl = container.querySelector(`[data-page="${savedResumePageRef.current}"]`);
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
      const isDownloadedLocal = isAppend ? isChDownloaded(chapterObj.number) : isCurrentDownloaded;
      
      // API expects chapter number if downloaded, ID if online
      const apiChapterID = isAppend 
        ? (isDownloadedLocal ? chapterObj.number : chapterObj.id) 
        : currentChapter;

      // Cache and elements should always use chapterObj.id
      let cacheID = null;
      if (isAppend) {
        cacheID = chapterObj.id;
      } else {
        const initialChapterObj = sortedChapters.find(c => {
          if (isCurrentDownloaded) {
            return Number(c.number) === Number(currentChapter);
          } else {
            return c.id === currentChapter;
          }
        });
        cacheID = initialChapterObj ? initialChapterObj.id : currentChapter;
      }

      const response = await fetch("/api/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterID: apiChapterID,
          Downloaded: isDownloadedLocal,
          MangaID: id,
          provider: provider,
        }),
      });
      const data = await response.json();

      if (data && data.length > 0) {
        const sortedPages = [...data].sort((a, b) => a.page - b.page);
        
        const chNum = isAppend ? chapterObj.number : (sortedChapters.find(c => c.id === cacheID)?.number || getCleanChapterNum(cacheID, currentChapter));

        const isActuallyLocal = data[0].img && data[0].img.startsWith("data:image/");

        // Auto-heal downloaded list and state
        if (isActuallyLocal) {
          const num = Number(chNum);
          if (downloadedChapters && !downloadedChapters.map(Number).includes(num)) {
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

        const newPages = sortedPages.map(p => ({
          id: `page-${cacheID}-${p.page}`,
          type: "page",
          img: p.img,
          page: p.page,
          chapterNum: chNum,
          chapterId: cacheID,
        }));

        if (isAppend) {
          setItems(prev => [...prev, newHeader, ...newPages]);
          setLoadedChapters(prev => [...prev, cacheID]);
        } else {
          setItems([newHeader, ...newPages]);
          setLoadedChapters([cacheID]);
          setIsCurrentDownloaded(isActuallyLocal);
          if (containerRef.current) {
            containerRef.current.scrollTop = 0;
          }
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
      activePageRef.current = activePageVal;

      if (activeId && activeId !== activeChapterInView) {
        setActiveChapterInView(activeId);
        activeChapterRef.current = activeId;
        const targetObj = sortedChapters.find(item => item.id === activeId);
        if (targetObj) {
          setIsCurrentDownloaded(isChDownloaded(targetObj.number));
        }
      }

      // Check if scrolled near the bottom of the container
      const threshold = 350; // pixels from the bottom
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
      
      if (isNearBottom && autoLoadNext && !loading && !appendingLoading && !errorMsg && nextIndex !== -1) {
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
    return () =>
      container.removeEventListener("scroll", handleScroll);
  }, [id, activeChapterInView, autoLoadNext, nextIndex, loading, appendingLoading, errorMsg, loadedChapters, sortedChapters]);

  const scrollToTop = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div ref={containerRef} style={readerWrapperStyle}>
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
      <div style={headerStyle} className="glass-panel">
        <div style={headerLeftSectionStyle}>
          <button onClick={onBack} style={backBtnStyle}>
            <ArrowLeft size={18} />
            <span>Exit Reader</span>
          </button>
        </div>

        {sortedChapters.length > 0 && (
          <div style={navigationStyle}>
            <button
              onClick={handlePrevChapter}
              disabled={prevIndex === -1}
              style={navBtnStyle(prevIndex === -1)}
              title="Previous Chapter"
            >
              <ChevronLeft size={16} />
            </button>

            <div style={selectContainerStyle}>
              <select
                value={activeChapterInView || ''}
                onChange={(e) => {
                  const selected = sortedChapters.find(item => item.id === e.target.value);
                  if (selected) handleJumpToChapter(selected);
                }}
                style={navSelectStyle}
              >
                {sortedChapters.map(item => (
                  <option key={item.id} value={item.id}>
                    Ch {item.number}{isChDownloaded(item.number) ? ' (Downloaded)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleNextChapter}
              disabled={nextIndex === -1}
              style={navBtnStyle(nextIndex === -1)}
              title="Next Chapter"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <div style={headerRightSectionStyle}>
          <span style={chapterTitleStyle} title={mangaTitle || id}>
            {mangaTitle ? `${mangaTitle.slice(0, 20)}${mangaTitle.length > 20 ? '...' : ''}` : "Manga"} - Ch {getCleanChapterNum(activeChapterInView, chapterNumOrId)}
          </span>
          <span style={{ ...headerBadgeStyle(isCurrentDownloaded), display: "inline-flex", alignItems: "center", gap: "4px" }}>
            {isCurrentDownloaded ? <HardDrive size={13} /> : <Globe size={13} />}
            <span>{isCurrentDownloaded ? 'Local' : 'Online'}</span>
          </span>
        </div>
      </div>

      {/* Main Pages viewport */}
      <div style={viewportStyle}>
        {loading ? (
          <div style={statusOverlayStyle}>
            <img
              src="/images/loading.gif"
              alt="loading"
              style={{ width: "64px", height: "64px" }}
            />
            <p style={{ marginTop: "16px", color: "var(--text-muted)" }}>
              Loading pages for Chapter {getCleanChapterNum(activeChapterInView, chapterNumOrId)}...
            </p>
          </div>
        ) : errorMsg ? (
          <div style={statusOverlayStyle}>
            <span style={{ fontSize: "48px" }}>⚠️</span>
            <p style={{ marginTop: "16px", color: "var(--danger)" }}>
              {errorMsg}
            </p>
            <button onClick={() => fetchChapterPages(null, false)} style={retryBtnStyle}>
              Retry
            </button>
          </div>
        ) : (
          <div style={pagesContainerStyle}>
            {items.map((item) => {
              if (item.type === "header") {
                return (
                  <div key={item.id} data-chapter={item.chapterId} style={splashCardStyle}>
                    <div style={splashCardOverlayStyle} />
                    <div style={splashCardContentStyle}>
                      <span style={splashMangaTitleStyle}>
                        {mangaTitle || id || "Manga Stream"}
                      </span>
                      <h1 style={splashChapterNumStyle}>
                        Chapter {getCleanChapterNum(item.chapterId, item.chapterNum)}
                      </h1>
                      <div style={splashStatusBadgeStyle(item.isDownloaded)}>
                        {item.isDownloaded ? <HardDrive size={13} /> : <Globe size={13} />}
                        <span>{item.isDownloaded ? "Downloaded Chapter" : "Online Stream"}</span>
                      </div>
                      
                      <div className="splash-chevron" style={splashScrollHintStyle}>
                        <span style={{ fontSize: "11px", letterSpacing: "1.5px", opacity: 0.8, fontWeight: "600" }}>SCROLL TO READ</span>
                        <ChevronsDown size={20} />
                      </div>
                    </div>
                  </div>
                );
              } else {
                return (
                  <div key={item.id} data-chapter={item.chapterId} data-page={item.page} style={pageWrapperStyle}>
                    <LazyMangaPage
                      src={item.img}
                      alt={`Page ${item.page}`}
                      style={pageImgStyle}
                    />
                    <div style={pageNumStyle}>Page {item.page}</div>
                  </div>
                );
              }
            })}

            {/* Subtle pre-fetching loading indicator at bottom */}
            {appendingLoading && (
              <div style={appendLoadingContainerStyle}>
                <Loader2 className="spin-icon" size={24} style={{ color: "var(--accent)" }} />
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Pre-fetching next chapter...</span>
              </div>
            )}

            {/* Bottom Navigation Controls */}
            {sortedChapters.length > 0 && !appendingLoading && (
              <div style={bottomControlsPanelStyle} className="glass-panel">
                <p style={bottomControlsTitleStyle}>
                  You've reached the end of Chapter {getCleanChapterNum(activeChapterInView, chapterNumOrId)}
                </p>
                <div style={bottomNavRowStyle}>
                  <button
                    onClick={handlePrevChapter}
                    disabled={prevIndex === -1}
                    style={bottomNavBtnStyle(prevIndex === -1)}
                  >
                    <ChevronLeft size={16} />
                    <span>Previous Chapter</span>
                  </button>

                  <select
                    value={activeChapterInView || ''}
                    onChange={(e) => {
                      const selected = sortedChapters.find(item => item.id === e.target.value);
                      if (selected) handleJumpToChapter(selected);
                    }}
                    style={bottomNavSelectStyle}
                  >
                    {sortedChapters.map(item => (
                      <option key={item.id} value={item.id}>
                        Chapter {item.number}{isChDownloaded(item.number) ? ' (Downloaded)' : ''}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={handleNextChapter}
                    disabled={nextIndex === -1}
                    style={bottomNavBtnStyle(nextIndex === -1)}
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
        <button onClick={scrollToTop} style={scrollTopBtnStyle}>
          <ChevronsUp size={24} />
        </button>
      )}
    </div>
  );
}

// Styling definitions
const readerWrapperStyle = {
  flex: 1,
  backgroundColor: "#0a0a0c",
  height: "100%",
  overflowY: "auto",
  width: "100%",
  color: "white",
  display: "flex",
  flexDirection: "column",
};

const headerStyle = {
  position: "sticky",
  top: 0,
  width: "100%",
  height: "60px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 24px",
  zIndex: 90,
  borderRadius: 0,
  borderTop: "none",
  borderLeft: "none",
  borderRight: "none",
  flexShrink: 0,
};

const backBtnStyle = {
  background: "#1f222d",
  border: "1px solid #262936",
  color: "white",
  padding: "6px 14px",
  borderRadius: "6px",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "13px",
  fontWeight: "600",
  transition: "var(--transition)",
};

const chapterTitleStyle = {
  fontSize: "13px",
  fontWeight: "600",
  color: "#e5e7eb",
};

const viewportStyle = {
  paddingTop: "20px",
  paddingBottom: "40px",
  width: "100%",
  display: "flex",
  justifyContent: "center",
};

const statusOverlayStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "400px",
  color: "#9ca3af",
};

const retryBtnStyle = {
  marginTop: "16px",
  backgroundColor: "var(--accent)",
  color: "white",
  border: "none",
  padding: "8px 20px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: "600",
};

const pagesContainerStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  width: "100%",
  maxWidth: "800px",
  gap: "8px",
};

const pageWrapperStyle = {
  position: "relative",
  width: "100%",
  minHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  backgroundColor: "#000",
  borderRadius: "4px",
  overflow: "hidden",
  boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
};

const pageImgStyle = {
  width: "100%",
  height: "auto",
  display: "block",
};

const pageNumStyle = {
  padding: "8px",
  fontSize: "11px",
  fontWeight: "600",
  color: "#4b5563",
  textAlign: "center",
};

const scrollTopBtnStyle = {
  position: "fixed",
  bottom: "30px",
  right: "30px",
  width: "50px",
  height: "50px",
  borderRadius: "50%",
  backgroundColor: "var(--accent)",
  color: "white",
  border: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
  zIndex: 100,
  transition: "var(--transition)",
  "&:hover": {
    backgroundColor: "var(--accent-hover)",
    transform: "scale(1.1)",
  },
};

// Navigation Styles
const navigationStyle = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  backgroundColor: "#0e0f12",
  padding: "4px 8px",
  borderRadius: "8px",
  border: "1px solid #1f222d",
};

const navBtnStyle = (disabled) => ({
  backgroundColor: disabled ? "rgba(255,255,255,0.02)" : "#1f222d",
  color: disabled ? "#4b5563" : "white",
  border: "1px solid #262936",
  padding: "6px 10px",
  borderRadius: "6px",
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "var(--transition)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  opacity: disabled ? 0.4 : 1,
});

const selectContainerStyle = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
};

const navSelectStyle = {
  backgroundColor: "#1f222d",
  border: "1px solid #262936",
  color: "white",
  padding: "5px 10px",
  borderRadius: "6px",
  fontSize: "12px",
  fontWeight: "600",
  outline: "none",
  cursor: "pointer",
};

const headerLeftSectionStyle = {
  display: "flex",
  alignItems: "center",
  flex: 1,
};

const headerRightSectionStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "10px",
  flex: 1,
};

const headerBadgeStyle = (downloaded) => ({
  fontSize: "11px",
  fontWeight: "600",
  padding: "3px 8px",
  borderRadius: "12px",
  backgroundColor: downloaded ? "rgba(16, 185, 129, 0.1)" : "rgba(124, 58, 237, 0.15)",
  color: downloaded ? "var(--success)" : "#c084fc",
  border: downloaded ? "1px solid var(--success)" : "1px solid rgba(124, 58, 237, 0.3)",
});

// Beautiful Splash Cover Styles
const splashCardStyle = {
  width: "100%",
  height: "calc(100vh - 120px)",
  minHeight: "450px",
  position: "relative",
  background: "linear-gradient(135deg, #13151a 0%, #090a0d 100%)",
  borderRadius: "8px",
  border: "1px solid #1f222d",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
  marginBottom: "30px",
  overflow: "hidden",
};

const splashCardOverlayStyle = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundImage: "radial-gradient(circle at center, rgba(124, 58, 237, 0.08) 0%, transparent 70%)",
  pointerEvents: "none",
};

const splashCardContentStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  zIndex: 2,
  padding: "0 24px",
  textAlign: "center",
};

const splashMangaTitleStyle = {
  fontSize: "13px",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "3px",
  fontWeight: "700",
  marginBottom: "12px",
  opacity: 0.8,
};

const splashChapterNumStyle = {
  fontSize: "44px",
  fontWeight: "800",
  color: "#ffffff",
  letterSpacing: "0.5px",
  marginBottom: "16px",
  background: "linear-gradient(to right, #ffffff, #a78bfa)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

const splashStatusBadgeStyle = (downloaded) => ({
  backgroundColor: downloaded ? "rgba(16, 185, 129, 0.1)" : "rgba(124, 58, 237, 0.15)",
  border: downloaded ? "1px solid var(--success)" : "1px solid var(--accent)",
  color: downloaded ? "var(--success)" : "#c084fc",
  padding: "6px 14px",
  borderRadius: "20px",
  fontSize: "12px",
  fontWeight: "600",
  letterSpacing: "0.5px",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
});

const splashScrollHintStyle = {
  position: "absolute",
  bottom: "40px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "8px",
  color: "var(--text-muted)",
  opacity: 0.7,
};

// Bottom Navigation panel
const bottomControlsPanelStyle = {
  width: "100%",
  padding: "24px 30px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "16px",
  marginTop: "20px",
  border: "1px solid var(--border)",
  background: "rgba(22, 24, 31, 0.4)",
  borderRadius: "12px",
};

const bottomControlsTitleStyle = {
  fontSize: "14px",
  fontWeight: "500",
  color: "var(--text-muted)",
};

const bottomNavRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "14px",
  width: "100%",
};

const bottomNavBtnStyle = (disabled) => ({
  backgroundColor: disabled ? "rgba(255,255,255,0.02)" : "var(--bg-tertiary)",
  color: disabled ? "var(--text-muted)" : "white",
  border: "1px solid var(--border)",
  padding: "10px 20px",
  borderRadius: "8px",
  fontSize: "13px",
  fontWeight: "600",
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "var(--transition)",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  opacity: disabled ? 0.4 : 1,
});

const bottomNavSelectStyle = {
  backgroundColor: "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  color: "white",
  padding: "10px 16px",
  borderRadius: "8px",
  fontSize: "13px",
  fontWeight: "600",
  outline: "none",
  cursor: "pointer",
  minWidth: "150px",
};

const appendLoadingContainerStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "10px",
  margin: "30px 0",
};
