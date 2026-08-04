import React from "react";
import {
  Play,
  BookOpen,
  Download,
  Plus,
  X,
  ExternalLink,
  ChevronDown,
  CheckCircle,
} from "lucide-react";
import Dropdown from "../common/Dropdown";

export default function InfoHeader({
  type,
  details,
  currentTags,
  customTags,
  pulseDropdown,
  isDropdownOpen,
  setIsDropdownOpen,
  dropdownRef,
  newTagInput,
  setNewTagInput,
  addCustomTag,
  saveTags,
  toggleTag,
  removeCustomTag,
  isProviderDropdownOpen,
  setIsProviderDropdownOpen,
  providerDropdownRef,
  getProviderIcon,
  onSwitchProvider,
  malStatus,
  malWatched,
  malStatusOptions,
  getMalStatusLabel,
  isMalStatusDropdownOpen,
  setIsMalStatusDropdownOpen,
  malStatusDropdownRef,
  updateMalStatus,
  setMalWatched,
  onWatch,
  onRead,
  episodesOrChapters,
  hasProgress,
  lastProgress,
  historyProgress,
  suggestedNumber,
  dubSelect,
  setDubSelect,
  selectedItems,
  onDownloadSelected,
  onClearSelection,
  rangeInput,
  setRangeInput,
  onApplyRange,
  isRangeInputInvalid,
  onExpandImage,
}) {
  const isAnime = type === "Anime";

  return (
    <div className="info-header-container">
      {/* Banner / Poster Section */}
      <div className="info-banner">
        {(details?.image || details?.scraper_image) && (
          <img
            src={details.image || details.scraper_image}
            alt={details.title}
            className="info-banner-blur"
            onError={(e) => {
              const fallback =
                details?.scraper_image || details?.fallback_image;
              if (
                fallback &&
                e.target.src !== fallback &&
                e.target.src !== window.location.origin + fallback
              ) {
                e.target.src = fallback;
              } else {
                e.target.style.display = "none";
              }
            }}
          />
        )}
        <div className="info-banner-overlay" />
      </div>

      <div className="info-hero-content">
        <div
          className="info-cover-wrapper"
          onClick={() => onExpandImage && onExpandImage()}
          style={{ cursor: onExpandImage ? "pointer" : "default" }}
        >
          <img
            src={
              details?.image ||
              details?.scraper_image ||
              "/images/image-404.png"
            }
            alt={details?.title || "Poster"}
            className="info-cover-image"
            onError={(e) => {
              const fallback =
                details?.scraper_image || details?.fallback_image;
              if (
                fallback &&
                e.target.src !== fallback &&
                e.target.src !== window.location.origin + fallback
              ) {
                e.target.src = fallback;
              } else {
                e.target.src = "/images/image-404.png";
              }
            }}
          />
        </div>

        <div className="info-meta-wrapper">
          <h1 className="info-title">{details?.title}</h1>

          {details?.description && (
            <p className="info-description">{details.description}</p>
          )}

          <div className="info-badge-row">
            {details?.status && (
              <span className="info-badge status">{details.status}</span>
            )}
            {details?.aired && (
              <span className="info-badge aired">{details.aired}</span>
            )}
            {details?.released && (
              <span className="info-badge aired">{details.released}</span>
            )}
            {details?.genres?.map((g, i) => (
              <span key={i} className="info-badge genre">
                {g}
              </span>
            ))}
          </div>

          {/* Action Row */}
          <div className="info-actions-row">
            {isAnime ? (
              <button
                className="btn-primary"
                onClick={() => onWatch(episodesOrChapters[0]?.id, 1)}
              >
                <Play className="icon-sm" /> Watch Episode 1
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={() => onRead(episodesOrChapters[0]?.id, 1)}
              >
                <BookOpen className="icon-sm" /> Read Chapter 1
              </button>
            )}

            {selectedItems?.size > 0 && (
              <button className="btn-secondary" onClick={onDownloadSelected}>
                <Download className="icon-sm" /> Download Selected (
                {selectedItems.size})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
