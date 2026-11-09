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
  type = "Anime",
}) {
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState("Initializing MPV player...");
  const [currentEpNumOrId, setCurrentEpNumOrId] = useState(episodeNumOrId);

  useEffect(() => {
    setCurrentEpNumOrId(episodeNumOrId);
  }, [episodeNumOrId]);

  useEffect(() => {
    const isElectronMpvAvailable =
      typeof window !== "undefined" &&
      window.sharedStateAPI &&
      typeof window.sharedStateAPI.playInMpv === "function";

    if (!isElectronMpvAvailable) return;

    const allEpisodes = episodes.length > 0 ? episodes : episodesList;
    const sortedEpisodes = [...allEpisodes].sort((a, b) => {
      const numA = Number(a.number !== undefined ? a.number : a.id);
      const numB = Number(b.number !== undefined ? b.number : b.id);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return 0;
    });

    const currentEpisodeObj = sortedEpisodes.find(
      (item) =>
        String(item.id) === String(currentEpNumOrId) ||
        Number(item.number) === Number(currentEpNumOrId),
    );

    const targetEpId = currentEpisodeObj
      ? currentEpisodeObj.id
      : currentEpNumOrId;
    const targetEpNum = currentEpisodeObj
      ? currentEpisodeObj.number
      : typeof currentEpNumOrId === "number" ||
          (!isNaN(Number(currentEpNumOrId)) &&
            !String(currentEpNumOrId).includes("|"))
        ? Number(currentEpNumOrId)
        : 1;

    const currentIdx = sortedEpisodes.findIndex(
      (item) =>
        String(item.id) === String(currentEpNumOrId) ||
        Number(item.number) === Number(targetEpNum),
    );
    const hasNext =
      currentIdx !== -1
        ? currentIdx < sortedEpisodes.length - 1
        : sortedEpisodes.some((e) => Number(e.number) > Number(targetEpNum));
    const hasPrev =
      currentIdx !== -1
        ? currentIdx > 0
        : Number(targetEpNum) > 1;

    setLoading(true);
    setStatusMsg(`Opening MPV player for Episode ${targetEpNum}...`);

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
        episodes: sortedEpisodes,
        hasNext,
        hasPrev,
        type: type || "Anime",
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
        } else if (res && res.reused) {
          // In-place loadfile — overlay will hide when mpv-started fires on file-loaded
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

    const handleNextEpisode = () => {
      let nextEp = null;
      if (currentIdx !== -1 && currentIdx < sortedEpisodes.length - 1) {
        nextEp = sortedEpisodes[currentIdx + 1];
      } else {
        nextEp = sortedEpisodes.find(
          (e) => Number(e.number) > Number(targetEpNum),
        );
      }
      if (nextEp) {
        setLoading(true);
        setStatusMsg(`Loading Episode ${nextEp.number || nextEp.id}...`);
        setCurrentEpNumOrId(nextEp.number || nextEp.id);
      } else if (onBack) {
        onBack();
      }
    };

    const handlePrevEpisode = () => {
      let prevEp = null;
      if (currentIdx > 0) {
        prevEp = sortedEpisodes[currentIdx - 1];
      } else {
        const prevCandidates = sortedEpisodes.filter(
          (e) => Number(e.number) < Number(targetEpNum),
        );
        if (prevCandidates.length > 0) {
          prevEp = prevCandidates[prevCandidates.length - 1];
        }
      }
      if (prevEp) {
        setLoading(true);
        setStatusMsg(`Loading Episode ${prevEp.number || prevEp.id}...`);
        setCurrentEpNumOrId(prevEp.number || prevEp.id);
      }
    };

    const removeMpvStartedListener = window.sharedStateAPI.on(
      "mpv-started",
      () => {
        setLoading(false);
      },
    );

    // Show overlay while backend fetches sources for next/prev episode
    const removeMpvLoadingListener = window.sharedStateAPI.on(
      "mpv-loading",
      (data) => {
        setLoading(true);
        setStatusMsg(
          data?.episode
            ? `Fetching sources for Episode ${data.episode}...`
            : "Fetching episode sources...",
        );
      },
    );

    const removeMpvActionListener = window.sharedStateAPI.on(
      "mpv-action",
      (data) => {
        if (data?.action === "next") {
          handleNextEpisode();
        } else if (data?.action === "prev") {
          handlePrevEpisode();
        }
      },
    );

    const removeMpvCloseListener = window.sharedStateAPI.on(
      "mpv-closed",
      (data) => {
        setLoading(false);
        if (data?.action === "next") {
          handleNextEpisode();
        } else if (data?.action === "prev") {
          handlePrevEpisode();
        } else if (onBack) {
          onBack();
        }
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
      removeMpvLoadingListener();
      removeMpvActionListener();
      removeMpvCloseListener();
      removeMpvErrorListener();
    };
  }, [id, currentEpNumOrId, playerSubDub, provider]);

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
