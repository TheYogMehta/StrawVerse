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
  onOpenWatchTogether,
}) {
  const menuItems = [
    { id: "local-anime", label: "Local Anime", icon: Library },
    { id: "local-manga", label: "Local Manga", icon: FolderMinus },
    { id: "anime-catalog", label: "Discover Anime", icon: Play },
    { id: "manga-catalog", label: "Discover Manga", icon: BookOpen },
    {
      id: "watch-together",
      label: "Watch Together",
      icon: Users,
      action: "wt",
    },
    { id: "downloads", label: "Downloads", icon: Download },
    { id: "logs", label: "Logs", icon: Terminal },
    { id: "settings", label: "Settings", icon: Settings },
    { id: "marketplace", label: "Marketplace", icon: ShoppingBag },
  ];

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
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            currentView === item.id ||
            (item.id === "anime-catalog" && currentView === "anime-search") ||
            (item.id === "manga-catalog" && currentView === "manga-search");

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
    </aside>
  );
}
