import { useMemo } from "react";
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
  installedExtensions = [],
  activeProvider = "",
  onProviderChange,
  isFilterOpen,
  onToggleFilter,
  activeFilterCount = 0,
  showFilterToggle = false,
}) {
  const parseProvider = (item) => {
    if (!item) return null;
    if (typeof item === "object") {
      const name = String(item.name || item.id || "").trim();
      const owner = String(item.repoOwner || item.author || "TheYogMehta")
        .replace(/^@/, "")
        .trim();
      const value =
        item.uniqueId ||
        (owner.toLowerCase() === "theyogmehta" ? name : `@${owner}/${name}`);
      return { name, owner, value, icon: item.icon || null };
    }
    const raw = String(item).trim();
    const clean = raw.replace(/^@/, "");
    if (clean.includes("/")) {
      const parts = clean.split("/");
      const owner = parts[0];
      const name = parts[1];
      return { name, owner, value: raw, icon: null };
    }
    let owner = "TheYogMehta";
    let icon = null;
    if (Array.isArray(installedExtensions)) {
      const ext = installedExtensions.find(
        (e) => String(e.name || "").toLowerCase() === clean.toLowerCase(),
      );
      if (ext?.repoOwner) {
        owner = ext.repoOwner.replace(/^@/, "");
      }
      if (ext?.icon) {
        icon = ext.icon;
      }
    }
    return { name: clean, owner, value: raw, icon };
  };

  const providerOptions = useMemo(() => {
    const list = [];
    const seen = new Set();

    const addChoice = (item) => {
      const parsed = parseProvider(item);
      if (!parsed || !parsed.name) return;
      const key = `${parsed.owner.toLowerCase()}/${parsed.name.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({
        value: parsed.value,
        name: parsed.name,
        owner: parsed.owner,
        label: `${parsed.name} (@${parsed.owner})`,
        icon: parsed.icon,
      });
    };

    if (Array.isArray(installedExtensions) && installedExtensions.length > 0) {
      installedExtensions.forEach(addChoice);
    }
    if (Array.isArray(installedProviders)) {
      installedProviders.forEach(addChoice);
    }
    if (activeProvider) {
      addChoice(activeProvider);
    }

    return list;
  }, [installedExtensions, installedProviders, activeProvider]);

  const activeValue = useMemo(() => {
    if (!activeProvider) return providerOptions[0]?.value || "";
    const parsed = parseProvider(activeProvider);
    if (!parsed) return providerOptions[0]?.value || "";
    const matched = providerOptions.find(
      (opt) =>
        opt.name.toLowerCase() === parsed.name.toLowerCase() &&
        opt.owner.toLowerCase() === parsed.owner.toLowerCase(),
    );
    return matched ? matched.value : activeProvider;
  }, [providerOptions, activeProvider]);

  const showProviderPicker =
    provider === "provider" &&
    typeof onProviderChange === "function" &&
    providerOptions.length >= 1;

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
          <Dropdown
            value={activeValue}
            onChange={(val) => onProviderChange(val)}
            options={providerOptions}
            className="header-type-dropdown discover-provider-dropdown"
            minWidth={170}
          />
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
