/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, no-unused-vars */
import { useState, useEffect, useCallback } from "react";
import "./css/Catalog.css";
import {
  Search,
  Loader2,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Download,
  Eye,
  Film,
  Plus,
  Folder,
} from "lucide-react";
import Swal from "sweetalert2";

export default function Catalog({ type, provider, onSelectMedia }) {
  const [data, setData] = useState({
    results: [],
    totalPages: 0,
    currentPage: 1,
    hasNextPage: false,
  });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [activeFilters, setActiveFilters] = useState({});
  const [availableFilters, setAvailableFilters] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [localTags, setLocalTags] = useState([]);
  const [providerIconMap, setProviderIconMap] = useState({});
  const [linkingMalItem, setLinkingMalItem] = useState(null);

  // Define supported filter maps matching index.js
  const siteFilterDefs = {
    // legacy for now..
  };

  const getApiEndpoint = (currentTag = activeFilters.tag) => {
    if (provider === "local") {
      if (currentTag === "MyAnimeList") {
        return `/api/list/${type}/mal`;
      }
      return `/api/list/${type}/local`;
    }
    if (provider === "mal") return `/api/list/${type}/mal`;
    if (searchQuery.trim().length > 0)
      return `/api/list/${type}/search?query=${encodeURIComponent(searchQuery)}`;
    return `/api/list/${type}/provider`;
  };

  const fetchData = async (
    page = 1,
    currentFilters = activeFilters,
    searchOverride = null,
    linkingOverride = undefined,
  ) => {
    setLoading(true);
    setErrorMsg("");
    try {
      const activeSearch =
        searchOverride !== null ? searchOverride : searchQuery;
      const isLinking =
        linkingOverride !== undefined ? linkingOverride : linkingMalItem;

      let endpoint;
      if (isLinking) {
        endpoint = `/api/list/${type}/search?query=${encodeURIComponent(activeSearch)}`;
      } else {
        endpoint = getApiEndpoint(currentFilters.tag);
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: {
            ...currentFilters,
            page: page,
          },
        }),
      });

      if (!response.ok) throw new Error("Network error fetching catalog data.");
      const resData = await response.json();

      if (resData?.extension_missing) {
        setErrorMsg(
          `Extension missing. Please install a provider for ${type} in Settings.`,
        );
        setData({
          results: [],
          totalPages: 0,
          currentPage: 1,
          hasNextPage: false,
        });
      } else if (resData?.error) {
        setErrorMsg(resData.message || "Failed to fetch catalog.");
        setData({
          results: [],
          totalPages: 0,
          currentPage: 1,
          hasNextPage: false,
        });
      } else {
        setData(resData);
        if (resData?.site && siteFilterDefs[resData.site]) {
          setAvailableFilters(siteFilterDefs[resData.site]);
        } else {
          setAvailableFilters(null);
        }
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(
        "Failed to load data. Please verify your settings or server connection.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCancelLinking = () => {
    setLinkingMalItem(null);
    setSearchQuery("");
    fetchData(1, activeFilters, "", null);
  };

  // Trigger fetch when catalog view or filter dependencies change
  useEffect(() => {
    setCurrentPage(1);
    setLinkingMalItem(null);
    fetchData(1, {}, "", null);
    setActiveFilters({});

    if (provider === "local") {
      fetch(`/api/local/tags/${type}`)
        .then((res) => res.json())
        .then((tags) => setLocalTags(tags))
        .catch((err) => console.error(err));
    } else {
      setLocalTags([]);
    }

    if (provider === "local" || provider === "mal") {
      // Fetch provider icons for local library badges
      fetch("/api/providers")
        .then((res) => res.json())
        .then((data) => {
          const map = {};
          if (data) {
            [...(data.Anime || []), ...(data.Manga || [])].forEach((p) => {
              map[p.name] = p.icon || null;
            });
          }
          setProviderIconMap(map);
        })
        .catch(() => {});
    }
  }, [type, provider]);

  const handleAddLocalTag = async () => {
    const { value: tagName } = await Swal.fire({
      title: "Create Custom Tag",
      input: "text",
      inputPlaceholder: "Enter tag name...",
      showCancelButton: true,
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      confirmButtonColor: "var(--accent)",
      cancelButtonColor: "var(--bg-tertiary)",
    });
    if (tagName && tagName.trim()) {
      const trimmed = tagName.trim();
      const lower = trimmed.toLowerCase();
      const forbidden = [
        "watching",
        "plan to watch",
        "reading",
        "plan to read",
        "myanimelist",
      ];
      if (forbidden.includes(lower)) {
        Swal.fire({
          title: "Reserved Tag Name",
          text: `"${trimmed}" is a reserved system tag and cannot be created manually.`,
          icon: "warning",
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
          confirmButtonColor: "var(--accent)",
        });
        return;
      }
      if (!localTags.includes(trimmed)) {
        setLocalTags((prev) => [...prev, trimmed]);
        Swal.fire({
          title: "Tag Created",
          text: `Tag "${trimmed}" created. You can now assign it to items in their details page!`,
          icon: "success",
          toast: true,
          position: "top-end",
          showConfirmButton: false,
          timer: 3000,
          background: "var(--bg-secondary)",
          color: "var(--text-main)",
        });
      }
    }
  };

  const handleMediaClick = (item) => {
    if (linkingMalItem) {
      // Link the clicked provider item to the MAL item!
      Swal.fire({
        title: "Link Title",
        text: `Link "${item.title}" to MyAnimeList entry "${linkingMalItem.title}"?`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Yes, link it",
        cancelButtonText: "Cancel",
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
        confirmButtonColor: "var(--accent)",
        cancelButtonColor: "var(--bg-tertiary)",
      }).then((result) => {
        if (result.isConfirmed) {
          Swal.fire({
            title: "Linking...",
            allowOutsideClick: false,
            didOpen: () => {
              Swal.showLoading();
            },
          });

          fetch("/api/local/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: type,
              id: item.id,
              title: item.title,
              ImageUrl: item.image,
              provider: data.site || item.provider,
              MalID: linkingMalItem.MalID || linkingMalItem.id,
            }),
          })
            .then((res) => res.json())
            .then((linkRes) => {
              if (!linkRes.error) {
                Swal.fire({
                  title: "Linked!",
                  text: `Successfully linked to "${item.title}"!`,
                  icon: "success",
                  background: "var(--bg-secondary)",
                  color: "var(--text-main)",
                  confirmButtonColor: "var(--accent)",
                }).then(() => {
                  setLinkingMalItem(null);
                  setSearchQuery("");
                  fetchData(1, activeFilters, "", null);
                });
              } else {
                Swal.fire({
                  title: "Error",
                  text: linkRes.message || "Failed to link title.",
                  icon: "error",
                });
              }
            });
        }
      });
      return;
    }

    const isMalActive =
      provider === "mal" ||
      (provider === "local" && activeFilters.tag === "MyAnimeList");

    // Determine what back text to display
    let backText = "Back to Collection";
    if (searchQuery.trim().length > 0) {
      backText = "Back to Search";
    } else if (provider === "local") {
      if (activeFilters.tag) {
        backText = `Back to ${activeFilters.tag}`;
      } else {
        backText = "Back to Collection";
      }
    } else if (provider === "provider") {
      backText = "Back to Recently Updated";
    } else if (provider === "mal") {
      backText = "Back to MAL Library";
    }

    if (isMalActive && item.allMatches && item.allMatches.length > 1) {
      const inputOptions = {};
      item.allMatches.forEach((m) => {
        inputOptions[m.id] = m.provider.toUpperCase();
      });

      Swal.fire({
        title: "Select Provider",
        text: `Choose which provider to open "${item.title}" with:`,
        icon: "question",
        input: "select",
        inputOptions,
        inputValue: item.id,
        showCancelButton: true,
        confirmButtonText: "Open",
        cancelButtonText: "Cancel",
        background: "var(--bg-secondary)",
        color: "var(--text-main)",
        confirmButtonColor: "var(--accent)",
        cancelButtonColor: "var(--bg-tertiary)",
      }).then((result) => {
        if (result.isConfirmed && result.value) {
          onSelectMedia(result.value, "provider", backText);
        }
      });
      return;
    }

    onSelectMedia(item.id, isMalActive ? "provider" : provider, backText);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchData(1);
  };

  const handleFilterChange = (filterName, val) => {
    const nextFilters = { ...activeFilters };
    if (val === "") {
      delete nextFilters[filterName];
    } else {
      nextFilters[filterName] = val;
    }
    setActiveFilters(nextFilters);
    setCurrentPage(1);
    fetchData(1, nextFilters);
  };

  const handlePageChange = (page) => {
    if (page < 1) return;
    setCurrentPage(page);
    fetchData(page);
  };

  return (
    <div className="catalog-wrapper">
      <header className="catalog-header">
        <h1 className="catalog-title">
          {provider === "local"
            ? `Local ${type}`
            : provider === "mal"
              ? `MyAnimeList ${type}`
              : `Discover ${type}`}
        </h1>

        {/* Search bar for non-local searches, or when linking a MAL title */}
        {((provider !== "local" && provider !== "mal") || linkingMalItem) && (
          <form onSubmit={handleSearchSubmit} className="search-form">
            <input
              type="text"
              placeholder={`Search ${type}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            <button type="submit" className="btn-search">
              <Search size={18} />
            </button>
          </form>
        )}
      </header>

      {/* Filter panel */}
      {availableFilters && (
        <div className="filter-panel">
          {Object.entries(availableFilters).map(([key, filter]) => (
            <div key={key} className="filter-group">
              <label className="filter-label">{filter.label}</label>
              <select
                value={activeFilters[key] || ""}
                onChange={(e) => handleFilterChange(key, e.target.value)}
                className="filter-select"
              >
                {Object.entries(filter.options).map(([optLabel, optVal]) => (
                  <option key={optLabel} value={optVal}>
                    {optLabel}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Local Tag Filter panel */}
      {provider === "local" && !linkingMalItem && (
        <div className="tag-chips-container">
          <button
            onClick={() => handleFilterChange("tag", "")}
            className={`tag-chip ${!activeFilters.tag || activeFilters.tag === "" ? "active" : ""}`}
          >
            All
          </button>
          {localTags.map((tag) => (
            <button
              key={tag}
              onClick={() => handleFilterChange("tag", tag)}
              className={`tag-chip ${activeFilters.tag === tag ? "active" : ""}`}
            >
              {tag}
            </button>
          ))}
          <button
            onClick={handleAddLocalTag}
            className="tag-chip btn-add-tag"
            title="Create Custom Tag"
          >
            <Plus size={14} style={{ marginRight: "4px" }} />
            Add Tag
          </button>
        </div>
      )}

      {/* Linking Banner */}
      {linkingMalItem && (
        <div className="linking-banner">
          <span className="linking-banner-text">
            Linking MyAnimeList title: <strong>{linkingMalItem.title}</strong>.
            Select the matching card below to link it.
          </span>
          <button onClick={handleCancelLinking} className="btn-cancel-link">
            Cancel Link
          </button>
        </div>
      )}

      {errorMsg && <div className="error-banner">{errorMsg}</div>}

      {/* Content grid */}
      {loading ? (
        <div className="loading-center-panel">
          <img
            src="/images/loading.gif"
            alt="loading"
            style={{ width: "64px", height: "64px" }}
          />
          <p style={{ marginTop: "16px", color: "var(--text-muted)" }}>
            Fetching collection...
          </p>
        </div>
      ) : data?.results?.length === 0 ? (
        <div className="empty-center-panel">
          <span style={{ fontSize: "48px" }}>🍉</span>
          <h3>
            {provider === "local" ? "Empty Collection" : "No results found"}
          </h3>
          <p style={{ color: "var(--text-muted)" }}>
            {provider === "local"
              ? activeFilters.tag
                ? `No items found tagged with "${activeFilters.tag}".`
                : `Your local ${type.toLowerCase()} library is empty.`
              : provider === "mal" || activeFilters.tag === "MyAnimeList"
                ? `No items found in your MyAnimeList ${type.toLowerCase()} library.`
                : searchQuery.trim().length > 0
                  ? "Try checking your spelling or using different search terms."
                  : "Try changing your selected filters."}
          </p>
        </div>
      ) : (
        <div className="content-container">
          <div className="content-grid">
            {data.results.map((item) => (
              <div
                key={item.id}
                onClick={() => handleMediaClick(item)}
                className="media-card glass-panel"
              >
                <div className="img-container">
                  <img
                    src={item.image}
                    alt={item.title}
                    className="media-img"
                    onError={(e) => {
                      e.target.src = "/images/image-404.png";
                    }}
                  />

                  {/* Indicator badges for downloaded or watched counts */}
                  <div className="card-badges-container">
                    {item.Downloaded && item.Downloaded.length > 0 && (
                      <div className="indicator-badge">
                        <Download size={12} style={{ marginRight: "4px" }} />
                        {item.Downloaded.length}{" "}
                        {type === "Anime" ? "Eps" : "Chs"}
                      </div>
                    )}

                    {item.nextEpisodeIn ? (
                      <div className="indicator-badge schedule-badge" title="Next release countdown">
                        <Film size={12} style={{ marginRight: "4px" }} />
                        {item.nextEpisodeIn}
                      </div>
                    ) : (
                      item.watched !== undefined && item.watched !== null && (
                        <div className="indicator-badge">
                          <Eye size={12} style={{ marginRight: "4px" }} />
                          {item.watched}/{item.totalEpisodes || "?"}
                        </div>
                      )
                    )}
                  </div>

                  {/* Provider badge — bottom-right of card image */}
                  {(provider === "local" || provider === "mal") &&
                    item.provider &&
                    item.provider !== "" && (
                      <ProviderBadge
                        providerName={item.provider}
                        iconUrl={providerIconMap[item.provider]}
                      />
                    )}
                </div>

                <div className="card-info">
                  <h4 className="card-title">{item.title}</h4>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {(data.totalPages > 1 || data.hasNextPage || currentPage > 1) && (
            <div className="pagination-container">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                className="btn-page"
              >
                <ArrowLeft size={16} />
              </button>
              <span className="page-info">
                Page {currentPage}{" "}
                {data.totalPages ? `of ${data.totalPages}` : ""}
              </span>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={
                  !data.hasNextPage && currentPage >= (data.totalPages || 999)
                }
                className="btn-page"
              >
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Deterministic colour from provider name string
function providerColour(name) {
  const palette = [
    "#7c3aed",
    "#db2777",
    "#d97706",
    "#059669",
    "#0891b2",
    "#4f46e5",
    "#c026d3",
    "#dc2626",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

// Small provider badge rendered bottom-right of card image
function ProviderBadge({ providerName, iconUrl }) {
  const [imgFailed, setImgFailed] = useState(false);
  const label =
    providerName === "local source"
      ? "📁"
      : providerName.substring(0, 2).toUpperCase();
  const colour = providerColour(providerName);
  const friendlyName =
    providerName === "local source" ? "Local file" : providerName;

  return (
    <div
      title={friendlyName}
      className="provider-badge-wrapper"
      style={{
        border: `1px solid ${colour}55`,
        boxShadow: `0 0 0 1px ${colour}33`,
      }}
    >
      {iconUrl && !imgFailed ? (
        <img
          src={iconUrl}
          alt={providerName}
          width={14}
          height={14}
          className="provider-badge-img"
          onError={() => setImgFailed(true)}
        />
      ) : providerName === "local source" ? (
        <Folder size={14} style={{ color: "#fff", flexShrink: 0 }} />
      ) : (
        <span
          className="provider-badge-text-icon"
          style={{ backgroundColor: colour }}
        >
          {label.charAt(0)}
        </span>
      )}
      <span className="provider-badge-label">{friendlyName}</span>
    </div>
  );
}
