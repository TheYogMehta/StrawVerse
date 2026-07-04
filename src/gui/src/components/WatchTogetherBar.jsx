import { useState, useEffect } from "react";
import watchTogetherClient from "../utils/watchTogetherClient";
import { Users, Radio, Copy, Check, LogOut } from "lucide-react";

export default function WatchTogetherBar({ onOpenModal }) {
  const [roomCode, setRoomCode] = useState(watchTogetherClient.roomCode);
  const [userCount, setUserCount] = useState(watchTogetherClient.users.length);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleRoomJoined = (data) => {
      setRoomCode(data.roomCode);
    };

    const handleUsersChanged = (users) => {
      setUserCount(users.length);
    };

    const handleDisconnected = () => {
      setRoomCode(null);
      setUserCount(0);
    };

    watchTogetherClient.on("roomJoined", handleRoomJoined);
    watchTogetherClient.on("usersChanged", handleUsersChanged);
    watchTogetherClient.on("disconnected", handleDisconnected);

    return () => {
      watchTogetherClient.off("roomJoined", handleRoomJoined);
      watchTogetherClient.off("usersChanged", handleUsersChanged);
      watchTogetherClient.off("disconnected", handleDisconnected);
    };
  }, []);

  const handleCopy = (e) => {
    e.stopPropagation();
    if (roomCode) {
      navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLeave = (e) => {
    e.stopPropagation();
    watchTogetherClient.disconnect();
  };

  if (!roomCode) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 20,
        zIndex: 900,
        background: "rgba(17, 17, 27, 0.92)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(139, 92, 246, 0.4)",
        borderRadius: 20,
        padding: "6px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        color: "#fff",
        fontSize: "0.82rem",
        boxShadow: "0 4px 18px rgba(0, 0, 0, 0.5)",
        cursor: "pointer",
      }}
      onClick={onOpenModal}
    >
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
          style={{ fontWeight: 700, color: "#a78bfa", letterSpacing: "1px" }}
        >
          {roomCode}
        </span>
      </div>

      {/* Copy Code Icon Button */}
      <button
        style={{
          background: "rgba(255, 255, 255, 0.08)",
          border: "none",
          borderRadius: 12,
          padding: "3px 8px",
          color: "#d1d5db",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: "0.72rem",
          transition: "background 0.15s",
        }}
        onClick={handleCopy}
        title="Copy Room Code"
      >
        {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
        <span>{copied ? "Copied!" : "Copy"}</span>
      </button>

      {/* Users Count */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          color: "#9ca3af",
        }}
      >
        <Users size={14} />
        <span>{userCount}</span>
      </div>

      {/* Red Exit / Leave Button */}
      <button
        style={{
          background: "rgba(239, 68, 68, 0.18)",
          border: "1px solid rgba(239, 68, 68, 0.4)",
          borderRadius: 12,
          padding: "4px 8px",
          color: "#f87171",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: "0.75rem",
          fontWeight: 600,
          transition: "all 0.15s",
        }}
        onClick={handleLeave}
        title="Leave Room"
      >
        <LogOut size={13} color="#f87171" />
      </button>
    </div>
  );
}
