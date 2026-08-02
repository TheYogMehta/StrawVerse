import "./css/Sidebar.css";
import {
  Play,
  Library,
  Download,
  Terminal,
  Settings,
  ShoppingBag,
} from "lucide-react";

export default function Sidebar({
  currentView,
  setView,
  developerMode = false,
}) {
  const menuItems = [
    { id: "home", label: "Home", icon: Library },
    { id: "discover", label: "Discover", icon: Play },
    { id: "downloads", label: "Downloads", icon: Download },
    { id: "marketplace", label: "Extensions", icon: ShoppingBag },
    { id: "logs", label: "Logs", icon: Terminal },
  ];

  const mainItems = menuItems.filter(
    (item) => item.id !== "logs" || developerMode,
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <img src="/images/logo.webp" alt="logo" className="sidebar-logo-img" />
      </div>

      <nav className="sidebar-nav">
        {mainItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`sidebar-item ${isActive ? "active" : ""}`}
              data-tooltip={item.label}
            >
              <Icon size={20} color={isActive ? "#a78bfa" : "#9ca3af"} />
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button
          onClick={() => setView("settings")}
          className={`sidebar-item ${currentView === "settings" ? "active" : ""}`}
          data-tooltip="Settings"
        >
          <Settings
            size={20}
            color={currentView === "settings" ? "#a78bfa" : "#9ca3af"}
          />
        </button>
      </div>
    </aside>
  );
}
