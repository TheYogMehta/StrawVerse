import React, { useState, useEffect } from 'react';
import { Loader2, Download, Trash2, ShieldAlert } from 'lucide-react';
import Swal from 'sweetalert2';

export default function Marketplace({ initialType }) {
  const [activeType, setActiveType] = useState(initialType || 'Anime');
  const [extensions, setExtensions] = useState([]);
  const [installedProviders, setInstalledProviders] = useState({ Anime: [], Manga: [] });
  const [installedVersions, setInstalledVersions] = useState({ Anime: [], Manga: [] });
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);

  const fetchMarketplace = async () => {
    setLoading(true);
    try {
      // 1. Fetch online scrapers from repository
      const response = await fetch(
        'https://raw.githubusercontent.com/TheYogMehta/extensions/refs/heads/main/marketplace.json'
      );
      const data = await response.json();
      setExtensions(data[activeType] || []);

      // 2. Fetch locally installed scrapers from our Express settings
      const settingsRes = await fetch('/api/settings');
      const settingsData = await settingsRes.json();
      setInstalledProviders(settingsData.settings?.providers || { Anime: [], Manga: [] });
      setInstalledVersions(settingsData.settings?.installedExtensions || { Anime: [], Manga: [] });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarketplace();
  }, [activeType]);

  const isUpdateAvailable = (current, required) => {
    if (!current || !required) return false;
    const curr = current.split('.').map(Number);
    const req = required.split('.').map(Number);
    for (let i = 0; i < Math.max(curr.length, req.length); i++) {
      const c = curr[i] || 0;
      const r = req[i] || 0;
      if (c < r) return true;
      if (c > r) return false;
    }
    return false;
  };

  const getInstalledVersion = (name) => {
    const list = installedVersions[activeType] || [];
    const item = list.find(ext => ext.name === name);
    return item ? item.version : null;
  };

  const handleAction = async (taskType, providerName) => {
    if (taskType === 'remove') {
      const confirmResult = await Swal.fire({
        title: 'Are you sure?',
        text: `Do you want to remove the ${providerName} scraper?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, remove it',
        cancelButtonText: 'Cancel',
        background: 'var(--bg-secondary)',
        color: 'var(--text-main)',
        confirmButtonColor: 'var(--danger)',
        cancelButtonColor: 'var(--bg-tertiary)',
      });
      if (!confirmResult.isConfirmed) return;
    }

    setProcessingId(providerName);
    try {
      const res = await window.sharedStateAPI.extensions(taskType, activeType, providerName);
      if (res && res.type === 'success') {
        Swal.fire({
          title: 'Success',
          text: res.msg || `${providerName} was updated successfully.`,
          icon: 'success',
          background: 'var(--bg-secondary)',
          color: 'var(--text-main)',
          confirmButtonColor: 'var(--accent)',
        });
        fetchMarketplace();
      } else {
        Swal.fire({
          title: 'Error',
          text: res?.msg || 'Error performing scraper task.',
          icon: 'error',
          background: 'var(--bg-secondary)',
          color: 'var(--text-main)',
          confirmButtonColor: 'var(--accent)',
        });
      }
    } catch (err) {
      console.error(err);
      Swal.fire({
        title: 'Installation Failed',
        text: err.message || 'Scraper installation failed.',
        icon: 'error',
        background: 'var(--bg-secondary)',
        color: 'var(--text-main)',
        confirmButtonColor: 'var(--accent)',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const isInstalled = (name) => {
    const list = installedProviders[activeType] || [];
    return list.includes(name);
  };

  // Actually, we can get versions by loading local extensions. But wait! Let's check if the React app can just show Install / Remove buttons, which is already 95% of what's needed. If we want update check, we can just show "Update" if it's installed and version doesn't match!
  // Wait, let's see if we should fetch version. Let's just look at how EJS rendered it. EJS rendered Install, Update, Remove. Let's support Install and Remove, and if it's already installed, we can let user update it or remove it.

  return (
    <div style={marketWrapperStyle}>
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Scraper Marketplace</h1>
          <p style={subtitleStyle}>Install, update, or remove extensions for anime & manga content streaming.</p>
        </div>

        {/* Anime / Manga Tab Selectors */}
        <div style={tabsWrapperStyle}>
          <button
            onClick={() => setActiveType('Anime')}
            style={tabBtnStyle(activeType === 'Anime')}
          >
            Anime Scrapers
          </button>
          <button
            onClick={() => setActiveType('Manga')}
            style={tabBtnStyle(activeType === 'Manga')}
          >
            Manga Scrapers
          </button>
        </div>
      </header>

      {loading ? (
        <div style={loadingCenterStyle}>
          <img src="/images/loading.gif" alt="loading" style={{ width: '64px', height: '64px' }} />
          <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Connecting to extensions registry...</p>
        </div>
      ) : (
        <div style={gridStyle}>
          {extensions.map((provider) => {
            const installed = isInstalled(provider.name);
            const isProcessing = processingId === provider.name;
            const logoUrl = `https://raw.githubusercontent.com/TheYogMehta/extensions/refs/heads/main/ico/${provider.name}.ico`;
            const installedVer = getInstalledVersion(provider.name);
            const hasUpdate = installedVer ? isUpdateAvailable(installedVer, provider.version) : false;

            return (
              <div key={provider.name} style={cardStyle} className="glass-panel">
                <div style={cardHeaderStyle}>
                  <div style={logoWrapperStyle}>
                    <img
                      src={logoUrl}
                      alt={provider.name}
                      style={logoStyle}
                      onError={(e) => { e.target.src = '/images/image-404.png'; }}
                    />
                  </div>
                  <div>
                    <h3 style={cardTitleStyle}>{provider.name}</h3>
                    <span style={versionStyle}>v{provider.version}</span>
                  </div>
                </div>

                {provider.disabled && (
                  <div style={disabledBannerStyle}>
                    <ShieldAlert size={14} />
                    <span>Scraper Disabled / Obsolete</span>
                  </div>
                )}

                <div style={cardActionsStyle}>
                  {isProcessing ? (
                    <button disabled className="btn-market-loading">
                      <Loader2 size={16} className="spin" />
                      <span>Processing...</span>
                    </button>
                  ) : installed ? (
                    <>
                      {hasUpdate ? (
                        <button
                          onClick={() => handleAction('add', provider.name)}
                          className="btn-update"
                          disabled={provider.disabled}
                          title={`New version v${provider.version} available!`}
                        >
                          Update
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAction('add', provider.name)}
                          className="btn-reinstall"
                          disabled={provider.disabled}
                          title="Reinstall current version"
                        >
                          Reinstall
                        </button>
                      )}
                      <button onClick={() => handleAction('remove', provider.name)} className="btn-remove">
                        Remove
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleAction('add', provider.name)}
                      className="btn-install"
                      disabled={provider.disabled}
                    >
                      <Download size={14} />
                      <span>Install Scraper</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const marketWrapperStyle = {
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
  marginBottom: '30px',
  flexWrap: 'wrap',
  gap: '16px',
};

const titleStyle = {
  fontSize: '28px',
  fontWeight: '800',
  letterSpacing: '-0.5px',
  marginBottom: '4px',
};

const subtitleStyle = {
  fontSize: '13px',
  color: 'var(--text-muted)',
};

const tabsWrapperStyle = {
  display: 'flex',
  backgroundColor: 'var(--bg-secondary)',
  padding: '4px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
};

const tabBtnStyle = (active) => ({
  backgroundColor: active ? 'var(--accent)' : 'transparent',
  border: 'none',
  color: active ? 'white' : 'var(--text-muted)',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: '600',
  cursor: 'pointer',
  transition: 'var(--transition)',
});

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: '20px',
};

const cardStyle = {
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  minHeight: '160px',
};

const cardHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  marginBottom: '16px',
};

const logoWrapperStyle = {
  width: '42px',
  height: '42px',
  borderRadius: '8px',
  backgroundColor: 'var(--bg-tertiary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--border)',
};

const logoStyle = {
  width: '24px',
  height: '24px',
};

const cardTitleStyle = {
  fontSize: '16px',
  fontWeight: '700',
};

const versionStyle = {
  fontSize: '11px',
  color: 'var(--text-muted)',
  fontWeight: '600',
};

const disabledBannerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 10px',
  backgroundColor: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid var(--danger)',
  borderRadius: '6px',
  color: 'var(--danger)',
  fontSize: '12px',
  fontWeight: '600',
  marginBottom: '16px',
};

const cardActionsStyle = {
  display: 'flex',
  gap: '10px',
  marginTop: 'auto',
};

const loadingCenterStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '300px',
  width: '100%',
};
