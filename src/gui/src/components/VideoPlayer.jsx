/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import Swal from "sweetalert2";
import { apiPost } from "../utils/common";
import watchTogetherClient from "../utils/watchTogetherClient";

if (
  typeof window !== "undefined" &&
  window.MediaSource &&
  MediaSource.prototype.addSourceBuffer
) {
  const origAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (type) {
    const remapped = type.replace(/mp4a\.40\.1/g, "mp4a.40.5");
    if (remapped !== type) {
      console.log("[CODEC REMAP]", type, "→", remapped);
    }
    return origAddSourceBuffer.call(this, remapped);
  };
}

class KwikFragmentLoader {
  constructor(config) {
    this.config = config;
    this.loader = new Hls.DefaultConfig.loader(config);
  }

  get stats() {
    return this.loader.stats;
  }

  get context() {
    return this.loader.context;
  }

  load(context, config, callbacks) {
    const customCallbacks = {
      ...callbacks,
      onSuccess: (response, stats, context, networkDetails) => {
        let data = response.data;
        if (data instanceof ArrayBuffer) {
          const uint8 = new Uint8Array(data);
          if (
            uint8.length >= 8 &&
            uint8[0] === 0x89 &&
            uint8[1] === 0x50 &&
            uint8[2] === 0x4e &&
            uint8[3] === 0x47 &&
            uint8[4] === 0x0d &&
            uint8[5] === 0x0a &&
            uint8[6] === 0x1a &&
            uint8[7] === 0x0a
          ) {
            let iendOffset = -1;
            for (let i = 0; i < Math.min(uint8.length - 3, 1024); i++) {
              if (
                uint8[i] === 0x49 &&
                uint8[i + 1] === 0x45 &&
                uint8[i + 2] === 0x4e &&
                uint8[i + 3] === 0x44
              ) {
                iendOffset = i;
                break;
              }
            }
            if (iendOffset !== -1) {
              response.data = data.slice(iendOffset + 8);
            }
          }
        }
        callbacks.onSuccess(response, stats, context, networkDetails);
      },
    };

    this.loader.load(context, config, customCallbacks);
  }

  abort() {
    this.loader.abort();
  }

