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
    <div onClick={onOpenModal} className="u-style-99">
      <div className="u-style-100">
        <Radio size={14} className="animate-pulse" />
        <span className="u-style-101">
          {roomCode}
        </span>
      </div>

      {/* Copy Code Icon Button */}
      <button onClick={handleCopy} title="Copy Room Code" className="u-style-102">
        {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
        <span>{copied ? "Copied!" : "Copy"}</span>
      </button>

      {/* Users Count */}
      <div className="u-style-103">
        <Users size={14} />
        <span>{userCount}</span>
      </div>

      {/* Red Exit / Leave Button */}
      <button onClick={handleLeave} title="Leave Room" className="u-style-104">
        <LogOut size={13} color="#f87171" />
      </button>
    </div>
  );
}
