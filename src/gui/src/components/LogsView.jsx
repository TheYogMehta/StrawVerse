import React, { useState, useEffect } from 'react';
import { Loader2, Copy, Trash2, RefreshCw } from 'lucide-react';
import Swal from 'sweetalert2';

export default function LogsView() {
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/logs');
      const data = await response.json();
      setLogs(data.logs || 'No log messages available.');
    } catch (err) {
      console.error(err);
      setLogs('Error fetching logs from server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs);
    Swal.fire({
      title: 'Copied',
      text: 'Logs copied to clipboard!',
      icon: 'success',
      background: 'var(--bg-secondary)',
      color: 'var(--text-main)',
      confirmButtonColor: 'var(--accent)',
    });
  };

  const handleClearLogs = async () => {
    const confirmResult = await Swal.fire({
      title: 'Clear Logs?',
      text: 'Are you sure you want to clear the logs?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, clear',
      cancelButtonText: 'Cancel',
      background: 'var(--bg-secondary)',
      color: 'var(--text-main)',
      confirmButtonColor: 'var(--danger)',
      cancelButtonColor: 'var(--bg-tertiary)',
    });
    if (!confirmResult.isConfirmed) return;

    try {
      const response = await fetch('/api/logs', {
        method: 'DELETE'
      });
      if (response.ok) {
        setLogs('No log messages available.');
      } else {
        Swal.fire({
          title: 'Error',
          text: 'Failed to clear logs.',
          icon: 'error',
          background: 'var(--bg-secondary)',
          color: 'var(--text-main)',
          confirmButtonColor: 'var(--accent)',
        });
      }
    } catch (err) {
      console.error(err);
      Swal.fire({
        title: 'Error',
        text: 'Error connecting to server to clear logs.',
        icon: 'error',
        background: 'var(--bg-secondary)',
        color: 'var(--text-main)',
        confirmButtonColor: 'var(--accent)',
      });
    }
  };

  return (
    <div style={logsWrapperStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>Application Logs</h1>
        <div style={actionsStyle}>
          <button onClick={fetchLogs} style={actionBtnStyle} title="Refresh Logs">
            <RefreshCw size={16} />
          </button>
          <button onClick={handleCopyLogs} style={actionBtnStyle} title="Copy to Clipboard">
            <Copy size={16} />
            <span>Copy Logs</span>
          </button>
        </div>
      </header>

      {loading ? (
        <div style={loadingCenterStyle}>
          <img src="/images/loading.gif" alt="loading" style={{ width: '64px', height: '64px' }} />
        </div>
      ) : (
        <div style={terminalContainerStyle} className="glass-panel">
          <div style={terminalHeaderStyle}>
            <button onClick={handleClearLogs} style={clearLogsBtnStyle} title="Clear Logs">
              <Trash2 size={13} />
              <span>Clear Logs</span>
            </button>
            <span style={terminalTitleStyle}>logs.txt</span>
          </div>
          <pre style={preStyle}>{logs}</pre>
        </div>
      )}
    </div>
  );
}

const logsWrapperStyle = {
  flex: 1,
  padding: '30px',
  overflowY: 'auto',
  height: '100%',
  backgroundColor: 'var(--bg-primary)',
  display: 'flex',
  flexDirection: 'column',
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
  gap: '10px',
};

const actionBtnStyle = {
  backgroundColor: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  color: 'white',
  borderRadius: '8px',
  padding: '8px 16px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '13px',
  fontWeight: '600',
  transition: 'var(--transition)',
  '&:hover': {
    backgroundColor: 'var(--bg-tertiary)',
  }
};

const terminalContainerStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  backgroundColor: '#050507',
  border: '1px solid #1f222d',
  borderRadius: '12px',
};

const terminalHeaderStyle = {
  backgroundColor: '#0a0a0f',
  padding: '12px 18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid #16181f',
};

const clearLogsBtnStyle = {
  backgroundColor: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid var(--danger)',
  color: 'var(--danger)',
  borderRadius: '6px',
  padding: '6px 12px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11px',
  fontWeight: '600',
  transition: 'var(--transition)',
  outline: 'none',
};

const terminalTitleStyle = {
  fontSize: '12px',
  fontFamily: 'monospace',
  color: 'var(--text-muted)',
};

const preStyle = {
  flex: 1,
  padding: '20px',
  fontFamily: 'monospace',
  fontSize: '12px',
  lineHeight: '1.6',
  color: '#a7f3d0', // green terminal tint
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  margin: 0,
};

const loadingCenterStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
};