  destroy() {
    this.loader.destroy();
  }
}
import {
  ArrowLeft,
  HardDrive,
  Globe,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  ChevronLeft,
  ChevronRight,
  Settings,
  Subtitles,
  PictureInPicture,
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
  isHost = false,
  onSkip = null,
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const wrapperRef = useRef(null);
  const uiTimeoutRef = useRef(null);
  const indicatorTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);
  const settingsRef = useRef(null);
  const timelineRef = useRef(null);
  const timeDisplayRef = useRef(null);
  const rafRef = useRef(null);
  const currentTimeRef = useRef(0);
  const bufferedRef = useRef(0);
  const durationRef = useRef(0);
  const isRemoteSync = useRef(false);

  useEffect(() => {
    const handleRemotePlayPause = ({ isPlaying: remotePlaying, timestamp }) => {
      const video = videoRef.current;
      if (!video) return;
      isRemoteSync.current = true;

      if (Math.abs(video.currentTime - timestamp) > 0.5) {
        video.currentTime = timestamp;
      }

      if (remotePlaying && video.paused) {
        video.play().catch(() => {});
        setIsPlaying(true);
      } else if (!remotePlaying && !video.paused) {
        video.pause();
        setIsPlaying(false);
      }

      setTimeout(() => {
        isRemoteSync.current = false;
      }, 100);
    };

    const handleRemoteTimeSync = ({ timestamp, speed }) => {
      const video = videoRef.current;
      if (!video) return;
      isRemoteSync.current = true;

      if (Math.abs(video.currentTime - timestamp) > 1.5) {
        video.currentTime = timestamp;
      }
      if (speed && video.playbackRate !== speed) {
        video.playbackRate = speed;
      }

      setTimeout(() => {
        isRemoteSync.current = false;
      }, 100);
    };

    const handleRemoteStartPlayback = () => {
      const video = videoRef.current;
      if (!video) return;
      isRemoteSync.current = true;
      video.play().catch(() => {});
      setIsPlaying(true);
      setTimeout(() => {
        isRemoteSync.current = false;
      }, 100);
    };

    watchTogetherClient.on("playPause", handleRemotePlayPause);
    watchTogetherClient.on("timeSync", handleRemoteTimeSync);
    watchTogetherClient.on("startPlayback", handleRemoteStartPlayback);

    return () => {
      watchTogetherClient.off("playPause", handleRemotePlayPause);
      watchTogetherClient.off("timeSync", handleRemoteTimeSync);
      watchTogetherClient.off("startPlayback", handleRemoteStartPlayback);
    };
  }, []);

  const [sources, setSources] = useState([]);
  const [currentEpisode, setCurrentEpisode] = useState(episodeNumOrId);
  const [isCurrentDownloaded, setIsCurrentDownloaded] = useState(isDownloaded);
  const [playerSubDub, setPlayerSubDub] = useState(subdub || "sub");

  const [isPip, setIsPip] = useState(false);
  const pipSupported =
    typeof document !== "undefined" && document.pictureInPictureEnabled;

  const [skipTimes, setSkipTimes] = useState([]);
  const [autoSkip, setAutoSkip] = useState(
    () => localStorage.getItem("player-auto-skip") !== "false",
  );

  const [subtitles, setSubtitles] = useState([]);
  const [processedSubtitles, setProcessedSubtitles] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [showSettings, setShowSettings] = useState(false);
  const [settingsActiveMenu, setSettingsActiveMenu] = useState("main");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState(-1);

  const [showUI, setShowUI] = useState(true);
  const [indicator, setIndicator] = useState({
    visible: false,
    icon: null,
    text: "",
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const savedVolume = localStorage.getItem("player-volume");
    return savedVolume !== null ? parseFloat(savedVolume) : 1;
  });
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem("player-muted") === "true";
  });
  const [buffered, setBuffered] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = isMuted;
    }
  }, [volume, isMuted, selectedSource]);

  const updateTimelineDOM = () => {
    const ct = currentTimeRef.current;
    const dur = durationRef.current || 1;
    const buf = bufferedRef.current;
    const progressPct = (ct / dur) * 100;
    const bufferedPct = (buf / dur) * 100;

    if (timelineRef.current) {
      timelineRef.current.value = ct;
      timelineRef.current.max = durationRef.current || 100;
      timelineRef.current.style.setProperty(
        "--progress-percent",
        `${progressPct}%`,
      );
      timelineRef.current.style.setProperty(
        "--buffered-percent",
        `${bufferedPct}%`,
      );
    }
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = formatTime(ct);
    }
  };
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [useTranscodeFallback, setUseTranscodeFallback] = useState(false);

  const sourceUrl =
    typeof selectedSource?.url === "string"
      ? selectedSource.url
      : selectedSource?.url && typeof selectedSource.url === "object"
        ? selectedSource.url.url
        : "";

  const formatTime = (time) => {
    if (isNaN(time) || time === Infinity) return "0:00";
    const hrs = Math.floor(time / 3600);
    const mins = Math.floor((time % 3600) / 60);
    const secs = Math.floor(time % 60);

    const pad = (n) => (n < 10 ? `0${n}` : n);

    if (hrs > 0) {
      return `${hrs}:${pad(mins)}:${pad(secs)}`;
    }
    return `${mins}:${pad(secs)}`;
  };

  const togglePlay = () => {
    if (watchTogetherClient.roomCode && !isHost) return;
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      showIndicator(Play, "Play");
      video.play().catch(() => {});
      if (watchTogetherClient.roomCode && !isRemoteSync.current) {
        watchTogetherClient.sendPlayPause(true, video.currentTime);
      }
    } else {
      showIndicator(Pause, "Pause");
      video.pause();
      if (watchTogetherClient.roomCode && !isRemoteSync.current) {
        watchTogetherClient.sendPlayPause(false, video.currentTime);
      }
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    showIndicator(
      video.muted ? VolumeX : Volume2,
      video.muted ? "Muted" : "Unmuted",
    );
  };

  const handleVolumeSliderChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    localStorage.setItem("player-volume", val);
    const video = videoRef.current;
    if (video) {
      video.volume = val;
      video.muted = val === 0;
    }
    setIsMuted(val === 0);
    localStorage.setItem("player-muted", val === 0 ? "true" : "false");
  };

  const handleTimelineChange = (e) => {
    if (watchTogetherClient.roomCode && !isHost) return;
    const val = parseFloat(e.target.value);
    currentTimeRef.current = val;
    setCurrentTime(val);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
    }
    if (watchTogetherClient.roomCode && !isRemoteSync.current) {
      watchTogetherClient.sendTimeSync(val, playbackSpeed);
    }
  };

  // Dynamic page title & media metadata sync
  useEffect(() => {
    const originalTitle = document.title;
    const cleanEp =
      typeof currentEpisode === "object"
        ? currentEpisode.number || currentEpisode.id
        : currentEpisode;
    const displayTitle = animeTitle
      ? `${animeTitle} - Ep ${cleanEp}`
      : "StrawVerse Video";

    document.title = displayTitle;

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: displayTitle,
        artist: "StrawVerse",
        artwork: image
          ? [{ src: image, sizes: "512x512", type: "image/png" }]
          : [],
      });
    }

    return () => {
      document.title = originalTitle;
    };
  }, [animeTitle, currentEpisode, image]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnterPiP = () => {
      setIsPip(true);
      const cleanEp =
        typeof currentEpisode === "object"
          ? currentEpisode.number || currentEpisode.id
          : currentEpisode;
      const displayTitle = animeTitle
        ? `${animeTitle} - Ep ${cleanEp}`
        : "StrawVerse Video";
      document.title = `${displayTitle} (PiP)`;
    };

    const handleLeavePiP = () => {
      setIsPip(false);
      const cleanEp =
        typeof currentEpisode === "object"
          ? currentEpisode.number || currentEpisode.id
          : currentEpisode;
      const displayTitle = animeTitle
        ? `${animeTitle} - Ep ${cleanEp}`
        : "StrawVerse Video";
      document.title = displayTitle;
    };

    video.addEventListener("enterpictureinpicture", handleEnterPiP);
    video.addEventListener("leavepictureinpicture", handleLeavePiP);

    return () => {
      if (video) {
        video.removeEventListener("enterpictureinpicture", handleEnterPiP);
        video.removeEventListener("leavepictureinpicture", handleLeavePiP);
      }
    };
  }, [selectedSource, animeTitle, currentEpisode]);

  const togglePiP = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.error("Failed to toggle PiP:", err);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const ct = videoRef.current.currentTime;
      currentTimeRef.current = ct;
      setCurrentTime(ct);

      if (autoSkip && skipTimes.length > 0) {
        const match = skipTimes.find(
          (st) =>
            ct >= st.interval.start_time && ct < st.interval.end_time - 0.5,
        );
        if (match) {
          videoRef.current.currentTime = match.interval.end_time;
          currentTimeRef.current = match.interval.end_time;
          setCurrentTime(match.interval.end_time);
          showIndicator(
            ChevronRight,
            `Skipped ${match.skip_type === "op" || match.skip_type === "mixed-op" ? "Opening" : "Ending"}`,
          );
          return;
        }
      }

      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          updateTimelineDOM();
        });
      }
    }
  };

  const handleEnded = () => {
    saveWatchProgress(true);
    if (watchTogetherClient.roomCode) {
      if (isHost) {
        if (onSkip) {
          onSkip();
        }
      }
    } else {
      if (nextIndex !== -1) {
        handleNextEpisode();
      }
    }
  };

  const handleDurationChange = () => {
    if (videoRef.current) {
      durationRef.current = videoRef.current.duration;
      setDuration(videoRef.current.duration);
    }
  };

  const handleVolumeChange = () => {
    if (videoRef.current) {
      setVolume(videoRef.current.volume);
      setIsMuted(videoRef.current.muted);
      localStorage.setItem("player-volume", videoRef.current.volume);
      localStorage.setItem(
        "player-muted",
        videoRef.current.muted ? "true" : "false",
      );
    }
  };

  const handleProgress = () => {
    if (videoRef.current && videoRef.current.buffered.length > 0) {
      const buf = videoRef.current.buffered;
      const curr = videoRef.current.currentTime;
      for (let i = 0; i < buf.length; i++) {
        if (buf.start(i) <= curr && buf.end(i) >= curr) {
          bufferedRef.current = buf.end(i);
          updateTimelineDOM();
          return;
        }
      }
      bufferedRef.current = buf.end(buf.length - 1);
      updateTimelineDOM();
    } else {
      bufferedRef.current = 0;
      updateTimelineDOM();
    }
  };

  const resetUITimeout = () => {
    setShowUI(true);
    if (uiTimeoutRef.current) {
      clearTimeout(uiTimeoutRef.current);
    }
    if (videoRef.current && !videoRef.current.paused) {
      uiTimeoutRef.current = setTimeout(() => {
        setShowUI(false);
      }, 3000);
    }
  };

  const showIndicator = (icon, text) => {
    setIndicator({ visible: true, icon, text });
    if (indicatorTimeoutRef.current) {
      clearTimeout(indicatorTimeoutRef.current);
    }
    indicatorTimeoutRef.current = setTimeout(() => {
      setIndicator((prev) => ({ ...prev, visible: false }));
    }, 500);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      const wrapper = wrapperRef.current;
      if (wrapper) {
        if (wrapper.requestFullscreen) {
          wrapper.requestFullscreen();
        } else if (wrapper.webkitRequestFullscreen) {
          wrapper.webkitRequestFullscreen();
        } else if (wrapper.msRequestFullscreen) {
          wrapper.msRequestFullscreen();
        }
        showIndicator(Maximize, "Fullscreen");
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
      showIndicator(Minimize, "Exit Fullscreen");
    }
  };

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

  // Sort episodes list in ascending order to make Next/Prev predictable
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

  useEffect(() => {
    const fetchSkipTimes = async () => {
      if (skipTimes && skipTimes.length > 0) {
        return;
      }
      if (!malid) {
        setSkipTimes([]);
        return;
      }
      const epNum = currentEpisodeObj
        ? currentEpisodeObj.number
        : episodeNumOrId;
      if (!epNum || isNaN(Number(epNum))) {
        setSkipTimes([]);
        return;
      }

      try {
        const epLength = Math.round(durationRef.current || 0);
        const res = await fetch(
          `https://api.aniskip.com/v2/skip-times/${malid}/${Number(epNum)}?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&episodeLength=${epLength}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data && data.found && data.results) {
            // Normalize v2 camelCase response to snake_case
            const normalized = data.results.map((st) => ({
              ...st,
              skip_type: st.skipType || st.skip_type,
              interval: {
                start_time: st.interval.startTime ?? st.interval.start_time,
                end_time: st.interval.endTime ?? st.interval.end_time,
              },
            }));
            setSkipTimes(normalized);
          } else {
            setSkipTimes([]);
          }
        } else {
          setSkipTimes([]);
        }
      } catch (err) {
        console.warn("Failed to fetch skip times from AniSkip:", err);
        setSkipTimes([]);
      }
    };

    fetchSkipTimes();
  }, [
    malid,
    currentEpisodeObj,
    episodeNumOrId,
    selectedSource,
    isCurrentDownloaded,
  ]);

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
  const animeTitleVal = animeTitle || "Anime";

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
        await apiPost("/api/history/update", {
          mediaId: id,
          type: "Anime",
          title: animeTitleVal,
          number: currentEpisodeObj ? currentEpisodeObj.number : 1,
          currentTime,
          duration,
          timeSpent,
          image,
          provider,
          malid,
        });
      } catch (err) {
        console.error("Failed to save watch progress:", err);
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
          const resumeTime = Math.max(0, savedTime - 5);
          savedResumeTimeRef.current = resumeTime;

          if (videoRef.current && videoRef.current.readyState >= 1) {
            videoRef.current.currentTime = resumeTime;
          }
        }
      } catch (err) {
        console.error("Failed to load progress:", err);
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
      apiPost("/api/discord/reset").catch(() => {});
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

    video.addEventListener("pause", handlePause);
    video.addEventListener("play", handlePlay);

    return () => {
      if (video) {
        video.removeEventListener("pause", handlePause);
        video.removeEventListener("play", handlePlay);
      }
    };
  }, [selectedSource, currentEpisode, currentEpisodeObj]);

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
      setUseTranscodeFallback(false);

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
    if (hlsRef.current) {
      console.log(
        "Proactively destroying existing HLS instance on episode switch",
      );
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    fetchStreamData();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [id, currentEpisode, isCurrentDownloaded, playerSubDub]);

  useEffect(() => {
    const blobUrls = [];
    let cancelled = false;
    const processSubtitles = async () => {
      if (!subtitles || subtitles.length === 0 || playerSubDub === "hsub") {
        setProcessedSubtitles([]);
        return;
      }
      const processed = [];
      for (const sub of subtitles) {
        if (!sub.url) continue;
        if (sub.url.startsWith("blob:")) {
          processed.push(sub);
          continue;
        }
        try {
          const res = await fetch(sub.url);
          if (!res.ok) continue;
          let text = await res.text();
          const trimmed = text.trim();
          if (!trimmed.startsWith("WEBVTT")) {
            const converted = text.replace(
              /(\d{1,2}:\d{2}:\d{2}),(\d{2,3})/g,
              (m, time, ms) => `${time.padStart(8, "0")}.${ms.padEnd(3, "0")}`,
            );
            text = "WEBVTT\n\n" + converted;
          }
          const blob = new Blob([text], { type: "text/vtt" });
          const blobUrl = URL.createObjectURL(blob);
          blobUrls.push(blobUrl);
          if (!cancelled) {
            processed.push({ ...sub, url: blobUrl });
          }
        } catch (err) {
          console.warn(`Failed to fetch subtitle: ${sub.url}`, err.message);
        }
      }
      if (!cancelled) setProcessedSubtitles(processed);
    };
    processSubtitles();
    return () => {
      cancelled = true;
      blobUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [subtitles]);

  useEffect(() => {
    if (!selectedSource || !videoRef.current) return;

    const video = videoRef.current;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    video.src = "";

    durationRef.current = 0;
    currentTimeRef.current = 0;
    bufferedRef.current = 0;
    setDuration(0);

    const url = sourceUrl;

    const isM3U8 = url.includes(".m3u8") || selectedSource?.isM3U8;

    if (isM3U8) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          fLoader: KwikFragmentLoader,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxBufferSize: 60 * 1000 * 1000,
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          stretchShortVideoTrack: true,
          maxBufferHole: 0.5,
          highBufferWatchdogPeriod: 3,
          nudgeOffset: 0.1,
          nudgeMaxRetry: 5,
          startPosition: 0.15,
          progressive: false,
          fragLoadingTimeOut: 20000,
          fragLoadingMaxRetry: 5,
          fragLoadingRetryDelay: 1000,
          fragLoadingMaxRetryDelay: 8000,
          manifestLoadingTimeOut: 20000,
          manifestLoadingMaxRetry: 5,
          manifestLoadingRetryDelay: 1000,
          manifestLoadingMaxRetryDelay: 8000,
          levelLoadingTimeOut: 20000,
          levelLoadingMaxRetry: 5,
          levelLoadingRetryDelay: 1000,
          levelLoadingMaxRetryDelay: 8000,
        });
        hlsRef.current = hls;
        hls.attachMedia(video);

        if (window.sharedStateAPI?.ensureCfBypass) {
          const referer =
            selectedSource?.headers?.Referer ||
            selectedSource?.headers?.referer ||
            "";
          window.sharedStateAPI
            .ensureCfBypass(url, referer)
            .then(() => {
              if (
                url.includes("owocdn.top") ||
                url.includes("uwucdn.top") ||
                url.includes("kwik.cx")
              ) {
                window.sharedStateAPI
                  .ensureCfBypass("https://kwik.cx/", referer)
                  .catch(() => {});
              }
            })
            .catch((e) => {
              console.warn("Background CF bypass check failed:", e);
            });
        }
        hls.loadSource(url);

        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          console.log("[HLS MANIFEST_PARSED]", data.levels.length, "level(s)");
          if (savedResumeTimeRef.current > 0) {
            video.currentTime = savedResumeTimeRef.current;
            video.play().catch(() => {});
          } else {
            const onBufferAppended = () => {
              hls.off(Hls.Events.BUFFER_APPENDED, onBufferAppended);
              if (video.buffered.length > 0 && video.buffered.start(0) > 0.01) {
                const seekTo = video.buffered.start(0) + 0.01;
                console.log(
                  "[HLS] Skipping initial PTS gap, seeking to",
                  seekTo.toFixed(3),
                );
                video.currentTime = seekTo;
              }
              video.play().catch(() => {});
            };
            hls.on(Hls.Events.BUFFER_APPENDED, onBufferAppended);
          }
        });

        video.addEventListener("error", () => {
          console.error(
            "[VIDEO ELEMENT ERROR]",
            video.error?.code,
            video.error?.message,
          );
        });

        let networkErrorRetry = 0;
        let mediaErrorRetry = 0;
        hls.on(Hls.Events.ERROR, (event, data) => {
          console.log(
            "[HLS ERROR]",
            data.type,
            data.details,
            data.fatal,
            data.reason || "",
            data.error || "",
          );
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (networkErrorRetry < 6) {
                  networkErrorRetry++;
                  console.warn(
                    `Network error: retrying recovery attempt ${networkErrorRetry}...`,
                  );
                  hls.startLoad();
                } else {
                  console.error("Fatal network error: retry limit reached.");
                  setErrorMsg(
                    "Network error: Failed to download stream segments. Try selecting a different quality or check your connection.",
                  );
                  hls.destroy();
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                if (mediaErrorRetry < 3) {
                  mediaErrorRetry++;
                  console.warn(
                    `Media decoding warning: retrying recovery attempt ${mediaErrorRetry}...`,
                  );
                  if (mediaErrorRetry > 1) {
                    console.warn(
                      "Swapping audio codec to bypass HE-AAC decode loop...",
                    );
                    hls.swapAudioCodec();
                  }
                  hls.recoverMediaError();
                } else {
                  console.error("Fatal media error: recovery loop prevented.");
                  hls.destroy();
                  if (!useTranscodeFallback) {
                    console.warn(
                      "Switching to FFmpeg audio transcode fallback...",
                    );
                    setUseTranscodeFallback(true);
                  } else {
                    setErrorMsg(
                      "Playback error: Try selecting a different quality level.",
                    );
                  }
                }
                break;
              default:
                hls.destroy();
                setErrorMsg("Fatal stream playback error.");
                break;
            }
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        const handleLoadedMetadata = () => {
          if (savedResumeTimeRef.current > 0) {
            video.currentTime = savedResumeTimeRef.current;
          }
          video.play().catch(() => {});
          video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        };
        video.addEventListener("loadedmetadata", handleLoadedMetadata);
      } else {
        setErrorMsg("HLS streaming is not supported in this browser.");
      }
    } else {
      video.src = url;
      const handleLoadedMetadata = () => {
        if (savedResumeTimeRef.current > 0) {
          video.currentTime = savedResumeTimeRef.current;
        }
        video.play().catch(() => {});
        video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      };
      video.addEventListener("loadedmetadata", handleLoadedMetadata);
    }
  }, [selectedSource, sourceUrl]);

  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      resetUITimeout();
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange,
      );
      document.removeEventListener(
        "mozfullscreenchange",
        handleFullscreenChange,
      );
      document.removeEventListener(
        "MSFullscreenChange",
        handleFullscreenChange,
      );
    };
  }, []);

  useEffect(() => {
    if (subtitles.length > 0) {
      setSelectedSubtitleIndex(0);
    } else {
      setSelectedSubtitleIndex(-1);
    }
  }, [subtitles]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.textTracks) return;

    const applySubtitleTrack = () => {
      for (let i = 0; i < video.textTracks.length; i++) {
        if (i === selectedSubtitleIndex) {
          video.textTracks[i].mode = "showing";
        } else {
          video.textTracks[i].mode = "disabled";
        }
      }
    };

    video.textTracks.addEventListener("addtrack", applySubtitleTrack);
    video.addEventListener("loadedmetadata", applySubtitleTrack);
    applySubtitleTrack();

    return () => {
      if (video && video.textTracks) {
        video.textTracks.removeEventListener("addtrack", applySubtitleTrack);
      }
      if (video) {
        video.removeEventListener("loadedmetadata", applySubtitleTrack);
      }
    };
  }, [selectedSource, subtitles, selectedSubtitleIndex]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const applySpeed = () => {
      video.playbackRate = playbackSpeed;
    };

    video.addEventListener("loadedmetadata", applySpeed);
    video.addEventListener("play", applySpeed);
    applySpeed();

    return () => {
      video.removeEventListener("loadedmetadata", applySpeed);
      video.removeEventListener("play", applySpeed);
    };
  }, [selectedSource, playbackSpeed]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target)) {
        setShowSettings(false);
        setSettingsActiveMenu("main");
      }
    };

    if (showSettings) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showSettings]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      resetUITimeout();
    };

    const onPause = () => {
      setShowUI(true);
      if (uiTimeoutRef.current) {
        clearTimeout(uiTimeoutRef.current);
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [selectedSource]);

  useEffect(() => {
    const handleKeyDown = (e) => {
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

      const video = videoRef.current;
      if (!video) return;

      resetUITimeout();

      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          e.preventDefault();
          if (watchTogetherClient.roomCode && !isHost) break;
          if (video.paused) {
            showIndicator(Play, "Play");
            video.play().catch(() => {});
          } else {
            showIndicator(Pause, "Pause");
            video.pause();
          }
          break;

        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;

        case "arrowleft":
        case "j":
          e.preventDefault();
          if (watchTogetherClient.roomCode && !isHost) break;
          video.currentTime = Math.max(0, video.currentTime - 10);
          currentTimeRef.current = video.currentTime;
          showIndicator(ChevronLeft, "-10s");
          break;

        case "arrowright":
        case "l":
          e.preventDefault();
          if (watchTogetherClient.roomCode && !isHost) break;
          video.currentTime = Math.min(
            video.duration || 0,
            video.currentTime + 10,
          );
          currentTimeRef.current = video.currentTime;
          showIndicator(ChevronRight, "+10s");
          break;

        case "arrowup": {
          e.preventDefault();
          const nextVol = Math.min(1, video.volume + 0.1);
          video.volume = nextVol;
          if (video.muted) {
            video.muted = false;
          }
          showIndicator(Volume2, `${Math.round(nextVol * 100)}%`);
          break;
        }

        case "arrowdown": {
          e.preventDefault();
          const prevVol = Math.max(0, video.volume - 0.1);
          video.volume = prevVol;
          showIndicator(Volume2, `${Math.round(prevVol * 100)}%`);
          break;
        }

        case "m":
          e.preventDefault();
          video.muted = !video.muted;
          showIndicator(
            video.muted ? VolumeX : Volume2,
            video.muted ? "Muted" : "Unmuted",
          );
          break;

        case ">":
        case ".":
          if (e.shiftKey) {
            e.preventDefault();
            const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
            const idx = speeds.indexOf(playbackSpeed);
            if (idx !== -1 && idx < speeds.length - 1) {
              const nextSpeed = speeds[idx + 1];
              setPlaybackSpeed(nextSpeed);
              showIndicator(Settings, `${nextSpeed}x Speed`);
            }
          }
          break;

        case "<":
        case ",":
          if (e.shiftKey) {
            e.preventDefault();
            const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
            const idx = speeds.indexOf(playbackSpeed);
            if (idx > 0) {
              const nextSpeed = speeds[idx - 1];
              setPlaybackSpeed(nextSpeed);
              showIndicator(Settings, `${nextSpeed}x Speed`);
            }
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedSource, playbackSpeed]);

  useEffect(() => {
    return () => {
      if (uiTimeoutRef.current) clearTimeout(uiTimeoutRef.current);
      if (indicatorTimeoutRef.current)
        clearTimeout(indicatorTimeoutRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`player-wrapper ${!showUI ? "hide-ui" : ""}`}
      onMouseMove={resetUITimeout}
    >
      {/* Header Overlay */}
      <div className="player-controls-header u-style-96">
        <div className="u-style-97">
          {!hideExit && (
            <button onClick={onBack} className="player-back-btn">
              <ArrowLeft size={18} />
              <span>Exit Player</span>
            </button>
          )}
          <span className="player-episode-title">
            Playing Episode{" "}
            {currentEpisodeObj ? currentEpisodeObj.number : "Stream"} (
            {(subdub || "sub").toUpperCase()})
          </span>
          <span
            className={`player-header-badge ${isCurrentDownloaded ? "local" : "online"}`}
          >
            {isCurrentDownloaded ? (
              <HardDrive size={13} />
            ) : (
              <Globe size={13} />
            )}
            <span>{isCurrentDownloaded ? "Local" : "Online"}</span>
          </span>
        </div>

        <div className="u-style-27">
          {(() => {
            if (loading || !currentEpisodeObj) return null;
            let availableLangs = [];
            if (
              currentEpisodeObj.langs &&
              Array.isArray(currentEpisodeObj.langs)
            ) {
              availableLangs = currentEpisodeObj.langs;
            } else {
              if (currentEpisodeObj.lang === "both") {
                availableLangs = ["sub", "dub"];
              } else if (currentEpisodeObj.lang === "dub") {
                availableLangs = ["dub"];
              } else {
                availableLangs = ["sub"];
              }
              if (
                currentEpisodeObj.hasHsub &&
                !availableLangs.includes("hsub")
              ) {
                availableLangs = ["sub", "hsub", "dub"].filter(
                  (l) =>
                    l === "hsub" ||
                    (l === "sub" &&
                      (currentEpisodeObj.lang === "sub" ||
                        currentEpisodeObj.lang === "both")) ||
                    (l === "dub" &&
                      (currentEpisodeObj.lang === "dub" ||
                        currentEpisodeObj.lang === "both")),
                );
              }
            }

            if (availableLangs.length <= 1) return null;

            return (
              <div className="player-quality-selector">
                <span className="u-style-98">Language:</span>
                <div className="player-qualities-wrapper">
                  {availableLangs.map((langKey) => (
                    <button
                      key={langKey}
                      onClick={() => setPlayerSubDub(langKey)}
                      className={`player-quality-btn ${playerSubDub === langKey ? "active" : ""}`}
                    >
                      {(langKey || "sub").toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {!loading && sources.length > 0 && (
            <div className="player-quality-selector">
              <span className="u-style-98">Source:</span>
              <div className="player-qualities-wrapper">
                {sources.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedSource(s)}
                    className={`player-quality-btn ${selectedSource === s ? "active" : ""}`}
                  >
                    {s.quality || "Default"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main player viewport */}
      <div className="player-viewport">
        {indicator.icon && (
          <div
            className={`player-indicator-overlay ${indicator.visible ? "visible" : ""}`}
          >
            <indicator.icon size={36} />
            {indicator.text && (
              <span className="player-indicator-text">{indicator.text}</span>
            )}
          </div>
        )}
        {loading ? (
          <div className="player-status-overlay">
            <div className="player-spinner"></div>
            <p>Initializing stream buffer...</p>
          </div>
        ) : errorMsg ? (
          <div className="player-status-overlay">
            <span className="error-icon">⚠️</span>
            <p className="error-msg">{errorMsg}</p>
            <button onClick={fetchStreamData} className="player-retry-btn">
              Retry
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              controls={false}
              onDoubleClick={toggleFullscreen}
              onContextMenu={(e) => e.preventDefault()}
              className="player-video"
              crossOrigin="anonymous"
              onClick={togglePlay}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={handleTimeUpdate}
              onDurationChange={handleDurationChange}
              onVolumeChange={handleVolumeChange}
              onProgress={handleProgress}
              onEnded={handleEnded}
            >
              {processedSubtitles.map((sub, idx) => {
                const sourceKey =
                  typeof selectedSource?.url === "object"
                    ? selectedSource?.url?.url
                    : selectedSource?.url;
                return (
                  <track
                    key={`${currentEpisode}-${sourceKey || ""}-${idx}`}
                    src={sub.url || ""}
                    label={sub.lang || `Language ${idx + 1}`}
                    kind="subtitles"
                    srcLang={
                      sub.lang ? sub.lang.slice(0, 2).toLowerCase() : "en"
                    }
                    default={idx === 0}
                  />
                );
              })}
            </video>

            {/* Custom Big Play Button Overlay */}
            {!isPlaying && !loading && !errorMsg && (
              <div className="player-big-play-btn" onClick={togglePlay}>
                <Play size={28} fill="#fff" color="#fff" />
              </div>
            )}

            {/* Manual AniSkip Toast Overlay */}
            {(() => {
              if (autoSkip || skipTimes.length === 0) return null;
              const activeSkip = skipTimes.find(
                (st) =>
                  currentTime >= st.interval.start_time &&
                  currentTime < st.interval.end_time,
              );
              if (!activeSkip) return null;

              return (
                <button
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.currentTime =
                        activeSkip.interval.end_time;
                      currentTimeRef.current = activeSkip.interval.end_time;
                      setCurrentTime(activeSkip.interval.end_time);
                    }
                  }}
                  className="player-skip-button"
                >
                  <span>
                    Skip {activeSkip.skip_type === "op" ? "Opening" : "Ending"}
                  </span>
                  <ChevronRight size={14} />
                </button>
              );
            })()}

            {/* Custom Controls Bar */}
            <div
              className={`player-custom-controls ${!showUI ? "hide-ui" : ""}`}
            >
              {/* Timeline Progress Bar */}
              <div className="player-timeline-container">
                <input
                  ref={timelineRef}
                  type="range"
                  min="0"
                  max={duration || 100}
                  defaultValue={0}
                  onChange={handleTimelineChange}
                  disabled={watchTogetherClient.roomCode && !isHost}
                  className="player-timeline-slider"
                  style={{
                    "--progress-percent": `${(currentTime / (duration || 1)) * 100}%`,
                    "--buffered-percent": `${(buffered / (duration || 1)) * 100}%`,
                  }}
                />
                {duration > 0 &&
                  skipTimes.length > 0 &&
                  skipTimes.map((st, idx) => {
                    const startPct = (st.interval.start_time / duration) * 100;
                    const widthPct =
                      ((st.interval.end_time - st.interval.start_time) /
                        duration) *
                      100;
                    return (
                      <div
                        key={`skip-marker-${idx}`}
                        className="timeline-skip-marker"
                        title={
                          st.skip_type === "op" || st.skip_type === "mixed-op"
                            ? "Intro"
                            : "Outro"
                        }
                        style={{
                          position: "absolute",
                          left: `${startPct}%`,
                          width: `${widthPct}%`,
                          height: "100%",
                          top: 0,
                          backgroundColor: "rgba(59, 130, 246, 0.55)",
                          borderRadius: "2px",
                          pointerEvents: "none",
                          zIndex: 1,
                        }}
                      />
                    );
                  })}
              </div>

              {/* Controls Controls Row */}
              <div className="player-controls-row">
                <div className="player-controls-left">
                  <div className="player-time-display">
                    <span ref={timeDisplayRef}>{formatTime(currentTime)}</span>
                    <span className="player-time-divider">/</span>
                    <span className="player-duration">
                      {formatTime(duration)}
                    </span>
                  </div>
                </div>

                <div className="player-controls-right">
                  <div className="player-volume-container">
                    <button
                      onClick={toggleMute}
                      className="player-control-btn"
                      aria-label="Toggle Mute"
                    >
                      {isMuted || volume === 0 ? (
                        <VolumeX size={16} />
                      ) : (
                        <Volume2 size={16} />
                      )}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeSliderChange}
                      className="player-volume-slider"
                      style={{
                        "--volume-percent": `${(isMuted ? 0 : volume) * 100}%`,
                      }}
                    />
                  </div>

                  {/* Settings Menu Button & Popover */}
                  <div ref={settingsRef} className="player-settings-container">
                    <button
                      onClick={() => setShowSettings(!showSettings)}
                      className={`player-control-btn ${showSettings ? "active" : ""}`}
                      aria-label="Settings"
                    >
                      <Settings
                        size={16}
                        className={showSettings ? "spin-animation" : ""}
                      />
                    </button>
                    {showSettings && (
                      <div className="player-settings-menu">
                        {settingsActiveMenu === "main" && (
                          <div className="settings-menu-panel">
                            <button
                              onClick={() => setSettingsActiveMenu("speed")}
                              className="settings-menu-item"
                            >
                              <div className="settings-menu-item-left">
                                <Settings size={14} />
                                <span>Speed</span>
                              </div>
                              <div className="settings-menu-item-right">
                                <span>
                                  {playbackSpeed === 1
                                    ? "Normal"
                                    : `${playbackSpeed}x`}
                                </span>
                                <ChevronRight size={14} />
                              </div>
                            </button>

                            <button
                              onClick={() => setSettingsActiveMenu("subtitles")}
                              className="settings-menu-item"
                            >
                              <div className="settings-menu-item-left">
                                <Subtitles size={14} />
                                <span>Subtitles</span>
                              </div>
                              <div className="settings-menu-item-right">
                                <span>
                                  {selectedSubtitleIndex === -1
                                    ? "Off"
                                    : subtitles[selectedSubtitleIndex]?.lang ||
                                      `Track ${selectedSubtitleIndex + 1}`}
                                </span>
                                <ChevronRight size={14} />
                              </div>
                            </button>
                          </div>
                        )}

                        {settingsActiveMenu === "speed" && (
                          <div className="settings-menu-panel">
                            <button
                              onClick={() => setSettingsActiveMenu("main")}
                              className="settings-menu-header"
                            >
                              <ChevronLeft size={14} />
                              <span>Playback Speed</span>
                            </button>
                            <div className="settings-menu-options">
                              {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(
                                (speed) => (
                                  <button
                                    key={speed}
                                    onClick={() => {
                                      setPlaybackSpeed(speed);
                                      setSettingsActiveMenu("main");
                                      setShowSettings(false);
                                    }}
                                    className={`settings-menu-option-item ${playbackSpeed === speed ? "active" : ""}`}
                                  >
                                    <span>
                                      {speed === 1 ? "Normal" : `${speed}x`}
                                    </span>
                                    {playbackSpeed === speed && (
                                      <span className="checkmark">✓</span>
                                    )}
                                  </button>
                                ),
                              )}
                            </div>
                          </div>
                        )}

                        {settingsActiveMenu === "subtitles" && (
                          <div className="settings-menu-panel">
                            <button
                              onClick={() => setSettingsActiveMenu("main")}
                              className="settings-menu-header"
                            >
                              <ChevronLeft size={14} />
                              <span>Subtitles</span>
                            </button>
                            <div className="settings-menu-options">
                              <button
                                onClick={() => {
                                  setSelectedSubtitleIndex(-1);
                                  setSettingsActiveMenu("main");
                                  setShowSettings(false);
                                }}
                                className={`settings-menu-option-item ${selectedSubtitleIndex === -1 ? "active" : ""}`}
                              >
                                <span>Off</span>
                                {selectedSubtitleIndex === -1 && (
                                  <span className="checkmark">✓</span>
                                )}
                              </button>
                              {subtitles.map((sub, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => {
                                    setSelectedSubtitleIndex(idx);
                                    setSettingsActiveMenu("main");
                                    setShowSettings(false);
                                  }}
                                  className={`settings-menu-option-item ${selectedSubtitleIndex === idx ? "active" : ""}`}
                                >
                                  <span>{sub.lang || `Track ${idx + 1}`}</span>
                                  {selectedSubtitleIndex === idx && (
                                    <span className="checkmark">✓</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Picture-in-Picture Button */}
                  {pipSupported && (
                    <button
                      onClick={togglePiP}
                      className={`player-control-btn ${isPip ? "active" : ""}`}
                      aria-label="Toggle Picture-in-Picture"
                      title="Picture-in-Picture"
                    >
                      <PictureInPicture size={16} />
                    </button>
                  )}

                  <button
                    onClick={toggleFullscreen}
                    className="player-control-btn"
                    aria-label="Toggle Fullscreen"
                  >
                    {isFullscreen ? (
                      <Minimize size={16} />
                    ) : (
                      <Maximize size={16} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Control Navigation & Source Section */}
      <div className="player-controls-footer">
        {/* Next/Prev Navigation */}
        {!hideExit && sortedEpisodes.length > 0 && (
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
                value={currentEpisodeObj?.id || ""}
                onChange={(e) => {
                  const selected = sortedEpisodes.find(
                    (item) => item.id === e.target.value,
                  );
                  if (selected) handleJumpToEpisode(selected);
                }}
                className="player-nav-select"
              >
                {sortedEpisodes.map((item) => (
                  <option key={item.id} value={item.id}>
                    Ep {item.number}
                    {isEpDownloaded(item.number) ? " (Downloaded)" : ""}
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
