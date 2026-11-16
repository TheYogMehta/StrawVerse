import { Clock, CheckSquare, Tv, BookOpen } from "lucide-react";

export default function LibraryStats({
  type,
  stats,
  provider,
  linkingMalItem,
}) {
  if (provider !== "local" || !stats || linkingMalItem) return null;

  return (
    <div className="library-stats-container">
      <div className="library-stat-card glass-panel">
        <div className="stat-icon-wrapper purple-glow">
          <Clock size={16} className="stat-icon" />
        </div>
        <div className="stat-content">
          <span className="stat-label">
            {type === "Manga" ? "Time Read" : "Time Watched"}
          </span>
          <span className="stat-value">
            {type === "Manga"
              ? `${stats.readHours || 0} hrs`
              : type === "Movies"
                ? `${stats.movieWatchHours ?? 0} hrs`
                : `${stats.animeWatchHours ?? stats.watchHours ?? 0} hrs`}
          </span>
        </div>
      </div>

      <div className="library-stat-card glass-panel">
        <div className="stat-icon-wrapper green-glow">
          <CheckSquare size={16} className="stat-icon" />
        </div>
        <div className="stat-content">
          <span className="stat-label">
            {type === "Manga"
              ? "Chapters"
              : type === "Movies"
                ? "Episodes / Movies"
                : "Episodes"}
          </span>
          <span className="stat-value">
            {type === "Manga"
              ? `${stats.completedChapters || 0} chs`
              : type === "Movies"
                ? `${stats.completedMovieEpisodes ?? 0} eps`
                : `${stats.completedAnimeEpisodes ?? stats.completedEpisodes ?? 0} eps`}
          </span>
        </div>
      </div>

      <div className="library-stat-card glass-panel">
        <div className="stat-icon-wrapper blue-glow">
          {type === "Manga" ? (
            <BookOpen size={16} className="stat-icon" />
          ) : (
            <Tv size={16} className="stat-icon" />
          )}
        </div>
        <div className="stat-content">
          <span className="stat-label">
            {type === "Anime"
              ? "Total Series"
              : type === "Movies"
                ? "Total Movies & Series"
                : "Total Titles"}
          </span>
          <span className="stat-value">
            {type === "Anime"
              ? `${stats.distinctAnime || 0} Anime`
              : type === "Movies"
                ? `${stats.distinctMovies || 0} Titles`
                : `${stats.distinctManga || 0} Manga`}
          </span>
        </div>
      </div>
    </div>
  );
}
