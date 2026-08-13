/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { Loader2 } from "lucide-react";

export default function VideoPlayer({
  id,
  episodeNumOrId,
  isDownloaded,
  episodes = [],
  episodesList = [],
  animeTitle = "",
  image = "",
  provider = "",
  malid = "",
  onBack,
  playerSubDub = "sub",
  subdub,
}) {
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState("Initializing MPV player...");

  useEffect(() => {
    const isElectronMpvAvailable =
      typeof window !== "undefined" &&
      window.sharedStateAPI &&
      typeof window.sharedStateAPI.playInMpv === "function";

    if (!isElectronMpvAvailable) return;

    const allEpisodes = episodes.length > 0 ? episodes : episodesList;
    const currentEpisodeObj = allEpisodes.find(
      (item) =>
        String(item.id) === String(episodeNumOrId) ||
        Number(item.number) === Number(episodeNumOrId),
    );

    const targetEpId = currentEpisodeObj
      ? currentEpisodeObj.id
      : episodeNumOrId;
    const targetEpNum = currentEpisodeObj
      ? currentEpisodeObj.number
      : typeof episodeNumOrId === "number" ||
          (!isNaN(Number(episodeNumOrId)) &&
            !String(episodeNumOrId).includes("|"))
        ? Number(episodeNumOrId)
        : 1;

    const currentIdx = allEpisodes.findIndex(
      (item) =>
        String(item.id) === String(episodeNumOrId) ||
        Number(item.number) === Number(targetEpNum),
    );
    const hasNext =
      currentIdx !== -1
        ? currentIdx < allEpisodes.length - 1
        : allEpisodes.length > 0
          ? allEpisodes.some((e) => Number(e.number) > Number(targetEpNum))
          : true;
    const hasPrev =
      currentIdx !== -1 ? currentIdx > 0 : Number(targetEpNum) > 1;

    setLoading(true);
    setStatusMsg("Opening MPV player...");

    window.sharedStateAPI
      .playInMpv({
        mediaId: id,
        episodeId: targetEpId,
        episode: targetEpNum,
        isDownloaded: !!isDownloaded,
        title: animeTitle,
        image: image,
        provider: provider,
        malid: malid,
        subdub: subdub || playerSubDub,
        episodes: allEpisodes,
        hasNext,
        hasPrev,
      })
      .then((res) => {
        if (res && res.error) {
          setLoading(false);
          Swal.fire({
            icon: "error",
            title: "MPV Launch Error",
            text: res.error,
            background: "#18181b",
            color: "#fff",
            confirmButtonText: "OK",
          }).then(() => {
            if (onBack) onBack();
          });
        } else {
          setTimeout(() => {
            setLoading(false);
          }, 1200);
        }
      })
      .catch((err) => {
        setLoading(false);
        const msg = err.message || "Failed to launch MPV player.";
        Swal.fire({
          icon: "error",
          title: "MPV Launch Error",
          text: msg,
          background: "#18181b",
          color: "#fff",
          confirmButtonText: "OK",
        }).then(() => {
          if (onBack) onBack();
        });
      });

    const removeMpvStartedListener = window.sharedStateAPI.on(
      "mpv-started",
      () => {
        setLoading(false);
      },
    );

    const removeMpvCloseListener = window.sharedStateAPI.on(
      "mpv-closed",
      () => {
        setLoading(false);
        if (onBack) onBack();
      },
    );

    const removeMpvErrorListener = window.sharedStateAPI.on(
      "mpv-error",
      (data) => {
        setLoading(false);
        Swal.fire({
          icon: "error",
          title: "MPV Player Error",
          text: data?.message || "MPV player encountered an error.",
          background: "#18181b",
          color: "#fff",
          confirmButtonText: "OK",
        }).then(() => {
          if (onBack) onBack();
        });
      },
    );

    return () => {
      removeMpvStartedListener();
      removeMpvCloseListener();
      removeMpvErrorListener();
    };
  }, [id, episodeNumOrId, playerSubDub, provider]);

  if (!loading) return null;

  return (
    <>
      {/* Top Animated Progress Bar & Backdrop Blocker */}
      <style>{`
        @keyframes topProgressPulse {
          0% { width: 0%; left: 0%; }
          50% { width: 70%; left: 15%; }
          100% { width: 100%; left: 0%; }
        }
        .mpv-top-progress-bar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899);
          z-index: 99999;
          animation: topProgressPulse 1.5s infinite ease-in-out;
        }
        .mpv-blocker-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(4px);
          z-index: 99998;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: wait;
        }
        .mpv-blocker-card {
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 12px;
          padding: 24px 32px;
          display: flex;
          align-items: center;
          gap: 16px;
          box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
          color: #f4f4f5;
        }
      `}</style>
      <div className="mpv-top-progress-bar" />
      <div className="mpv-blocker-overlay">
        <div className="mpv-blocker-card">
          <Loader2 className="animate-spin text-blue-500" size={28} />
          <div>
            <h4 style={{ margin: 0, fontWeight: 600, fontSize: "15px" }}>
              Opening MPV Player
            </h4>
            <p
              style={{
                margin: "4px 0 0 0",
                fontSize: "13px",
                color: "#a1a1aa",
              }}
            >
              {statusMsg}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
