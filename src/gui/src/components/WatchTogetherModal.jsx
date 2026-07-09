import { useState, useEffect, useRef } from "react";
import watchTogetherClient from "../utils/watchTogetherClient";
import "./css/WatchTogetherModal.css";
import {
  Users,
  Copy,
  Check,
  MessageSquare,
  ListVideo,
  X,
  LogOut,
  Radio,
} from "lucide-react";

export default function WatchTogetherModal({
  isOpen,
  onClose,
  username = "Guest",
}) {
  const [activeTab, setActiveTab] = useState("chat");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatList, setChatList] = useState([]);
  const [roomCode, setRoomCode] = useState(watchTogetherClient.roomCode);
  const [isHost, setIsHost] = useState(watchTogetherClient.isHost);
  const [users, setUsers] = useState(watchTogetherClient.users);
  const [queue, setQueue] = useState(watchTogetherClient.queue);
  const [errorMsg, setErrorMsg] = useState("");

  const chatEndRef = useRef(null);

  useEffect(() => {
    const handleRoomJoined = (data) => {
      setRoomCode(data.roomCode);
      setIsHost(data.isHost);
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

    const handleError = (err) => {
      setErrorMsg(err.message || "An error occurred");
    };

    const handleDisconnected = () => {
      setRoomCode(null);
      setIsHost(false);
      setUsers([]);
    };

    watchTogetherClient.on("roomJoined", handleRoomJoined);
    watchTogetherClient.on("usersChanged", handleUsersChanged);
    watchTogetherClient.on("chatMessage", handleChat);
    watchTogetherClient.on("queueUpdated", handleQueue);
    watchTogetherClient.on("error", handleError);
    watchTogetherClient.on("disconnected", handleDisconnected);

    return () => {
      watchTogetherClient.off("roomJoined", handleRoomJoined);
      watchTogetherClient.off("usersChanged", handleUsersChanged);
      watchTogetherClient.off("chatMessage", handleChat);
      watchTogetherClient.off("queueUpdated", handleQueue);
      watchTogetherClient.off("error", handleError);
      watchTogetherClient.off("disconnected", handleDisconnected);
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatList]);

  if (!isOpen) return null;

  const handleCreateRoom = async () => {
    try {
      setErrorMsg("");
      await watchTogetherClient.createRoom(username);
    } catch (err) {
      setErrorMsg("Failed to connect to Watch Together server");
    }
  };

  const handleJoinRoom = async () => {
    if (!joinCodeInput.trim()) return;
    try {
      setErrorMsg("");
      await watchTogetherClient.joinRoom(joinCodeInput.trim(), username);
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

  const handleLeaveRoom = () => {
    watchTogetherClient.disconnect();
    setRoomCode(null);
  };

  return (
    <div className="wt-modal-overlay" onClick={onClose}>
      <div className="wt-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="wt-header">
          <div className="wt-title-area">
            <div className="wt-title-icon">
              <Users size={22} />
            </div>
            <div className="wt-title-text">
              <h3>Watch Together</h3>
              <p>Synchronized Watch Rooms & Real-time Chat</p>
            </div>
          </div>
          <button className="wt-close-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        {errorMsg && (
          <div className="u-style-105">
            {errorMsg}
          </div>
        )}

        {/* Setup View (No active room) */}
        {!roomCode ? (
          <div className="wt-setup-container">
            <div className="wt-setup-box">
              <Radio size={40} className="wt-box-icon" />
              <h4>Create New Room</h4>
              <p>
                Host a new room and invite your friends with a 6-character code.
              </p>
              <button className="wt-btn-primary" onClick={handleCreateRoom}>
                Create Watch Room
              </button>
            </div>

            <div className="wt-setup-box">
              <Users size={40} className="wt-box-icon" />
              <h4>Join Existing Room</h4>
              <p>Enter the 6-character room code provided by the host.</p>
              <div className="wt-join-input-group">
                <input
                  type="text"
                  className="wt-input"
                  placeholder="ROOM CODE"
                  maxLength={6}
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                />
                <button className="wt-btn-primary u-style-106" onClick={handleJoinRoom}>
                  Join
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Active Room View */
          <div className="wt-active-layout">
            {/* Sidebar */}
            <div className="wt-sidebar">
              <div className="wt-code-card">
                <div className="wt-code-label">Room Code</div>
                <div className="wt-code-value">{roomCode}</div>
                <button className="wt-btn-copy" onClick={handleCopyCode}>
                  {copied ? (
                    <Check size={14} color="#10b981" />
                  ) : (
                    <Copy size={14} />
                  )}
                  <span>{copied ? "Copied!" : "Copy Code"}</span>
                </button>
              </div>

              <div className="wt-users-section">
                <div className="wt-section-title">
                  <span>Connected ({users.length})</span>
                </div>
                {users.map((u, idx) => (
                  <div key={idx} className="wt-user-item">
                    <div className="wt-avatar">
                      {u.username ? u.username[0].toUpperCase() : "G"}
                    </div>
                    <span className="wt-user-name">
                      {u.username || "Guest"}
                    </span>
                    {u.isHost && <span className="wt-badge-host">Host</span>}
                  </div>
                ))}
              </div>

              <button className="wt-leave-btn" onClick={handleLeaveRoom}>
                <LogOut size={14} className="u-style-107" /> Leave Room
              </button>
            </div>

            {/* Main Chat/Queue Area */}
            <div className="wt-main-area">
              <div className="wt-tabs">
                <button
                  className={`wt-tab-btn ${activeTab === "chat" ? "active" : ""}`}
                  onClick={() => setActiveTab("chat")}
                >
                  <MessageSquare size={16} /> Chat ({chatList.length})
                </button>
                <button
                  className={`wt-tab-btn ${activeTab === "queue" ? "active" : ""}`}
                  onClick={() => setActiveTab("queue")}
                >
                  <ListVideo size={16} /> Queue ({queue.length})
                </button>
              </div>

              {activeTab === "chat" ? (
                <div className="wt-chat-container">
                  <div className="wt-chat-messages">
                    {chatList.length === 0 ? (
                      <div className="u-style-108">
                        No messages yet. Say hi to everyone!
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
              ) : (
                /* Queue Tab */
                <div className="u-style-109">
                  <h4 className="u-style-110">
                    Shared Watch Playlist
                  </h4>
                  {queue.length === 0 ? (
                    <div className="u-style-111">
                      The watch queue is currently empty.
                    </div>
                  ) : (
                    queue.map((item, idx) => (
                      <div key={idx} className="wt-user-item u-style-112">
                        <span className="u-style-113">
                          #{idx + 1}
                        </span>
                        <span className="wt-user-name">
                          {item.title || `Anime #${item.animeID}`} - Ep{" "}
                          {item.episode}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
