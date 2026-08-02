import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, X, Check, Bookmark, Trash2, Tag } from "lucide-react";

export default function TagPickerModal({
  item,
  type,
  availableTags = [],
  tagCounts = {},
  currentTags = [],
  onSelectTag,
  onRemoveTag,
  onClose,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Auto-focus search input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Sort available tags: most used tags first, then by configured order
  const sortedTags = useMemo(() => {
    return [...availableTags].sort((a, b) => {
      const countA = tagCounts[a] || 0;
      const countB = tagCounts[b] || 0;
      if (countB !== countA) {
        return countB - countA;
      }
      return 0;
    });
  }, [availableTags, tagCounts]);

  // Filter tags based on user search query
  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return sortedTags;
    const q = searchQuery.toLowerCase().trim();
    return sortedTags.filter((t) => t.toLowerCase().includes(q));
  }, [sortedTags, searchQuery]);

  // Reset highlight index when filter results change
  useEffect(() => {
    setHighlightIndex(0);
  }, [searchQuery]);

  // Ensure highlighted element is scrolled into view
  useEffect(() => {
    if (listRef.current) {
      const highlightedEl = listRef.current.children[highlightIndex];
      if (highlightedEl) {
        highlightedEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightIndex]);

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) =>
        filteredTags.length > 0
          ? Math.min(filteredTags.length - 1, prev + 1)
          : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(0, prev - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredTags.length > 0 && highlightIndex < filteredTags.length) {
        const chosenTag = filteredTags[highlightIndex];
        onSelectTag(chosenTag);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const isItemTaggedWith = (tag) => {
    return (currentTags || []).some(
      (t) => t.toLowerCase().trim() === tag.toLowerCase().trim(),
    );
  };

  return (
    <div className="tag-picker-modal-overlay" onClick={onClose} tabIndex={-1}>
      <div
        className="tag-picker-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tag-picker-modal-header">
          <div className="tag-picker-header-title">
            <Bookmark size={18} className="tag-picker-header-icon" />
            <span className="tag-picker-title-text" title={item?.title}>
              Tag "{item?.title || "Media"}"
            </span>
          </div>
          <button
            className="tag-picker-btn-close"
            onClick={onClose}
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="tag-picker-search-bar">
          <Search size={16} className="tag-picker-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="tag-picker-search-input"
            placeholder="Type tag name... (Press Enter to select)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {searchQuery && (
            <button
              className="tag-picker-search-clear"
              onClick={() => setSearchQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="tag-picker-tag-list" ref={listRef}>
          {filteredTags.length === 0 ? (
            <div className="tag-picker-empty-state">
              <Tag size={20} />
              <span>No tags found matching "{searchQuery}"</span>
            </div>
          ) : (
            filteredTags.map((tag, idx) => {
              const isSelected = isItemTaggedWith(tag);
              const isFocused = idx === highlightIndex;
              const count = tagCounts[tag] || 0;

              return (
                <div
                  key={tag}
                  className={`tag-picker-tag-item ${isFocused ? "is-focused" : ""} ${
                    isSelected ? "is-selected" : ""
                  }`}
                  onClick={() => onSelectTag(tag)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                >
                  <div className="tag-picker-tag-name-wrapper">
                    <span className="tag-picker-tag-name">{tag}</span>
                  </div>
                  {isSelected && (
                    <span className="tag-picker-tag-check">
                      <Check size={16} />
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {currentTags && currentTags.length > 0 && (
          <div className="tag-picker-modal-footer">
            <button
              className="tag-picker-btn-remove-tag"
              onClick={() => onRemoveTag && onRemoveTag()}
            >
              <Trash2 size={14} />
              <span>Remove Tag</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
