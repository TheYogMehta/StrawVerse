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
          <Clock size={20} className="stat-icon" />
        </div>
        <div className="stat-content">
          <span className="stat-label">Total Time Spent</span>
          <span className="stat-value">
            {type === "Anime"
              ? `${stats.watchHours || 0} hrs`
              : `${stats.readHours || 0} hrs`}
          </span>
        </div>
      </div>

      <div className="library-stat-card glass-panel">
        <div className="stat-icon-wrapper green-glow">
          <CheckSquare size={20} className="stat-icon" />
        </div>
        <div className="stat-content">
          <span className="stat-label">
            {type === "Anime" ? "Episodes Watched" : "Chapters Read"}
          </span>
          <span className="stat-value">
            {type === "Anime"
              ? `${stats.completedEpisodes || 0} eps`
              : `${stats.completedChapters || 0} chs`}
          </span>
        </div>
      </div>

      <div className="library-stat-card glass-panel">
        <div className="stat-icon-wrapper blue-glow">
          {type === "Anime" ? (
            <Tv size={20} className="stat-icon" />
          ) : (
            <BookOpen size={20} className="stat-icon" />
          )}
        </div>
        <div className="stat-content">
          <span className="stat-label">
            {type === "Anime" ? "Total Anime" : "Total Manga"}
          </span>
          <span className="stat-value">
            {type === "Anime"
              ? `${stats.distinctAnime || 0} Anime`
              : `${stats.distinctManga || 0} Manga`}
          </span>
        </div>
      </div>
    </div>
  );
}
