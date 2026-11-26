import { useState } from "react";
import { Users } from "lucide-react";
import { getInitials, sanitizeExternalUrl } from "./enrichmentUtils";

function CastAvatar({ src, name }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="cast-avatar-box">
        <span className="cast-avatar-initials">{getInitials(name)}</span>
      </div>
    );
  }

  return (
    <div className="cast-avatar-box">
      <img
        src={src}
        alt={name}
        className="cast-avatar-img"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export default function CastSection({ cast = [], mediaType = "Movies" }) {
  const list = Array.isArray(cast) ? cast : [];
  const [vaLang, setVaLang] = useState("Japanese");

  if (list.length === 0) return null;

  const isAnime = mediaType === "Anime";
  const hasEnglishVa =
    isAnime &&
    list.some((item) =>
      (item.voiceActors || []).some((va) => va.language === "English"),
    );
  const hasJapaneseVa =
    isAnime &&
    list.some((item) =>
      (item.voiceActors || []).some((va) => va.language === "Japanese"),
    );

  return (
    <section
      className="enrichment-section glass-panel"
      aria-label={isAnime ? "Characters & Voice Actors" : "Cast"}
    >
      <div className="enrichment-section-header">
        <div className="enrichment-section-title-wrap">
          <Users size={18} />
          <h2 className="enrichment-section-title">
            {isAnime ? "Voice Cast & Characters" : "Top Cast"}
          </h2>
        </div>

        {hasJapaneseVa && hasEnglishVa && (
          <div className="cast-lang-toggle" role="group" aria-label="Voice actor language">
            {["Japanese", "English"].map((lang) => (
              <button
                key={lang}
                type="button"
                className={`cast-lang-btn ${vaLang === lang ? "active" : ""}`}
                onClick={() => setVaLang(lang)}
              >
                {lang === "Japanese" ? "JP" : "EN"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="cast-scroll-strip">
        {list.map((person, idx) => {
          let displayName = person.name;
          let displayRole = person.role;
          let displayImage = person.image;
          let displayUrl = sanitizeExternalUrl(person.profileUrl);

          if (isAnime && Array.isArray(person.voiceActors) && person.voiceActors.length > 0) {
            const preferredVa =
              person.voiceActors.find((va) => va.language === vaLang) ||
              person.voiceActors[0];
            if (preferredVa) {
              displayName = preferredVa.name;
              displayRole = person.characterName || person.role;
              displayImage = preferredVa.image || person.characterImage || person.image;
              displayUrl =
                sanitizeExternalUrl(preferredVa.profileUrl) || displayUrl;
            }
          }

          const content = (
            <>
              <CastAvatar key={`${displayName}-${displayImage || "init"}`} src={displayImage} name={displayName} />
              <div className="cast-card-body">
                <div className="cast-person-name" title={displayName}>
                  {displayName}
                </div>
                {displayRole && (
                  <div className="cast-person-role" title={displayRole}>
                    {displayRole}
                  </div>
                )}
              </div>
            </>
          );

          if (displayUrl) {
            return (
              <a
                key={`${displayName}-${idx}`}
                href={displayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cast-card"
                title={`Open ${displayName} profile`}
              >
                {content}
              </a>
            );
          }

          return (
            <div key={`${displayName}-${idx}`} className="cast-card">
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}
