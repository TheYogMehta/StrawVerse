import React, { useState, useEffect } from 'react';
import { Loader2, Save, LogOut, CheckCircle, Trash2 } from 'lucide-react';
import Swal from 'sweetalert2';

export default function SettingsView({ onMarketplaceOpen }) {
  const [settings, setSettings] = useState(null);
  const [url, setUrl] = useState('');
  const [malLoggedIn, setMalLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form states
  const [downloadLocation, setDownloadLocation] = useState('');
  const [discordRpc, setDiscordRpc] = useState('off');
  const [animeProvider, setAnimeProvider] = useState('');
  const [quality, setQuality] = useState('1080p');
  const [mangaProvider, setMangaProvider] = useState('weebcentral');
  const [autoLoadNextChapter, setAutoLoadNextChapter] = useState('on');
  const [pagination, setPagination] = useState('off');
  const [malStatus, setMalStatus] = useState('plan_to_watch');
  const [mergeSubtitles, setMergeSubtitles] = useState('off');
  const [subtitleFormat, setSubtitleFormat] = useState('vtt');

  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  const [stats, setStats] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'history') {
      const loadHistoryData = async () => {
        setStatsLoading(true);
        try {
          const statsRes = await fetch('/api/history/stats');
          const statsData = await statsRes.json();
          setStats(statsData);

          const listRes = await fetch('/api/history/list?limit=50');
          const listData = await listRes.json();
          setHistoryList(listData);
        } catch (err) {
          console.error('Failed to fetch history:', err);
        } finally {
          setStatsLoading(false);
        }
      };
      loadHistoryData();
    }
  }, [activeTab]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      setSettings(data.settings);
      setUrl(data.url);
      setMalLoggedIn(data.MalLoggedIn);

      // Load values into form states
      const s = data.settings;
      setDownloadLocation(s.CustomDownloadLocation || '');
      setDiscordRpc(s.enableDiscordRPC || 'off');
      setAnimeProvider(s.Animeprovider || '');
      setQuality(s.quality || '1080p');
      setMangaProvider(s.Mangaprovider || 'weebcentral');
      setAutoLoadNextChapter(s.autoLoadNextChapter || 'on');
      setPagination(s.Pagination || 'off');
      setMalStatus(s.status || 'plan_to_watch');
      setMergeSubtitles(s.mergeSubtitles || 'off');
      setSubtitleFormat(s.subtitleFormat || 'vtt');

      setHasChanges(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();

    if (window.sharedStateAPI && window.sharedStateAPI.on) {
      window.sharedStateAPI.on('mal', (data) => {
        setMalLoggedIn(data?.LoggedIn || false);
        fetchSettings();
      });
    }
  }, []);

  const handleDeleteHistory = async (type, id, title, number) => {
    const result = await Swal.fire({
      title: 'Delete History Entry?',
      text: `Are you sure you want to delete the tracking entry for "${title}" (${type === "Anime" ? "Episode" : "Chapter"} ${number})? This will update your watch/read statistics.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Yes, delete it!'
    });

    if (result.isConfirmed) {
      try {
        const res = await fetch(`/api/history/${type}/${id}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
          Swal.fire({
            title: 'Deleted!',
            text: 'Your tracking entry has been deleted.',
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
          });
          // Refresh statistics and history
          const statsRes = await fetch('/api/history/stats');
          const statsData = await statsRes.json();
          setStats(statsData);

          const listRes = await fetch('/api/history/list?limit=50');
          const listData = await listRes.json();
          setHistoryList(listData);
        } else {
          Swal.fire('Error', data.error || 'Failed to delete tracking entry.', 'error');
        }
      } catch (err) {
        Swal.fire('Error', err.message || 'An error occurred while deleting.', 'error');
      }
    }
  };

  const autoSaveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quality: quality,
          Animeprovider: animeProvider,
          Mangaprovider: mangaProvider,
          CustomDownloadLocation: downloadLocation,
          Pagination: pagination,
          autoLoadNextChapter: autoLoadNextChapter,
          status: malStatus,
          enableDiscordRPC: discordRpc,
          mergeSubtitles: mergeSubtitles,
          subtitleFormat: subtitleFormat
        })
      });
      const data = await response.json();
      if (data.message) {
        // Silently update comparison base to reset hasChanges state
        setSettings({
          ...settings,
          quality: quality,
          Animeprovider: animeProvider,
          Mangaprovider: mangaProvider,
          CustomDownloadLocation: downloadLocation,
          Pagination: pagination,
          autoLoadNextChapter: autoLoadNextChapter,
          status: malStatus,
          enableDiscordRPC: discordRpc,
          mergeSubtitles: mergeSubtitles,
          subtitleFormat: subtitleFormat
        });
      } else if (data.error) {
        Swal.fire({
          title: 'Error Saving Settings',
          text: data.error,
          icon: 'error',
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 3000,
          background: 'var(--bg-secondary)',
          color: 'var(--text-main)',
        });
      }
    } catch (err) {
      console.error('Failed to auto-save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  // Monitor changes and trigger debounced auto-save
  useEffect(() => {
    if (!settings) return;
    const changed =
      downloadLocation !== (settings.CustomDownloadLocation || '') ||
      discordRpc !== (settings.enableDiscordRPC || 'off') ||
      animeProvider !== (settings.Animeprovider || '') ||
      quality !== (settings.quality || '1080p') ||
      mangaProvider !== (settings.Mangaprovider || 'weebcentral') ||
      autoLoadNextChapter !== (settings.autoLoadNextChapter || 'on') ||
      pagination !== (settings.Pagination || 'off') ||
      malStatus !== (settings.status || 'plan_to_watch') ||
      mergeSubtitles !== (settings.mergeSubtitles || 'off') ||
      subtitleFormat !== (settings.subtitleFormat || 'vtt');

    setHasChanges(changed);

    if (changed) {
      const timer = setTimeout(() => {
        autoSaveSettings();
      }, 500); // 500ms debounce
      return () => clearTimeout(timer);
    }
  }, [
    downloadLocation, discordRpc, animeProvider, quality,
    mangaProvider, autoLoadNextChapter, pagination,
    malStatus, mergeSubtitles, subtitleFormat,
    settings
  ]);

  const handleMalLogout = async () => {
    const confirmResult = await Swal.fire({
      title: 'Are you sure?',
      text: 'Are you sure you want to logout from MyAnimeList?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, logout',
      cancelButtonText: 'Cancel',
      background: 'var(--bg-secondary)',
      color: 'var(--text-main)',
      confirmButtonColor: 'var(--danger)',
      cancelButtonColor: 'var(--bg-tertiary)',
    });
    if (!confirmResult.isConfirmed) return;
    try {
      const res = await fetch('/mal/logout');
      if (res.ok) {
        Swal.fire({
          title: 'Logged Out',
          text: 'Logged out from MAL successfully!',
          icon: 'success',
          background: 'var(--bg-secondary)',
          color: 'var(--text-main)',
          confirmButtonColor: 'var(--accent)',
        });
        fetchSettings();
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div style={loadingCenterStyle}>
        <img src="/images/loading.gif" alt="loading" style={{ width: '64px', height: '64px' }} />
        <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Loading configurations...</p>
      </div>
    );
  }

  return (
    <div style={settingsWrapperStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>App Settings</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
          {saving ? (
            <>
              <Loader2 size={14} className="spin" style={{ color: 'var(--accent)' }} />
              <span>Saving changes...</span>
            </>
          ) : hasChanges ? (
            <span>Unsaved changes...</span>
          ) : (
            <>
              <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>✓</span>
              <span>All changes saved</span>
            </>
          )}
        </div>
      </header>

      {/* Horizontal Tabs Navigation */}
      <div style={tabsRowStyle}>
        <button type="button" onClick={() => setActiveTab('general')} style={tabBtnStyle(activeTab === 'general')}>General & UI</button>
        <button type="button" onClick={() => setActiveTab('anime')} style={tabBtnStyle(activeTab === 'anime')}>Anime Settings</button>
        <button type="button" onClick={() => setActiveTab('manga')} style={tabBtnStyle(activeTab === 'manga')}>Manga Settings</button>
        <button type="button" onClick={() => setActiveTab('mal')} style={tabBtnStyle(activeTab === 'mal')}>MyAnimeList</button>
        <button type="button" onClick={() => setActiveTab('history')} style={tabBtnStyle(activeTab === 'history')}>History & Stats</button>
      </div>

      <form onSubmit={(e) => e.preventDefault()} style={formStyle}>
        {activeTab === 'general' && (
          <div style={rowStyle}>
            <div style={panelStyle} className="glass-panel">
              <h2 style={panelTitleStyle}>Directory & Discord</h2>
              <div style={inputWrapperStyle}>
                <label style={labelStyle}>Download Location</label>
                <input
                  type="text"
                  value={downloadLocation}
                  onChange={(e) => setDownloadLocation(e.target.value)}
                  style={textInputStyle}
                  placeholder="Downloads directory path"
                />
              </div>
              <div style={inputWrapperStyle}>
                <label style={labelStyle}>Discord Rich Presence</label>
                <select value={discordRpc} onChange={(e) => setDiscordRpc(e.target.value)} style={selectStyle}>
                  <option value="on">Enabled</option>
                  <option value="off">Disabled</option>
                </select>
              </div>
            </div>

            <div style={panelStyle} className="glass-panel">
              <h2 style={panelTitleStyle}>UI Customization</h2>
              <div style={inputWrapperStyle}>
                <label style={labelStyle}>Pagination Controls</label>
                <select value={pagination} onChange={(e) => setPagination(e.target.value)} style={selectStyle}>
                  <option value="on">Enabled (Page Buttons)</option>
                  <option value="off">Disabled (Infinite Scroll)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'anime' && (
          <div style={panelStyle} className="glass-panel">
            <h2 style={panelTitleStyle}>Anime Settings</h2>
            <div style={inputWrapperStyle}>
              <label style={labelStyle}>Active Anime Provider</label>
              <select value={animeProvider} onChange={(e) => setAnimeProvider(e.target.value)} style={selectStyle}>
                <option value="">None selected</option>
                {settings?.providers?.Anime?.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div style={inputWrapperStyle}>
              <label style={labelStyle}>Preferred Streaming/Download Quality</label>
              <select value={quality} onChange={(e) => setQuality(e.target.value)} style={selectStyle}>
                <option value="1080p">1080p (Full HD)</option>
                <option value="720p">720p (HD)</option>
                <option value="360p">360p (SD)</option>
              </select>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', margin: '20px 0', paddingTop: '20px' }} />
            <h3 style={{ ...panelTitleStyle, fontSize: '16px', marginBottom: '14px' }}>Subtitles Configuration</h3>
            <div style={inputWrapperStyle}>
              <label style={labelStyle}>Merge Soft Subtitles into Video</label>
              <select value={mergeSubtitles} onChange={(e) => setMergeSubtitles(e.target.value)} style={selectStyle}>
                <option value="on">Yes (Merge subtitles inside MP4)</option>
                <option value="off">No (Download subtitles in subfolder)</option>
              </select>
              <span style={hintStyle}>Merges multi-lingual soft subs directly into the video stream via FFmpeg.</span>
            </div>
            <div style={inputWrapperStyle}>
              <label style={labelStyle}>Subtitle Format Conversion</label>
              <select value={subtitleFormat} onChange={(e) => setSubtitleFormat(e.target.value)} style={selectStyle}>
                <option value="srt">SubRip (.srt)</option>
                <option value="vtt">WebVTT (.vtt)</option>
              </select>
            </div>

            <button type="button" onClick={() => onMarketplaceOpen('Anime')} style={{ ...marketBtnStyle, marginTop: '20px' }}>
              Open Anime Marketplace
            </button>
          </div>
        )}

        {activeTab === 'manga' && (
          <div style={panelStyle} className="glass-panel">
            <h2 style={panelTitleStyle}>Manga Settings</h2>
            <div style={inputWrapperStyle}>
              <label style={labelStyle}>Active Manga Provider</label>
              <select value={mangaProvider} onChange={(e) => setMangaProvider(e.target.value)} style={selectStyle}>
                {settings?.providers?.Manga?.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div style={inputWrapperStyle}>
              <label style={labelStyle}>Auto Load Next Chapter</label>
              <select value={autoLoadNextChapter} onChange={(e) => setAutoLoadNextChapter(e.target.value)} style={selectStyle}>
                <option value="on">Enabled</option>
                <option value="off">Disabled</option>
              </select>
            </div>
            <button type="button" onClick={() => onMarketplaceOpen('Manga')} style={marketBtnStyle}>
              Open Manga Marketplace
            </button>
          </div>
        )}



        {activeTab === 'mal' && (
          <div style={panelStyle} className="glass-panel">
            <h2 style={panelTitleStyle}>MyAnimeList Connection</h2>
            {malLoggedIn ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--success)', fontWeight: '600' }}>
                  <CheckCircle size={18} />
                  <span>MyAnimeList account is connected!</span>
                </div>
                <div style={inputWrapperStyle}>
                  <label style={labelStyle}>Auto update anime status to:</label>
                  <select value={malStatus} onChange={(e) => setMalStatus(e.target.value)} style={selectStyle}>
                    <option value="plan_to_watch">Plan To Watch</option>
                    <option value="watching">Watching</option>
                    <option value="completed">Completed</option>
                    <option value="on_hold">On Hold</option>
                    <option value="dropped">Dropped</option>
                  </select>
                </div>
                <button type="button" onClick={handleMalLogout} style={logoutBtnStyle}>
                  <LogOut size={16} />
                  <span>Disconnect Account</span>
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                  Connecting your MyAnimeList account allows StrawVerse to sync your watch status, automatically update episodes in your plan-to-watch/watching lists.
                </p>
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    style={connectLinkStyle}
                  >
                    Authenticate MyAnimeList Account
                  </a>
                ) : (
                  <p style={{ color: 'var(--danger)', fontSize: '12px' }}>No OAuth URL generated by MAL backend.</p>
                )}
              </div>
            )}
          </div>
        )}
        {activeTab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {statsLoading ? (
              <div style={loadingCenterStyle}>
                <Loader2 size={32} className="spin" style={{ color: 'var(--accent)' }} />
                <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Loading history data...</p>
              </div>
            ) : (
              <>
                {/* Stats Dashboard Grid */}
                <div style={statsGridStyle}>
                  <div style={statCardStyle} className="glass-panel">
                    <span style={statCardTitleStyle}>Total Watch Time</span>
                    <h3 style={statCardValStyle}>{stats?.watchHours || 0} <span style={statUnitStyle}>hrs</span></h3>
                    <p style={statCardSubStyle}>{stats?.completedEpisodes || 0} episodes completed ({stats?.distinctAnime || 0} titles)</p>
                  </div>
                  <div style={statCardStyle} className="glass-panel">
                    <span style={statCardTitleStyle}>Total Read Time</span>
                    <h3 style={statCardValStyle}>{stats?.readHours || 0} <span style={statUnitStyle}>hrs</span></h3>
                    <p style={statCardSubStyle}>{stats?.completedChapters || 0} chapters completed ({stats?.distinctManga || 0} titles)</p>
                  </div>
                </div>

                {/* History Timeline */}
                <div style={panelStyle} className="glass-panel">
                  <h2 style={panelTitleStyle}>Recent Activity History</h2>
                  {historyList.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic', padding: '10px 0' }}>No history records found yet. Go watch some anime or read some manga!</p>
                  ) : (
                    <div style={historyListContainerStyle}>
                      {historyList.map((item, idx) => {
                        const formattedTime = item.time_spent > 3600
                          ? `${(item.time_spent / 3600).toFixed(1)} hours`
                          : item.time_spent > 60
                            ? `${Math.round(item.time_spent / 60)} minutes`
                            : `${Math.round(item.time_spent)} seconds`;

                        const formattedDate = new Date(item.date).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        });

                        return (
                          <div key={idx} style={historyItemStyle}>
                            <div style={historyItemLeftStyle}>
                              <span style={historyTypeBadgeStyle(item.type)}>
                                {item.type}
                              </span>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <strong style={historyItemTitleStyle}>{item.title}</strong>
                                <span style={historyItemMetaStyle}>
                                  {item.type === "Anime" ? "Episode" : "Chapter"} {item.number} • Spent {formattedTime}
                                </span>
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                              <div style={historyItemRightStyle}>
                                <span style={historyItemDateStyle}>{formattedDate}</span>
                                {item.is_completed === 1 && (
                                  <span style={completedBadgeStyle}>Completed</span>
                                )}
                              </div>
                              <button
                                type="button"
                                className="history-delete-btn"
                                onClick={() => handleDeleteHistory(item.type, item.id, item.title, item.number)}
                                title="Delete history entry"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

const settingsWrapperStyle = {
  flex: 1,
  padding: '30px',
  overflowY: 'auto',
  height: '100%',
  backgroundColor: 'var(--bg-primary)',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '30px',
};

const titleStyle = {
  fontSize: '28px',
  fontWeight: '800',
  letterSpacing: '-0.5px',
};

const saveBtnStyle = {
  padding: '10px 20px',
  fontSize: '13px',
};

const formStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
};

const rowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
  gap: '24px',
};

const panelStyle = {
  padding: '24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const panelTitleStyle = {
  fontSize: '16px',
  fontWeight: '700',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '10px',
  marginBottom: '8px',
};

const inputWrapperStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const labelStyle = {
  fontSize: '13px',
  fontWeight: '600',
  color: 'var(--text-muted)',
};

const textInputStyle = {
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  color: 'white',
  padding: '10px 14px',
  borderRadius: '8px',
  outline: 'none',
  fontSize: '14px',
  transition: 'var(--transition)',
  '&:focus': {
    borderColor: 'var(--accent)',
  }
};

const selectStyle = {
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  color: 'white',
  padding: '10px 14px',
  borderRadius: '8px',
  outline: 'none',
  cursor: 'pointer',
  fontSize: '14px',
};

const hintStyle = {
  fontSize: '11px',
  color: 'var(--text-muted)',
  lineHeight: '1.4',
  marginTop: '2px',
};

const marketBtnStyle = {
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  color: 'white',
  padding: '10px 16px',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: '600',
  fontSize: '13px',
  marginTop: '8px',
  transition: 'var(--transition)',
  '&:hover': {
    backgroundColor: 'var(--bg-primary)',
    borderColor: 'var(--accent)',
  }
};

const logoutBtnStyle = {
  backgroundColor: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid var(--danger)',
  color: 'var(--danger)',
  padding: '10px 16px',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: '600',
  fontSize: '13px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  marginTop: '8px',
};

const connectLinkStyle = {
  display: 'inline-block',
  textAlign: 'center',
  backgroundColor: '#2563eb',
  color: 'white',
  padding: '12px 18px',
  borderRadius: '8px',
  textDecoration: 'none',
  fontWeight: '600',
  fontSize: '13px',
  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)',
  transition: 'var(--transition)',
  '&:hover': {
    backgroundColor: '#1d4ed8',
    transform: 'translateY(-2px)',
    boxShadow: '0 6px 18px rgba(37, 99, 235, 0.4)',
  }
};

const loadingCenterStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '350px',
  width: '100%',
};

const tabsRowStyle = {
  display: 'flex',
  gap: '12px',
  marginBottom: '24px',
  borderBottom: '1px solid var(--border)',
  paddingBottom: '12px',
};

const tabBtnStyle = (active) => ({
  backgroundColor: active ? 'var(--accent)' : 'transparent',
  border: 'none',
  color: active ? 'white' : 'var(--text-muted)',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: '600',
  cursor: 'pointer',
  transition: 'var(--transition)',
  outline: 'none',
});

const statsGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '24px',
};

const statCardStyle = {
  padding: '24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  position: 'relative',
  overflow: 'hidden',
};

const statCardTitleStyle = {
  fontSize: '14px',
  fontWeight: '600',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const statCardValStyle = {
  fontSize: '36px',
  fontWeight: '800',
  color: 'white',
  margin: '0',
  display: 'flex',
  alignItems: 'baseline',
  gap: '6px',
};

const statUnitStyle = {
  fontSize: '18px',
  fontWeight: '500',
  color: 'var(--accent)',
};

const statCardSubStyle = {
  fontSize: '13px',
  color: 'var(--text-muted)',
  margin: '0',
};

const historyListContainerStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  marginTop: '10px',
};

const historyItemStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px',
  borderRadius: '12px',
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  transition: 'var(--transition)',
  gap: '16px',
};

const historyItemLeftStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
};

const historyTypeBadgeStyle = (type) => ({
  padding: '6px 12px',
  borderRadius: '6px',
  fontSize: '11px',
  fontWeight: '700',
  textTransform: 'uppercase',
  backgroundColor: type === 'Anime' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
  color: type === 'Anime' ? '#60a5fa' : '#34d399',
  border: `1px solid ${type === 'Anime' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
});

const historyItemTitleStyle = {
  fontSize: '15px',
  fontWeight: '600',
  color: 'white',
};

const historyItemMetaStyle = {
  fontSize: '13px',
  color: 'var(--text-muted)',
};

const historyItemRightStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: '6px',
  flexShrink: 0,
};

const historyItemDateStyle = {
  fontSize: '12px',
  color: 'var(--text-muted)',
};

const completedBadgeStyle = {
  padding: '4px 8px',
  borderRadius: '4px',
  fontSize: '10px',
  fontWeight: '700',
  textTransform: 'uppercase',
  backgroundColor: 'rgba(16, 185, 129, 0.2)',
  color: '#34d399',
  border: '1px solid rgba(16, 185, 129, 0.4)',
};
