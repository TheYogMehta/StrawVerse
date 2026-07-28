import { Calendar, Clock, Search, Tv } from "lucide-react";

export default function AiringCalendar({
  calendarLoading,
  scheduleUpdating,
  scheduleData,
  calendarDayFilter,
  setCalendarDayFilter,
  timeTicker,
  onSelectMedia,
  triggerScrapeSearch,
}) {
  const getCountdownString = (airTimestamp) => {
    const diffMs = airTimestamp * 1000 - timeTicker;
    if (diffMs <= 0) return "Aired";

    const totalMins = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMins / (24 * 60));
    const hours = Math.floor((totalMins % (24 * 60)) / 60);
    const mins = totalMins % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);

    return `In ${parts.join(" ")}`;
  };

  if (calendarLoading) {
    return (
      <div className="loading-center-panel">
        <img src="/images/loading.gif" alt="loading" className="u-style-17" />
        <p className="u-style-18">Loading calendar & airing schedule...</p>
      </div>
    );
  }

  const daysOfWeek = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const dayAbbr = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const today = new Date();

  const tabs = [
    { id: "All", label: "ALL", dateNum: "", month: "" },
    {
      id: "Yesterday",
      label: "YEST",
      dateNum: new Date(today.getTime() - 24 * 60 * 60 * 1000)
        .getDate()
        .toString(),
      month: new Date(today.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString(
        undefined,
        { month: "short" },
      ),
    },
    {
      id: "Today",
      label: "TODAY",
      dateNum: today.getDate().toString(),
      month: today.toLocaleDateString(undefined, {
        month: "short",
      }),
    },
    {
      id: "Tomorrow",
      label: "TOMO",
      dateNum: new Date(today.getTime() + 24 * 60 * 60 * 1000)
        .getDate()
        .toString(),
      month: new Date(today.getTime() + 24 * 60 * 60 * 1000).toLocaleDateString(
        undefined,
        { month: "short" },
      ),
    },
  ];

  for (let i = 2; i < 6; i++) {
    const nextDate = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    tabs.push({
      id: daysOfWeek[nextDate.getDay()],
      label: dayAbbr[nextDate.getDay()],
      dateNum: nextDate.getDate().toString(),
      month: nextDate.toLocaleDateString(undefined, {
        month: "short",
      }),
    });
  }

  const scheduleByDay = [];
  for (let i = -1; i < 6; i++) {
    const targetDate = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    const dayName = daysOfWeek[targetDate.getDay()];
    const dateStr = targetDate.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });

    const dayStart =
      new Date(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        targetDate.getDate(),
        0,
        0,
        0,
      ).getTime() / 1000;
    const dayEnd = dayStart + 24 * 3600;

    const dayEpisodes = scheduleData.filter(
      (ep) => ep.date >= dayStart && ep.date < dayEnd,
    );

    scheduleByDay.push({
      dayName:
        i === -1
          ? "Yesterday"
          : i === 0
            ? "Today"
            : i === 1
              ? "Tomorrow"
              : dayName,
      dateStr,
      episodes: dayEpisodes,
    });
  }

  const filteredGroups = scheduleByDay.filter((group) => {
    if (calendarDayFilter === "All") return true;
    return group.dayName === calendarDayFilter;
  });

  const totalEpisodesCount = filteredGroups.reduce(
    (acc, g) => acc + g.episodes.length,
    0,
  );

  return (
    <div className="calendar-view-container">
      <div className="calendar-section">
        <h2 className="calendar-section-title">Weekly Airing Schedule</h2>
        {scheduleUpdating && (
          <div className="schedule-updating-banner u-style-19">
            <div className="pulse-dot u-style-20" />
            <span className="u-style-21">
              Refreshing airing schedule from LiveChart...
            </span>
            <span className="u-style-22">
              Fresh episodes will display automatically
            </span>
          </div>
        )}

        <div className="calendar-tabs-container">
          {tabs.map((tab) => {
            const isActive = calendarDayFilter === tab.id;
            return (
              <button
                key={tab.id}
                className={`calendar-day-tab ${tab.id === "Yesterday" ? "yesterday" : ""} ${isActive ? "active" : ""} ${tab.id === "All" ? "all-tab" : ""}`}
                onClick={() => setCalendarDayFilter(tab.id)}
              >
                {tab.id === "All" ? (
                  <div className="calendar-tab-content-all">
                    <Calendar size={16} />
                    <span className="tab-day-label">{tab.label}</span>
                  </div>
                ) : (
                  <div className="calendar-tab-content">
                    <span className="tab-day-label">{tab.label}</span>
                    <span className="tab-date-num">{tab.dateNum}</span>
                    <span className="tab-month-label">{tab.month}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="schedule-feed-container">
          {totalEpisodesCount === 0 ? (
            <div className="schedule-empty-state glass-panel">
              <div className="empty-state-icon">
                <Tv size={36} className="u-style-23" />
              </div>
              <h3>
                No episodes airing{" "}
                {calendarDayFilter !== "All"
                  ? calendarDayFilter.toLowerCase()
                  : "this week"}
              </h3>
              <p>Check back later or view other days in the calendar.</p>
            </div>
          ) : (
            filteredGroups.map((group) => {
              if (group.episodes.length === 0) return null;

              return (
                <div
                  key={group.dayName}
                  className={`schedule-day-section ${group.dayName === "Yesterday" ? "yesterday-section" : ""}`}
                >
                  <div className="schedule-section-header">
                    <span className="section-day-name">{group.dayName}</span>
                    <span className="section-day-date">{group.dateStr}</span>
                  </div>

                  <div className="schedule-vertical-list">
                    {group.episodes.map((ep) => {
                      const airTime = new Date(
                        ep.date * 1000,
                      ).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      });

                      const isAired = ep.date * 1000 <= timeTicker;
                      const countdownStr = getCountdownString(ep.date);

                      return (
                        <div
                          key={`${ep.livechart_id}-${ep.episode}`}
                          className="schedule-row-card glass-panel"
                          onClick={() => {
                            if (ep.malid) {
                              onSelectMedia(
                                ep.malid,
                                "mal",
                                "Back to Calendar",
                                undefined,
                                ep.title,
                              );
                            } else {
                              triggerScrapeSearch(ep.title);
                            }
                          }}
                        >
                          <div className="schedule-row-left">
                            {ep.image ? (
                              <img
                                src={ep.image}
                                alt={ep.title}
                                className="schedule-row-img"
                              />
                            ) : (
                              <div className="schedule-row-no-img">
                                <Tv size={20} />
                              </div>
                            )}
                          </div>
                          <div className="schedule-row-info">
                            <div className="schedule-row-meta">
                              <span className="schedule-row-ep-badge">
                                EPISODE {ep.episode}
                              </span>
                              <span
                                className={`schedule-row-status-dot ${isAired ? "aired" : "airing"}`}
                              />
                            </div>
                            <h4
                              className="schedule-row-title-new"
                              title={ep.title}
                            >
                              {ep.title}
                            </h4>
                            <div className="schedule-row-badges">
                              <span className="schedule-row-time-badge">
                                <Clock size={11} />
                                {airTime}
                              </span>
                              <span
                                className={`schedule-row-countdown-badge ${isAired ? "aired" : "airing"}`}
                              >
                                {countdownStr}
                              </span>
                            </div>
                          </div>
                          {isAired && (
                            <div className="schedule-row-actions">
                              <button
                                className="schedule-row-action-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  triggerScrapeSearch(ep.title);
                                }}
                                title="Find Stream"
                              >
                                <Search size={14} />
                                <span className="btn-text-desktop">
                                  Find Stream
                                </span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
