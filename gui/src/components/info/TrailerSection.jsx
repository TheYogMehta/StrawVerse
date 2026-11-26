import { useState } from "react";
import { Play, Film, ExternalLink } from "lucide-react";
import { isValidYoutubeId, sanitizeExternalUrl } from "./enrichmentUtils";

export default function TrailerSection({ trailers = [] }) {
  const validTrailers = Array.isArray(trailers)
    ? trailers.filter((t) => isValidYoutubeId(t?.youtubeId))
    : [];

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  if (validTrailers.length === 0) return null;

  const safeIndex = selectedIndex < validTrailers.length ? selectedIndex : 0;
  const active = validTrailers[safeIndex];
  const youtubeId = active.youtubeId.trim();
  const watchUrl =
    sanitizeExternalUrl(active.watchUrl) ||
    `https://www.youtube.com/watch?v=${youtubeId}`;
  const thumbUrl = `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
  const embedUrl = `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0`;

  return (
    <section
      className="enrichment-section glass-panel"
      aria-label="Official Trailer"
    >
      <div className="enrichment-section-header">
        <div className="enrichment-section-title-wrap">
          <Film size={18} />
          <h2 className="enrichment-section-title">Trailer</h2>
          {active.title && (
            <span className="enrichment-section-sub">{active.title}</span>
          )}
        </div>

        <div className="enrichment-header-actions">
          {validTrailers.length > 1 && (
            <div className="trailer-pills" role="tablist" aria-label="Trailers">
              {validTrailers.map((item, idx) => (
                <button
                  key={`${item.youtubeId}-${idx}`}
                  type="button"
                  role="tab"
                  aria-selected={idx === safeIndex}
                  className={`trailer-pill-btn ${idx === safeIndex ? "active" : ""}`}
                  onClick={() => {
                    setSelectedIndex(idx);
                    setIsPlaying(false);
                  }}
                >
                  {item.type || "Trailer"} {validTrailers.length > 1 ? idx + 1 : ""}
                </button>
              ))}
            </div>
          )}

          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="trailer-youtube-link"
            title="Open trailer in YouTube"
          >
            <span>Open in YouTube</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      <div className="trailer-frame-shell">
        {isPlaying ? (
          <iframe
            key={youtubeId}
            className="trailer-iframe"
            src={embedUrl}
            title={active.title || "Trailer"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            className="trailer-facade-btn"
            onClick={() => setIsPlaying(true)}
            aria-label={`Play ${active.title || "trailer"}`}
          >
            <img
              src={thumbUrl}
              alt={active.title || "Trailer thumbnail"}
              className="trailer-thumb-img"
              loading="lazy"
            />
            <div className="trailer-facade-overlay">
              <div className="trailer-play-circle">
                <Play size={26} fill="currentColor" />
              </div>
              <span className="trailer-facade-caption">
                Play {active.title || "Trailer"}
              </span>
            </div>
          </button>
        )}
      </div>
    </section>
  );
}
