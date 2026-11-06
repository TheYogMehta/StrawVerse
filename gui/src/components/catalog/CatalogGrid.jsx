import { useState, useEffect } from "react";
import {
  Download,
  Film,
  Eye,
  CheckCircle,
  BookOpen,
  ArrowLeft,
  ArrowRight,
  Loader2,
  X,
  Bookmark,
  Plus,
  SearchX,
} from "lucide-react";

const getProxiedImageUrl = (url, item) => {
  if (!url) return "/images/image-404.png";
  if (
    url.startsWith("/api/image") ||
    url.startsWith("data:") ||
    url.startsWith("file://") ||
    url.startsWith("/images/")
  ) {
    return url;
  }
  let query = `url=${encodeURIComponent(url)}`;
  const malid = item?.malid || item?.MalID || item?.id;
  if (malid && !isNaN(parseInt(malid, 10))) {
    query += `&malid=${malid}`;
  }
  if (item?.title) {
    query += `&title=${encodeURIComponent(item.title)}`;
  }
  return `/api/image?${query}`;
};

export default function CatalogGrid({
  loading,
  data,
  type,
  provider,
  activeFilters,
  searchQuery,
  infiniteScroll,
  infiniteLoading,
  currentPage,
  loadedPageStart,
  topSentinelRef,
  sentinelRef,
  canReorder: propCanReorder,
  draggedIndex,
  dragOverIndex,
  handleDragStart,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDragEnd,
  handleTouchStart,
  handleTouchMove,
  handleTouchEnd,
  handleMediaClick,
  handlePageChange,
  handleRemoveFromLibrary,
  getItemTagInfo,
  onOpenTagModal,
}) {
  const [loadingStatusText, setLoadingStatusText] = useState("");

  const canReorder =
    propCanReorder !== undefined
      ? propCanReorder
      : provider === "local" && (!searchQuery || !searchQuery.trim());

  useEffect(() => {
    if (window.sharedStateAPI && window.sharedStateAPI.on) {
      const unsub = window.sharedStateAPI.on(
        "catalog-loading-status",
        (payload) => {
          setLoadingStatusText(payload?.text || "");
        },
      );
      return () => {
        if (typeof unsub === "function") unsub();
      };
    }
  }, []);

  if (loading) {
    return (
      <div className="loading-center-panel">
        <img src="/images/loading.gif" alt="loading" className="u-style-17" />
        <p className="u-style-18">
          {loadingStatusText || "Fetching collection..."}
        </p>
      </div>
    );
  }

  if (data?.results?.length === 0) {
    return (
      <div className="empty-center-panel">
        <SearchX size={36} className="u-style-24" />
        <h3>
          {provider === "local" ? "Empty Collection" : "No results found"}
        </h3>
        <p className="u-style-25">
          {provider === "local"
            ? activeFilters.tag
              ? `No items found tagged with "${activeFilters.tag}".`
              : `Your local ${type.toLowerCase()} library is empty.`
            : searchQuery.trim().length > 0
              ? "Try checking your spelling or using different search terms."
              : "Try changing your selected filters."}
        </p>
      </div>
    );
  }

  return (
    <div className="content-container">
      {infiniteScroll && loadedPageStart > 1 && (
        <div
          ref={topSentinelRef}
          className="infinite-sentinel-top"
          style={{ height: "1px" }}
        />
      )}
      <div className="content-grid">
        {data.results.map((item, index) => (
          <div
            key={item.id}
            data-index={index}
            draggable={canReorder}
            onDragStart={
              canReorder
                ? (e) => handleDragStart && handleDragStart(e, index)
                : undefined
            }
            onDragOver={
              canReorder
                ? (e) => handleDragOver && handleDragOver(e, index)
                : undefined
            }
            onDragLeave={
              canReorder
                ? (e) => handleDragLeave && handleDragLeave(e, index)
                : undefined
            }
            onDrop={
              canReorder ? (e) => handleDrop && handleDrop(e, index) : undefined
            }
            onDragEnd={canReorder ? handleDragEnd : undefined}
            onTouchStart={
              canReorder
                ? (e) => handleTouchStart && handleTouchStart(e, index)
                : undefined
            }
            onTouchMove={canReorder ? handleTouchMove : undefined}
            onTouchEnd={canReorder ? handleTouchEnd : undefined}
            onClick={() => handleMediaClick(item)}
            className={`media-card ${canReorder ? "is-reorderable" : ""} ${canReorder && draggedIndex === index ? "is-dragging" : ""} ${canReorder && dragOverIndex === index ? "is-drag-over" : ""}`}
            title={canReorder ? "Hold & drag to reorder title" : undefined}
          >
            <div className="img-container">
              <img
                src={getProxiedImageUrl(
                  item.mal_image || item.image || item.scraper_image,
                  item,
                )}
                alt={item.title}
                className="media-img"
                loading="lazy"
                draggable={false}
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = "/images/image-404.png";
                }}
              />

              <div className="card-top-actions">
                {(() => {
                  const tagInfo = getItemTagInfo ? getItemTagInfo(item) : null;
                  const tags = tagInfo?.tags || [];
                  const isTagged = tags.length > 0;

                  return (
                    <button
                      className={`card-tag-btn ${isTagged ? "is-tagged" : ""}`}
                      title={
                        isTagged
                          ? `Tagged: ${tags.join(", ")} (Click to edit tag)`
                          : "Add tag to Library"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onOpenTagModal) onOpenTagModal(e, item);
                      }}
                    >
                      {isTagged ? (
                        <Bookmark size={14} className="bookmark-icon" />
                      ) : (
                        <Plus size={14} />
                      )}
                    </button>
                  );
                })()}

                {provider === "local" && handleRemoveFromLibrary && (
                  <button
                    className="card-remove-btn"
                    title="Remove from Library"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveFromLibrary(item);
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Indicator badges for downloaded, schedule, watched progress, or completed */}
              <div className="card-badges-container">
                {item.Downloaded && item.Downloaded.length > 0 && (
                  <div className="indicator-badge">
                    <Download size={12} className="u-style-16" />
                    {item.Downloaded.length} {type === "Anime" ? "Eps" : "Chs"}
                  </div>
                )}

                {item.nextEpisodeIn && (
                  <div
                    className="indicator-badge schedule-badge"
                    title="Next release countdown"
                  >
                    <Film size={12} className="u-style-16" />
                    {item.nextEpisodeIn}
                  </div>
                )}

                {item.isCompleted || item.malStatus === "completed" ? (
                  <div
                    className="indicator-badge completed-badge"
                    title={`Completed${
                      item.watched
                        ? ` (${type === "Manga" ? "Ch " : "Ep "}${item.watched}${item.totalEpisodes ? `/${item.totalEpisodes}` : ""})`
                        : ""
                    }`}
                  >
                    <CheckCircle size={12} className="u-style-16" />
                    Completed
                    {item.watched > 0
                      ? ` (${item.totalEpisodes > 0 ? `${item.watched}/${item.totalEpisodes}` : `${type === "Manga" ? "Ch " : "Ep "}${item.watched}`})`
                      : ""}
                  </div>
                ) : (
                  item.watched !== undefined &&
                  item.watched !== null &&
                  item.watched > 0 && (
                    <div
                      className="indicator-badge watched-badge"
                      title={`${type === "Manga" ? "Read" : "Watched"}: ${type === "Manga" ? "Ch " : "Ep "}${item.watched}${item.totalEpisodes ? `/${item.totalEpisodes}` : ""}`}
                    >
                      {type === "Manga" ? (
                        <BookOpen size={12} className="u-style-16" />
                      ) : (
                        <Eye size={12} className="u-style-16" />
                      )}
                      {item.totalEpisodes > 0
                        ? `${item.watched}/${item.totalEpisodes}`
                        : `${type === "Manga" ? "Ch " : "Ep "}${item.watched}`}
                    </div>
                  )
                )}
              </div>
            </div>

            <div className="card-info">
              <h4 className="card-title">{item.title}</h4>
            </div>
          </div>
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      {infiniteScroll && (
        <div ref={sentinelRef} className="infinite-sentinel">
          {infiniteLoading && (
            <div className="infinite-loading-indicator">
              <Loader2 size={22} className="infinite-spin" />
              <span>{loadingStatusText || "Loading more..."}</span>
            </div>
          )}
          {!infiniteLoading &&
            !data.hasNextPage &&
            currentPage >= (data.totalPages || 1) &&
            data.results.length > 0 && (
              <div className="infinite-end-label">You've reached the end</div>
            )}
        </div>
      )}

      {/* Pagination */}
      {!infiniteScroll &&
        (data.totalPages > 1 || data.hasNextPage || currentPage > 1) && (
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
  );
}
