import React, { useState, useEffect, useCallback } from "react";
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
    hianime: {
      type: {
        label: "Type",
        options: {
          All: "",
          Movie: "1",
          Tv: "2",
          OVA: "3",
          ONA: "4",
          Special: "5",
          Music: "6",
        },
      },
      status: {
        label: "Status",
        options: {
          All: "",
          "Finished Airing": "1",
          "Currently Airing": "2",
          "Not Yet Aired": "3",
        },
      },
      rated: {
        label: "Rated",
        options: {
          All: "",
          G: "1",
          PG: "2",
          "PG-13": "3",
          R: "4",
          "R+": "5",
          Rx: "6",
        },
      },
      score: {
        label: "Score",
        options: {
          All: "",
          Average: "5",
          Good: "7",
          "Very Good": "8",
          Great: "9",
          Masterpiece: "10",
        },
      },
      season: {
        label: "Season",
        options: { All: "", Spring: "1", Summer: "2", Fall: "3", Winter: "4" },
      },
      language: { label: "Language", options: { All: "", SUB: "1", DUB: "2" } },
      sort: {
        label: "Sort By",
        options: {
          "Recently Updated": "recently_updated",
          "Recently Added": "recently_added",
          Score: "score",
          "Name A-Z": "name_az",
          "Released Date": "released_date",
          "Most Watched": "most_watched",
        },
      },
    },
    animekai: {
      sort: {
        label: "Sort By",
        options: {
          "Updated Date": "updated_date",
          "Released Date": "released_date",
          Trending: "trending",
          "Name A-Z": "title_az",
          "Average Score": "avg_score",
          "MAL Score": "mal_score",
        },
      },
      status: {
        label: "Status",
        options: {
          All: "",
          "Not Yet Aired": "info",
          Releasing: "releasing",
          Completed: "completed",
        },
      },
      type: {
        label: "Type",
        options: { All: "", Movie: "movie", Tv: "tv", OVA: "ova", ONA: "ona" },
      },
    },
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
    <div style={catalogWrapperStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>
          {provider === "local"
            ? `Local ${type}`
            : provider === "mal"
              ? `MyAnimeList ${type}`
              : `Discover ${type}`}
        </h1>

        {/* Search bar for non-local searches, or when linking a MAL title */}
        {((provider !== "local" && provider !== "mal") || linkingMalItem) && (
          <form onSubmit={handleSearchSubmit} style={searchFormStyle}>
            <input
              type="text"
              placeholder={`Search ${type}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={searchInputStyle}
            />
            <button type="submit" style={searchBtnStyle}>
              <Search size={18} />
            </button>
          </form>
        )}
      </header>

      {/* Filter panel */}
      {availableFilters && (
        <div style={filterPanelStyle}>
          {Object.entries(availableFilters).map(([key, filter]) => (
            <div key={key} style={filterGroupStyle}>
              <label style={filterLabelStyle}>{filter.label}</label>
              <select
                value={activeFilters[key] || ""}
                onChange={(e) => handleFilterChange(key, e.target.value)}
                style={filterSelectStyle}
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
        <div style={tagChipsContainerStyle}>
          <button
            onClick={() => handleFilterChange("tag", "")}
            style={
              !activeFilters.tag || activeFilters.tag === ""
                ? activeTagChipStyle
                : tagChipStyle
            }
          >
            All
          </button>
          {localTags.map((tag) => (
            <button
              key={tag}
              onClick={() => handleFilterChange("tag", tag)}
              style={
                activeFilters.tag === tag ? activeTagChipStyle : tagChipStyle
              }
            >
              {tag}
            </button>
          ))}
          <button
            onClick={handleAddLocalTag}
            style={addTagBtnStyle}
            title="Create Custom Tag"
          >
            <Plus size={14} style={{ marginRight: "4px" }} />
            Add Tag
          </button>
        </div>
      )}

      {/* Linking Banner */}
      {linkingMalItem && (
        <div style={linkingBannerStyle}>
          <span style={linkingBannerTextStyle}>
            Linking MyAnimeList title: <strong>{linkingMalItem.title}</strong>.
            Select the matching card below to link it.
          </span>
          <button onClick={handleCancelLinking} style={cancelLinkBtnStyle}>
            Cancel Link
          </button>
        </div>
      )}

      {errorMsg && <div style={errorBannerStyle}>{errorMsg}</div>}

      {/* Content grid */}
      {loading ? (
        <div style={loadingCenterStyle}>
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
        <div style={emptyCenterStyle}>
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
        <div style={containerStyle}>
          <div style={gridStyle}>
            {data.results.map((item) => (
              <div
                key={item.id}
                onClick={() => handleMediaClick(item)}
                style={cardStyle}
                className="glass-panel"
              >
                <div style={imgContainerStyle}>
                  <img
                    src={item.image}
                    alt={item.title}
                    style={imgStyle}
                    onError={(e) => {
                      e.target.src = "/images/image-404.png";
                    }}
                  />



                  {/* Indicator badges for downloaded or watched counts */}
                  {item.Downloaded && item.Downloaded.length > 0 && (
                    <div style={badgeStyle}>
                      <Download size={12} style={{ marginRight: "4px" }} />
                      {item.Downloaded.length}{" "}
                      {type === "Anime" ? "Eps" : "Chs"}
                    </div>
                  )}

                  {item.watched !== undefined && item.watched !== null && (
                    <div style={badgeStyle}>
                      <Eye size={12} style={{ marginRight: "4px" }} />
                      {item.watched}/{item.totalEpisodes || "?"}
                    </div>
                  )}

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

                <div style={cardInfoStyle}>
                  <h4 style={cardTitleStyle}>{item.title}</h4>
                  {item.type && (
                    <span style={cardMetaStyle}>{item.type.toUpperCase()}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {(data.totalPages > 1 || data.hasNextPage || currentPage > 1) && (
            <div style={paginationStyle}>
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                style={pageBtnStyle(currentPage <= 1)}
              >
                <ArrowLeft size={16} />
              </button>
              <span style={pageInfoStyle}>
                Page {currentPage}{" "}
                {data.totalPages ? `of ${data.totalPages}` : ""}
              </span>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={
                  !data.hasNextPage && currentPage >= (data.totalPages || 999)
                }
                style={pageBtnStyle(
                  !data.hasNextPage && currentPage >= (data.totalPages || 999),
                )}
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

const catalogWrapperStyle = {
  flex: 1,
  padding: "30px",
  overflowY: "auto",
  height: "100%",
  backgroundColor: "var(--bg-primary)",
};

const headerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "24px",
  flexWrap: "wrap",
  gap: "16px",
};

const titleStyle = {
  fontSize: "28px",
  fontWeight: "800",
  letterSpacing: "-0.5px",
};

const searchFormStyle = {
  display: "flex",
  alignItems: "center",
  backgroundColor: "var(--bg-secondary)",
  borderRadius: "8px",
  border: "1px solid var(--border)",
  overflow: "hidden",
  width: "320px",
};

const searchInputStyle = {
  flex: 1,
  padding: "10px 14px",
  background: "transparent",
  border: "none",
  color: "white",
  outline: "none",
  fontSize: "14px",
};

const searchBtnStyle = {
  background: "transparent",
  border: "none",
  padding: "10px 14px",
  color: "var(--text-muted)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
};

const filterPanelStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
  marginBottom: "24px",
  padding: "16px",
  backgroundColor: "var(--bg-secondary)",
  borderRadius: "10px",
  border: "1px solid var(--border)",
};

const filterGroupStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  minWidth: "130px",
};

const filterLabelStyle = {
  fontSize: "11px",
  fontWeight: "700",
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const filterSelectStyle = {
  backgroundColor: "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  color: "white",
  padding: "8px 12px",
  borderRadius: "6px",
  outline: "none",
  cursor: "pointer",
  fontSize: "13px",
};

const tagChipsContainerStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  marginBottom: "24px",
};

const tagChipStyle = {
  backgroundColor: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
  padding: "8px 16px",
  borderRadius: "20px",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: "600",
  transition: "var(--transition)",
  outline: "none",
};

const activeTagChipStyle = {
  ...tagChipStyle,
  backgroundColor: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "white",
};

const addTagBtnStyle = {
  ...tagChipStyle,
  backgroundColor: "transparent",
  border: "1px dashed var(--accent)",
  color: "var(--accent)",
  display: "flex",
  alignItems: "center",
};

const errorBannerStyle = {
  padding: "12px 16px",
  backgroundColor: "rgba(239, 68, 68, 0.1)",
  border: "1px solid var(--danger)",
  borderRadius: "8px",
  color: "var(--danger)",
  marginBottom: "20px",
  fontSize: "14px",
};

const containerStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: "24px",
  width: "100%",
  marginBottom: "40px",
};

const cardStyle = {
  cursor: "pointer",
  overflow: "hidden",
  transition: "var(--transition)",
  position: "relative",
  display: "flex",
  flexDirection: "column",
  "&:hover": {
    transform: "translateY(-4px)",
    borderColor: "var(--accent)",
  },
};

const imgContainerStyle = {
  position: "relative",
  width: "100%",
  paddingBottom: "140%", // Aspect ratio 1:1.4
  overflow: "hidden",
};

const imgStyle = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  transition: "var(--transition)",
};

const badgeStyle = {
  position: "absolute",
  top: "8px",
  left: "8px",
  backgroundColor: "rgba(0, 0, 0, 0.75)",
  color: "#fff",
  fontSize: "11px",
  fontWeight: "700",
  padding: "4px 8px",
  borderRadius: "4px",
  backdropFilter: "blur(4px)",
  display: "flex",
  alignItems: "center",
};

const cardInfoStyle = {
  padding: "14px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  flexGrow: 1,
  justifyContent: "space-between",
};

const cardTitleStyle = {
  fontSize: "14px",
  fontWeight: "600",
  lineHeight: "1.4",
  color: "var(--text-main)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  display: "-webkit-box",
  WebkitLineClamp: "2",
  WebkitBoxOrient: "vertical",
};

const cardMetaStyle = {
  fontSize: "10px",
  fontWeight: "700",
  color: "var(--accent)",
  letterSpacing: "0.5px",
};

const paginationStyle = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
  padding: "16px 0",
};

const pageBtnStyle = (disabled) => ({
  background: disabled ? "var(--bg-secondary)" : "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  color: disabled ? "rgba(255, 255, 255, 0.2)" : "white",
  width: "40px",
  height: "40px",
  borderRadius: "8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "var(--transition)",
});

const pageInfoStyle = {
  fontSize: "14px",
  fontWeight: "600",
};

const loadingCenterStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "350px",
  width: "100%",
};

const emptyCenterStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "300px",
  width: "100%",
  gap: "10px",
};



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
  const [imgFailed, setImgFailed] = React.useState(false);
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
      style={{
        position: "absolute",
        bottom: "8px",
        right: "8px",
        backgroundColor: "rgba(0,0,0,0.82)",
        backdropFilter: "blur(6px)",
        borderRadius: "6px",
        padding: "3px 6px",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        border: `1px solid ${colour}55`,
        boxShadow: `0 0 0 1px ${colour}33`,
        maxWidth: "90px",
        overflow: "hidden",
      }}
    >
      {iconUrl && !imgFailed ? (
        <img
          src={iconUrl}
          alt={providerName}
          width={14}
          height={14}
          style={{ borderRadius: "2px", flexShrink: 0 }}
          onError={() => setImgFailed(true)}
        />
      ) : providerName === "local source" ? (
        <Folder size={14} style={{ color: "#fff", flexShrink: 0 }} />
      ) : (
        <span
          style={{
            width: "14px",
            height: "14px",
            borderRadius: "3px",
            backgroundColor: colour,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "8px",
            fontWeight: "900",
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {label.charAt(0)}
        </span>
      )}
      <span
        style={{
          fontSize: "10px",
          fontWeight: "700",
          color: "#fff",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          letterSpacing: "0.2px",
        }}
      >
        {friendlyName}
      </span>
    </div>
  );
}

const linkingBannerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 20px",
  backgroundColor: "rgba(167, 139, 250, 0.1)",
  border: "1px solid var(--accent)",
  borderRadius: "10px",
  color: "white",
  marginBottom: "24px",
  fontSize: "14px",
};

const linkingBannerTextStyle = {
  lineHeight: "1.5",
};

const cancelLinkBtnStyle = {
  backgroundColor: "rgba(239, 68, 68, 0.1)",
  border: "1px solid var(--danger)",
  color: "var(--danger)",
  padding: "6px 12px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: "600",
  fontSize: "12px",
  transition: "var(--transition)",
  borderStyle: "solid",
};
