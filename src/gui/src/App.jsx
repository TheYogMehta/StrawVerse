import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Catalog from './components/Catalog';
import InfoView from './components/InfoView';
import VideoPlayer from './components/VideoPlayer';
import MangaReader from './components/MangaReader';
import DownloadsTracker from './components/DownloadsTracker';
import LogsView from './components/LogsView';
import SettingsView from './components/SettingsView';
import Marketplace from './components/Marketplace';

export default function App() {
  const [history, setHistory] = useState([{ view: 'local-anime', params: {} }]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [malLoggedIn, setMalLoggedIn] = useState(false);

  const current = history[history.length - 1] || { view: 'local-anime', params: {} };

  const navigateTo = (view, params = {}) => {
    setHistory((prev) => [...prev, { view, params }]);
  };

  const navigateBack = () => {
    if (history.length > 1) {
      setHistory((prev) => prev.slice(0, prev.length - 1));
    }
  };

  // Sync basic configurations and MAL connections from server
  const syncSettings = async () => {
    try {
      const settingsRes = await fetch('/api/settings');
      const settingsData = await settingsRes.json();
      setMalLoggedIn(settingsData.MalLoggedIn || false);
    } catch (err) {
      console.error('Failed to sync app info:', err);
    }
  };

  useEffect(() => {
    // Delay settings fetch to prevent blocking the main page load on startup
    const timer = setTimeout(() => {
      syncSettings();
    }, 2000);

    // Listen to MAL connection events from main thread
    if (window.sharedStateAPI && window.sharedStateAPI.on) {
      window.sharedStateAPI.on('mal', (data) => {
        setMalLoggedIn(data?.LoggedIn || false);
      });
    }

    return () => clearTimeout(timer);
  }, []);

  const renderActiveView = () => {
    switch (current.view) {
      case 'local-anime':
        return (
          <Catalog
            type="Anime"
            provider="local"
            onSelectMedia={(id, prov, backText) => navigateTo('info', { id, type: 'Anime', provider: 'local', backText })}
          />
        );
      case 'local-manga':
        return (
          <Catalog
            type="Manga"
            provider="local"
            onSelectMedia={(id, prov, backText) => navigateTo('info', { id, type: 'Manga', provider: 'local', backText })}
          />
        );

      case 'anime-catalog':
        return (
          <Catalog
            type="Anime"
            provider="provider"
            onSelectMedia={(id, prov, backText) => navigateTo('info', { id, type: 'Anime', provider: 'provider', backText })}
          />
        );
      case 'manga-catalog':
        return (
          <Catalog
            type="Manga"
            provider="provider"
            onSelectMedia={(id, prov, backText) => navigateTo('info', { id, type: 'Manga', provider: 'provider', backText })}
          />
        );
      case 'info':
        return (
          <InfoView
            id={current.params.id}
            type={current.params.type}
            localMalProvider={current.params.provider}
            backText={current.params.backText}
            onBack={navigateBack}
            onWatch={(animeId, epIdOrNum, isDownloaded, subdub, episodesList, downloadedEpisodes, animeTitle, provider) => 
              navigateTo('watch', { id: animeId, ep: epIdOrNum, isDownloaded, subdub, episodesList, downloadedEpisodes, animeTitle, provider })
            }
            onRead={(mangaId, chapterIdOrNum, isDownloaded, chaptersList, downloadedChapters, mangaTitle, provider) =>
              navigateTo('read', { id: mangaId, chapter: chapterIdOrNum, isDownloaded, chaptersList, downloadedChapters, mangaTitle, provider })
            }
          />
        );
      case 'watch':
        return (
          <VideoPlayer
            id={current.params.id}
            episodeNumOrId={current.params.ep}
            isDownloaded={current.params.isDownloaded}
            subdub={current.params.subdub}
            episodesList={current.params.episodesList || []}
            downloadedEpisodes={current.params.downloadedEpisodes}
            animeTitle={current.params.animeTitle || ''}
            provider={current.params.provider}
            onBack={navigateBack}
          />
        );
      case 'read':
        return (
          <MangaReader
            id={current.params.id}
            mangaTitle={current.params.mangaTitle || ''}
            chapterNumOrId={current.params.chapter}
            isDownloaded={current.params.isDownloaded}
            chaptersList={current.params.chaptersList || []}
            downloadedChapters={current.params.downloadedChapters || []}
            provider={current.params.provider}
            onBack={navigateBack}
          />
        );
      case 'downloads':
        return <DownloadsTracker />;
      case 'logs':
        return <LogsView />;
      case 'settings':
        return (
          <SettingsView
            onMarketplaceOpen={(initialType) => navigateTo('marketplace', { type: initialType })}
          />
        );
      case 'marketplace':
        return (
          <Marketplace
            initialType={current.params.type || 'Anime'}
          />
        );
      default:
        return <div>View not implemented: {current.view}</div>;
    }
  };

  return (
    <>
      <Sidebar
        currentView={current.view}
        setView={(view) => setHistory([{ view, params: {} }])}
        isCollapsed={isSidebarCollapsed}
        toggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        malLoggedIn={malLoggedIn}
      />
      <main style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
        {renderActiveView()}
      </main>
    </>
  );
}
