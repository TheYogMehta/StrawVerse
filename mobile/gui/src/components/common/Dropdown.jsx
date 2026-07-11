import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

export default function Dropdown({
  label,
  value,
  options = [],
  onChange,
  className = "",
  triggerClassName = "",
  menuClassName = "",
  itemClassName = "",
  minWidth,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);
  const displayText = selectedOption ? selectedOption.label : label;

  return (
    <div
      className={`input-group ${className}`}
      style={{
        minWidth: minWidth ? `${minWidth}px` : undefined,
        position: "relative",
        zIndex: isOpen ? 50 : undefined,
      }}
      ref={dropdownRef}
    >
      <div
        className={`custom-dropdown-trigger ${isOpen ? "open" : ""} ${triggerClassName}`}
        onClick={() => setIsOpen(!isOpen)}
        style={{ display: "flex", alignItems: "center", gap: "8px" }}
      >
        {selectedOption?.icon && (
          <img
            src={selectedOption.icon}
            alt=""
            style={{
              width: "16px",
              height: "16px",
              borderRadius: "3px",
              objectFit: "contain",
            }}
          />
        )}
        <span className="custom-dropdown-trigger-text" style={{ flex: 1 }}>
          {displayText}
        </span>
        <ChevronDown
          className="custom-dropdown-chevron"
          size={16}
          style={{ flexShrink: 0 }}
        />
      </div>

      {isOpen && (
        <div className={`custom-dropdown-menu ${menuClassName}`}>
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`custom-dropdown-item ${opt.value === value ? "selected" : ""} ${opt.className || ""} ${itemClassName}`}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
            >
              {opt.icon && (
                <img
                  src={opt.icon}
                  alt=""
                  style={{
                    width: "16px",
                    height: "16px",
                    borderRadius: "3px",
                    objectFit: "contain",
                  }}
                />
              )}
              <span>{opt.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
