import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { ArrowLeft, Loader2, HardDrive, Globe } from 'lucide-react';

export default function VideoPlayer({
  id,
  episodeNumOrId,
  isDownloaded,
  subdub,
  episodesList = [],
  downloadedEpisodes = null,
  animeTitle = '',
  provider,
  onBack
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [sources, setSources] = useState([]);
  const [subtitles, setSubtitles] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // Local navigation states
  const [currentEpisode, setCurrentEpisode] = useState(episodeNumOrId);
  const [isCurrentDownloaded, setIsCurrentDownloaded] = useState(isDownloaded);
  const [playerSubDub, setPlayerSubDub] = useState(subdub || 'sub');

  // Helper to determine if an episode number is downloaded
  const isEpDownloaded = (num, currentLang = playerSubDub) => {
    if (!downloadedEpisodes) return false;
    const subList = downloadedEpisodes.sub || [];
    const dubList = downloadedEpisodes.dub || [];
    return currentLang === 'dub' ? dubList.includes(Number(num)) : subList.includes(Number(num));
  };

  // Sort episodes list in ascending order to make Next/Prev predictable
  const sortedEpisodes = [...episodesList].sort((a, b) => Number(a.number) - Number(b.number));

  useEffect(() => {
    const currentEpNum = currentEpisodeObj ? currentEpisodeObj.number : (typeof currentEpisode === 'number' || !isNaN(Number(currentEpisode)) ? Number(currentEpisode) : null);
    if (currentEpNum !== null) {
      const isDownloadedInNewLang = isEpDownloaded(currentEpNum, playerSubDub);
      if (isDownloadedInNewLang !== isCurrentDownloaded) {
        setIsCurrentDownloaded(isDownloadedInNewLang);
        if (isDownloadedInNewLang) {
          setCurrentEpisode(currentEpNum);
        } else {
          const epObj = sortedEpisodes.find(item => Number(item.number) === Number(currentEpNum));
          if (epObj) {
            setCurrentEpisode(epObj.id);
          }
        }
      }
    }
  }, [playerSubDub]);

  // Find current active episode object
  const currentEpisodeObj = sortedEpisodes.find(item => {
    if (isCurrentDownloaded) {
      return Number(item.number) === Number(currentEpisode);
    } else {
      return item.id === currentEpisode;
    }
  });

  const currentIndex = currentEpisodeObj ? sortedEpisodes.indexOf(currentEpisodeObj) : -1;
  const prevIndex = currentIndex > 0 ? currentIndex - 1 : -1;
  const nextIndex = currentIndex !== -1 && currentIndex < sortedEpisodes.length - 1 ? currentIndex + 1 : -1;

  const handleJumpToEpisode = (episodeObj) => {
    const isDownloadedLocal = isEpDownloaded(episodeObj.number);
    setIsCurrentDownloaded(isDownloadedLocal);
    setCurrentEpisode(isDownloadedLocal ? episodeObj.number : episodeObj.id);
  };

  const handlePrevEpisode = () => {
    if (prevIndex !== -1) {
      handleJumpToEpisode(sortedEpisodes[prevIndex]);
    }
  };

  const handleNextEpisode = () => {
    if (nextIndex !== -1) {
      handleJumpToEpisode(sortedEpisodes[nextIndex]);
    }
  };

  // Tracking refs and logic
  const lastTickTimeRef = useRef(Date.now());
  const savedResumeTimeRef = useRef(0);
  const animeTitleVal = animeTitle || 'Anime';

  const saveWatchProgress = async (isFinal = false) => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const currentTime = video.currentTime;
    const duration = video.duration;
    
    const now = Date.now();
    const timeSpent = (now - lastTickTimeRef.current) / 1000;
    lastTickTimeRef.current = now;

    if (duration > 0 && (timeSpent > 0.5 || isFinal)) {
      try {
        await fetch('/api/history/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mediaId: id,
            type: 'Anime',
            title: animeTitleVal,
            number: currentEpisodeObj ? currentEpisodeObj.number : 1,
            currentTime,
            duration,
            timeSpent
          })
        });
      } catch (err) {
        console.error('Failed to save watch progress:', err);
      }
    }
  };

  // Fetch progress on load
  useEffect(() => {
    savedResumeTimeRef.current = 0;
    lastTickTimeRef.current = Date.now();

    const loadProgress = async () => {
      try {
        const epNum = currentEpisodeObj ? currentEpisodeObj.number : 1;
        const res = await fetch(`/api/history/progress?mediaId=${encodeURIComponent(id)}&type=Anime`);
        const progressData = await res.json();
        
        if (progressData?.lastProgress && Number(progressData.lastProgress.number) === Number(epNum)) {
          const savedTime = parseFloat(progressData.lastProgress.currentTime || 0);
          const resumeTime = Math.max(0, savedTime - 5);
          savedResumeTimeRef.current = resumeTime;
          
          if (videoRef.current && videoRef.current.readyState >= 1) {
            videoRef.current.currentTime = resumeTime;
          }
        }
      } catch (err) {
        console.error('Failed to load progress:', err);
      }
    };

    loadProgress();
  }, [id, currentEpisode, currentEpisodeObj]);

  // Periodically save progress
  useEffect(() => {
    const interval = setInterval(() => {
      saveWatchProgress(false);
    }, 5000);

    return () => {
      clearInterval(interval);
      saveWatchProgress(true);
    };
  }, [id, currentEpisode, currentEpisodeObj]);

  // Handle pause and play events to ensure tracking accuracy
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePause = () => {
      saveWatchProgress(false);
    };

    const handlePlay = () => {
      lastTickTimeRef.current = Date.now();
    };

    video.addEventListener('pause', handlePause);
    video.addEventListener('play', handlePlay);

    return () => {
      if (video) {
        video.removeEventListener('pause', handlePause);
        video.removeEventListener('play', handlePlay);
      }
    };
  }, [selectedSource, currentEpisode, currentEpisodeObj]);

  const fetchStreamData = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const response = await fetch('/api/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isCurrentDownloaded
            ? { ep: id, epNum: currentEpisode, Downloaded: true, subdub: playerSubDub }
            : { ep: currentEpisode, Downloaded: false, subdub: playerSubDub, provider: provider }
        )
      });
      const data = await response.json();

      let fetchedSources = [];
      let fetchedSubs = [];

      fetchedSources = data?.sources || [];
      fetchedSubs = data?.subtitles || [];

      setSources(fetchedSources);
      setSubtitles(fetchedSubs);

      if (fetchedSources.length > 0) {
        const preferred = fetchedSources.find(s => s.quality === '1080p') || 
                          fetchedSources.find(s => s.quality === '720p') || 
                          fetchedSources[0];
        setSelectedSource(preferred);
      } else {
        setErrorMsg('No video sources found for this episode.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to load video player resources.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hlsRef.current) {
      console.log('Proactively destroying existing HLS instance on episode switch');
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    fetchStreamData();
  }, [id, currentEpisode, isCurrentDownloaded, playerSubDub]);

  useEffect(() => {
    if (!selectedSource || !videoRef.current) return;

    const video = videoRef.current;
    
    // Robustly extract stream URL, supporting nested source.url.url structures with proxy conversion
    let url = '';
    if (selectedSource?.url && typeof selectedSource.url === 'object' && selectedSource.url.url) {
      url = `/proxy?url=${encodeURIComponent(selectedSource.url.url)}`;
    } else if (typeof selectedSource?.url === 'string') {
      url = selectedSource.url;
    } else {
      url = selectedSource?.url || '';
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    video.src = '';

    if (url.includes('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          maxMaxBufferLength: 30,
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          fragLoadingTimeOut: 20000,
          fragLoadingMaxRetry: 5,
          fragLoadingRetryDelay: 1000,
          fragLoadingMaxRetryDelay: 8000,
          manifestLoadingTimeOut: 20000,
          manifestLoadingMaxRetry: 5,
          manifestLoadingRetryDelay: 1000,
          manifestLoadingMaxRetryDelay: 8000,
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (savedResumeTimeRef.current > 0) {
            video.currentTime = savedResumeTimeRef.current;
          }
          video.play().catch(() => {});
        });

        let networkErrorRetry = 0;
        let mediaErrorRetry = 0;
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (networkErrorRetry < 3) {
                  networkErrorRetry++;
                  console.warn(`Network error: retrying recovery attempt ${networkErrorRetry}...`);
                  hls.startLoad();
                } else {
                  console.error('Fatal network error: retry limit reached.');
                  setErrorMsg('Network error: Failed to download stream segments. Try selecting a different quality or check your connection.');
                  hls.destroy();
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                if (mediaErrorRetry < 3) {
                  mediaErrorRetry++;
                  console.warn(`Media decoding warning: retrying recovery attempt ${mediaErrorRetry}...`);
                  hls.recoverMediaError();
                } else {
                  console.error('Fatal media error: recovery loop prevented.');
                  setErrorMsg('Playback error: Try selecting a different quality level.');
                  hls.destroy();
                }
                break;
              default:
                hls.destroy();
                setErrorMsg('Fatal stream playback error.');
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        const handleLoadedMetadata = () => {
          if (savedResumeTimeRef.current > 0) {
            video.currentTime = savedResumeTimeRef.current;
          }
          video.play().catch(() => {});
          video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
      } else {
        setErrorMsg('HLS streaming is not supported in this browser.');
      }
    } else {
      video.src = url;
      const handleLoadedMetadata = () => {
        if (savedResumeTimeRef.current > 0) {
          video.currentTime = savedResumeTimeRef.current;
        }
        video.play().catch(() => {});
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      };
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
    }
  }, [selectedSource]);

  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
    };
  }, []);

  return (
    <div style={playerWrapperStyle}>
      {/* Header controls */}
      <div style={controlsHeaderStyle}>
        <button onClick={onBack} style={backBtnStyle}>
          <ArrowLeft size={18} />
          <span>Exit Player</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={episodeTitleStyle}>
            Playing Episode {currentEpisodeObj ? currentEpisodeObj.number : 'Stream'} ({subdub.toUpperCase()})
          </span>
          <span style={headerBadgeStyle(isCurrentDownloaded)}>
            {isCurrentDownloaded ? <HardDrive size={13} style={{ marginRight: '4px' }} /> : <Globe size={13} style={{ marginRight: '4px' }} />}
            {isCurrentDownloaded ? 'Local' : 'Online'}
          </span>
        </div>
      </div>

      {/* Main player viewport */}
      <div style={viewportStyle}>
        {loading ? (
          <div style={statusOverlayStyle}>
            <img src="/images/loading.gif" alt="loading" style={{ width: '64px', height: '64px' }} />
            <p style={{ marginTop: '16px' }}>Initializing stream buffer...</p>
          </div>
        ) : errorMsg ? (
          <div style={statusOverlayStyle}>
            <span style={{ fontSize: '48px' }}>⚠️</span>
            <p style={{ marginTop: '16px', color: 'var(--danger)' }}>{errorMsg}</p>
            <button onClick={fetchStreamData} style={retryBtnStyle}>Retry</button>
          </div>
        ) : (
          <video
            ref={videoRef}
            controls
            style={videoStyle}
            crossOrigin="anonymous"
          >
            {subtitles.map((sub, idx) => (
              <track
                key={idx}
                src={sub.url && sub.url.startsWith('http') ? `/proxy?url=${encodeURIComponent(sub.url)}` : sub.url}
                label={sub.lang || `Language ${idx + 1}`}
                kind="subtitles"
                srcLang={sub.lang ? sub.lang.slice(0, 2).toLowerCase() : 'en'}
                default={idx === 0}
              />
            ))}
          </video>
        )}
      </div>

      {/* Control Navigation & Source Section */}
      <div style={controlsFooterStyle}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {/* Language Selector if both are available */}
          {!loading && currentEpisodeObj?.lang === "both" && (
            <div style={qualitySelectorStyle}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Language:</span>
              <div style={qualitiesWrapperStyle}>
                <button
                  onClick={() => setPlayerSubDub('sub')}
                  style={qualityBtnStyle(playerSubDub === 'sub')}
                >
                  SUB
                </button>
                <button
                  onClick={() => setPlayerSubDub('dub')}
                  style={qualityBtnStyle(playerSubDub === 'dub')}
                >
                  DUB
                </button>
              </div>
            </div>
          )}

          {/* Quality Selector */}
          {!loading && sources.length > 0 && (
            <div style={qualitySelectorStyle}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Source:</span>
              <div style={qualitiesWrapperStyle}>
                {sources.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedSource(s)}
                    style={qualityBtnStyle(selectedSource === s)}
                  >
                    {s.quality || 'Default'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Next/Prev Navigation */}
        {sortedEpisodes.length > 0 && (
          <div style={navigationStyle}>
            <button
              onClick={handlePrevEpisode}
              disabled={prevIndex === -1}
              style={navBtnStyle(prevIndex === -1)}
            >
              &lt; Prev
            </button>

            <div style={selectContainerStyle}>
              <select
                value={currentEpisodeObj?.id || ''}
                onChange={(e) => {
                  const selected = sortedEpisodes.find(item => item.id === e.target.value);
                  if (selected) handleJumpToEpisode(selected);
                }}
                style={navSelectStyle}
              >
                {sortedEpisodes.map(item => (
                  <option key={item.id} value={item.id}>
                    Ep {item.number}{isEpDownloaded(item.number) ? ' (Downloaded)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleNextEpisode}
              disabled={nextIndex === -1}
              style={navBtnStyle(nextIndex === -1)}
            >
              Next &gt;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Styling definitions
const playerWrapperStyle = {
  flex: 1,
  backgroundColor: '#000',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  padding: '20px',
  color: 'white',
};

const controlsHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '16px',
};

const backBtnStyle = {
  background: '#1f222d',
  border: '1px solid #262936',
  color: 'white',
  padding: '8px 16px',
  borderRadius: '6px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '13px',
  fontWeight: '600',
};

const episodeTitleStyle = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#e5e7eb',
};

const viewportStyle = {
  flex: 1,
  backgroundColor: '#0a0a0a',
  borderRadius: '12px',
  overflow: 'hidden',
  position: 'relative',
  border: '1px solid #16181f',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const videoStyle = {
  width: '100%',
  height: '100%',
  maxHeight: 'calc(100vh - 200px)',
  backgroundColor: '#000',
};

const statusOverlayStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#9ca3af',
};

const retryBtnStyle = {
  marginTop: '16px',
  backgroundColor: 'var(--accent)',
  color: 'white',
  border: 'none',
  padding: '8px 20px',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: '600',
};

const controlsFooterStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '20px',
  marginTop: '16px',
  flexWrap: 'wrap',
};

const qualitySelectorStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '8px 12px',
  backgroundColor: '#0e0f12',
  borderRadius: '8px',
  border: '1px solid #1f222d',
};

const qualitiesWrapperStyle = {
  display: 'flex',
  gap: '6px',
  flexWrap: 'wrap',
};

const qualityBtnStyle = (active) => ({
  backgroundColor: active ? 'var(--accent)' : '#1f222d',
  color: 'white',
  border: active ? 'none' : '1px solid #262936',
  padding: '4px 10px',
  borderRadius: '6px',
  fontSize: '11px',
  fontWeight: '700',
  cursor: 'pointer',
  transition: 'var(--transition)',
});

const navigationStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  backgroundColor: '#0e0f12',
  padding: '8px 12px',
  borderRadius: '8px',
  border: '1px solid #1f222d',
};

const navBtnStyle = (disabled) => ({
  backgroundColor: disabled ? 'rgba(255,255,255,0.02)' : '#1f222d',
  color: disabled ? '#4b5563' : 'white',
  border: '1px solid #262936',
  padding: '6px 14px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: '600',
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'var(--transition)',
});

const selectContainerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};

const navSelectStyle = {
  backgroundColor: '#1f222d',
  border: '1px solid #262936',
  color: 'white',
  padding: '6px 12px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: '600',
  outline: 'none',
  cursor: 'pointer',
};

const headerBadgeStyle = (downloaded) => ({
  fontSize: "11px",
  fontWeight: "700",
  padding: "4px 8px",
  borderRadius: "4px",
  backgroundColor: downloaded ? "rgba(16, 185, 129, 0.15)" : "rgba(59, 130, 246, 0.15)",
  color: downloaded ? "#34d399" : "#60a5fa",
  border: downloaded ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(59, 130, 246, 0.3)",
  display: "inline-flex",
  alignItems: "center",
  lineHeight: 1
});
