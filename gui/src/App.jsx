import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import Sidebar from "./components/Sidebar";
import Catalog from "./components/Catalog";

const InfoView = lazy(() => import("./components/InfoView"));
const VideoPlayer = lazy(() => import("./components/VideoPlayer"));
const MangaReader = lazy(() => import("./components/MangaReader"));
const DownloadsTracker = lazy(() => import("./components/DownloadsTracker"));
const LogsView = lazy(() => import("./components/LogsView"));
const SettingsView = lazy(() => import("./components/settings/SettingsView"));
const Marketplace = lazy(() => import("./components/Marketplace"));

const ViewLoading = () => (
  <div
    style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: "100%",
      width: "100%",
      minHeight: "50vh",
    }}
  >
    <Loader2
      size={36}
      className="spin"
      style={{ color: "var(--accent, #6366f1)" }}
    />
  </div>
);

import { applyThemeVars } from "./utils/common";

export default function App() {
  const [history, setHistory] = useState([{ view: "home", params: {} }]);
  const [contentType, setContentType] = useState("Anime");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [malLoggedIn, setMalLoggedIn] = useState(false);
  const [developerMode, setDeveloperMode] = useState(false);
  const [whatsNewData, setWhatsNewData] = useState(null);
  const [whatsNewVersion, setWhatsNewVersion] = useState("");
  const [whatsNewDate, setWhatsNewDate] = useState("");
  const [toasts, setToasts] = useState([]);
  const [infoSortOrder, setInfoSortOrder] = useState(null);
  const [activePlayerParams, setActivePlayerParams] = useState(null);
  const [playerKey, setPlayerKey] = useState(0);
  const [reloadCounter, setReloadCounter] = useState(0);

  const showToast = (title, body, icon) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, title, body, icon, fadeOut: false }]);
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, fadeOut: true } : t)),
      );
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 300);
    }, 5000);
  };

  const removeToast = (id) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, fadeOut: true } : t)),
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  };

  const current = history[history.length - 1] || {
    view: "home",
    params: {},
  };

  const cancelObsoleteNativeRequests = () => {
    window.sharedStateAPI?.cancelNativeRequests?.().catch(() => {});
  };

  const navigateTo = (view, params = {}) => {
    cancelObsoleteNativeRequests();
    setHistory((prev) => [...prev, { view, params }]);
  };

  const navigateBack = () => {
    if (history.length > 1) {
      cancelObsoleteNativeRequests();
      setHistory((prev) => prev.slice(0, prev.length - 1));
    }
  };

  const handleCloseWhatsNew = () => {
    setWhatsNewData(null);
  };

  const parseInlineMarkdown = (text) => {
    if (!text) return "";

    // Check for keyboard shortcut pattern: "Key Name: Description"
    const shortcutRegex = /^([^:]+):\s*(.*)$/;
    const shortcutMatch = text.match(shortcutRegex);
    if (shortcutMatch) {
      const keysPart = shortcutMatch[1].trim();
      const descPart = shortcutMatch[2].trim();

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
              <span key={index} className="kbd-separator u-style-1">
                {token}
              </span>
            );
          }
          const cleanKey = token.replace(/`/g, "").trim();
          if (!cleanKey) return null;
          return (
            <kbd key={index} className="changelog-kbd u-style-2">
              {cleanKey}
            </kbd>
          );
        });

        return (
          <span className="changelog-shortcut-row u-style-3">
            <span className="changelog-keys-wrapper">{renderedKeys}</span>
            <span className="kbd-desc-separator u-style-4">:</span>
            <span className="changelog-desc">
              {parseInlineMarkdown(descPart)}
            </span>
          </span>
        );
      }
    }

    const emojiRegex =
      /[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g;
    const clean = text.replace(emojiRegex, "").trim();

    const parts = [];
    let lastIndex = 0;
    const regex = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;

    let match;
    while ((match = regex.exec(clean)) !== null) {
      const matchIndex = match.index;
      if (matchIndex > lastIndex) {
        parts.push(clean.substring(lastIndex, matchIndex));
      }

      if (match[1] && match[2]) {
        parts.push(
          <a
            key={`link-${matchIndex}`}
            href={match[2]}
            onClick={(e) => {
              e.preventDefault();
              const targetUrl = match[2];
              if (
                window.Capacitor &&
                window.Capacitor.Plugins &&
                window.Capacitor.Plugins.CloudflareBypass
              ) {
                window.Capacitor.Plugins.CloudflareBypass.openSystemBrowser({
                  url: targetUrl,
                }).catch(() => {
                  window.open(targetUrl, "_blank");
                });
              } else {
                window.open(targetUrl, "_blank");
              }
            }}
            target="_blank"
            rel="noopener noreferrer"
            className="u-style-5"
          >
            {match[1]}
          </a>,
        );
      } else if (match[3]) {
        parts.push(
          <strong key={`bold-${matchIndex}`} className="u-style-6">
            {match[3]}
          </strong>,
        );
      } else if (match[4]) {
        parts.push(
          <code key={`code-${matchIndex}`} className="u-style-7">
            {match[4]}
          </code>,
        );
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < clean.length) {
      parts.push(clean.substring(lastIndex));
    }

    return parts.length > 0 ? parts : clean;
  };

  const renderMarkdown = (md) => {
    if (!md) return null;
    const lines = md.split("\n");
    const elements = [];
    let currentList = [];
    let listKey = 0;
    const emojiRegex =
      /[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDC00-\uDFFF]/g;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("###")) {
        if (currentList.length > 0) {
          elements.push(<ul key={`list-${listKey++}`}>{currentList}</ul>);
          currentList = [];
        }
        const title = trimmed.replace("###", "").trim();
        elements.push(
          <h3 key={index}>{title.replace(emojiRegex, "").trim()}</h3>,
        );
      } else if (trimmed.startsWith("##")) {
        if (currentList.length > 0) {
          elements.push(<ul key={`list-${listKey++}`}>{currentList}</ul>);
          currentList = [];
        }
        const title = trimmed.replace("##", "").trim();
        elements.push(
          <h2 key={index}>{title.replace(emojiRegex, "").trim()}</h2>,
        );
      } else if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
        const cleanLine = trimmed.replace(/^[-*]\s*/, "");
        const isIndented = line.startsWith("  ") || line.startsWith("\t");
        currentList.push(
          <li key={index} className={isIndented ? "nested-li" : ""}>
            {parseInlineMarkdown(cleanLine)}
          </li>,
        );
      } else if (trimmed === "") {
        // ignore
      } else {
        if (currentList.length > 0) {
          elements.push(<ul key={`list-${listKey++}`}>{currentList}</ul>);
          currentList = [];
        }
        elements.push(<p key={index}>{parseInlineMarkdown(trimmed)}</p>);
      }
    });

    if (currentList.length > 0) {
      elements.push(<ul key={`list-${listKey++}`}>{currentList}</ul>);
    }

    return elements;
  };

  // Sync basic configurations and MAL connections from server
  const syncSettings = async () => {
    try {
      if (window.sharedStateAPI && window.sharedStateAPI.getSettings) {
        const settingsData = await window.sharedStateAPI.getSettings();
        setMalLoggedIn(settingsData.MalLoggedIn || false);
        setDeveloperMode(settingsData.settings?.developerMode);
        setInfoSortOrder(settingsData.settings?.infoSortOrder || null);
        if (settingsData.settings) {
          applyThemeVars(settingsData.settings);
        }
      }
    } catch (err) {
      console.error("Failed to sync app info:", err);
    }
  };

  useEffect(() => {
    syncSettings();
  }, [current.view]);

  useEffect(() => {
    if (window.sharedStateAPI && window.sharedStateAPI.checkWhatsNew) {
      window.sharedStateAPI
        .checkWhatsNew()
        .then((data) => {
          if (data && data.showWhatsNew) {
            setWhatsNewVersion(data.version || "");
            setWhatsNewDate(data.date || "");
            setWhatsNewData(data.changelog || "");
          }
        })
        .catch((err) => {
          console.error("Failed to check whats new info via IPC:", err);
        });
    }

    // Listen to MAL connection events from main thread
    if (window.sharedStateAPI && window.sharedStateAPI.on) {
      window.sharedStateAPI.on("mal", (data) => {
        setMalLoggedIn(data?.LoggedIn || false);
      });
      window.sharedStateAPI.on("mal-sync-notification", (data) => {
        showToast(data.title, data.body, data.icon);
      });
      window.sharedStateAPI.on("download-error", (data) => {
        showToast(
          data.title || "Download Error",
          data.message || "Download failed",
          "error",
        );
      });
      window.sharedStateAPI.on("download-logger", (data) => {
        if (
          window.Capacitor &&
          window.Capacitor.Plugins &&
          window.Capacitor.Plugins.CloudflareBypass &&
          window.Capacitor.Plugins.CloudflareBypass.updateDownloadNotification
        ) {
          window.Capacitor.Plugins.CloudflareBypass.updateDownloadNotification({
            caption: data.caption || "",
            currentSegments: data.currentSegments || 0,
            totalSegments: data.totalSegments || 0,
            epid: data.epid || "",
            isPaused: !!data.isPaused,
          }).catch(() => {});
        }
      });
      window.sharedStateAPI.on("open-settings-tab", (data) => {
        const tab =
          data?.tab === "subtitles" ? "anime_manga" : data?.tab || "general";
        const scrollTo =
          data?.tab === "subtitles" || data?.scrollTo === "subtitles"
            ? "subtitle-customization"
            : data?.scrollTo || null;
        navigateTo("settings", { tab, scrollTo });
      });
      window.sharedStateAPI.on("anime-id-updated", (data) => {
        if (!data?.oldId || !data?.newId) return;
        if (window.catalogCache) {
          delete window.catalogCache["Anime_local"];
          delete window.catalogCache["Anime_provider"];
        }
        setHistory((prev) =>
          prev.map((item) => {
            if (item.params && String(item.params.id) === String(data.oldId)) {
              return {
                ...item,
                params: {
                  ...item.params,
                  id: data.newId,
                },
              };
            }
            return item;
          }),
        );
        setActivePlayerParams((prev) => {
          if (prev && String(prev.id) === String(data.oldId)) {
            return {
              ...prev,
              id: data.newId,
            };
          }
          return prev;
        });
      });
    }
  }, []);

  useEffect(() => {
    if (!whatsNewData) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        handleCloseWhatsNew();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [whatsNewData]);

  // Android hardware back button handling
  const historyRef = useRef(history);
  const lastBackPressRef = useRef(0);
  const activePlayerRef = useRef(activePlayerParams);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    activePlayerRef.current = activePlayerParams;
  }, [activePlayerParams]);

  useEffect(() => {
    let backListener = null;
    let appStateListener = null;

    const setupBackButton = async () => {
      try {
        const CapApp = window.Capacitor?.Plugins?.App;
        if (!CapApp) return;
        appStateListener = await CapApp.addListener(
          "appStateChange",
          ({ isActive }) => {
            if (isActive) {
              window.refreshInfoViewProgress?.();
              window.refreshCatalogHistory?.();
            }
          },
        );

        backListener = await CapApp.addListener("backButton", () => {
          // If video player is open, close it first
          if (activePlayerRef.current) {
            setActivePlayerParams(null);
            window.refreshInfoViewProgress?.();
            window.refreshCatalogHistory?.();
            return;
          }

          if (historyRef.current.length > 1) {
            cancelObsoleteNativeRequests();
            setHistory((prev) => prev.slice(0, prev.length - 1));
          } else {
            const now = Date.now();
            if (now - lastBackPressRef.current < 2000) {
              CapApp.exitApp();
            } else {
              lastBackPressRef.current = now;
              showToast("Exit", "Press back again to exit");
            }
          }
        });
      } catch (err) {
        console.error("Failed to setup back button handler:", err);
      }
    };

    setupBackButton();

    return () => {
      if (backListener) {
        backListener.remove();
      }
      if (appStateListener) {
        appStateListener.remove();
      }
    };
  }, []);

  const renderActiveView = () => {
    switch (current.view) {
      case "home":
        return (
          <Catalog
            key={`home-${contentType}-${reloadCounter}`}
            type={contentType}
            provider="local"
            onTypeChange={setContentType}
            onSelectMedia={(id, prov, backText, autoPlay, targetNum) =>
              navigateTo("info", {
                id,
                type: contentType,
                provider: "local",
                backText,
                autoPlay,
                targetNum,
              })
            }
          />
        );

      case "discover":
        return (
          <Catalog
            key={`discover-${contentType}-${reloadCounter}`}
            type={contentType}
            provider="provider"
            onTypeChange={setContentType}
            initialSearchQuery={current.params?.searchQuery || ""}
            onSelectMedia={(id, prov, backText, autoPlay) =>
              navigateTo("info", {
                id,
                type: contentType,
                provider: prov,
                backText,
                autoPlay,
              })
            }
          />
        );

      case "filters":
        return (
          <Catalog
            key={`filters-${contentType}-${reloadCounter}`}
            type={contentType}
            provider="mal"
            onTypeChange={setContentType}
            initialSearchQuery={current.params?.searchQuery || ""}
            malLoggedIn={malLoggedIn}
            onNavigate={navigateTo}
            onSelectMedia={(id, prov, backText, autoPlay) =>
              navigateTo("info", {
                id,
                type: contentType,
                provider: prov,
                backText,
                autoPlay,
              })
            }
          />
        );
      case "info":
        return (
          <InfoView
            key={`${current.params.id}-${playerKey}`}
            id={current.params.id}
            type={current.params.type}
            localMalProvider={current.params.provider}
            backText={current.params.backText}
            autoPlay={current.params.autoPlay}
            targetNum={current.params.targetNum}
            sortOrder={infoSortOrder}
            setSortOrder={setInfoSortOrder}
            onBack={navigateBack}
            title={current.params.title}
            onSearchFallback={(title) => {
              setHistory([
                { view: "discover", params: { searchQuery: title } },
              ]);
            }}
            onIdChange={(oldId, newId) => {
              if (!oldId || !newId) return;
              setHistory((prev) =>
                prev.map((item) => {
                  if (item.params && String(item.params.id) === String(oldId)) {
                    return {
                      ...item,
                      params: {
                        ...item.params,
                        id: newId,
                      },
                    };
                  }
                  return item;
                }),
              );
              setActivePlayerParams((prev) => {
                if (prev && String(prev.id) === String(oldId)) {
                  return {
                    ...prev,
                    id: newId,
                  };
                }
                return prev;
              });
            }}
            onWatch={(
              animeId,
              epIdOrNum,
              isDownloaded,
              subdub,
              episodesList,
              downloadedEpisodes,
              animeTitle,
              provider,
              image,
              malid,
            ) => {
              setHistory((prev) =>
                prev.map((item, idx) => {
                  if (
                    idx === prev.length - 1 &&
                    item.view === "info" &&
                    item.params
                  ) {
                    return {
                      ...item,
                      params: {
                        ...item.params,
                        id: animeId,
                        autoPlay: false,
                      },
                    };
                  }
                  return item;
                }),
              );

              setActivePlayerParams({
                id: animeId,
                ep: epIdOrNum,
                isDownloaded,
                subdub,
                episodesList,
                downloadedEpisodes,
                animeTitle,
                provider,
                image,
                malid,
              });
            }}
            onRead={(
              mangaId,
              chapterIdOrNum,
              isDownloaded,
              chaptersList,
              downloadedChapters,
              mangaTitle,
              provider,
              image,
              malid,
            ) => {
              setHistory((prev) => {
                const next = [...prev];
                if (next.length > 0) {
                  const last = next[next.length - 1];
                  if (last.view === "info" && last.params) {
                    last.params = { ...last.params, autoPlay: false };
                  }
                }
                return [
                  ...next,
                  {
                    view: "read",
                    params: {
                      id: mangaId,
                      chapter: chapterIdOrNum,
                      isDownloaded,
                      chaptersList,
                      downloadedChapters,
                      mangaTitle,
                      provider,
                      image,
                      malid,
                    },
                  },
                ];
              });
            }}
          />
        );

      case "read":
        return (
          <MangaReader
            id={current.params.id}
            mangaTitle={current.params.mangaTitle || ""}
            chapterNumOrId={current.params.chapter}
            isDownloaded={current.params.isDownloaded}
            chaptersList={current.params.chaptersList || []}
            downloadedChapters={current.params.downloadedChapters || []}
            provider={current.params.provider}
            image={current.params.image || ""}
            onBack={navigateBack}
            malid={current.params.malid}
          />
        );
      case "downloads":
        return <DownloadsTracker />;
      case "logs":
        return <LogsView />;
      case "settings":
        return (
          <SettingsView
            initialTab={current.params?.tab || "general"}
            scrollToSection={current.params?.scrollTo || null}
            onMarketplaceOpen={(initialType) =>
              navigateTo("marketplace", { type: initialType })
            }
            onSelectMedia={(id, type, prov, backText) =>
              navigateTo("info", {
                id,
                type,
                provider: prov,
                backText,
              })
            }
            onSettingsSaved={() => syncSettings()}
          />
        );
      case "marketplace":
        return <Marketplace initialType={current.params.type || "Anime"} />;
      default:
        return <div>View not implemented: {current.view}</div>;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar
        currentView={current.view}
        setView={(view) => {
          cancelObsoleteNativeRequests();
          if (window.catalogCache) {
            if (view === "home") {
              delete window.catalogCache[`Anime_local`];
              delete window.catalogCache[`Manga_local`];
            } else if (view === "discover") {
              delete window.catalogCache[`Anime_provider`];
              delete window.catalogCache[`Manga_provider`];
            } else if (view === "filters") {
              delete window.catalogCache[`Anime_mal`];
              delete window.catalogCache[`Manga_mal`];
            }
          }
          if (view === current.view) {
            setReloadCounter((prev) => prev + 1);
          }
          setHistory([{ view, params: {} }]);
        }}
        isCollapsed={isSidebarCollapsed}
        toggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        malLoggedIn={malLoggedIn}
        developerMode={developerMode}
      />
      <main className="u-style-8">
        <Suspense fallback={<ViewLoading />}>{renderActiveView()}</Suspense>
      </main>

      {activePlayerParams && (
        <Suspense fallback={<ViewLoading />}>
          <VideoPlayer
            id={activePlayerParams.id}
            episodeNumOrId={activePlayerParams.ep}
            isDownloaded={activePlayerParams.isDownloaded}
            subdub={activePlayerParams.subdub}
            episodesList={activePlayerParams.episodesList || []}
            downloadedEpisodes={activePlayerParams.downloadedEpisodes}
            animeTitle={activePlayerParams.animeTitle || ""}
            provider={activePlayerParams.provider}
            image={activePlayerParams.image || ""}
            onBack={() => {
              setHistory((prev) =>
                prev.map((item, idx) => {
                  if (
                    idx === prev.length - 1 &&
                    item.view === "info" &&
                    item.params
                  ) {
                    return {
                      ...item,
                      params: {
                        ...item.params,
                        autoPlay: false,
                      },
                    };
                  }
                  return item;
                }),
              );
              setActivePlayerParams(null);
              setPlayerKey((prev) => prev + 1);
            }}
            malid={activePlayerParams.malid}
          />
        </Suspense>
      )}

      {whatsNewData && (
        <div className="whats-new-overlay">
          <div className="whats-new-card">
            <div className="whats-new-header">
              <div className="whats-new-header-main">
                <div className="whats-new-title-container">
                  <h2 className="whats-new-title">What's New</h2>
                  {whatsNewVersion && (
                    <span className="whats-new-version-badge">
                      v{whatsNewVersion}
                    </span>
                  )}
                </div>
                {whatsNewDate && (
                  <span className="whats-new-date">{whatsNewDate}</span>
                )}
              </div>
              <button
                className="whats-new-close"
                onClick={handleCloseWhatsNew}
                aria-label="Close dialog"
              >
                &times;
              </button>
            </div>
            <div className="whats-new-body">{renderMarkdown(whatsNewData)}</div>
            <div className="whats-new-footer">
              <button
                className="whats-new-button"
                onClick={handleCloseWhatsNew}
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* toast notifications */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast-card ${toast.fadeOut ? "fade-out" : ""}`}
            >
              <div
                className={`toast-icon-container ${toast.icon === "error" ? "error" : "success"}`}
              >
                {toast.icon === "error" ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="toast-check-svg"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="toast-check-svg"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <div className="toast-content">
                <div className="toast-title">{toast.title}</div>
                <div className="toast-body">{toast.body}</div>
              </div>
              <button
                className="toast-close-btn"
                onClick={() => removeToast(toast.id)}
                aria-label="Close notification"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
