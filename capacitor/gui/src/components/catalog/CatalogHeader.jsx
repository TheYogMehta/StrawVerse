import { Search } from "lucide-react";

export default function CatalogHeader({
  provider,
  type,
  discoverTab,
  onSubTabChange,
  linkingMalItem,
  searchQuery,
  onSearchQueryChange,
  onSearchSubmit,
  onTypeChange,
  showTypeToggle = true,
}) {
  return (
    <header className="catalog-header">
      <div className="catalog-header-row">
        <h1 className="catalog-title">
          {provider === "local"
            ? "Home"
            : provider === "mal"
              ? "MyAnimeList"
              : "Discover"}
        </h1>
        {showTypeToggle && (
          <div className="market-tabs-wrapper">
            <button
              type="button"
              onClick={() => onTypeChange && onTypeChange("Anime")}
              className={`market-tab-btn ${type === "Anime" ? "active" : ""}`}
            >
              Anime
            </button>
            <button
              type="button"
              onClick={() => onTypeChange && onTypeChange("Manga")}
              className={`market-tab-btn ${type === "Manga" ? "active" : ""}`}
            >
              Manga
            </button>
          </div>
        )}
      </div>

      {provider === "provider" && type === "Anime" && (
        <div className="discover-sub-tabs">
          <button
            onClick={() => onSubTabChange("latest")}
            className={`discover-sub-tab ${discoverTab === "latest" ? "active" : ""}`}
          >
            Latest
          </button>
          <button
            onClick={() => onSubTabChange("calendar")}
            className={`discover-sub-tab ${discoverTab === "calendar" ? "active" : ""}`}
          >
            Airing Calendar
          </button>
        </div>
      )}

      {((provider !== "local" && provider !== "mal") || linkingMalItem) &&
        discoverTab !== "calendar" && (
          <form onSubmit={onSearchSubmit} className="search-form">
            <input
              type="text"
              placeholder={`Search ${type}...`}
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="search-input"
            />
            <button type="submit" className="btn-search">
              <Search size={18} />
            </button>
          </form>
        )}
    </header>
  );
}
