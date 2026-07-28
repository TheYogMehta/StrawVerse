import {
  Download,
  Film,
  Eye,
  ArrowLeft,
  ArrowRight,
  Loader2,
  X,
} from "lucide-react";

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
}) {
  if (loading) {
    return (
      <div className="loading-center-panel">
        <img src="/images/loading.gif" alt="loading" className="u-style-17" />
        <p className="u-style-18">Fetching collection...</p>
      </div>
    );
  }

  if (data?.results?.length === 0) {
    return (
      <div className="empty-center-panel">
        <span className="u-style-24">🍉</span>
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
            draggable
            onDragStart={(e) => handleDragStart && handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver && handleDragOver(e, index)}
            onDragLeave={(e) => handleDragLeave && handleDragLeave(e, index)}
            onDrop={(e) => handleDrop && handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onTouchStart={(e) => handleTouchStart && handleTouchStart(e, index)}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onClick={() => handleMediaClick(item)}
            className={`media-card glass-panel ${draggedIndex === index ? "is-dragging" : ""} ${dragOverIndex === index ? "is-drag-over" : ""}`}
            title="Hold & drag to reorder title"
          >
            <div className="img-container">
              <img
                src={item.image || "/images/image-404.png"}
                alt={item.title}
                className="media-img"
                onError={(e) => {
                  e.target.src = "/images/image-404.png";
                }}
              />

              {handleRemoveFromLibrary && (provider === "local" || item.CustomTag) && (
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

              {/* Indicator badges for downloaded or watched counts */}
              <div className="card-badges-container">
                {item.Downloaded && item.Downloaded.length > 0 && (
                  <div className="indicator-badge">
                    <Download size={12} className="u-style-16" />
                    {item.Downloaded.length} {type === "Anime" ? "Eps" : "Chs"}
                  </div>
                )}

                {item.nextEpisodeIn ? (
                  <div
                    className="indicator-badge schedule-badge"
                    title="Next release countdown"
                  >
                    <Film size={12} className="u-style-16" />
                    {item.nextEpisodeIn}
                  </div>
                ) : (
                  item.watched !== undefined &&
                  item.watched !== null && (
                    <div className="indicator-badge">
                      <Eye size={12} className="u-style-16" />
                      {item.watched}/{item.totalEpisodes || "?"}
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
              <span>Loading more...</span>
            </div>
          )}
          {!infiniteLoading &&
            !data.hasNextPage &&
            currentPage >= (data.totalPages || 1) &&
            data.results.length > 0 && (
              <div className="infinite-end-label">
                You've reached the end ✨
              </div>
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
