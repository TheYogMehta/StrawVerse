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

function formatSubLabel(sub) {
  return sub?.lang || sub?.label || sub?.name || "";
}

function normalizeLangCode(str) {
  if (!str) return "";
  const s = String(str).toLowerCase().trim();
  if (s === "en" || s === "eng" || s.includes("english")) return "english";
  if (s === "jp" || s === "jpn" || s.includes("japanese")) return "japanese";
  if (s === "es" || s === "spa" || s.includes("spanish")) return "spanish";
  if (s === "fr" || s === "fra" || s === "fre" || s.includes("french"))
    return "french";
  if (s === "de" || s === "deu" || s === "ger" || s.includes("german"))
    return "german";
  if (s === "it" || s === "ita" || s.includes("italian")) return "italian";
  if (s === "ru" || s === "rus" || s.includes("russian")) return "russian";
  if (
    s === "pt" ||
    s === "por" ||
    s.includes("portuguese") ||
    s.includes("brazilian")
  )
    return "portuguese";
  if (s === "zh" || s === "zho" || s === "chi" || s.includes("chinese"))
    return "chinese";
  if (s === "ar" || s === "ara" || s.includes("arabic")) return "arabic";
  return s;
}

function findBestSubtitleIndex(subs, preferredLang = "english") {
  if (!subs || !Array.isArray(subs) || subs.length === 0) return -1;
  const prefNorm = normalizeLangCode(preferredLang);
  if (prefNorm === "off" || prefNorm === "false" || prefNorm === "none")
    return -1;

  const matchLang = (sub, targetNorm) => {
    if (!sub || !targetNorm) return false;
    const l1 = normalizeLangCode(sub.lang);
    const l2 = normalizeLangCode(sub.label);
    const l3 = normalizeLangCode(sub.name);
    const l4 = normalizeLangCode(sub.url);
    return (
      (l1 && (l1 === targetNorm || l1.includes(targetNorm))) ||
      (l2 && (l2 === targetNorm || l2.includes(targetNorm))) ||
      (l3 && (l3 === targetNorm || l3.includes(targetNorm))) ||
      (l4 && (l4 === targetNorm || l4.includes(targetNorm)))
    );
  };

  if (prefNorm) {
    const idx = subs.findIndex((s) => matchLang(s, prefNorm));
    if (idx !== -1) return idx;
  }

  if (prefNorm !== "english") {
    const engIdx = subs.findIndex((s) => matchLang(s, "english"));
    if (engIdx !== -1) return engIdx;
  }

  return 0;
}

let playerSubtitlePrefCache = "english";

