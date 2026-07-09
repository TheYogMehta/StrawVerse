/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useState, useEffect } from "react";
import { Loader2, Download, ShieldAlert } from "lucide-react";
import { swalSuccess, swalError, swalConfirm } from "../utils/swal";
import "./css/Marketplace.css";

export default function Marketplace({ initialType }) {
  const [activeType, setActiveType] = useState(initialType || "Anime");
  const [extensions, setExtensions] = useState([]);
  const [installedProviders, setInstalledProviders] = useState({
    Anime: [],
    Manga: [],
  });
  const [installedVersions, setInstalledVersions] = useState({
    Anime: [],
    Manga: [],
  });
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);

  const fetchMarketplace = async () => {
    setLoading(true);
    try {
      // 1. Fetch online scrapers from repository
      const response = await fetch(
        "https://raw.githubusercontent.com/TheYogMehta/extensions/refs/heads/main/marketplace.json",
      );
      const data = await response.json();
      setExtensions(data[activeType] || []);

      // 2. Fetch locally installed scrapers from our Express settings
      const settingsRes = await fetch("/api/settings");
      const settingsData = await settingsRes.json();
      setInstalledProviders(
        settingsData.settings?.providers || { Anime: [], Manga: [] },
      );
      setInstalledVersions(
        settingsData.settings?.installedExtensions || { Anime: [], Manga: [] },
      );
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
    const curr = current.split(".").map(Number);
    const req = required.split(".").map(Number);
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
    const item = list.find((ext) => ext.name === name);
    return item ? item.version : null;
  };

  const handleAction = async (taskType, providerName) => {
    if (taskType === "remove") {
      const confirmResult = await swalConfirm(
        "Are you sure?",
        `Do you want to remove the ${providerName} scraper?`,
        "Yes, remove it",
      );
      if (!confirmResult.isConfirmed) return;
    }

    setProcessingId(providerName);
    try {
      const res = await window.sharedStateAPI.extensions(
        taskType,
        activeType,
        providerName,
      );
      if (res && res.type === "success") {
        swalSuccess(
          "Success",
          res.msg || `${providerName} was updated successfully.`,
        );
        fetchMarketplace();
      } else {
        swalError("Error", res?.msg || "Error performing scraper task.");
      }
    } catch (err) {
      console.error(err);
      swalError(
        "Installation Failed",
        err.message || "Scraper installation failed.",
      );
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
    <div className="market-wrapper">
      <header className="market-header">
        <div>
          <h1 className="market-title">Scraper Extensions</h1>
          <p className="market-subtitle">
            Install, update, or remove extensions for anime & manga content
            streaming.
          </p>
        </div>

        {/* Anime / Manga Tab Selectors */}
        <div className="market-tabs-wrapper">
          <button
            onClick={() => setActiveType("Anime")}
            className={`market-tab-btn ${activeType === "Anime" ? "active" : ""}`}
          >
            Anime Scrapers
          </button>
          <button
            onClick={() => setActiveType("Manga")}
            className={`market-tab-btn ${activeType === "Manga" ? "active" : ""}`}
          >
            Manga Scrapers
          </button>
        </div>
      </header>

      {loading ? (
        <div className="market-loading-center">
          <img src="/images/loading.gif" alt="loading" />
          <p>Connecting to extensions registry...</p>
        </div>
      ) : (
        <div className="market-grid">
          {extensions.map((provider) => {
            const installed = isInstalled(provider.name);
            const isProcessing = processingId === provider.name;
            const logoUrl = `https://raw.githubusercontent.com/TheYogMehta/extensions/refs/heads/main/ico/${provider.name}.ico`;
            const installedVer = getInstalledVersion(provider.name);
            const hasUpdate = installedVer
              ? isUpdateAvailable(installedVer, provider.version)
              : false;

            return (
              <div key={provider.name} className="market-card glass-panel">
                <div className="market-card-header">
                  <div className="market-logo-wrapper">
                    <img
                      src={logoUrl}
                      alt={provider.name}
                      className="market-logo"
                      onError={(e) => {
                        e.target.src = "/images/image-404.png";
                      }}
                    />
                  </div>
                  <div>
                    <h3 className="market-card-title">{provider.name}</h3>
                    <span className="market-version">v{provider.version}</span>
                  </div>
                </div>

                {provider.disabled && (
                  <div className="market-disabled-banner">
                    <ShieldAlert size={14} />
                    <span>Scraper Disabled / Obsolete</span>
                  </div>
                )}

                <div className="market-card-actions">
                  {isProcessing ? (
                    <button disabled className="btn-market-loading">
                      <Loader2 size={16} className="spin" />
                      <span>Processing...</span>
                    </button>
                  ) : installed ? (
                    <>
                      {hasUpdate ? (
                        <button
                          onClick={() => handleAction("add", provider.name)}
                          className="btn-update"
                          disabled={provider.disabled}
                          title={`New version v${provider.version} available!`}
                        >
                          Update
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAction("add", provider.name)}
                          className="btn-reinstall"
                          disabled={provider.disabled}
                          title="Reinstall current version"
                        >
                          Reinstall
                        </button>
                      )}
                      <button
                        onClick={() => handleAction("remove", provider.name)}
                        className="btn-remove"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleAction("add", provider.name)}
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
