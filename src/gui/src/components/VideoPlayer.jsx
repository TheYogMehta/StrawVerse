/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from "react";
import Swal from "sweetalert2";
import { apiPost } from "../utils/common";
import {
  ArrowLeft,
  HardDrive,
  Globe,
  ChevronLeft,
  ChevronRight,
  Loader,
  Tv,
  AlertCircle,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  SkipForward,
} from "lucide-react";
import "./css/VideoPlayer.css";

export default function VideoPlayer({
  id,
  episodeNumOrId,
  isDownloaded,
  subdub,
  episodesList = [],
  downloadedEpisodes = null,
  animeTitle = "",
  provider,
  image,
  onBack,
  malid,
  hideExit = false,
}) {
  const abortControllerRef = useRef(null);
  const outroTriggeredRef = useRef(false);
  const launchingRef = useRef(false);
  const autoLaunchedRef = useRef(false);

  const [sources, setSources] = useState([]);
  const [currentEpisode, setCurrentEpisode] = useState(episodeNumOrId);
  const [isCurrentDownloaded, setIsCurrentDownloaded] = useState(isDownloaded);
  const [playerSubDub, setPlayerSubDub] = useState(subdub || "sub");

  const [subtitles, setSubtitles] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [skipTimes, setSkipTimes] = useState([]);

  const [isMpvActive, setIsMpvActive] = useState(false);
  const [mpvProgress, setMpvProgress] = useState({
    currentTime: 0,
    duration: 0,
  });
  const [mpvLaunched, setMpvLaunched] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [autoSkipIntro, setAutoSkipIntro] = useState(true);
  const [hasAutoSkipped, setHasAutoSkipped] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      if (window.sharedStateAPI && window.sharedStateAPI.getSettings) {
        try {
          const settings = await window.sharedStateAPI.getSettings();
          if (settings && typeof settings.autoSkipIntro === "boolean") {
            setAutoSkipIntro(settings.autoSkipIntro);
          }
        } catch (e) {}
      }
    };
    loadSettings();
  }, []);

  useEffect(() => {
    setHasAutoSkipped(false);
    outroTriggeredRef.current = false;
    launchingRef.current = false;
    autoLaunchedRef.current = false;
  }, [currentEpisode]);

  // Sync props
  useEffect(() => {
    setCurrentEpisode(episodeNumOrId);
  }, [episodeNumOrId]);

  useEffect(() => {
    setIsCurrentDownloaded(isDownloaded);
  }, [isDownloaded]);

  useEffect(() => {
    if (subdub) {
      setPlayerSubDub(subdub);
    }
  }, [subdub]);

  // Helper to determine if an episode number is downloaded
  const isEpDownloaded = (num, currentLang = playerSubDub) => {
    if (!downloadedEpisodes) return false;
    const subList = downloadedEpisodes.sub || [];
    const dubList = downloadedEpisodes.dub || [];
    return currentLang === "dub"
      ? dubList.includes(Number(num))
      : subList.includes(Number(num));
  };

  // Sort episodes list in ascending order
  const sortedEpisodes = [...episodesList].sort(
    (a, b) => Number(a.number) - Number(b.number),
  );

  // Find current active episode object
  const currentEpisodeObj = sortedEpisodes.find((item) => {
    if (isCurrentDownloaded) {
      return Number(item.number) === Number(currentEpisode);
    } else {
      return (
        item.id === currentEpisode ||
        Number(item.number) === Number(currentEpisode)
      );
    }
  });

  // Episode navigation
  const currentIndex = currentEpisodeObj
    ? sortedEpisodes.indexOf(currentEpisodeObj)
    : -1;
  const prevIndex = currentIndex > 0 ? currentIndex - 1 : -1;
  const nextIndex =
    currentIndex !== -1 && currentIndex < sortedEpisodes.length - 1
      ? currentIndex + 1
      : -1;

  const handleJumpToEpisode = (episodeObj) => {
    const isDownloadedLocal = isEpDownloaded(episodeObj.number);
    setIsCurrentDownloaded(isDownloadedLocal);
    setCurrentEpisode(isDownloadedLocal ? episodeObj.number : episodeObj.id);
    launchingRef.current = false;
    autoLaunchedRef.current = false;
    setSelectedSource(null);
    setMpvLaunched(false);
    setIsMpvActive(false);
    setMpvProgress({ currentTime: 0, duration: 0 });
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

  // Handle language/subdub switching
  useEffect(() => {
    const currentEpNum = currentEpisodeObj
      ? currentEpisodeObj.number
      : typeof currentEpisode === "number" || !isNaN(Number(currentEpisode))
        ? Number(currentEpisode)
        : null;
    if (currentEpNum !== null) {
      const isDownloadedInNewLang = isEpDownloaded(currentEpNum, playerSubDub);
      if (isDownloadedInNewLang !== isCurrentDownloaded) {
        setIsCurrentDownloaded(isDownloadedInNewLang);
        if (isDownloadedInNewLang) {
          setCurrentEpisode(currentEpNum);
        } else {
          const epObj = sortedEpisodes.find(
            (item) => Number(item.number) === Number(currentEpNum),
          );
          if (epObj) {
            setCurrentEpisode(epObj.id);
          }
        }
      }
    }
  }, [playerSubDub]);

  // Fetch stream data
  const fetchStreamData = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current?.signal;

    setLoading(true);
    setErrorMsg("");
    setSources([]);
    setSubtitles([]);
    setSelectedSource(null);
    setMpvLaunched(false);

    try {
      const targetEp = currentEpisodeObj
        ? currentEpisodeObj.id
        : currentEpisode;
      const targetEpNum = currentEpisodeObj
        ? currentEpisodeObj.number
        : currentEpisode;
      const data = await apiPost(
        "/api/watch",
        isCurrentDownloaded
          ? {
              ep: id,
              epNum: targetEpNum,
              Downloaded: true,
              subdub: playerSubDub,
            }
          : {
              ep: targetEp,
              Downloaded: false,
              subdub: playerSubDub,
              provider: provider,
            },
        { signal },
      );

      if (signal?.aborted) return;

      let fetchedSources = data?.sources || [];
      let fetchedSubs = data?.subtitles || [];
      let fetchedSkipTimes = data?.skipTimes || [];

      setSources(fetchedSources);
      setSubtitles(fetchedSubs);
      if (isCurrentDownloaded) {
        setSkipTimes(fetchedSkipTimes);
      }

      if (fetchedSources.length > 0) {
        const preferred =
          fetchedSources.find((s) => s.quality === "1080p") ||
          fetchedSources.find((s) => s.quality === "720p") ||
          fetchedSources[0];
        setSelectedSource(preferred);
      } else {
        setErrorMsg("No video sources found for this episode.");
      }
    } catch (err) {
      if (err.name === "AbortError") {
        console.log("Fetch aborted");
        return;
      }
      console.error(err);
      setErrorMsg("Failed to load video player resources.");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchStreamData();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [currentEpisode, playerSubDub, isCurrentDownloaded]);

  // Discord RPC cleanup on unmount
  useEffect(() => {
    return () => {
      apiPost("/api/discord/reset").catch(() => {});
    };
  }, []);

  // MPV IPC event listeners
  useEffect(() => {
    if (!window.sharedStateAPI || !window.sharedStateAPI.on) return;

    const cleanupProgress = window.sharedStateAPI.on("mpv-progress", (data) => {
      if (data) {
        const time = data.currentTime || 0;
        const dur = data.duration || 0;
        setMpvProgress({
          currentTime: time,
          duration: dur,
        });
        if (typeof data.paused === "boolean") {
          setIsPaused(data.paused);
        }

        // Auto-skip logic
        if (autoSkipIntro && !hasAutoSkipped && skipTimes && skipTimes.length > 0) {
          const currentSkip = skipTimes.find(
            (s) => s.skipType === "op" && time >= s.interval.start && time < s.interval.end
          );
          if (currentSkip) {
            console.log(`[Auto-Skip] Auto-skipping intro from ${time} to ${currentSkip.interval.end}`);
            if (window.sharedStateAPI.controlMpv) {
              window.sharedStateAPI.controlMpv("seek", [currentSkip.interval.end, "absolute"]);
              setHasAutoSkipped(true);
            }
          }
        }

        // Auto-play next logic when reaching outro (22:00 / 1320s)
        if (dur > 1320 && time >= 1320 && time < dur) {
          if (!outroTriggeredRef.current) {
            outroTriggeredRef.current = true;
            console.log(`[Auto-Play] Reached outro at ${time}s. Loading next episode...`);
            if (nextIndex !== -1) {
              handleJumpToEpisode(sortedEpisodes[nextIndex]);
              return;
            }
          }
        }
      }
    });

    const cleanupClosed = window.sharedStateAPI.on("mpv-closed", (data) => {
      console.log("[MPV] Native player window closed.");
      launchingRef.current = false;
      setIsMpvActive(false);
      setMpvLaunched(false);

      if (data) {
        setMpvProgress({
          currentTime: data.currentTime || 0,
          duration: data.duration || 0,
        });
      }

      // Auto-advance to next episode if watched > 99% (natural completion)
      if (
        data &&
        data.duration > 0 &&
        data.currentTime / data.duration > 0.99 &&
        nextIndex !== -1
      ) {
        handleJumpToEpisode(sortedEpisodes[nextIndex]);
      } else {
        onBack();
      }
    });

    const cleanupError = window.sharedStateAPI.on("mpv-error", (data) => {
      console.error("[MPV] Spawn or playback error:", data?.message);
      launchingRef.current = false;
      setIsMpvActive(false);
      setMpvLaunched(false);
      Swal.fire({
        title: "MPV Launch Failed",
        text: data?.message || "Failed to start native MPV player process.",
        icon: "error",
        confirmButtonColor: "var(--accent-color)",
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
      }).then(() => {
        onBack();
      });
    });

    return () => {
      cleanupProgress();
      cleanupClosed();
      cleanupError();
    };
  }, [nextIndex]);

  // Auto-launch MPV when source is ready
  useEffect(() => {
    if (selectedSource && !autoLaunchedRef.current && !mpvLaunched && !isMpvActive) {
      autoLaunchedRef.current = true;
      launchMpv();
    }
  }, [selectedSource]);

  const launchMpv = async () => {
    if (!selectedSource || launchingRef.current || mpvLaunched) return;
    launchingRef.current = true;

    setIsMpvActive(true);
    setMpvLaunched(true);

    const title = animeTitle || "Anime";
    const epNum = currentEpisodeObj ? currentEpisodeObj.number : 1;

    let subs = [];
    if (subtitles && Array.isArray(subtitles)) {
      subs = subtitles.map((s) => ({
        url: s.url,
        lang: s.lang || s.label,
      }));
    }

    // Fetch resume time from history
    let resumeTime = 0;
    try {
      const res = await fetch(
        `/api/history/progress?mediaId=${encodeURIComponent(id)}&type=Anime`,
      );
      const progressData = await res.json();
      if (
        progressData?.lastProgress &&
        Number(progressData.lastProgress.number) === Number(epNum)
      ) {
        const savedTime = parseFloat(
          progressData.lastProgress.currentTime || 0,
        );
        resumeTime = Math.max(0, savedTime - 5);
      }
    } catch (_) {
      // Ignore - start from beginning
    }

    const playOptions = {
      url: selectedSource.url,
      sources: sources.map((s) => ({
        quality: s.quality || "Default",
        url: s.url,
      })),
      title: title,
      episode: epNum,
      currentTime: resumeTime,
      duration: 0,
      subtitles: subs,
      mediaId: id,
      image: image,
      provider: provider,
      malid: malid,
    };

    try {
      if (window.sharedStateAPI && window.sharedStateAPI.playInMpv) {
        const res = await window.sharedStateAPI.playInMpv(playOptions);
        if (res && !res.success) {
          Swal.fire({
            title: "MPV Launch Failed",
            text: res.error || "Could not launch native MPV player.",
            icon: "error",
            confirmButtonColor: "var(--accent-color)",
            background: "var(--bg-secondary)",
            color: "var(--text-main)",
          });
          launchingRef.current = false;
          setIsMpvActive(false);
          setMpvLaunched(false);
        }
      } else {
        Swal.fire({
          title: "Not Supported",
          text: "Native MPV player integration is not available in this environment.",
          icon: "warning",
          confirmButtonColor: "var(--accent-color)",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
        });
        launchingRef.current = false;
        setIsMpvActive(false);
        setMpvLaunched(false);
      }
    } catch (err) {
      console.error("[MPV] playInMpv API call error:", err);
      launchingRef.current = false;
      setIsMpvActive(false);
      setMpvLaunched(false);
    }
  };

  const handleSeek = (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && window.sharedStateAPI && window.sharedStateAPI.controlMpv) {
      window.sharedStateAPI.controlMpv("seek", [val, "absolute"]);
      setMpvProgress((prev) => ({ ...prev, currentTime: val }));
    }
  };

  const handleRelativeSeek = (amount) => {
    if (window.sharedStateAPI && window.sharedStateAPI.controlMpv) {
      window.sharedStateAPI.controlMpv("seek", [amount, "relative"]);
    }
  };

  const handleTogglePause = () => {
    if (window.sharedStateAPI && window.sharedStateAPI.controlMpv) {
      window.sharedStateAPI.controlMpv("cycle", ["pause"]);
      setIsPaused(!isPaused);
    }
  };

  // Format seconds to MM:SS
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const progressPercent =
    mpvProgress.duration > 0
      ? Math.min((mpvProgress.currentTime / mpvProgress.duration) * 100, 100)
      : 0;

  const activeSkipSegment = skipTimes?.find(
    (s) => mpvProgress.currentTime >= s.interval.start && mpvProgress.currentTime < s.interval.end
  );

  if (isMpvActive) {
    return null;
  }

  return (
    <div className="mpv-loading-overlay">
      <div className="mpv-loading-card glass-panel">
        {loading ? (
          <div className="mpv-loading-spinner-container">
            <Loader size={36} className="mpv-spin" />
            <h3>Fetching stream sources...</h3>
            <p>{animeTitle} — Episode {currentEpisodeObj ? currentEpisodeObj.number : currentEpisode}</p>
          </div>
        ) : errorMsg ? (
          <div className="mpv-error-container">
            <AlertCircle size={36} className="error-icon" />
            <h3>Launch Error</h3>
            <p>{errorMsg}</p>
            <button onClick={onBack} className="mpv-error-close-btn">Close</button>
          </div>
        ) : (
          <div className="mpv-loading-spinner-container">
            <Loader size={36} className="mpv-spin" />
            <h3>Launching MPV Player...</h3>
            <p>{animeTitle} — Episode {currentEpisodeObj ? currentEpisodeObj.number : currentEpisode}</p>
          </div>
        )}
      </div>
    </div>
  );
}
