import React, { useState, useEffect } from 'react';
import { Loader2, Trash2, X, CheckCircle, HardDrive, RefreshCw } from 'lucide-react';

export default function DownloadsTracker() {
  const [activeTask, setActiveTask] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDownloads = async () => {
    try {
      const response = await fetch('/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      updateStates(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const updateStates = (data) => {
    if (data.totalSegments && data.totalSegments > 0) {
      setActiveTask({
        caption: data.caption,
        totalSegments: data.totalSegments,
        currentSegments: data.currentSegments,
        epid: data.epid
      });
    } else {
      setActiveTask(null);
    }
    setQueue(data.queue || []);
  };

  useEffect(() => {
    fetchDownloads();

    // Listen to real-time Electron IPC download events
    if (window.sharedStateAPI && window.sharedStateAPI.on) {
      window.sharedStateAPI.on('download-logger', (data) => {
        if (data.totalSegments && data.totalSegments > 0) {
          setActiveTask({
            caption: data.caption,
            totalSegments: data.totalSegments,
            currentSegments: data.currentSegments,
            epid: data.epid
          });
        } else {
          setActiveTask(null);
        }
        if (data.queue) {
          setQueue(data.queue);
        }
      });
    }
  }, []);

  const handleRemoveItem = async (epid) => {
    try {
      const endpoint = epid ? `/api/download/remove?AnimeEpId=${epid}` : '/api/download/remove';
      const response = await fetch(endpoint);
      const data = await response.json();
      fetchDownloads();
    } catch (err) {
      console.error(err);
    }
  };

  const calculateProgress = () => {
    if (!activeTask || !activeTask.totalSegments) return 0;
    return Math.floor((activeTask.currentSegments / activeTask.totalSegments) * 100);
  };

  return (
    <div style={trackerWrapperStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>Download Queue</h1>
        <div style={actionsStyle}>
          <button onClick={fetchDownloads} style={refreshBtnStyle} title="Force Refresh">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => handleRemoveItem(null)} style={clearAllBtnStyle}>
            <Trash2 size={16} />
            <span>Clear Queue</span>
          </button>
        </div>
      </header>

      {/* Active Downloading Progress */}
      {activeTask ? (
        <div style={activePanelStyle} className="glass-panel">
          <div style={activeHeaderStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Loader2 size={20} className="spin" color="var(--accent)" />
              <span style={activeCaptionStyle}>{activeTask.caption}</span>
            </div>
            <span style={percentageStyle}>{calculateProgress()}%</span>
          </div>

          {/* Progress bar wrapper */}
          <div style={progressBgStyle}>
            <div style={progressFillStyle(calculateProgress())} />
          </div>

          <div style={activeFooterStyle}>
            <span>Downloaded {activeTask.currentSegments} of {activeTask.totalSegments} segments</span>
            <button onClick={() => handleRemoveItem(activeTask.epid)} style={cancelDlBtnStyle}>
              Cancel Download
            </button>
          </div>
        </div>
      ) : (
        <div style={idlePanelStyle} className="glass-panel">
          <HardDrive size={36} color="var(--text-muted)" />
          <h3 style={{ fontSize: '15px', fontWeight: '600' }}>No active downloads</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Ready for tasks.</p>
        </div>
      )}

      {/* Queue items list */}
      <div style={queueSectionStyle}>
        <h2 style={queueTitleStyle}>Upcoming Queue ({queue.length})</h2>

        {loading ? (
          <div style={loadingCenterStyle}>
            <Loader2 size={36} className="spin" color="var(--accent)" />
          </div>
        ) : queue.length === 0 ? (
          <div style={emptyCenterStyle} className="glass-panel">
            <CheckCircle size={32} color="var(--success)" />
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No items in upcoming queue.</p>
          </div>
        ) : (
          <div style={queueListStyle}>
            {queue.map((item, idx) => (
              <div key={item.epid || idx} style={queueCardStyle} className="glass-panel">
                <div style={queueItemInfoStyle}>
                  <span style={queueTitleTextStyle}>{item.Title}</span>
                  <span style={queueMetaStyle}>
                    {item.Type === 'Anime' ? `Episode ${item.EpNum}` : `Chapter ${item.EpNum}`} • {item.Type.toUpperCase()}
                  </span>
                </div>
                <button onClick={() => handleRemoveItem(item.epid)} style={removeItemBtnStyle}>
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const trackerWrapperStyle = {
  flex: 1,
  padding: '30px',
  overflowY: 'auto',
  height: '100%',
  backgroundColor: 'var(--bg-primary)',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '24px',
};

const titleStyle = {
  fontSize: '28px',
  fontWeight: '800',
  letterSpacing: '-0.5px',
};

const actionsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
};

const refreshBtnStyle = {
  backgroundColor: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  color: 'white',
  width: '36px',
  height: '36px',
  borderRadius: '8px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'var(--transition)',
};

const clearAllBtnStyle = {
  backgroundColor: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid var(--danger)',
  color: 'var(--danger)',
  borderRadius: '8px',
  padding: '8px 16px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '13px',
  fontWeight: '600',
  transition: 'var(--transition)',
};

const activePanelStyle = {
  padding: '24px',
  marginBottom: '30px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const activeHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const activeCaptionStyle = {
  fontSize: '15px',
  fontWeight: '600',
};

const percentageStyle = {
  fontSize: '18px',
  fontWeight: '800',
  color: 'var(--accent)',
};

const progressBgStyle = {
  width: '100%',
  height: '12px',
  backgroundColor: 'var(--bg-tertiary)',
  borderRadius: '10px',
  overflow: 'hidden',
};

const progressFillStyle = (percentage) => ({
  width: `${percentage}%`,
  height: '100%',
  backgroundColor: 'var(--accent)',
  borderRadius: '10px',
  transition: 'width 0.4s ease-out',
});

const activeFooterStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: '13px',
  color: 'var(--text-muted)',
};

const cancelDlBtnStyle = {
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  color: 'var(--text-main)',
  padding: '6px 12px',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: '600',
  transition: 'var(--transition)',
  '&:hover': {
    backgroundColor: 'var(--danger)',
    borderColor: 'transparent',
    color: 'white',
  }
};

const idlePanelStyle = {
  padding: '30px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  marginBottom: '30px',
  color: 'var(--text-muted)',
  borderStyle: 'dashed',
  borderWidth: '2px',
};

const queueSectionStyle = {
  marginTop: '30px',
};

const queueTitleStyle = {
  fontSize: '18px',
  fontWeight: '700',
  marginBottom: '16px',
};

const loadingCenterStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px',
};

const emptyCenterStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px',
  gap: '12px',
};

const queueListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const queueCardStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 18px',
  borderRadius: '8px',
};

const queueItemInfoStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const queueTitleTextStyle = {
  fontSize: '14px',
  fontWeight: '600',
};

const queueMetaStyle = {
  fontSize: '11px',
  color: 'var(--text-muted)',
};

const removeItemBtnStyle = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  padding: '4px',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'var(--transition)',
  '&:hover': {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    color: 'var(--danger)',
  }
};