function getSavedSubtitlePref() {
  return playerSubtitlePrefCache || "english";
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
  MessageSquare,
  ListVideo,
  Users,
  X,
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
  // Watch together props
  isWatchTogether = false,
  roomCode = "",
  chatList = [],
  onSendChat = null,
  queue = [],
  users = [],
  hasPrivileges = false,
  onPlayFromQueue = null,
  onAddToQueue = null,
  onPlayEpisode = null,
  onCoHostChange = null,
  onClearQueue = null,
  onRemoveQueue = null,
}) {
  const videoRef = useRef(null);
  const loadedSubMapRef = useRef({});
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
  const lastZoneTapRef = useRef({ time: 0, side: null });
  const clickTimerRef = useRef(null);

  const toggleUI = () => {
    setShowUI((prev) => {
      const next = !prev;
      if (uiTimeoutRef.current) {
        clearTimeout(uiTimeoutRef.current);
      }
      if (
        next &&
        videoRef.current &&
        !videoRef.current.paused &&
        !showSettings &&
        !showWTOverlayPanel
      ) {
        uiTimeoutRef.current = setTimeout(() => {
          setShowUI(false);
        }, 3000);
      }
      return next;
    });
  };

  const handleZoneDoubleTap = (side, e) => {
    e.stopPropagation();
    const now = Date.now();
    const last = lastZoneTapRef.current;
    if (last.side === side && now - last.time < 350) {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      const video = videoRef.current;
      if (!video) return;
      if (watchTogetherClient.roomCode && !isHost) return;
      if (side === "left") {
        const nextTime = Math.max(0, video.currentTime - 10);
        video.currentTime = nextTime;
        currentTimeRef.current = nextTime;
        setCurrentTime(nextTime);
        showIndicator(ChevronLeft, "-10s");
      } else {
        const nextTime = Math.min(video.duration || 0, video.currentTime + 10);
        video.currentTime = nextTime;
        currentTimeRef.current = nextTime;
        setCurrentTime(nextTime);
        showIndicator(ChevronRight, "+10s");
      }
      lastZoneTapRef.current = { time: 0, side: null };
    } else {
      lastZoneTapRef.current = { time: now, side };
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        lastZoneTapRef.current = { time: 0, side: null };
        toggleUI();
      }, 350);
    }
  };

  const handleViewportClick = (e) => {
    if (
      e.target.closest("button") ||
      e.target.closest("input") ||
      e.target.closest("select") ||
      e.target.closest("a") ||
      e.target.closest(".player-controls-header") ||
      e.target.closest(".player-custom-controls") ||
      e.target.closest(".player-controls-footer") ||
      e.target.closest(".player-settings-dropdown") ||
      e.target.closest(".player-status-overlay") ||
      e.target.closest(".wt-overlay-panel") ||
      e.target.closest(".player-touch-zone")
    ) {
      return;
    }

    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    toggleUI();
  };

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
  const [autoSkip, setAutoSkip] = useState(true);

  const [subtitles, setSubtitles] = useState([]);
  const [processedSubtitles, setProcessedSubtitles] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [showSettings, setShowSettings] = useState(false);
  const [showWTOverlayPanel, setShowWTOverlayPanel] = useState(false);
  const [wtActiveTab, setWtActiveTab] = useState("chat");
  const [wtChatMessage, setWtChatMessage] = useState("");

  const handleWTSendChatSubmit = (e) => {
    e.preventDefault();
    if (!wtChatMessage.trim()) return;
    if (onSendChat) {
      onSendChat(wtChatMessage);
    }
    setWtChatMessage("");
  };

  const [settingsActiveMenu, setSettingsActiveMenu] = useState("main");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState(0);

  const [showUI, setShowUI] = useState(true);
  const [indicator, setIndicator] = useState({
    visible: false,
    icon: null,
    text: "",
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [buffered, setBuffered] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = isMuted;
    }
  }, [volume, isMuted, selectedSource]);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (window.sharedStateAPI && window.sharedStateAPI.getSettings) {
          const res = await window.sharedStateAPI.getSettings([
            "autoSkipIntro",
            "playerVolume",
            "playerMuted",
            "playerSubtitlePref",
            "playerSubsEnabled",
            "playerSpeed",
          ]);
          if (res?.settings?.autoSkipIntro !== undefined) {
            setAutoSkip(res.settings.autoSkipIntro);
          }
          if (res?.settings?.playerVolume !== undefined)
            setVolume(parseFloat(res.settings.playerVolume) ?? 1);
          if (res?.settings?.playerMuted !== undefined)
            setIsMuted(Boolean(res.settings.playerMuted));
          if (res?.settings?.playerSpeed !== undefined) {
            const spd = parseFloat(res.settings.playerSpeed);
            if (!isNaN(spd) && spd > 0) setPlaybackSpeed(spd);
          }
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    };
    fetchSettings();
  }, []);

  const changePlaybackSpeed = (speed) => {
    setPlaybackSpeed(speed);
    if (window.sharedStateAPI && window.sharedStateAPI.updateSetting) {
      window.sharedStateAPI.updateSetting("playerSpeed", speed);
    }
    fetch("/api/settings/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerSpeed: speed }),
    }).catch(() => {});
  };

  useEffect(() => {
    if (!subtitles || subtitles.length === 0) return;

    if (window.sharedStateAPI && window.sharedStateAPI.updateSetting) {
      if (selectedSubtitleIndex === -1) {
        window.sharedStateAPI.updateSetting("playerSubsEnabled", false);
        window.sharedStateAPI.updateSetting("playerSubtitlePref", "off");
      } else {
        window.sharedStateAPI.updateSetting("playerSubsEnabled", true);
        const activeSub = subtitles[selectedSubtitleIndex];
        if (activeSub) {
          const lang = normalizeLangCode(
            activeSub.lang || activeSub.label || activeSub.name || "english",
          );
          if (lang) {
            window.sharedStateAPI.updateSetting("playerSubtitlePref", lang);
          }
        }
      }
    }
  }, [selectedSubtitleIndex, subtitles]);

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
    if (window.sharedStateAPI && window.sharedStateAPI.updateSetting) {
      window.sharedStateAPI.updateSetting("playerVolume", val);
      window.sharedStateAPI.updateSetting("playerMuted", val === 0);
    }
    const video = videoRef.current;
    if (video) {
      video.volume = val;
      video.muted = val === 0;
    }
    setIsMuted(val === 0);
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
            ct >= st.interval.start_time - 0.2 &&
            ct < st.interval.end_time - 0.5,
        );
        if (match) {
          const targetTime = match.interval.end_time + 0.5;
          videoRef.current.currentTime = targetTime;
          currentTimeRef.current = targetTime;
          setCurrentTime(targetTime);
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
      if (window.sharedStateAPI && window.sharedStateAPI.updateSetting) {
        window.sharedStateAPI.updateSetting(
          "playerVolume",
          videoRef.current.volume,
        );
        window.sharedStateAPI.updateSetting(
          "playerMuted",
          videoRef.current.muted,
        );
      }
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
    if (showSettings || showWTOverlayPanel) {
      return;
    }
    if (videoRef.current && !videoRef.current.paused) {
      uiTimeoutRef.current = setTimeout(() => {
        setShowUI(false);
      }, 3000);
    }
  };

  useEffect(() => {
    resetUITimeout();
  }, [showSettings, showWTOverlayPanel]);

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
    if (Array.isArray(downloadedEpisodes)) {
      return downloadedEpisodes.map(Number).includes(Number(num));
    }
    const subList = downloadedEpisodes.sub || [];
    const dubList = downloadedEpisodes.dub || [];
    return currentLang === "dub"
      ? dubList.map(Number).includes(Number(num))
      : subList.map(Number).includes(Number(num));
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
        window.refreshInfoViewProgress?.();
        window.refreshCatalogHistory?.();
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
              epNum: targetEpNum,
              animeId: id,
              Downloaded: false,
              subdub: playerSubDub,
              provider: provider,
            },
        { signal },
      );

      if (signal?.aborted) return;

      let rawSources = [];
      if (
        playerSubDub &&
        Array.isArray(data?.[playerSubDub]?.sources) &&
        data[playerSubDub].sources.length > 0
      ) {
        rawSources = data[playerSubDub].sources;
      } else if (
        playerSubDub &&
        Array.isArray(data?.[playerSubDub]) &&
        data[playerSubDub].length > 0
      ) {
        rawSources = data[playerSubDub];
      } else {
        const subSrcs = Array.isArray(data?.sub?.sources)
          ? data.sub.sources
          : Array.isArray(data?.sub)
            ? data.sub
            : [];
        const dubSrcs = Array.isArray(data?.dub?.sources)
          ? data.dub.sources
          : Array.isArray(data?.dub)
            ? data.dub
            : [];
        const hsubSrcs = Array.isArray(data?.hsub?.sources)
          ? data.hsub.sources
          : Array.isArray(data?.hsub)
            ? data.hsub
            : [];
        const baseSrcs = Array.isArray(data?.sources) ? data.sources : [];

        rawSources = [...baseSrcs, ...subSrcs, ...dubSrcs, ...hsubSrcs];
      }

      const isHSub = (s) =>
        s.isHsub ||
        s.type === "hsub" ||
        s.quality?.toLowerCase().includes("hsub");
      const isDub = (s) =>
        s.isDub || s.type === "dub" || s.quality?.toLowerCase().includes("dub");

      let fetchedSources = rawSources;
      if (playerSubDub === "sub") {
        const cleanSub = rawSources.filter((s) => !isHSub(s) && !isDub(s));
        if (cleanSub.length > 0) fetchedSources = cleanSub;
      } else if (playerSubDub === "hsub") {
        const cleanHsub = rawSources.filter((s) => isHSub(s));
        if (cleanHsub.length > 0) fetchedSources = cleanHsub;
      } else if (playerSubDub === "dub") {
        const cleanDub = rawSources.filter((s) => isDub(s));
        if (cleanDub.length > 0) fetchedSources = cleanDub;
      }

      let fetchedSubs = [];
      if (playerSubDub !== "hsub") {
        fetchedSubs = [
          ...(Array.isArray(data?.subtitles) ? data.subtitles : []),
          ...(Array.isArray(data?.[playerSubDub]?.subtitles)
            ? data[playerSubDub].subtitles
            : []),
          ...(Array.isArray(data?.sub?.subtitles) ? data.sub.subtitles : []),
          ...(Array.isArray(data?.dub?.subtitles) ? data.dub.subtitles : []),
        ];
      }
      fetchedSubs = Array.from(
        new Map(fetchedSubs.map((s) => [s.url, s])).values(),
      ).map((s, idx) => ({
        ...s,
        lang: formatSubLabel(s, idx),
        label: formatSubLabel(s, idx),
      }));
      let fetchedSkipTimes = data?.skipTimes || [];

      setSources(fetchedSources);
      setSubtitles(fetchedSubs);
      if (fetchedSubs && fetchedSubs.length > 0) {
        const pref = getSavedSubtitlePref();
        const bestIdx = findBestSubtitleIndex(fetchedSubs, pref);
        setSelectedSubtitleIndex(bestIdx);
      } else {
        setSelectedSubtitleIndex(-1);
      }
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
    return () => {
      Object.values(loadedSubMapRef.current).forEach((url) => {
        if (url && url.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(url);
          } catch (e) {}
        }
      });
      loadedSubMapRef.current = {};
    };
  }, [subtitles]);

  useEffect(() => {
    let cancelled = false;
    const fetchSelectedSubtitle = async () => {
      if (
        !subtitles ||
        subtitles.length === 0 ||
        playerSubDub === "hsub" ||
        selectedSubtitleIndex < 0 ||
        selectedSubtitleIndex >= subtitles.length
      ) {
        setProcessedSubtitles([]);
        return;
      }

      const sub = subtitles[selectedSubtitleIndex];
      if (!sub || !sub.url) {
        setProcessedSubtitles([]);
        return;
      }

      if (sub.url.startsWith("blob:") || loadedSubMapRef.current[sub.url]) {
        const blobUrl = sub.url.startsWith("blob:")
          ? sub.url
          : loadedSubMapRef.current[sub.url];
        if (!cancelled) {
          setProcessedSubtitles([{ ...sub, url: blobUrl }]);
        }
        return;
      }

      try {
        const reqHeaders = {};
        if (selectedSource?.headers) {
          Object.assign(reqHeaders, selectedSource.headers);
        }
        if (sub.headers) {
          Object.assign(reqHeaders, sub.headers);
        }
        if (sub.referer) {
          reqHeaders["Referer"] = sub.referer;
        }

        const res = await fetch(sub.url, { headers: reqHeaders });
        if (!res.ok) return;

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
        loadedSubMapRef.current[sub.url] = blobUrl;

        if (!cancelled) {
          setProcessedSubtitles([{ ...sub, url: blobUrl }]);
        }
      } catch (err) {
        console.warn(`Failed to fetch subtitle: ${sub.url}`, err.message);
      }
    };

    fetchSelectedSubtitle();

    return () => {
      cancelled = true;
    };
  }, [subtitles, selectedSubtitleIndex, selectedSource, playerSubDub]);

  useEffect(() => {
    if (!selectedSource) return;

    if (window.Capacitor?.Plugins?.CloudflareBypass && !isWatchTogether) {
      const url = sourceUrl;
      const subtitleList = subtitles || [];
      const sourcesList = sources.map((src, idx) => ({
        url: typeof src.url === "string" ? src.url : src.url?.url || "",
        quality: src.quality || `Source ${idx + 1}`,
        headers: src.headers || {},
        isM3U8: !!src.isM3U8,
      }));
      const skipsList = skipTimes || [];
      const currentSourceIdx = sources.findIndex(
        (src) => src === selectedSource,
      );

      console.log(
        "[NATIVE VIDEO PLAYBACK] Launching native PlayerActivity with parameters",
      );
      window.Capacitor.Plugins.CloudflareBypass.playVideo({
        url,
        animeTitle: animeTitle || "Anime Stream",
        subtitles: subtitleList,
        sources: sourcesList,
        skipTimes: skipsList,
        currentSourceIndex: currentSourceIdx >= 0 ? currentSourceIdx : 0,
        animeId: id,
        episodeNumber: currentEpisodeObj ? currentEpisodeObj.number : 1,
        provider: provider || "",
        image: image || "",
        malid: String(malid || ""),
      })
        .then(() => {
          if (onBack) onBack();
        })
        .catch((err) => {
          console.error(
            "[NATIVE VIDEO PLAYBACK] Failed to launch native player:",
            err,
          );
        });
    }
  }, [selectedSource, sourceUrl]);

  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch (e) {}
        hlsRef.current = null;
      }
      if (videoRef.current) {
        try {
          const video = videoRef.current;
          video.pause();
          video.removeAttribute("src");
          video.load();
        } catch (e) {}
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
      const pref = getSavedSubtitlePref();
      const bestIdx = findBestSubtitleIndex(subtitles, pref);
      setSelectedSubtitleIndex(bestIdx);
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
              changePlaybackSpeed(nextSpeed);
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
              changePlaybackSpeed(nextSpeed);
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
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch (e) {}
        hlsRef.current = null;
      }
      if (videoRef.current) {
        try {
          videoRef.current.pause();
          videoRef.current.removeAttribute("src");
          videoRef.current.load();
        } catch (e) {}
      }
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
            let availableLangs =
              currentEpisodeObj.langs &&
              Array.isArray(currentEpisodeObj.langs) &&
              currentEpisodeObj.langs.length > 0
                ? currentEpisodeObj.langs
                : ["sub"];

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
              <span className="u-style-98">
                {sources.some((s) => {
                  const q = String(s?.quality || "").toLowerCase();
                  return (
                    !/^\d+p$/.test(q) && !/^auto$/.test(q) && !/\d+p/.test(q)
                  );
                })
                  ? "Servers:"
                  : "Quality:"}
              </span>
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
      <div className="player-viewport" onClick={handleViewportClick}>
        {/* Double tap / click 10s seek target zones (left & right) */}
        <div
          className="player-touch-zone left"
          onClick={(e) => handleZoneDoubleTap("left", e)}
        />
        <div
          className="player-touch-zone right"
          onClick={(e) => handleZoneDoubleTap("right", e)}
        />

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
                    const isOp =
                      st.skip_type === "op" || st.skip_type === "mixed-op";
                    return (
                      <div
                        key={`skip-marker-${idx}`}
                        className="timeline-skip-marker"
                        title={isOp ? "Intro" : "Outro"}
                        style={{
                          position: "absolute",
                          left: `${startPct}%`,
                          width: `${widthPct}%`,
                          height: "100%",
                          top: 0,
                          backgroundColor: isOp
                            ? "rgba(245, 158, 11, 0.85)"
                            : "rgba(168, 85, 247, 0.85)",
                          borderRadius: "2px",
                          pointerEvents: "none",
                          zIndex: 3,
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
                                      changePlaybackSpeed(speed);
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
                      </div>
                    )}
                  </div>

                  {isWatchTogether && (
                    <button
                      onClick={() => setShowWTOverlayPanel(!showWTOverlayPanel)}
                      className={`player-control-btn ${showWTOverlayPanel ? "active" : ""}`}
                      title="Watch Together Menu"
                      aria-label="Watch Together Menu"
                    >
                      <Users size={16} />
                    </button>
                  )}

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
            {/* Watch Together Panel Overlay */}
            {isWatchTogether && showWTOverlayPanel && (
              <div className="player-wt-panel">
                {/* Panel Tabs */}
                <div className="player-wt-tabs">
                  <button
                    className={`player-wt-tab-btn ${wtActiveTab === "chat" ? "active" : ""}`}
                    onClick={() => setWtActiveTab("chat")}
                  >
                    <MessageSquare size={14} />
                    <span>Chat</span>
                  </button>
                  <button
                    className={`player-wt-tab-btn ${wtActiveTab === "queue" ? "active" : ""}`}
                    onClick={() => setWtActiveTab("queue")}
                  >
                    <ListVideo size={14} />
                    <span>Queue</span>
                  </button>
                  <button
                    className={`player-wt-tab-btn ${wtActiveTab === "users" ? "active" : ""}`}
                    onClick={() => setWtActiveTab("users")}
                  >
                    <Users size={14} />
                    <span>Users</span>
                  </button>
                  <button
                    className={`player-wt-tab-btn ${wtActiveTab === "episodes" ? "active" : ""}`}
                    onClick={() => setWtActiveTab("episodes")}
                  >
                    <Play size={14} />
                    <span>Episodes</span>
                  </button>
                  <button
                    className="player-wt-close-btn"
                    onClick={() => setShowWTOverlayPanel(false)}
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Panel Body */}
                <div className="player-wt-tab-content">
                  {wtActiveTab === "chat" ? (
                    <div className="player-wt-chat-container">
                      <div className="player-wt-chat-messages">
                        {chatList.length === 0 ? (
                          <div className="player-wt-empty">
                            No messages yet.
                          </div>
                        ) : (
                          chatList.map((m, idx) => (
                            <div key={idx} className="player-wt-chat-msg">
                              <span className="player-wt-chat-sender">
                                {m.sender}:
                              </span>
                              <span className="player-wt-chat-text">
                                {m.message}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                      <form
                        className="player-wt-chat-input-row"
                        onSubmit={handleWTSendChatSubmit}
                      >
                        <input
                          type="text"
                          className="player-wt-chat-input"
                          placeholder="Type a message..."
                          value={wtChatMessage}
                          onChange={(e) => setWtChatMessage(e.target.value)}
                        />
                        <button type="submit" className="player-wt-send-btn">
                          Send
                        </button>
                      </form>
                    </div>
                  ) : wtActiveTab === "queue" ? (
                    <div className="player-wt-queue-container">
                      <div className="player-wt-queue-header">
                        <span>Watch Queue</span>
                        {hasPrivileges && queue.length > 0 && (
                          <button
                            onClick={onClearQueue}
                            className="player-wt-action-btn-sm"
                          >
                            Clear All
                          </button>
                        )}
                      </div>
                      <div className="player-wt-list">
                        {queue.length === 0 ? (
                          <div className="player-wt-empty">Queue is empty.</div>
                        ) : (
                          queue.map((item, idx) => (
                            <div key={idx} className="player-wt-item-row">
                              <span className="player-wt-item-idx">
                                #{idx + 1}
                              </span>
                              <span
                                className="player-wt-item-name"
                                title={item.title || `Ep ${item.episode}`}
                              >
                                {item.title || `Ep ${item.episode}`}
                              </span>
                              {hasPrivileges && (
                                <div className="player-wt-item-actions">
                                  <button
                                    className="player-wt-item-btn play"
                                    onClick={() => {
                                      if (onPlayFromQueue)
                                        onPlayFromQueue(item);
                                    }}
                                  >
                                    <Play size={10} />
                                  </button>
                                  <button
                                    className="player-wt-item-btn delete"
                                    onClick={() => {
                                      if (onRemoveQueue) onRemoveQueue(idx);
                                    }}
                                  >
                                    <X size={10} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : wtActiveTab === "users" ? (
                    <div className="player-wt-users-container">
                      <div className="player-wt-list">
                        {users.map((u, idx) => (
                          <div key={idx} className="player-wt-item-row">
                            <span className="player-wt-item-name">
                              {u.username}
                            </span>
                            <div className="player-wt-user-badges">
                              {u.isHost && (
                                <span className="player-wt-badge-host">
                                  HOST
                                </span>
                              )}
                              {u.isCoHost && (
                                <span className="player-wt-badge-cohost">
                                  CO-HOST
                                </span>
                              )}
                            </div>
                            {isHost && u.id !== watchTogetherClient.userID && (
                              <button
                                className="player-wt-cohost-btn"
                                onClick={() => {
                                  if (onCoHostChange)
                                    onCoHostChange(u.id, !u.isCoHost);
                                }}
                              >
                                {u.isCoHost ? "Demote" : "Co-Host"}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    /* Episodes Tab */
                    <div className="player-wt-episodes-container">
                      <div className="player-wt-list grid">
                        {episodesList.map((ep, idx) => {
                          const isCurrent =
                            ep.number === currentEpisode ||
                            ep.id === currentEpisode;
                          return (
                            <button
                              key={idx}
                              className={`player-wt-ep-card ${isCurrent ? "active" : ""}`}
                              onClick={() => {
                                if (onPlayEpisode) onPlayEpisode(ep);
                              }}
                            >
                              <span className="ep-num">
                                Ep {ep.number || idx + 1}
                              </span>
                              {ep.title && (
                                <span className="ep-title" title={ep.title}>
                                  {ep.title}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
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
