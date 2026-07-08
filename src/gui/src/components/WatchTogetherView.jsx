import { useState, useEffect, useRef, useMemo } from "react";
import watchTogetherClient from "../utils/watchTogetherClient";
import VideoPlayer from "./VideoPlayer";
import Swal from "sweetalert2";
import "./css/WatchTogetherView.css";
import {
  Users,
  Copy,
  Check,
  Radio,
  Search,
  AlertTriangle,
  Play,
  LogOut,
  X,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Plus,
  ArrowUpDown,
  ListVideo,
} from "lucide-react";

export default function WatchTogetherView({ onNavigate }) {
  const [username, setUsername] = useState("");
  const [malLoggedIn, setMalLoggedIn] = useState(null); // null = loading, false = locked, true = accessible
  const [roomCode, setRoomCode] = useState(watchTogetherClient.roomCode);
  const [isHost, setIsHost] = useState(watchTogetherClient.isHost);
  const [users, setUsers] = useState(watchTogetherClient.users);
  const [queue, setQueue] = useState(watchTogetherClient.queue);
  const [hostProvider, setHostProvider] = useState(
    watchTogetherClient.hostProvider || "",
  );
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [chatMessage, setChatMessage] = useState("");
  const [chatList, setChatList] = useState(watchTogetherClient.messages || []);
  const [joinInput, setJoinInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [rangeValue, setRangeValue] = useState("");

  const [isChatExpanded, setIsChatExpanded] = useState(true);
  const [expandedSearchItem, setExpandedSearchItem] = useState(null);
  const [searchDropdownVisible, setSearchDropdownVisible] = useState(false);

  const [lastReadCount, setLastReadCount] = useState(0);

  useEffect(() => {
    if (isChatExpanded) {
      setLastReadCount(chatList.length);
    }
  }, [chatList.length, isChatExpanded]);

  const unreadCount = isChatExpanded ? 0 : chatList.length - lastReadCount;


  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  const [activeMedia, setActiveMedia] = useState(null);
  const [selectedAnime, setSelectedAnime] = useState(null);
  const [selectedAnimeDetails, setSelectedAnimeDetails] = useState(null);
  const [isSynopsisCollapsed, setIsSynopsisCollapsed] = useState(false);
  const [animeEpisodes, setAnimeEpisodes] = useState([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  const [episodeSearchQuery, setEpisodeSearchQuery] = useState("");
  const [dubSelect, setDubSelect] = useState("sub");
  const [sortOrder, setSortOrder] = useState("asc");

  const filteredEpisodes = useMemo(() => {
    let list = [...animeEpisodes];
    if (dubSelect === "dub") {
      list = list.filter((ep) => ep.lang === "dub" || ep.hasDub || ep.isDub);
    } else if (dubSelect === "sub") {
      list = list.filter((ep) => ep.lang !== "dub");
    }
    if (episodeSearchQuery.trim()) {
      const q = episodeSearchQuery.toLowerCase().trim();
      list = list.filter(
        (ep) =>
          String(ep.number || ep.id).includes(q) ||
          (ep.title && ep.title.toLowerCase().includes(q)),
      );
    }
    if (sortOrder === "desc") {
      list.reverse();
    }
    return list;
  }, [animeEpisodes, dubSelect, episodeSearchQuery, sortOrder]);

  const chatEndRef = useRef(null);

  useEffect(() => {
    // 1. Fetch settings to get MAL login status
    fetch("/api/settings")
      .then((res) => res.json())
      .then((settingsData) => {
        const loggedIn = settingsData.MalLoggedIn || false;
        setMalLoggedIn(loggedIn);
        if (loggedIn && settingsData.malUsername) {
          setUsername(settingsData.malUsername);
        }
      })
      .catch((err) => {
        console.error("Failed to load settings:", err);
        setMalLoggedIn(false);
      });

    // 2. Fetch providers
    fetch("/api/providers")
      .then((res) => res.json())
      .then((data) => {
        let animeList = [];
        if (Array.isArray(data.Anime)) {
          animeList = data.Anime.map((p) =>
            typeof p === "string" ? p : p.name,
          );
        } else if (data.providers?.Anime) {
          animeList = data.providers.Anime.map((p) =>
            typeof p === "string" ? p : p.name,
          );
        }
        setProviders(animeList);
        if (animeList.length > 0) {
          setSelectedProvider(animeList[0]);
        }
      })
      .catch((err) => console.error("Failed to load providers:", err));
  }, []);

  useEffect(() => {
    const handleRoomJoined = (data) => {
      setRoomCode(data.roomCode);
      setIsHost(data.isHost);
      if (data.hostProvider) setHostProvider(data.hostProvider);
      setUsers(watchTogetherClient.users);
      setErrorMsg("");
    };

    const handleUsersChanged = (userList) => {
      setUsers(userList);
    };

    const handleChat = (msg) => {
      setChatList([...watchTogetherClient.messages]);
    };

    const handleQueue = (q) => {
      setQueue([...q]);
    };

    const handleLoadMedia = ({ providerID, animeID, episode }) => {
      console.log("[Remote LoadMedia]", providerID, animeID, episode);
      if (episode === 0) {
        setActiveMedia(null);
        return;
      }
      const epIdentifier = String(episode);

      let matchedQueueTitle = "";
      if (watchTogetherClient.queue && watchTogetherClient.queue.length > 0) {
        const qItem = watchTogetherClient.queue.find(
          (item) => Number(item.episode) === Number(episode),
        );
        if (qItem && qItem.title) {
          const parts = qItem.title.split(" - Ep ");
          if (parts.length > 0) {
            matchedQueueTitle = parts[0];
          }
        }
      }

      const isMatch =
        selectedAnime &&
        (!matchedQueueTitle ||
          selectedAnime.title
            .toLowerCase()
            .includes(matchedQueueTitle.toLowerCase()) ||
          matchedQueueTitle
            .toLowerCase()
            .includes(selectedAnime.title.toLowerCase()));

      setActiveMedia((prev) => {
        const titleToUse = isMatch 
          ? selectedAnime.title 
          : (matchedQueueTitle || (prev?.animeTitle && prev.animeTitle !== "Watch Together Session" ? prev.animeTitle : "Watch Together Session"));
        const imageToUse = isMatch 
          ? selectedAnime.image 
          : (prev?.image || "");
        const idToUse = isMatch 
          ? selectedAnime.id 
          : String(animeID);
        const epListToUse = isMatch && animeEpisodes.length > 0 
          ? animeEpisodes 
          : (prev?.episodesList || [{ id: epIdentifier, number: episode }]);

        if (!prev) {
          return {
            id: idToUse,
            ep: epIdentifier,
            animeTitle: titleToUse,
            provider: selectedProvider || "anikoto",
            image: imageToUse,
            episodesList: epListToUse,
          };
        }
        return {
          ...prev,
          id: idToUse,
          ep: epIdentifier,
          animeTitle: titleToUse,
          image: imageToUse,
          episodesList: epListToUse,
        };
      });
    };

    const handleError = (err) => {
      setErrorMsg(err.message || "An error occurred");
    };

    const handleDisconnected = () => {
      setRoomCode(null);
      setIsHost(false);
      setUsers([]);
      setHostProvider("");
      setActiveMedia(null);
      setQueue([]);
      setChatList([]);
      setSearchQuery("");
      setSearchResults([]);
      setEpisodeSearchQuery("");
      setSelectedAnime(null);
      setSelectedAnimeDetails(null);
      setAnimeEpisodes([]);
      setRangeValue("");
    };

    watchTogetherClient.on("roomJoined", handleRoomJoined);
    watchTogetherClient.on("usersChanged", handleUsersChanged);
    watchTogetherClient.on("chatMessage", handleChat);
    watchTogetherClient.on("queueUpdated", handleQueue);
    watchTogetherClient.on("loadMedia", handleLoadMedia);
    watchTogetherClient.on("error", handleError);
    watchTogetherClient.on("disconnected", handleDisconnected);

    return () => {
      watchTogetherClient.off("roomJoined", handleRoomJoined);
      watchTogetherClient.off("usersChanged", handleUsersChanged);
      watchTogetherClient.off("chatMessage", handleChat);
      watchTogetherClient.off("queueUpdated", handleQueue);
      watchTogetherClient.off("loadMedia", handleLoadMedia);
      watchTogetherClient.off("error", handleError);
      watchTogetherClient.off("disconnected", handleDisconnected);
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatList]);

  const handleSearchSubmit = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim() || !selectedProvider) return;
    setIsSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch(
        `/api/list/Anime/${encodeURIComponent(selectedProvider)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            page: 1,
            keyword: searchQuery.trim(),
            filters: {},
          }),
        },
      );
      const data = await res.json();
      setSearchResults(data.results || []);
      setSearchDropdownVisible(true);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectAnime = async (item) => {
    setSelectedAnime(item);
    setSelectedAnimeDetails(null);
    setLoadingEpisodes(true);
    setAnimeEpisodes([]);
    setSearchDropdownVisible(false);
    try {
      const resInfo = await fetch(
        `/api/info/Anime/${encodeURIComponent(selectedProvider)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: item.id,
            type: "Anime",
            provider: selectedProvider,
          }),
        },
      );
      const infoData = await resInfo.json();
      setSelectedAnimeDetails(infoData);

      const targetId = infoData?.dataId || item.id;
      const resEp = await fetch("/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: targetId,
          page: 1,
          provider: selectedProvider,
        }),
      });
      const epData = await resEp.json();
      const episodesList = epData?.episodes || infoData?.episodes || [];
      setAnimeEpisodes(episodesList);

      if (episodesList.length > 0 && !activeMedia && queue.length === 0) {
        const sorted = [...episodesList].sort((a, b) => {
          const aNum = typeof a.number === "number" ? a.number : parseFloat(a.number) || 0;
          const bNum = typeof b.number === "number" ? b.number : parseFloat(b.number) || 0;
          return aNum - bNum;
        });
        const firstEp = sorted[0];
        if (firstEp) {
          const epNum = typeof firstEp.number === "number" ? firstEp.number : parseFloat(firstEp.number) || 1;
          const mediaObj = {
            id: item.id,
            ep: firstEp.id || firstEp.number || 1,
            animeTitle: item.title,
            provider: selectedProvider,
            image: item.image,
            episodesList: episodesList,
          };
          setActiveMedia(mediaObj);
          if (watchTogetherClient.roomCode) {
            watchTogetherClient.sendLoadMedia(1, 100, epNum);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch info or episodes:", err);
    } finally {
      setLoadingEpisodes(false);
    }
  };

  const handlePlayEpisode = (epItem) => {
    const epNum =
      typeof epItem.number === "number"
        ? epItem.number
        : parseFloat(epItem.number) || 1;
    const mediaObj = {
      id: selectedAnime?.id || "100",
      ep: epItem.id || epItem.number || 1,
      animeTitle: selectedAnime?.title || "Watch Together Session",
      provider: selectedProvider || "anikoto",
      image: selectedAnime?.image || "",
      episodesList: animeEpisodes.length > 0 ? animeEpisodes : [epItem],
    };
    setActiveMedia(mediaObj);
    if (roomCode) {
      watchTogetherClient.sendLoadMedia(1, 100, epNum);
    }
  };

  const handlePlayFromQueue = (queueItem) => {
    const epNum = Number(queueItem.episode) || 1;
    const match = animeEpisodes.find((ep) => Number(ep.number) === epNum);
    if (match) {
      handlePlayEpisode(match);
    } else {
      let parsedTitle = "Watch Together Session";
      if (queueItem.title) {
        const parts = queueItem.title.split(" - Ep ");
        if (parts.length > 0) {
          parsedTitle = parts[0];
        }
      }
      handlePlayEpisode({
        id: String(epNum),
        number: epNum,
        title: queueItem.title || `${parsedTitle} - Ep ${epNum}`,
      });
    }
  };

    const handleSkipEpisode = () => {
    if (queue.length > 0) {
      const nextItem = queue[0];
      handlePlayFromQueue(nextItem);
      watchTogetherClient.sendRemoveQueue(0);
    } else {
      // Auto queue next episode if possible
      if (activeMedia && activeMedia.episodesList) {
        const currentEpNum = parseFloat(activeMedia.ep);
        const sorted = [...activeMedia.episodesList].sort((a, b) => {
          const aNum = parseFloat(a.number) || 0;
          const bNum = parseFloat(b.number) || 0;
          return aNum - bNum;
        });
        const currentIdx = sorted.findIndex(e => parseFloat(e.number) === currentEpNum);
        if (currentIdx !== -1 && currentIdx + 1 < sorted.length) {
          const nextEp = sorted[currentIdx + 1];
          handlePlayEpisode(nextEp);
          return;
        }
      }
      setActiveMedia(null);
      if (roomCode) {
        watchTogetherClient.sendLoadMedia(0, 0, 0);
      }
    }
  };

  const handleAddToQueue = (epItem) => {
    const epNum =
      typeof epItem.number === "number"
        ? epItem.number
        : parseFloat(epItem.number) || 1;
    const title = `${selectedAnime?.title || "Anime"} - Ep ${epNum}`;
    watchTogetherClient.sendAddQueue(1, 100, epNum, title);
  };

  const handleQueueRange = (limit) => {
    if (!filteredEpisodes || filteredEpisodes.length === 0) return;
    const sorted = [...filteredEpisodes].sort((a, b) => {
      const aNum =
        typeof a.number === "number" ? a.number : parseFloat(a.number) || 0;
      const bNum =
        typeof b.number === "number" ? b.number : parseFloat(b.number) || 0;
      return aNum - bNum;
    });

    if (limit === "all") {
      for (const epItem of sorted) {
        const epNum =
          typeof epItem.number === "number"
            ? epItem.number
            : parseFloat(epItem.number) || 1;
        const title = `${selectedAnime?.title || "Anime"} - Ep ${epNum}`;
        watchTogetherClient.sendAddQueue(1, 100, epNum, title);
      }
      return;
    }

    const cleaned = String(limit).trim().toLowerCase();
    let start = 1;
    let end = 1;

    const rangeMatch = cleaned.match(/^(\d+)\s*(?:-|to)\s*(\d+)$/);
    if (rangeMatch) {
      start = parseInt(rangeMatch[1]);
      end = parseInt(rangeMatch[2]);
    } else {
      const singleMatch = cleaned.match(/^(\d+)$/);
      if (singleMatch) {
        start = 1;
        end = parseInt(singleMatch[1]);
      } else {
        Swal.fire({
          title: "Invalid Range",
          text: "Invalid range format. Please use e.g. '1-50', '1 to 50', or '50'.",
          icon: "error",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
        });
        return;
      }
    }

    const minVal = Math.min(start, end);
    const maxVal = Math.max(start, end);

    const toQueue = sorted.filter((ep) => {
      const num =
        typeof ep.number === "number" ? ep.number : parseFloat(ep.number);
      return !isNaN(num) && num >= minVal && num <= maxVal;
    });

    for (const epItem of toQueue) {
      const epNum =
        typeof epItem.number === "number"
          ? epItem.number
          : parseFloat(epItem.number) || 1;
      const title = `${selectedAnime?.title || "Anime"} - Ep ${epNum}`;
      watchTogetherClient.sendAddQueue(1, 100, epNum, title);
    }
  };

  const handleAddToQueueFromDropdown = (animeItem, epItem) => {
    const epNum = parseFloat(epItem.number) || 1;
    const title = `${animeItem.title} - Ep ${epNum}`;
    watchTogetherClient.sendAddQueue(1, 100, epNum, title);
  };

  const handlePlayFromDropdown = (animeItem, epItem) => {
    const epNum = parseFloat(epItem.number) || 1;
    // Persist the selected anime so title/image remain correct after skip/auto-queue
    setSelectedAnime(animeItem);
    const mediaObj = {
      id: animeItem.id,
      ep: epItem.id || epItem.number || 1,
      animeTitle: animeItem.title,
      provider: selectedProvider,
      image: animeItem.image,
      episodesList: animeEpisodes.length > 0 ? animeEpisodes : [epItem],
    };
    setActiveMedia(mediaObj);
    if (roomCode) {
      watchTogetherClient.sendLoadMedia(1, 100, epNum);
    }
  };

  const handleClearQueue = () => {
    const len = queue.length;
    for (let i = 0; i < len; i++) {
      watchTogetherClient.sendRemoveQueue(0);
    }
  };

  const handleCreateRoom = async () => {
    try {
      setErrorMsg("");
      await watchTogetherClient.createRoom(username, selectedProvider);
    } catch (err) {
      setErrorMsg("Failed to connect to server");
    }
  };

  const handleJoinRoom = async () => {
    if (!joinInput.trim()) return;
    try {
      setErrorMsg("");
      await watchTogetherClient.joinRoom(
        joinInput.trim(),
        username,
        selectedProvider,
      );
    } catch (err) {
      setErrorMsg("Failed to join room");
    }
  };

  const handleCopyCode = () => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSendChat = (e) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    watchTogetherClient.sendChatMessage(chatMessage);
    setChatMessage("");
  };

  useEffect(() => {
    if (hostProvider && providers.length > 0) {
      const matchedProvider = providers.find(
        (p) => p.toLowerCase() === hostProvider.toLowerCase(),
      );
      if (matchedProvider) {
        setSelectedProvider(matchedProvider);
      }
    }
  }, [hostProvider, providers]);

  const isExtensionMismatch =
    !isHost &&
    hostProvider &&
    selectedProvider &&
    hostProvider.toLowerCase() !== selectedProvider.toLowerCase();

  const isLocalCoHost = users.some(
    (u) => u.id === watchTogetherClient.userID && u.isCoHost,
  );
  const hasPrivileges = isHost || isLocalCoHost;

  useEffect(() => {
    if (hasPrivileges && !activeMedia && queue.length > 0) {
      const nextItem = queue[0];
      handlePlayFromQueue(nextItem);
      watchTogetherClient.sendRemoveQueue(0);
    }
  }, [queue, activeMedia, hasPrivileges]);

  useEffect(() => {
    if (selectedAnime && selectedAnimeDetails && selectedProvider) {
      if (
        selectedAnimeDetails.provider !== selectedProvider &&
        !selectedAnimeDetails.error
      ) {
        const linked = selectedAnimeDetails.linkedProviders?.find(
          (p) => p.provider === selectedProvider,
        );
        if (linked) {
          handleSelectAnime({
            id: linked.id,
            title: selectedAnime.title,
            image: selectedAnime.image,
          });
        } else {
          setAnimeEpisodes([]);
          setSelectedAnimeDetails({
            provider: selectedAnimeDetails.provider,
            error: "Not Found",
            message: `This anime is not mapped or linked to the selected provider "${selectedProvider}".`,
          });
        }
      }
    }
  }, [selectedProvider]);

  if (malLoggedIn === null) {
    return (
      <div className="wt-landing-container">
        <div style={{ color: "#a78bfa", fontSize: "1rem", fontWeight: "600" }}>
          Loading settings...
        </div>
      </div>
    );
  }

  if (!malLoggedIn) {
    return (
      <div className="wt-landing-container">
        <div className="wt-minimal-lock">
          <AlertTriangle size={36} color="#f87171" style={{ opacity: 0.8 }} />
          <h2>MyAnimeList Connection Required</h2>
          <p>
            To use Watch Together, please connect your MyAnimeList account in
            Settings first.
          </p>
          <button
            className="wt-minimal-btn"
            onClick={() =>
              onNavigate && onNavigate("settings", { tab: "anime_manga" })
            }
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  if (!roomCode) {
    return (
      <div className="wt-landing-container">
        <div className="wt-landing-card">
          <div className="wt-landing-header">
            <Radio size={52} className="wt-landing-logo" />
            <h2>Watch Together</h2>
            <p>
              Synchronized anime playback, real-time chat, and shared watch
              queues with your friends.
            </p>
          </div>

          {errorMsg && <div className="wt-error-banner">{errorMsg}</div>}

          <div className="wt-landing-grid">
            {/* Create Room Card */}
            <div className="wt-landing-box">
              <div className="wt-landing-box-top">
                <div className="wt-landing-icon-wrapper">
                  <Radio size={28} color="#c084fc" />
                </div>
                <h3>Create Watch Room</h3>
              </div>
              
              <div className="wt-landing-box-middle">
                <p>Host a new watch room and share code with friends.</p>
              </div>

              <div className="wt-landing-box-bottom">
                <button className="wt-btn-primary wt-btn-landing" onClick={handleCreateRoom}>
                  Create Watch Room
                </button>
              </div>
            </div>

            {/* Join Room Card */}
            <div className="wt-landing-box">
              <div className="wt-landing-box-top">
                <div className="wt-landing-icon-wrapper">
                  <Users size={28} color="#c084fc" />
                </div>
                <h3>Join Watch Room</h3>
              </div>
              
              <div className="wt-landing-box-middle">
                <p>Enter the room code to connect instantly.</p>
              </div>

              <div className="wt-landing-box-bottom">
                <input
                  type="text"
                  className="wt-join-input"
                  placeholder="Enter 6-digit code..."
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                  maxLength={6}
                />
                <button
                  className={joinInput.trim().length === 6 ? "wt-btn-primary wt-btn-landing" : "wt-btn-secondary wt-btn-landing"}
                  onClick={handleJoinRoom}
                  disabled={joinInput.trim().length !== 6}
                >
                  Join Room
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wt-view-container">
      {/* TOP BAR */}
      <div className="wt-top-bar">
        <div className="wt-top-left">
          <span className="wt-room-code">{roomCode}</span>
          <button className="wt-btn-copy-sm" onClick={handleCopyCode} title="Copy Room Code">
            {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
            <span>{copied ? "Copied!" : "Copy"}</span>
          </button>
        </div>

        <div className="wt-top-search-wrapper">
          <form className="wt-top-search-form" onSubmit={handleSearchSubmit}>
            <div className="wt-top-search-input-box">
              <Search size={14} className="wt-search-icon" />
              <input
                type="text"
                placeholder="Search anime to add to queue..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value === "") setSearchDropdownVisible(false);
                }}
                onFocus={() => {
                   if (searchResults.length > 0) setSearchDropdownVisible(true);
                }}
              />
            </div>
            <button type="submit" className="wt-btn-primary" disabled={isSearching}>
              {isSearching ? "..." : "Search"}
            </button>
          </form>
          
          {/* SEARCH DROPDOWN (ROFI STYLE) */}
          {searchDropdownVisible && searchResults.length > 0 && (
            <div className="wt-search-dropdown">
              <div className="wt-search-dropdown-header">
                <span>Search Results</span>
                <button onClick={() => setSearchDropdownVisible(false)} className="wt-sd-close-btn"><X size={14}/></button>
              </div>
              <div className="wt-search-dropdown-list">
                {searchResults.map((item, idx) => (
                  <div
                    key={idx}
                    className="wt-search-dropdown-item"
                    onClick={() => handleSelectAnime(item)}
                  >
                    <img src={item.image} alt={item.title} className="wt-sd-image" />
                    <div className="wt-sd-info">
                       <span className="wt-sd-title">{item.title}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="wt-top-right">
          <button className="wt-btn-exit-sm" onClick={() => watchTogetherClient.disconnect()} title="Leave Room">
            <LogOut size={14} color="#f87171" /> Leave Room
          </button>
        </div>
      </div>

      {isExtensionMismatch && (
        <div className="wt-mismatch-banner-top">
          <AlertTriangle size={16} />
          <strong>Extension Warning:</strong> You can't sync properly! Ask @{users.find((u) => u.isHost)?.username || "Host"} to select the <strong>{hostProvider}</strong> provider.
        </div>
      )}

      <div className="wt-main-body">
        <div className="wt-left-content" style={{ marginRight: isChatExpanded ? "340px" : "50px", transition: "margin-right 0.3s ease" }}>
          <div className="wt-player-area">
            {activeMedia ? (
              <VideoPlayer
                id={activeMedia.id}
                episodeNumOrId={activeMedia.ep}
                episodesList={activeMedia.episodesList}
                animeTitle={activeMedia.animeTitle}
                provider={activeMedia.provider}
                image={activeMedia.image}
                onBack={() => setActiveMedia(null)}
                hideExit={true}
                isHost={hasPrivileges}
                onSkip={handleSkipEpisode}
              />
            ) : (
              <div className="wt-player-placeholder">
                <Radio size={48} color="#a78bfa" />
                <h3>No Media Active</h3>
                <p>Search using the top bar to start watching!</p>
              </div>
            )}
          </div>

          <div className="wt-bottom-info">
            <div className="wt-current-info">
              {activeMedia ? (
                <>
                  <img src={activeMedia.image} alt={activeMedia.animeTitle} className="wt-bottom-cover" />
                  <div className="wt-bottom-details">
                    <span className="wt-bottom-title">{activeMedia.animeTitle}</span>
                    <span className="wt-bottom-ep">Episode {activeMedia.ep}</span>
                  </div>
                  {hasPrivileges && (
                    <div className="wt-bottom-actions">
                      <select
                        className="wt-btn-provider-dropdown"
                        value={selectedProvider}
                        onChange={(e) => setSelectedProvider(e.target.value)}
                        title="Switch source"
                      >
                        {providers.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                      <button className="wt-btn-skip" onClick={handleSkipEpisode}>
                        Skip <Play size={12} fill="currentColor" />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div style={{color: "#9ca3af", fontSize: "0.85rem", padding: "12px"}}>Nothing currently playing</div>
              )}
            </div>
            
            <div className="wt-next-info">
              <span className="wt-next-label">Next in Queue</span>
              {queue.length > 0 ? (
                <span className="wt-next-title">{queue[0].title || `Ep ${queue[0].episode}`}</span>
              ) : (
                <span className="wt-next-title" style={{color: "#6b7280"}}>Auto-play next ep</span>
              )}
            </div>
          </div>
          
          <div className="wt-queue-scroll">
            {/* Anime description section */}
            {selectedAnime && selectedAnimeDetails?.description && (
              isSynopsisCollapsed && activeMedia ? (
                <div className="wt-collapsed-synopsis-bar" style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 16px",
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  borderRadius: "8px",
                  marginBottom: "12px"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <img
                      src={selectedAnimeDetails?.image || selectedAnime.image}
                      alt={selectedAnime.title}
                      style={{ width: "32px", height: "45px", objectFit: "cover", borderRadius: "4px" }}
                    />
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "0.85rem", fontWeight: "700", color: "#fff" }}>
                        {selectedAnimeDetails?.title || selectedAnime.title}
                      </span>
                      <span style={{ fontSize: "0.72rem", color: "#cbd5e1" }}>Synopsis & poster collapsed</span>
                    </div>
                  </div>
                  <button
                    className="wt-btn-toggle-synopsis"
                    onClick={() => setIsSynopsisCollapsed(false)}
                    style={{
                      background: "rgba(124, 58, 237, 0.15)",
                      border: "1px solid rgba(124, 58, 237, 0.3)",
                      borderRadius: "6px",
                      color: "#c4b5fd",
                      padding: "4px 10px",
                      fontSize: "0.75rem",
                      cursor: "pointer",
                      fontWeight: "600"
                    }}
                  >
                    Show Info
                  </button>
                </div>
              ) : (
                <div className="wt-scroll-description">
                  <img
                    src={selectedAnimeDetails?.image || selectedAnime.image}
                    alt={selectedAnime.title}
                    className="wt-scroll-poster"
                  />
                  <div className="wt-scroll-desc-body">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
                      <span className="wt-scroll-anime-title">{selectedAnimeDetails?.title || selectedAnime.title}</span>
                      {activeMedia && (
                        <button
                          className="wt-btn-toggle-synopsis"
                          onClick={() => setIsSynopsisCollapsed(true)}
                          style={{
                            background: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: "6px",
                            color: "#c4b5fd",
                            padding: "4px 10px",
                            fontSize: "0.75rem",
                            cursor: "pointer",
                            fontWeight: "600",
                            transition: "background 0.2s"
                          }}
                        >
                          Hide Info
                        </button>
                      )}
                    </div>
                    <p className="wt-scroll-desc-text">{selectedAnimeDetails.description}</p>
                  </div>
                </div>
              )
            )}

            {/* Anime episodes section */}
            {loadingEpisodes && (
              <div style={{ padding: "20px 0", color: "#a78bfa", fontSize: "0.9rem", fontWeight: "600" }}>
                Loading episodes list...
              </div>
            )}

            {selectedAnime && !loadingEpisodes && animeEpisodes.length > 0 && (
              <div className="wt-episodes-section" style={{ marginTop: 20, marginBottom: 20 }}>
                <div className="wt-ep-toolbar">
                  <h4
                    style={{
                      margin: 0,
                      color: "#fff",
                      fontSize: "0.92rem",
                    }}
                  >
                    Episodes ({filteredEpisodes.length})
                  </h4>

                  <div className="wt-ep-toolbar-controls">
                    {/* Episode Filter Box */}
                    <div className="wt-ep-search-wrapper">
                      <Search size={12} className="wt-ep-search-icon" />
                      <input
                        type="text"
                        className="wt-ep-search-input"
                        placeholder="Filter episode..."
                        value={episodeSearchQuery}
                        onChange={(e) =>
                          setEpisodeSearchQuery(e.target.value)
                        }
                      />
                      {episodeSearchQuery && (
                        <button
                          className="wt-ep-search-clear"
                          onClick={() => setEpisodeSearchQuery("")}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    {/* Sub / Dub Selector */}
                    <select
                      className="wt-ep-select-sm"
                      value={dubSelect}
                      onChange={(e) => setDubSelect(e.target.value)}
                    >
                      <option value="sub">SUB</option>
                      <option value="dub">DUB</option>
                      <option value="all">ALL</option>
                    </select>

                    {/* Sort Order Toggle */}
                    <button
                      className="wt-btn-sort-sm"
                      onClick={() =>
                        setSortOrder(sortOrder === "asc" ? "desc" : "asc")
                      }
                      title="Toggle Sort Order"
                    >
                      <ArrowUpDown size={12} /> {sortOrder.toUpperCase()}
                    </button>

                    {hasPrivileges && filteredEpisodes.length > 0 && (
                      <div
                        style={{
                          display: "inline-flex",
                          gap: "6px",
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="text"
                          className="wt-ep-range-input"
                          placeholder="e.g. 1-50 or 50"
                          value={rangeValue}
                          onChange={(e) => setRangeValue(e.target.value)}
                        />
                        <button
                          className="wt-btn-range-queue"
                          onClick={() => handleQueueRange(rangeValue)}
                          title="Queue custom range"
                        >
                          Queue Range
                        </button>
                        <button
                          className="wt-btn-range-queue"
                          onClick={() => handleQueueRange("all")}
                          title="Queue all episodes"
                        >
                          Queue All
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {filteredEpisodes.length === 0 ? (
                  <div
                    style={{
                      color: "#9ca3af",
                      fontSize: "0.85rem",
                      padding: "12px 0",
                    }}
                  >
                    No episodes match your filter.
                  </div>
                ) : (
                  <div className="wt-episodes-grid">
                    {filteredEpisodes.map((ep, idx) => (
                      <div key={idx} className="wt-ep-card">
                        <div className="wt-ep-header">
                          <span className="wt-ep-number">
                            Episode {ep.number || ep.id || idx + 1}
                          </span>
                          <span className="wt-ep-badge">
                            {dubSelect.toUpperCase()}
                          </span>
                        </div>
                        {ep.title &&
                          ep.title.toLowerCase() !==
                            `episode ${ep.number || idx + 1}`.toLowerCase() &&
                          ep.title.toLowerCase() !==
                            `ep ${ep.number || idx + 1}`.toLowerCase() &&
                          ep.title.toLowerCase() !==
                            `${ep.number || idx + 1}`.toLowerCase() && (
                            <div className="wt-ep-title" title={ep.title}>
                              {ep.title}
                            </div>
                          )}
                        {hasPrivileges && (
                          <div className="wt-ep-actions">
                            <button
                              className="wt-btn-play-sm"
                              onClick={() => handlePlayEpisode(ep)}
                              title="Play episode together"
                            >
                              <Play size={11} /> Play
                            </button>
                            <button
                              className="wt-btn-queue-sm"
                              onClick={() => handleAddToQueue(ep)}
                              title="Add to watch queue"
                            >
                              <Plus size={11} /> Queue
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}


          </div>
        </div>

        {/* RIGHT CONTENT (SIDEBAR WITH TABS) */}
        <div className={`wt-right-chat ${isChatExpanded ? "expanded" : "collapsed"}`}>
          {isChatExpanded ? (
            <div className="wt-chat-inner">
              {/* 3 Icon-Only Toggle Switch Bar (Chat | Queue | Users) */}
              <div className="wt-sidebar-tabs">
                <button
                  className={`wt-sidebar-tab-btn ${activeTab === "chat" ? "active" : ""}`}
                  onClick={() => setActiveTab("chat")}
                  title="Chat"
                >
                  <MessageSquare size={16} />
                  <span className="wt-badge-count">
                    {chatList.length > 99 ? "99+" : chatList.length}
                  </span>
                </button>
                <button
                  className={`wt-sidebar-tab-btn ${activeTab === "queue" ? "active" : ""}`}
                  onClick={() => setActiveTab("queue")}
                  title="Queue"
                >
                  <ListVideo size={16} />
                  <span className="wt-badge-count">
                    {queue.length > 99 ? "99+" : queue.length}
                  </span>
                </button>
                <button
                  className={`wt-sidebar-tab-btn ${activeTab === "users" ? "active" : ""}`}
                  onClick={() => setActiveTab("users")}
                  title="Connected Users"
                >
                  <Users size={16} />
                  <span className="wt-badge-count">
                    {users.length > 99 ? "99+" : users.length}
                  </span>
                </button>
                <button
                  onClick={() => setIsChatExpanded(false)}
                  className="wt-chat-collapse-btn"
                  title="Collapse sidebar"
                  style={{ marginLeft: "auto" }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {/* Tab Content Area */}
              <div className="wt-tab-content-area" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "14px" }}>
                {activeTab === "chat" ? (
                  <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
                    <div className="wt-chat-messages">
                      {chatList.length === 0 ? (
                        <div style={{ color: "#6b7280", fontSize: "0.85rem", textAlign: "center", marginTop: 40 }}>
                          No messages yet. Say hi!
                        </div>
                      ) : (
                        chatList.map((m, idx) => (
                          <div key={idx} className="wt-chat-msg">
                            <span className="wt-chat-sender">{m.sender}:</span>
                            <span>{m.message}</span>
                          </div>
                        ))
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    <form className="wt-chat-input-row" onSubmit={handleSendChat}>
                      <input
                        type="text"
                        className="wt-chat-input-lg"
                        placeholder="Type a message..."
                        value={chatMessage}
                        onChange={(e) => setChatMessage(e.target.value)}
                      />
                      <button type="submit" className="wt-btn-send-lg">Send</button>
                    </form>
                  </div>
                ) : activeTab === "queue" ? (
                  /* Queue View */
                  <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <h4 style={{ margin: 0, color: "#fff", fontSize: "0.9rem" }}>Shared Watch Queue</h4>
                      {hasPrivileges && queue.length > 0 && (
                        <button
                          onClick={handleClearQueue}
                          style={{
                            padding: "4px 8px",
                            fontSize: "0.72rem",
                            background: "rgba(239, 68, 68, 0.2)",
                            border: "1px solid rgba(239, 68, 68, 0.4)",
                            color: "#f87171",
                            borderRadius: "4px",
                            cursor: "pointer",
                            height: "auto",
                          }}
                        >
                          Clear All
                        </button>
                      )}
                    </div>
                    <div style={{ flex: 1, overflowY: "auto" }}>
                      {queue.length === 0 ? (
                        <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>Watch queue is empty.</div>
                      ) : (
                        queue.map((item, idx) => (
                          <div
                            key={idx}
                            className="wt-user-row"
                            style={{
                              marginBottom: 6,
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <span style={{ fontWeight: 700, color: "#a78bfa" }}>#{idx + 1}</span>
                            <span
                              style={{
                                flex: 1,
                                fontSize: "0.8rem",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                              title={item.title || `Anime #${item.animeID} - Ep ${item.episode}`}
                            >
                              {item.title || `Anime #${item.animeID} - Ep ${item.episode}`}
                            </span>
                            {hasPrivileges && (
                              <div style={{ display: "inline-flex", gap: "6px" }}>
                                <button
                                  className="wt-btn-play-sm"
                                  onClick={() => handlePlayFromQueue(item)}
                                  style={{
                                    padding: "4px 8px",
                                    fontSize: "0.72rem",
                                    height: "auto",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "4px",
                                    borderRadius: "4px",
                                  }}
                                >
                                  <Play size={10} />
                                </button>
                                <button
                                  className="wt-btn-delete-sm"
                                  onClick={() => watchTogetherClient.sendRemoveQueue(idx)}
                                  style={{
                                    padding: "4px 8px",
                                    fontSize: "0.72rem",
                                    height: "auto",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "4px",
                                    borderRadius: "4px",
                                    background: "rgba(239, 68, 68, 0.2)",
                                    border: "1px solid rgba(239, 68, 68, 0.4)",
                                    color: "#f87171",
                                    cursor: "pointer",
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  /* Users View */
                  <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
                    <h4 style={{ margin: "0 0 12px 0", color: "#fff", fontSize: "0.9rem" }}>Connected Users ({users.length})</h4>
                    <div className="wt-users-list" style={{ flex: 1, overflowY: "auto" }}>
                      {users.map((u, idx) => (
                        <div key={idx} className="wt-user-row">
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
                          <span style={{ fontWeight: 600, color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {u.username}
                          </span>
                          {u.isHost && <span className="wt-user-badge-host">HOST</span>}
                          {u.isCoHost && (
                            <span
                              className="wt-user-badge-cohost"
                              style={{
                                marginLeft: 6,
                                background: "rgba(59, 130, 246, 0.2)",
                                border: "1px solid rgba(59, 130, 246, 0.4)",
                                color: "#60a5fa",
                                padding: "1px 4px",
                                borderRadius: "4px",
                                fontSize: "0.68rem",
                                fontWeight: "700",
                              }}
                            >
                              CO-HOST
                            </span>
                          )}
                          {isHost && u.id !== watchTogetherClient.userID && (
                            <button
                              className="wt-btn-cohost-sm"
                              onClick={() => watchTogetherClient.sendCoHostChange(u.id, !u.isCoHost)}
                              style={{
                                marginLeft: "auto",
                                padding: "2px 6px",
                                fontSize: "0.68rem",
                                background: u.isCoHost ? "rgba(239, 68, 68, 0.2)" : "rgba(16, 185, 129, 0.2)",
                                border: u.isCoHost ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid rgba(16, 185, 129, 0.4)",
                                color: u.isCoHost ? "#f87171" : "#34d399",
                                borderRadius: "4px",
                                cursor: "pointer",
                              }}
                            >
                              {u.isCoHost ? "Demote" : "Co-Host"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Collapsed state: slim vertical bar with 3 fast-access tab buttons */
            <div className="wt-chat-collapsed-bar">
              <button
                onClick={() => setIsChatExpanded(true)}
                className="wt-chat-expand-chevron-btn"
                title="Expand sidebar"
              >
                <ChevronLeft size={16} />
              </button>

              <button
                onClick={() => {
                  setActiveTab("chat");
                  setIsChatExpanded(true);
                }}
                className={`wt-chat-collapsed-icon ${activeTab === "chat" ? "active" : ""}`}
                title="Chat"
                style={{ position: "relative" }}
              >
                <MessageSquare size={16} />
                {unreadCount > 0 && (
                  <div className="wt-chat-unread-circle-mini" title={`${unreadCount} new message(s)`} style={{
                    position: "absolute",
                    top: "-4px",
                    right: "-4px",
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    background: "#ef4444",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.6rem",
                    fontWeight: 700,
                    boxShadow: "0 0 6px rgba(239, 68, 68, 0.4)"
                  }}>
                    {unreadCount}
                  </div>
                )}
              </button>

              <button
                onClick={() => {
                  setActiveTab("queue");
                  setIsChatExpanded(true);
                }}
                className={`wt-chat-collapsed-icon ${activeTab === "queue" ? "active" : ""}`}
                title="Watch Queue"
                style={{ position: "relative" }}
              >
                <ListVideo size={16} />
                {queue.length > 0 && (
                  <div className="wt-chat-unread-circle-mini" title={`${queue.length} items in queue`} style={{
                    position: "absolute",
                    top: "-4px",
                    right: "-4px",
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    background: "#7c3aed",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.6rem",
                    fontWeight: 700,
                    boxShadow: "0 0 6px rgba(124, 58, 237, 0.4)"
                  }}>
                    {queue.length}
                  </div>
                )}
              </button>

              <button
                onClick={() => {
                  setActiveTab("users");
                  setIsChatExpanded(true);
                }}
                className={`wt-chat-collapsed-icon ${activeTab === "users" ? "active" : ""}`}
                title="Connected Users"
                style={{ position: "relative" }}
              >
                <Users size={16} />
                {users.length > 0 && (
                  <div className="wt-chat-unread-circle-mini" title={`${users.length} connected users`} style={{
                    position: "absolute",
                    top: "-4px",
                    right: "-4px",
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    background: "#10b981",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.6rem",
                    fontWeight: 700,
                    boxShadow: "0 0 6px rgba(16, 185, 129, 0.4)"
                  }}>
                    {users.length}
                  </div>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
