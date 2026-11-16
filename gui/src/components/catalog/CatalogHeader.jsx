import { Search, SlidersHorizontal } from "lucide-react";
import Dropdown from "../common/Dropdown";

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
  installedProviders = [],
  activeProvider = "",
  onProviderChange,
  isFilterOpen,
  onToggleFilter,
  activeFilterCount = 0,
  showFilterToggle = false,
}) {
  // Discover only: a provider picker sitting directly left of the
  // Anime/Manga toggle, listing the extensions installed for this type.
  const providerChoices = Array.isArray(installedProviders)
    ? [...installedProviders]
    : [];
  if (activeProvider && !providerChoices.includes(activeProvider)) {
    providerChoices.unshift(activeProvider);
  }
  // Show whenever at least one provider exists - with a single provider the
  // picker still shows the active extension (it becomes a switcher as soon as
  // more are installed), which is how Android surfaces it too.
  const showProviderPicker =
    provider === "provider" &&
    typeof onProviderChange === "function" &&
    providerChoices.length >= 1;

  const providerLabel = (value) => {
    const clean = String(value).replace(/^@/, "");
    if (!clean.includes("/")) return clean;
    const [owner, name] = clean.split("/");
    return `${name} (@${owner})`;
  };

  const typeOptions = [
    { value: "Anime", label: "Anime" },
    { value: "Manga", label: "Manga" },
    ...(provider !== "mal"
      ? [{ value: "Movies", label: "Movies & Series" }]
      : []),
  ];

  return (
    <header className="catalog-header">
      <div className="header-left-section">
        <div className="header-title-group">
          {provider === "local" && <h1 className="catalog-title">Home</h1>}
          {provider === "provider" && (
            <h1 className="catalog-title">Discover</h1>
          )}
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

        {showTypeToggle && (
          <div className="mobile-only">
            <Dropdown
              value={type}
              onChange={(val) => onTypeChange && onTypeChange(val)}
              options={typeOptions}
              className="header-type-dropdown"
              minWidth={140}
            />
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

      <div className="header-right-section">
        {showProviderPicker && (
          <select
            className="discover-provider-select"
            value={activeProvider || providerChoices[0]}
            onChange={(e) => onProviderChange(e.target.value)}
            aria-label="Change active provider"
            title="Choose which extension provider Discover uses"
          >
            {providerChoices.map((value) => (
              <option key={value} value={value}>
                {providerLabel(value)}
              </option>
            ))}
          </select>
        )}

        {showTypeToggle && (
          <div className="desktop-only">
            <Dropdown
              value={type}
              onChange={(val) => onTypeChange && onTypeChange(val)}
              options={typeOptions}
              className="header-type-dropdown"
              minWidth={160}
            />
          </div>
        )}
      </div>
    </header>
  );
}
