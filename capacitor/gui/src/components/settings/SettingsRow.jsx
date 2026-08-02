import React from "react";

export default function SettingsRow({ label, desc, className = "", children }) {
  return (
    <div className={`settings-row-item ${className}`.trim()}>
      <div className="settings-row-info">
        <div className="settings-row-label">{label}</div>
        {desc && <div className="settings-row-hint">{desc}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}
