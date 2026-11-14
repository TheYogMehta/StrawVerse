import { Play, X } from "lucide-react";

export default function RecentHistory({
  type,
  provider,
  linkingMalItem,
  recentHistory,
  onSelectMedia,
  onDismissHistory,
}) {
  if (provider !== "local" || linkingMalItem) return null;

  const displayable = (recentHistory || []).filter((item) => {
    if (item.has_next === false) return false;
    if (item.is_completed === 0) return true;
    if (
      item.total_count === null ||
      item.total_count === undefined ||
      item.number < item.total_count
    ) {
      return true;
    }
    return false;
  });

  if (displayable.length === 0) return null;

  return (
    <div className="continue-shelf-container">
      <h2 className="shelf-title">
        {type === "Manga" ? "Continue Reading" : "Continue Watching"}
      </h2>
      <div className="continue-shelf-scroll">
        {displayable.slice(0, 4).map((item) => {
          const isItemCompleted = item.is_completed === 1;
          const nextSeason =
            item.next_season !== undefined && item.next_season !== null
              ? Number(item.next_season)
              : item.season !== undefined && item.season !== null
                ? Number(item.season)
                : 1;
          const nextNum =
            item.next_number !== undefined && item.next_number !== null
              ? Number(item.next_number)
              : isItemCompleted
                ? item.number + 1
                : item.number;
          const progress = isItemCompleted
            ? 0
            : item.duration > 0
              ? Math.min(
                  100,
                  Math.max(
                    0,
                    Math.round((item.current_time / item.duration) * 100),
                  ),
                )
              : 0;

          return (
            <div
              key={`${item.media_id}-${item.season || 1}-${item.number}`}
              className="continue-card glass-panel"
              onClick={() =>
                onSelectMedia(
                  item.media_id,
                  "local",
                  "Back to Collection",
                  true,
                  nextNum,
                  nextSeason,
                )
              }
            >
              <div className="continue-img-container">
                <button
                  className="continue-dismiss-btn"
                  title={`Hide from Continue ${type === "Manga" ? "Reading" : "Watching"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismissHistory(item);
                  }}
                >
                  <X size={14} />
                </button>
                {(() => {
                  const localSrc =
                    item.local_image ||
                    (item.image &&
                    (item.image.includes("/api/image") ||
                      item.image.startsWith("file://"))
                      ? item.image
                      : null);
                  const malSrc = item.mal_image;
                  const scraperSrc = item.scraper_image;
                  const defaultSrc =
                    item.fallback_image || "/images/image-404.png";
                  const primarySrc =
                    localSrc || malSrc || scraperSrc || defaultSrc;

                  return (
                    <img
                      src={primarySrc}
                      alt={item.title}
                      className="continue-img"
                      onError={(e) => {
                        const currentSrc = e.target.src;
                        const fallbacks = [
                          localSrc,
                          malSrc,
                          scraperSrc,
                          defaultSrc,
                        ].filter(Boolean);
                        const nextSrc = fallbacks.find(
                          (src) =>
                            src &&
                            currentSrc !== src &&
                            currentSrc !== window.location.origin + src,
                        );
                        if (nextSrc) {
                          e.target.src = nextSrc;
                        } else {
                          e.target.onerror = null;
                          e.target.src = defaultSrc;
                        }
                      }}
                    />
                  );
                })()}
                <div className="continue-play-overlay">
                  <Play size={28} className="continue-play-icon" />
                </div>
                <div className="continue-progress-container">
                  <div
                    className="continue-progress-bar"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
              <div className="continue-info">
                <span className="continue-number">
                  {type === "Manga"
                    ? `Chapter ${nextNum}`
                    : (type === "Movies" || item.type === "Movies" || (item.season && item.season > 1))
                      ? `Season ${nextSeason} Ep ${nextNum}`
                      : `Episode ${nextNum}`}
                </span>
                <h4 className="continue-title" title={item.title}>
                  {item.title}
                </h4>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
