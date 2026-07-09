/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react';
import { Copy, Trash2, RefreshCw } from 'lucide-react';
import Swal from 'sweetalert2';
import './css/LogsView.css';

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
    <div className="logs-wrapper">
      <header className="logs-header">
        <h1 className="logs-title">Application Logs</h1>
        <div className="logs-actions">
          <button onClick={fetchLogs} className="btn-log-action" title="Refresh Logs">
            <RefreshCw size={16} />
          </button>
          <button onClick={handleCopyLogs} className="btn-log-action" title="Copy to Clipboard">
            <Copy size={16} />
            <span>Copy Logs</span>
          </button>
        </div>
      </header>

      {loading ? (
        <div className="loading-center-logs">
          <img src="/images/loading.gif" alt="loading" className="u-style-17" />
        </div>
      ) : (
        <div className="terminal-container glass-panel">
          <div className="terminal-header">
            <button onClick={handleClearLogs} className="btn-clear-logs" title="Clear Logs">
              <Trash2 size={13} />
              <span>Clear Logs</span>
            </button>
            <span className="terminal-title">logs.txt</span>
          </div>
          <pre className="terminal-pre">{logs}</pre>
        </div>
      )}
    </div>
  );
}
