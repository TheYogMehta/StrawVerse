import { Star, Clock, ExternalLink } from "lucide-react";
import { sanitizeExternalUrl } from "./enrichmentUtils";

const EXTERNAL_LABELS = [
  { key: "imdb", label: "IMDb" },
  { key: "tmdb", label: "TMDB" },
  { key: "mal", label: "MAL" },
  { key: "anilist", label: "AniList" },
];

export function MediaEnrichmentBadges({ enrichment }) {
  if (!enrichment?.found) return null;

  const hasRating =
    enrichment.rating && typeof enrichment.rating.score === "number";
  const hasRuntime = Boolean(enrichment.runtime);
  const hasStatus = Boolean(enrichment.status);

  if (!hasRating && !hasRuntime && !hasStatus) return null;

  return (
    <div className="enrichment-badges-row">
      {hasRating && (
        <span
          className="enrichment-badge enrichment-badge--rating"
          title={`Score from ${enrichment.rating.label}`}
        >
          <Star size={12} fill="currentColor" />
          <span>
            {enrichment.rating.scale === 100
              ? `${Math.round(enrichment.rating.score * 10)}% ${enrichment.rating.label}`
              : `${enrichment.rating.score.toFixed(1)}/10 ${enrichment.rating.label}`}
          </span>
          {enrichment.rating.votes ? (
            <span className="enrichment-badge--votes">
              ({enrichment.rating.votes.toLocaleString()})
            </span>
          ) : null}
        </span>
      )}

      {hasRuntime && (
        <span className="enrichment-badge" title="Runtime">
          <Clock size={12} />
          <span>{enrichment.runtime}</span>
        </span>
      )}

      {hasStatus && (
        <span className="enrichment-badge enrichment-badge--status">
          {enrichment.status}
        </span>
      )}
    </div>
  );
}

export default function MediaEnrichmentMeta({ enrichment }) {
  if (!enrichment?.found) return null;

  const directors = Array.isArray(enrichment.directors)
    ? enrichment.directors
    : [];
  const studios = Array.isArray(enrichment.studios)
    ? enrichment.studios
    : [];
  const externalEntries = EXTERNAL_LABELS.map((item) => ({
    ...item,
    url: sanitizeExternalUrl(enrichment.externalUrls?.[item.key]),
  })).filter((item) => Boolean(item.url));

  if (
    directors.length === 0 &&
    studios.length === 0 &&
    externalEntries.length === 0
  ) {
    return null;
  }

  return (
    <div className="enrichment-credits-group">
      {directors.length > 0 && (
        <div className="meta-item">
          <strong>{directors.length > 1 ? "Directors:" : "Director:"}</strong>{" "}
          {directors.map((d) => d.name).join(", ")}
        </div>
      )}

      {studios.length > 0 && (
        <div className="meta-item">
          <strong>{studios.length > 1 ? "Studios:" : "Studio:"}</strong>{" "}
          {studios.join(", ")}
        </div>
      )}

      {externalEntries.length > 0 && (
        <div className="enrichment-external-links">
          {externalEntries.map((item) => (
            <a
              key={item.key}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="enrichment-ext-link"
            >
              <span>{item.label}</span>
              <ExternalLink size={11} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
