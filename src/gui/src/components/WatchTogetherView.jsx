import { useState, useEffect, useRef, useMemo } from "react";
import watchTogetherClient from "../utils/watchTogetherClient";
import VideoPlayer from "./VideoPlayer";
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

      if (episodesList.length > 0) {
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
        alert(
          "Invalid range format. Please use e.g. '1-50', '1 to 50', or '50'.",
        );
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
              <Radio size={36} color="#a78bfa" />
              <h3>Create Watch Room</h3>
              <p>
                Host a new synchronized room and share your code with friends.
              </p>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  width: "100%",
                  marginTop: 20,
                }}
              >
                <button className="wt-btn-primary" onClick={handleCreateRoom}>
                  Create Watch Room
                </button>
              </div>
            </div>

            {/* Join Room Card */}
            <div className="wt-landing-box">
              <Users size={36} color="#a78bfa" />
              <h3>Join Watch Room</h3>
              <p>Enter the 6-character room code provided by the host.</p>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  width: "100%",
                  marginTop: 16,
                }}
              >
                <div style={{ textAlign: "left" }}>
                  <label
                    style={{
                      fontSize: "0.8rem",
                      color: "#a78bfa",
                      fontWeight: 600,
                    }}
                  >
                    Enter Room Code:
                  </label>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <input
                      type="text"
                      className="wt-input"
                      placeholder="ROOM CODE"
                      value={joinInput}
                      onChange={(e) => setJoinInput(e.target.value)}
                    />
                    <button
                      className="wt-btn-primary"
                      style={{ width: "auto" }}
                      onClick={handleJoinRoom}
                    >
                      Join
                    </button>
                  </div>
                </div>
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
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#10b981", fontSize: "0.85rem", fontWeight: "600" }} title={`${users.length} watcher(s) online`}>
            <Users size={16} />
            <span>{users.length}</span>
          </div>
          <span className="wt-room-code" style={{ marginLeft: 4 }}>{roomCode}</span>
          <button className="wt-btn-copy-sm" onClick={handleCopyCode} title="Copy Room Code" style={{ padding: "4px 8px", fontSize: "0.75rem" }}>
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
            <button type="submit" className="wt-btn-primary" disabled={isSearching} style={{ padding: "6px 12px", fontSize: "0.75rem", width: "auto" }}>
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
            
            <div className="wt-info-separator" />
            
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
              <div className="wt-scroll-description">
                <img
                  src={selectedAnimeDetails?.image || selectedAnime.image}
                  alt={selectedAnime.title}
                  className="wt-scroll-poster"
                />
                <div className="wt-scroll-desc-body">
                  <span className="wt-scroll-anime-title">{selectedAnimeDetails?.title || selectedAnime.title}</span>
                  <p className="wt-scroll-desc-text">{selectedAnimeDetails.description}</p>
                </div>
              </div>
            )}

            {/* Anime episodes section */}
            {loadingEpisodes && (
              <div style={{ padding: "20px 0", color: "#a78bfa", fontSize: "0.9rem", fontWeight: "600" }}>
                Loading episodes list...
              </div>
            )}

            {selectedAnime && !loadingEpisodes && animeEpisodes.length > 0 && (
              <div className="wt-episodes-section" style={{ marginTop: 20, marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
                  <h4 style={{ margin: 0, color: "#fff", fontSize: "0.95rem" }}>Episodes</h4>
                  
                  {/* Episode Selection Controls */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Search Input */}
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      <input
                        type="text"
                        placeholder="Search ep..."
                        value={episodeSearchQuery}
                        onChange={(e) => setEpisodeSearchQuery(e.target.value)}
                        style={{
                          background: "rgba(0, 0, 0, 0.4)",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                          borderRadius: 6,
                          padding: "6px 28px 6px 10px",
                          color: "#fff",
                          fontSize: "0.75rem",
                          width: "120px",
                          outline: "none"
                        }}
                      />
                      {episodeSearchQuery && (
                        <button
                          onClick={() => setEpisodeSearchQuery("")}
                          style={{
                            position: "absolute",
                            right: 8,
                            background: "none",
                            border: "none",
                            color: "#9ca3af",
                            cursor: "pointer",
                            padding: 0,
                            display: "flex",
                            alignItems: "center"
                          }}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    {/* Sub/Dub Dropdown */}
                    <select
                      className="wt-btn-provider-dropdown"
                      value={dubSelect}
                      onChange={(e) => setDubSelect(e.target.value)}
                      style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                    >
                      <option value="sub">SUB</option>
                      <option value="dub">DUB</option>
                      <option value="all">ALL</option>
                    </select>

                    {/* Sort Dropdown */}
                    <select
                      className="wt-btn-provider-dropdown"
                      value={sortOrder}
                      onChange={(e) => setSortOrder(e.target.value)}
                      style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                    >
                      <option value="asc">ASC</option>
                      <option value="desc">DESC</option>
                    </select>
                  </div>
                </div>

                {/* Episodes List */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "350px", overflowY: "auto", paddingRight: 8 }}>
                  {filteredEpisodes.length === 0 ? (
                    <div style={{ color: "#6b7280", fontSize: "0.85rem", padding: "10px 0" }}>No matching episodes found.</div>
                  ) : (
                    filteredEpisodes.map((ep, idx) => (
                      <div key={idx} className="wt-queue-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="wt-queue-idx">#{ep.number || ep.id}</span>
                        <span className="wt-queue-item-title" style={{ flex: 1, marginLeft: 12 }}>
                          {ep.title || `Episode ${ep.number || ep.id}`}
                        </span>
                        {hasPrivileges && (
                          <div className="wt-queue-actions">
                            <button className="wt-btn-play-sm" onClick={() => handlePlayEpisode(ep)}>
                              <Play size={10} /> Play
                            </button>
                            <button className="wt-btn-queue-sm" onClick={() => handleAddToQueue(ep)}>
                              Queue
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}


            <div className="wt-queue-header">
               <h4>Watch Queue</h4>
               {hasPrivileges && queue.length > 0 && (
                  <button onClick={handleClearQueue} className="wt-btn-clear-queue">Clear All</button>
               )}
            </div>
            {queue.length === 0 ? (
               <div style={{ color: "#6b7280", fontSize: "0.85rem", padding: "10px 0" }}>Queue is empty.</div>
            ) : (
              queue.map((item, idx) => (
                  <div key={idx} className="wt-queue-row">
                    <span className="wt-queue-idx">#{idx + 1}</span>
                    <span className="wt-queue-item-title">
                      {item.title || `Anime #${item.animeID} - Ep ${item.episode}`}
                    </span>
                    {hasPrivileges && (
                      <div className="wt-queue-actions">
                        <button className="wt-btn-play-sm" onClick={() => handlePlayFromQueue(item)}><Play size={10} /> Play</button>
                        <button className="wt-btn-delete-sm" onClick={() => watchTogetherClient.sendRemoveQueue(idx)}>Delete</button>
                      </div>
                    )}
                  </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT CONTENT (CHAT) */}
        <div className={`wt-right-chat ${isChatExpanded ? "expanded" : "collapsed"}`}>
          {isChatExpanded ? (
            <div className="wt-chat-inner">
              {/* Chat header: title left, collapse arrow right */}
              <div className="wt-chat-header">
                <div className="wt-chat-participants">
                  <span style={{ fontWeight: 700, color: "#fff", marginRight: 8 }}>Chat</span>
                  <Users size={14} color="#a78bfa" />
                  {users.length > 5 ? (
                    <span className="wt-chat-users-text">
                      {users.find(u => u.isHost)?.username || "Host"} + {users.length - 1} watchers
                    </span>
                  ) : (
                    <span className="wt-chat-users-text">
                      {users.map(u => u.username).join(", ")}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setIsChatExpanded(false)}
                  className="wt-chat-collapse-btn"
                  title="Collapse chat"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

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
          ) : (
            /* Collapsed state: slim vertical bar with expand arrow */
            <div className="wt-chat-collapsed-bar">
              <button
                onClick={() => setIsChatExpanded(true)}
                className="wt-chat-collapsed-icon"
                title="Expand chat"
              >
                <MessageSquare size={16} />
              </button>

              {unreadCount > 0 && (
                <div className="wt-chat-unread-circle" title={`${unreadCount} new message(s)`}>
                  {unreadCount}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
