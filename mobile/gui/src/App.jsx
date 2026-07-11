import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import Catalog from "./components/Catalog";
import InfoView from "./components/InfoView";
import VideoPlayer from "./components/VideoPlayer";
import MangaReader from "./components/MangaReader";
import DownloadsTracker from "./components/DownloadsTracker";
import LogsView from "./components/LogsView";
import SettingsView from "./components/settings/SettingsView";
import Marketplace from "./components/Marketplace";
import WatchTogetherView from "./components/watch-together/WatchTogetherView";
import WatchTogetherBar from "./components/watch-together/WatchTogetherBar";

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

  const navigateTo = (view, params = {}) => {
    setHistory((prev) => [...prev, { view, params }]);
  };

  const navigateBack = () => {
    if (history.length > 1) {
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
        const settingsData = await window.sharedStateAPI.getSettings([
          "developerMode",
          "infoSortOrder",
        ]);
        setMalLoggedIn(settingsData.MalLoggedIn || false);
        setDeveloperMode(settingsData.settings?.developerMode);
        setInfoSortOrder(settingsData.settings?.infoSortOrder || null);
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

  const renderActiveView = () => {
    switch (current.view) {
      case "home":
        return (
          <Catalog
            type={contentType}
            provider="local"
            onTypeChange={setContentType}
            onSelectMedia={(id, prov, backText, autoPlay) =>
              navigateTo("info", {
                id,
                type: contentType,
                provider: "local",
                backText,
                autoPlay,
              })
            }
          />
        );

      case "discover":
        return (
          <Catalog
            type={contentType}
            provider="provider"
            onTypeChange={setContentType}
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
            sortOrder={infoSortOrder}
            setSortOrder={setInfoSortOrder}
            onBack={navigateBack}
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
                  if (idx === prev.length - 1 && item.view === "info" && item.params) {
                    return {
                      ...item,
                      params: {
                        ...item.params,
                        autoPlay: false,
                      },
                    };
                  }
                  return item;
                })
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
      case "watch-together":
        return <WatchTogetherView onNavigate={navigateTo} />;
      case "downloads":
        return <DownloadsTracker />;
      case "logs":
        return <LogsView />;
      case "settings":
        return (
          <SettingsView
            initialTab={current.params?.tab || "general"}
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

  const isCinemaMode = !!activePlayerParams;

  return (
    <div className={`app-layout ${isCinemaMode ? "cinema-mode" : ""}`}>
      {isCinemaMode && <div className="cinema-mode-trigger" />}
      <Sidebar
        currentView={current.view}
        setView={(view) => {
          if (window.catalogCache) {
            if (view === "home") {
              delete window.catalogCache[`Anime_local`];
              delete window.catalogCache[`Manga_local`];
            } else if (view === "discover") {
              delete window.catalogCache[`Anime_provider`];
              delete window.catalogCache[`Manga_provider`];
            }
          }
          setHistory([{ view, params: {} }]);
        }}
        isCollapsed={isSidebarCollapsed}
        toggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        malLoggedIn={malLoggedIn}
        developerMode={developerMode}
        onOpenWatchTogether={() => setIsWTModalOpen(true)}
      />
      <main className="u-style-8">{renderActiveView()}</main>

      {activePlayerParams && (
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
                if (idx === prev.length - 1 && item.view === "info" && item.params) {
                  return {
                    ...item,
                    params: {
                      ...item.params,
                      autoPlay: false,
                    },
                  };
                }
                return item;
              })
            );
            setActivePlayerParams(null);
            setPlayerKey((prev) => prev + 1);
          }}
          malid={activePlayerParams.malid}
        />
      )}

      {current.view !== "watch-together" && (
        <WatchTogetherBar onOpenModal={() => navigateTo("watch-together")} />
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
              <div className="toast-icon-container success">
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
