import "./css/Sidebar.css";
import {
  Play,
  FolderMinus,
  BookOpen,
  Library,
  Download,
  Terminal,
  Settings,
  ShoppingBag,
  ChevronLeft,
  ChevronRight,
  Users,
} from "lucide-react";

export default function Sidebar({
  currentView,
  setView,
  isCollapsed,
  toggleCollapse,
  developerMode = false,
  onOpenWatchTogether,
}) {
  const menuItems = [
    { id: "home", label: "Home", icon: Library },
    { id: "discover", label: "Discover", icon: Play },
    {
      id: "watch-together",
      label: "Watch Together",
      icon: Users,
    },
    { id: "downloads", label: "Downloads", icon: Download },
    { id: "marketplace", label: "Extensions", icon: ShoppingBag },
    { id: "logs", label: "Logs", icon: Terminal },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  const filteredMenuItems = menuItems.filter((item) => {
    if (item.id === "logs") {
      return developerMode;
    }
    return true;
  });

  const settingsItem = filteredMenuItems.find((item) => item.id === "settings");
  const mainItems = filteredMenuItems.filter((item) => item.id !== "settings");

  return (
    <aside className={`sidebar ${isCollapsed ? "collapsed" : ""}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo-wrapper">
          <img
            src="/images/logo.webp"
            alt="logo"
            className="sidebar-logo-img"
          />
          {!isCollapsed && (
            <span className="sidebar-logo-text">StrawVerse</span>
          )}
        </div>
        <button
          onClick={toggleCollapse}
          className="sidebar-toggle-btn"
          title={isCollapsed ? "Expand Menu" : "Collapse Menu"}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="sidebar-nav">
        {mainItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => {
                if (item.action === "wt") {
                  if (onOpenWatchTogether) onOpenWatchTogether();
                } else {
                  setView(item.id);
                }
              }}
              className={`sidebar-item ${isActive ? "active" : ""}`}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon size={20} color={isActive ? "#a78bfa" : "#9ca3af"} />
              {!isCollapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {settingsItem &&
        (() => {
          const Icon = settingsItem.icon;
          const isActive = currentView === settingsItem.id;
          return (
            <div className="sidebar-footer">
              <button
                onClick={() => setView(settingsItem.id)}
                className={`sidebar-item ${isActive ? "active" : ""}`}
                title={isCollapsed ? settingsItem.label : undefined}
              >
                <Icon size={20} color={isActive ? "#a78bfa" : "#9ca3af"} />
                {!isCollapsed && <span>{settingsItem.label}</span>}
              </button>
            </div>
          );
        })()}
    </aside>
  );
}
