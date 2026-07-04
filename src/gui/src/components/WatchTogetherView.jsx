import { useState, useEffect, useRef, useMemo } from "react";
import watchTogetherClient from "../utils/watchTogetherClient";
import VideoPlayer from "./VideoPlayer";
import "./css/WatchTogetherView.css";
import {
  Users,
  Copy,
  Check,
  MessageSquare,
  ListVideo,
  Radio,
  Search,
  AlertTriangle,
  Play,
  LogOut,
  Plus,
  ArrowLeft,
  X,
  ArrowUpDown,
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
  const [chatList, setChatList] = useState([]);
  const [joinInput, setJoinInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

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
      setChatList((prev) => [...prev, msg]);
    };

    const handleQueue = (q) => {
      setQueue([...q]);
    };

    const handleLoadMedia = ({ providerID, animeID, episode }) => {
      console.log("[Remote LoadMedia]", providerID, animeID, episode);
      const epIdentifier = String(episode);
      setActiveMedia((prev) => {
        if (!prev) {
          return {
            id: selectedAnime?.id || String(animeID),
            ep: epIdentifier,
            animeTitle: selectedAnime?.title || "Watch Together Session",
            provider: selectedProvider || "anikoto",
            image: selectedAnime?.image || "",
            episodesList:
              animeEpisodes.length > 0
                ? animeEpisodes
                : [{ id: epIdentifier, number: episode }],
          };
        }
        return {
          ...prev,
          ep: epIdentifier,
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
      setAnimeEpisodes(epData?.episodes || infoData?.episodes || []);
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
      id: selectedAnime.id,
      ep: epItem.id || epItem.number || 1,
      animeTitle: selectedAnime.title,
      provider: selectedProvider,
      image: selectedAnime.image,
      episodesList: animeEpisodes,
    };
    setActiveMedia(mediaObj);
    if (roomCode) {
      watchTogetherClient.sendLoadMedia(1, 100, epNum);
    }
  };

  const handlePlayFromQueue = (queueItem) => {
    const match = animeEpisodes.find(
      (ep) => Number(ep.number) === Number(queueItem.episode),
    );
    if (match) {
      handlePlayEpisode(match);
    } else {
      const epNum = Number(queueItem.episode);
      handlePlayEpisode({ id: String(epNum), number: epNum });
    }
  };

  const handleSkipEpisode = () => {
    if (queue.length > 0) {
      const nextItem = queue[0];
      handlePlayFromQueue(nextItem);
    } else if (activeMedia) {
      const sorted = [...animeEpisodes].sort(
        (a, b) => Number(a.number) - Number(b.number),
      );
      const currentEpObj = sorted.find(
        (ep) =>
          String(ep.id) === String(activeMedia.ep) ||
          Number(ep.number) === Number(activeMedia.ep),
      );
      if (currentEpObj) {
        const currentIdx = sorted.indexOf(currentEpObj);
        if (currentIdx !== -1 && currentIdx < sorted.length - 1) {
          handlePlayEpisode(sorted[currentIdx + 1]);
        }
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

  const isExtensionMismatch =
    !isHost &&
    hostProvider &&
    selectedProvider &&
    hostProvider.toLowerCase() !== selectedProvider.toLowerCase();

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
      {/* LEFT MAIN AREA (Player + Search) */}
      <div className="wt-left-main">
        {/* Video Player */}
        <div className="wt-player-wrapper">
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
              isHost={isHost}
              onSkip={handleSkipEpisode}
            />
          ) : (
            <div className="wt-player-placeholder">
              <Radio size={48} color="#a78bfa" />
              <h3>No Media Active</h3>
              <p>
                Search your installed extensions below to start watching
                together with your room!
              </p>
            </div>
          )}
        </div>

        {/* Extension Search Bar */}
        <div className="wt-search-section">
          <div className="wt-search-header">
            <h3>
              <Search size={18} color="#a78bfa" /> Search Extension Catalog
            </h3>
          </div>

          <form className="wt-search-input-group" onSubmit={handleSearchSubmit}>
            <select
              className="wt-provider-select"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
            >
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <div className="wt-search-input-wrapper">
              <Search size={16} className="wt-search-icon" />
              <input
                type="text"
                className="wt-search-input"
                placeholder="Search anime directly from extension..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="wt-btn-primary"
              style={{ width: "auto" }}
              disabled={isSearching}
            >
              {isSearching ? "Searching..." : "Search"}
            </button>
          </form>

          {/* Full Info & Episode Selector View (when an anime card is selected) */}
          {selectedAnime ? (
            <div className="wt-info-details-box">
              <button
                className="wt-info-back-btn"
                onClick={() => {
                  setSelectedAnime(null);
                  setSelectedAnimeDetails(null);
                }}
              >
                <ArrowLeft size={14} /> Back to Search Results
              </button>

              <div className="wt-info-hero">
                <img
                  src={selectedAnimeDetails?.image || selectedAnime.image}
                  alt={selectedAnime.title}
                  className="wt-info-poster"
                />
                <div className="wt-info-meta">
                  <h3>{selectedAnimeDetails?.title || selectedAnime.title}</h3>
                  <div className="wt-info-tags">
                    <span className="wt-info-tag">{selectedProvider}</span>
                    {selectedAnimeDetails?.status && (
                      <span className="wt-info-tag">
                        {selectedAnimeDetails.status}
                      </span>
                    )}
                    {animeEpisodes.length > 0 && (
                      <span className="wt-info-tag">
                        {animeEpisodes.length} Episodes
                      </span>
                    )}
                  </div>
                  {selectedAnimeDetails?.description && (
                    <p className="wt-info-desc">
                      {selectedAnimeDetails.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Episodes List Toolbar */}
              <div className="wt-episodes-section">
                <div className="wt-ep-toolbar">
                  <h4 style={{ margin: 0, color: "#fff", fontSize: "0.92rem" }}>
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
                        onChange={(e) => setEpisodeSearchQuery(e.target.value)}
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
                    </select>

                    {/* Server / Provider Switcher */}
                    {selectedAnimeDetails?.linkedProviders?.length > 1 && (
                      <select
                        className="wt-ep-select-sm"
                        value={selectedProvider}
                        onChange={(e) => {
                          const newProv = e.target.value;
                          setSelectedProvider(newProv);
                          const linked =
                            selectedAnimeDetails.linkedProviders.find(
                              (p) => p.provider === newProv,
                            );
                          if (linked) {
                            handleSelectAnime({
                              id: linked.id,
                              title: selectedAnime.title,
                            });
                          }
                        }}
                      >
                        {selectedAnimeDetails.linkedProviders.map((lp, idx) => (
                          <option key={idx} value={lp.provider}>
                            Server: {lp.provider}
                          </option>
                        ))}
                      </select>
                    )}

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
                  </div>
                </div>

                {loadingEpisodes ? (
                  <div
                    style={{
                      color: "#9ca3af",
                      fontSize: "0.85rem",
                      padding: "12px 0",
                    }}
                  >
                    Loading episodes...
                  </div>
                ) : filteredEpisodes.length === 0 ? (
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
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Search Results Grid */
            searchResults.length > 0 && (
              <div className="wt-results-grid">
                {searchResults.map((item, idx) => (
                  <div
                    key={idx}
                    className="wt-media-card"
                    onClick={() => handleSelectAnime(item)}
                  >
                    <img
                      src={item.image}
                      alt={item.title}
                      className="wt-media-cover"
                    />
                    <div className="wt-media-info">
                      <span className="wt-media-title" title={item.title}>
                        {item.title}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* RIGHT SIDEBAR (Chat & Queue) */}
      <div className="wt-right-sidebar">
        {/* Full-Width Top Header Bar */}
        <div className="wt-sidebar-top-bar">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#10b981",
            }}
          >
            <Radio size={14} className="animate-pulse" />
            <span
              style={{
                fontWeight: 700,
                color: "#a78bfa",
                letterSpacing: "1px",
                fontSize: "0.88rem",
              }}
            >
              {roomCode}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginLeft: "auto",
            }}
          >
            <button
              className="wt-btn-copy-sm"
              onClick={handleCopyCode}
              title="Copy Room Code"
            >
              {copied ? (
                <Check size={12} color="#10b981" />
              ) : (
                <Copy size={12} />
              )}
              <span>{copied ? "Copied!" : "Copy"}</span>
            </button>

            <button
              className="wt-btn-exit-sm"
              onClick={() => watchTogetherClient.disconnect()}
              title="Leave Room"
            >
              <LogOut size={13} color="#f87171" />
            </button>
          </div>
        </div>

        {/* Extension Mismatch Banner */}
        {isExtensionMismatch && (
          <div className="wt-sidebar-header">
            <div className="wt-mismatch-banner">
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <div>
                <strong>Extension Warning:</strong> You can't sync properly! Ask
                @{users.find((u) => u.isHost)?.username || "Host"} to update or
                select the <strong>{hostProvider}</strong> provider.
              </div>
            </div>
          </div>
        )}

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
        </div>

        {/* Tab Content Area */}
        <div className="wt-tab-content-area">
          {activeTab === "chat" ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
              <div
                className="wt-chat-messages"
                style={{ flex: 1, overflowY: "auto" }}
              >
                {chatList.length === 0 ? (
                  <div
                    style={{
                      color: "#6b7280",
                      fontSize: "0.85rem",
                      textAlign: "center",
                      marginTop: 40,
                    }}
                  >
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
                  className="wt-chat-input"
                  placeholder="Type a message..."
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                />
                <button type="submit" className="wt-btn-send">
                  Send
                </button>
              </form>
            </div>
          ) : activeTab === "queue" ? (
            /* Queue View */
            <div style={{ overflowY: "auto", flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <h4 style={{ margin: 0, color: "#fff" }}>Shared Watch Queue</h4>
              </div>
              {queue.length === 0 ? (
                <div style={{ color: "#6b7280", fontSize: "0.85rem" }}>
                  Watch queue is empty.
                </div>
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
                    <span style={{ fontWeight: 700, color: "#a78bfa" }}>
                      #{idx + 1}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.title ||
                        `Anime #${item.animeID} - Ep ${item.episode}`}
                    </span>
                    {isHost && (
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
                        <Play size={10} /> Play
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            /* Users View */
            <div style={{ overflowY: "auto", flex: 1 }}>
              <h4 style={{ margin: "0 0 12px 0", color: "#fff" }}>
                Connected Users ({users.length})
              </h4>
              <div className="wt-users-list">
                {users.map((u, idx) => (
                  <div key={idx} className="wt-user-row">
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#10b981",
                      }}
                    />
                    <span style={{ fontWeight: 600, color: "#e5e7eb" }}>
                      {u.username}
                    </span>
                    {u.isHost && (
                      <span className="wt-user-badge-host">HOST</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
