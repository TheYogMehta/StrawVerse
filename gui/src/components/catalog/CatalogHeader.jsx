import { Search, SlidersHorizontal } from "lucide-react";

export default function CatalogHeader({
  provider,
  type,
  discoverTab,
  onSubTabChange,
  searchQuery,
  onSearchQueryChange,
  onSearchSubmit,
  onTypeChange,
  showTypeToggle = true,
  catalogSource = "mal",
  isFilterOpen,
  onToggleFilter,
  activeFilterCount = 0,
  showFilterToggle = false,
}) {
  return (
    <header className="catalog-header">
      <div className="header-left-section">
        {provider === "local" && <h1 className="catalog-title">Home</h1>}
        {provider === "provider" && <h1 className="catalog-title">Discover</h1>}
        {provider === "mal" && <h1 className="catalog-title">Filters</h1>}
        {provider === "provider" && type === "Anime" && (
          <div className="discover-sub-tabs">
            <button
              onClick={() => onSubTabChange && onSubTabChange("latest")}
              className={`discover-sub-tab ${discoverTab === "latest" ? "active" : ""}`}
            >
              Latest
            </button>
            <button
              onClick={() => onSubTabChange && onSubTabChange("calendar")}
              className={`discover-sub-tab ${discoverTab === "calendar" ? "active" : ""}`}
            >
              Airing Calendar
            </button>
          </div>
        )}
      </div>

      <div className="header-search-section">
        <div className="search-and-filter-wrapper">
          <form onSubmit={onSearchSubmit} className="search-form">
            <input
              type="text"
              placeholder={
                provider === "mal" && catalogSource?.startsWith("unique:")
                  ? `Search unmapped ${type.toLowerCase()}...`
                  : type === "Movies"
                    ? "Search Movies & Series..."
                    : `Search ${type}...`
              }
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="search-input"
            />
            <button type="submit" className="btn-search">
              <Search size={18} />
            </button>
          </form>
          {showFilterToggle && onToggleFilter && (
            <button
              type="button"
              onClick={onToggleFilter}
              className={`catalog-filter-btn ${isFilterOpen ? "active" : ""} ${activeFilterCount > 0 ? "has-filters" : ""}`}
              title="Toggle filters panel"
            >
              <SlidersHorizontal size={16} />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="filter-badge">{activeFilterCount}</span>
              )}
            </button>
          )}
        </div>
      </div>

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
          {provider !== "mal" && (
            <button
              type="button"
              onClick={() => onTypeChange && onTypeChange("Movies")}
              className={`market-tab-btn ${type === "Movies" ? "active" : ""}`}
            >
              Movies & Series
            </button>
          )}
        </div>
      )}
    </header>
  );
}
