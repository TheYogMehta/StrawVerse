/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { ArrowLeft, HardDrive, Globe } from 'lucide-react';
import './css/VideoPlayer.css';

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

  // Find current active episode object
  const currentEpisodeObj = sortedEpisodes.find(item => {
    if (isCurrentDownloaded) {
      return Number(item.number) === Number(currentEpisode);
    } else {
      return item.id === currentEpisode;
    }
  });

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
  const lastTickTimeRef = useRef(0);
  useEffect(() => {
    lastTickTimeRef.current = Date.now();
  }, []);
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
    let url;
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
    <div className="player-wrapper">
      {/* Header controls */}
      <div className="player-controls-header">
        <button onClick={onBack} className="player-back-btn">
          <ArrowLeft size={18} />
          <span>Exit Player</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="player-episode-title">
            Playing Episode {currentEpisodeObj ? currentEpisodeObj.number : 'Stream'} ({subdub.toUpperCase()})
          </span>
          <span className={`player-header-badge ${isCurrentDownloaded ? 'local' : 'online'}`}>
            {isCurrentDownloaded ? <HardDrive size={13} /> : <Globe size={13} />}
            <span>{isCurrentDownloaded ? 'Local' : 'Online'}</span>
          </span>
        </div>
      </div>

      {/* Main player viewport */}
      <div className="player-viewport">
        {loading ? (
          <div className="player-status-overlay">
            <img src="/images/loading.gif" alt="loading" />
            <p>Initializing stream buffer...</p>
          </div>
        ) : errorMsg ? (
          <div className="player-status-overlay">
            <span className="error-icon">⚠️</span>
            <p className="error-msg">{errorMsg}</p>
            <button onClick={fetchStreamData} className="player-retry-btn">Retry</button>
          </div>
        ) : (
          <video
            ref={videoRef}
            controls
            className="player-video"
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
      <div className="player-controls-footer">
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {/* Language Selector if both are available */}
          {!loading && currentEpisodeObj?.lang === "both" && (
            <div className="player-quality-selector">
              <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Language:</span>
              <div className="player-qualities-wrapper">
                <button
                  onClick={() => setPlayerSubDub('sub')}
                  className={`player-quality-btn ${playerSubDub === 'sub' ? 'active' : ''}`}
                >
                  SUB
                </button>
                <button
                  onClick={() => setPlayerSubDub('dub')}
                  className={`player-quality-btn ${playerSubDub === 'dub' ? 'active' : ''}`}
                >
                  DUB
                </button>
              </div>
            </div>
          )}

          {/* Quality Selector */}
          {!loading && sources.length > 0 && (
            <div className="player-quality-selector">
              <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Source:</span>
              <div className="player-qualities-wrapper">
                {sources.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedSource(s)}
                    className={`player-quality-btn ${selectedSource === s ? 'active' : ''}`}
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
          <div className="player-navigation">
            <button
              onClick={handlePrevEpisode}
              disabled={prevIndex === -1}
              className="player-nav-btn"
            >
              &lt; Prev
            </button>

            <div className="player-select-container">
              <select
                value={currentEpisodeObj?.id || ''}
                onChange={(e) => {
                  const selected = sortedEpisodes.find(item => item.id === e.target.value);
                  if (selected) handleJumpToEpisode(selected);
                }}
                className="player-nav-select"
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
              className="player-nav-btn"
            >
              Next &gt;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
