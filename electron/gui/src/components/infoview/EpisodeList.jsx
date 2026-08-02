import React from "react";
import { Play, Download, CheckCircle, Search, ArrowUpDown } from "lucide-react";

export default function EpisodeList({
  items,
  type,
  dubSelect,
  setDubSelect,
  sortOrder,
  setSortOrder,
  episodeSearchQuery,
  setEpisodeSearchQuery,
  selectedItems,
  toggleSelectItem,
  isItemFullyDownloaded,
  onWatch,
  episodesStatus,
}) {
  return (
    <div className="episodes-list-section">
      <div className="episodes-controls-bar">
        <div className="search-box-wrapper">
          <Search className="search-icon" />
          <input
            type="text"
            placeholder="Search episodes..."
            value={episodeSearchQuery}
            onChange={(e) => setEpisodeSearchQuery(e.target.value)}
            className="episode-search-input"
          />
        </div>

        <div className="episodes-filter-controls">
          {type === "Anime" && (
            <div className="sub-dub-toggle">
              <button
                className={`toggle-btn ${dubSelect === "sub" ? "active" : ""}`}
                onClick={() => setDubSelect("sub")}
              >
                Sub
              </button>
              <button
                className={`toggle-btn ${dubSelect === "dub" ? "active" : ""}`}
                onClick={() => setDubSelect("dub")}
              >
                Dub
              </button>
            </div>
          )}

          <button
            className="sort-btn"
            onClick={() =>
              setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
            }
          >
            <ArrowUpDown className="icon-sm" /> {sortOrder.toUpperCase()}
          </button>
        </div>
      </div>

      <div className="episodes-grid">
        {items.map((item) => {
          const isDownloaded = isItemFullyDownloaded(item);
          const isSelected = selectedItems.has(item.id);
          const status = episodesStatus?.find(
            (s) => Number(s.number) === Number(item.number),
          );

          return (
            <div
              key={item.id}
              className={`episode-card ${isSelected ? "selected" : ""} ${
                isDownloaded ? "downloaded" : ""
              }`}
              onClick={() => toggleSelectItem(item.id)}
            >
              <div className="episode-card-header">
                <span className="episode-number">Ep {item.number}</span>
                {isDownloaded && <CheckCircle className="icon-downloaded" />}
              </div>

              <div className="episode-card-title">
                {item.title || `Episode ${item.number}`}
              </div>

              <div className="episode-card-actions">
                <button
                  className="btn-card-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    onWatch(item.id, item.number);
                  }}
                >
                  <Play className="icon-xs" /> Play
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
