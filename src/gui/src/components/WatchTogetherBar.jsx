import { useState, useEffect } from "react";
import watchTogetherClient from "../utils/watchTogetherClient";
import { Users, Radio } from "lucide-react";

export default function WatchTogetherBar({ onOpenModal }) {
  const [roomCode, setRoomCode] = useState(watchTogetherClient.roomCode);
  const [userCount, setUserCount] = useState(watchTogetherClient.users.length);

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

  if (!roomCode) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 20,
        zIndex: 900,
        background: "rgba(17, 17, 27, 0.85)",
        backdropFilter: "blur(10px)",
        border: "1px solid rgba(139, 92, 246, 0.4)",
        borderRadius: 20,
        padding: "6px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        color: "#fff",
        fontSize: "0.82rem",
        boxShadow: "0 4px 15px rgba(0, 0, 0, 0.4)",
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
        <span style={{ fontWeight: 700, color: "#a78bfa" }}>{roomCode}</span>
      </div>

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
    </div>
  );
}
