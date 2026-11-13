/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useState, useEffect, useRef } from "react";
import {
  Loader2,
  Download,
  ShieldAlert,
  Plus,
  FolderGit2,
  Trash2,
  X,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import Swal from "sweetalert2";
import { swalSuccess, swalError, swalConfirm } from "../utils/swal";
import "./css/Marketplace.css";

export default function Marketplace({ initialType }) {
  const [activeType, setActiveType] = useState(initialType || "Anime");
  const [extensions, setExtensions] = useState([]);
  const [repos, setRepos] = useState([]);
  const [selectedRepoFilter, setSelectedRepoFilter] = useState("all");
  const [installedProviders, setInstalledProviders] = useState({
    Anime: [],
    Manga: [],
    Movies: [],
  });
  const [installedVersions, setInstalledVersions] = useState({
    Anime: [],
    Manga: [],
    Movies: [],
  });
  const [activeProviders, setActiveProviders] = useState({
    Anime: "",
    Manga: "",
    Movies: "",
  });
  const [appVersion, setAppVersion] = useState("11.0.4");
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [showRepoModal, setShowRepoModal] = useState(false);
  const activeTabRef = useRef(activeType);

  const fetchMarketplace = async (targetType = activeType) => {
    setLoading(true);
    try {
      let extList = [];
      let repoList = [];
      let fetchedSuccessfully = false;

      // 1. Fetch from IPC if Electron
      if (window.sharedStateAPI && window.sharedStateAPI.getMarketplace) {
        try {
          const marketData =
            await window.sharedStateAPI.getMarketplace(targetType);
          extList = marketData?.items || [];
          repoList = marketData?.repos || [];
          fetchedSuccessfully = true;
        } catch (ipcErr) {
          console.warn(
            "IPC getMarketplace failed, falling back to HTTP:",
            ipcErr,
          );
        }
      }

      // 2. HTTP API fallback if running on web/mobile or IPC didn't fetch
      if (!fetchedSuccessfully) {
        try {
          const resp = await fetch(`/api/marketplace?type=${targetType}`);
          if (resp.ok) {
            const data = await resp.json();
            extList = data?.items || [];
            repoList = data?.repos || [];
            fetchedSuccessfully = true;
          }
        } catch (httpErr) {
          console.warn("HTTP getMarketplace failed:", httpErr);
        }
      }

      // Stale response guard: discard if user switched tabs in the meantime
      if (activeTabRef.current !== targetType) {
        return;
      }

      setExtensions(extList);
      setRepos(repoList);

      // 4. Fetch locally installed scrapers, versions, and active providers
      if (window.sharedStateAPI && window.sharedStateAPI.getSettings) {
        const settingsData = await window.sharedStateAPI.getSettings([
          "providers",
          "installedExtensions",
          "Animeprovider",
          "Mangaprovider",
          "Moviesprovider",
        ]);
        setInstalledProviders(
          settingsData.settings?.providers || {
            Anime: [],
            Manga: [],
            Movies: [],
          },
        );
        setInstalledVersions(
          settingsData.settings?.installedExtensions || {
            Anime: [],
            Manga: [],
            Movies: [],
          },
        );
        setActiveProviders({
          Anime: settingsData.settings?.Animeprovider || "",
          Manga: settingsData.settings?.Mangaprovider || "",
          Movies: settingsData.settings?.Moviesprovider || "",
        });
      } else {
        try {
          const res = await fetch("/api/settings");
          if (res.ok) {
            const data = await res.json();
            const s = data?.settings || {};
            setInstalledProviders(
              s.providers || { Anime: [], Manga: [], Movies: [] },
            );
            setInstalledVersions(
              s.installedExtensions || { Anime: [], Manga: [], Movies: [] },
            );
            setActiveProviders({
              Anime: s.Animeprovider || "",
              Manga: s.Mangaprovider || "",
              Movies: s.Moviesprovider || "",
            });
          }
        } catch (_) {}
      }

      // 5. Fetch current app version
      let currentAppVer = "11.0.4";
      if (window.sharedStateAPI && window.sharedStateAPI.getAppVersion) {
        try {
          const v = await window.sharedStateAPI.getAppVersion();
          if (v) currentAppVer = v;
        } catch (_) {}
      } else {
        try {
          const vRes = await fetch("/api/version");
          if (vRes.ok) {
            const vData = await vRes.json();
            const v = vData.version || vData.result;
            if (v) currentAppVer = v;
          }
        } catch (_) {}
      }
      setAppVersion(currentAppVer);
    } catch (err) {
      console.error("fetchMarketplace error:", err);
    } finally {
      if (activeTabRef.current === targetType) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    activeTabRef.current = activeType;
    setExtensions([]);
    fetchMarketplace(activeType);
  }, [activeType]);

  // If the currently selected repository filter is removed or not found, reset to 'all'
  useEffect(() => {
    if (
      selectedRepoFilter !== "all" &&
      repos.length > 0 &&
      !repos.some(
        (r) =>
          (r.id || `${r.owner}/${r.name}`).toLowerCase() ===
          selectedRepoFilter.toLowerCase(),
      )
    ) {
      setSelectedRepoFilter("all");
    }
  }, [repos, selectedRepoFilter]);

  const isAppVersionBelow = (current, minRequired) => {
    if (!current || !minRequired) return false;
    const curr = String(current)
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
    const req = String(minRequired)
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(curr.length, req.length); i++) {
      const c = curr[i] || 0;
      const r = req[i] || 0;
      if (c < r) return true;
      if (c > r) return false;
    }
    return false;
  };

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

  const getInstalledItem = (provider) => {
    const list = installedVersions[activeType] || [];
    const expectedOwner = (provider.repoOwner || "TheYogMehta")
      .toLowerCase()
      .replace(/^@/, "");
    const expectedName = (provider.name || "").toLowerCase();
    const expectedUniqueId = (
      provider.uniqueId || `${expectedOwner}/${expectedName}`
    )
      .toLowerCase()
      .replace(/^@/, "");

    return list.find((ext) => {
      const extUniqueId = (ext.uniqueId || "").toLowerCase().replace(/^@/, "");
      const extName = (ext.name || "").toLowerCase();
      const extOwner = (ext.repoOwner || "theyogmehta")
        .toLowerCase()
        .replace(/^@/, "");

      if (
        extUniqueId &&
        (extUniqueId === expectedUniqueId ||
          extUniqueId === `${expectedOwner}/${expectedName}`)
      ) {
        return true;
      }
      if (extName === expectedName && extOwner === expectedOwner) return true;
      return false;
    });
  };

  const isInstalled = (provider) => {
    if (getInstalledItem(provider)) return true;
    const providerList = installedProviders[activeType] || [];
    const owner = (provider.repoOwner || "TheYogMehta")
      .toLowerCase()
      .replace(/^@/, "");
    const isOfficial = owner === "theyogmehta";

    if (isOfficial && providerList.includes(provider.name)) return true;
    const targetUnique = provider.uniqueId;
    if (targetUnique && providerList.includes(targetUnique)) return true;

    const atScoped = `@${provider.repoOwner || "TheYogMehta"}/${provider.name}`;
    const slashScoped = `${(provider.repoOwner || "TheYogMehta").replace(/^@/, "")}/${provider.name}`;
    return (
      providerList.includes(atScoped) || providerList.includes(slashScoped)
    );
  };

  const getInstalledVersion = (provider) => {
    const item = getInstalledItem(provider);
    return item ? item.version : null;
  };

  const isProviderInUse = (provider) => {
    const rawActive = String(activeProviders[activeType] || "").trim();
    if (!rawActive) return false;

    const cleanActive = rawActive.toLowerCase().replace(/^@/, "");
    let activeOwner = "theyogmehta";
    let activeName = cleanActive;
    if (cleanActive.includes("/")) {
      const parts = cleanActive.split("/");
      activeOwner = parts[0];
      activeName = parts[1];
    }

    const pOwner = String(provider.repoOwner || "TheYogMehta")
      .trim()
      .toLowerCase()
      .replace(/^@/, "");
    const pName = String(provider.name || "").trim().toLowerCase();

    return activeOwner === pOwner && activeName === pName;
  };

  const handleUseProvider = async (provider) => {
    const ownerClean = (provider.repoOwner || "TheYogMehta").replace(/^@/, "");
    const isOfficial = ownerClean.toLowerCase() === "theyogmehta";
    const pList = installedProviders[activeType] || [];

    let targetVal = isOfficial
      ? provider.name
      : `@${ownerClean}/${provider.name}`;

    if (!isOfficial && pList.includes(`${ownerClean}/${provider.name}`)) {
      targetVal = `${ownerClean}/${provider.name}`;
    }

    const settingKey =
      activeType === "Anime"
        ? "Animeprovider"
        : activeType === "Movies"
          ? "Moviesprovider"
          : "Mangaprovider";

    try {
      if (window.sharedStateAPI && window.sharedStateAPI.updateSetting) {
        await window.sharedStateAPI.updateSetting(settingKey, targetVal);
      } else {
        await fetch("/api/settings/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [settingKey]: targetVal }),
        });
      }

      if (window.catalogCache) {
        delete window.catalogCache[`${activeType}_provider`];
        delete window.catalogCache[`${activeType}_trending`];
        delete window.catalogCache[`${activeType}_latest`];
      }

      setActiveProviders((prev) => ({
        ...prev,
        [activeType]: targetVal,
      }));

      swalSuccess(
        "Provider Activated",
        `"${provider.name}"${!isOfficial ? ` (@${provider.repoOwner})` : ""} is now your active ${activeType.toLowerCase()} provider!`,
      );
    } catch (err) {
      console.error("Failed to activate provider:", err);
      swalError("Error", "Could not set provider as active.");
    }
  };

  const handleAction = async (taskType, provider) => {
    const providerId =
      provider.uniqueId ||
      `${provider.repoId || `${provider.repoOwner || "TheYogMehta"}/${provider.repoName || "repo"}`}/${provider.name}`;

    if (taskType === "remove") {
      const confirmResult = await swalConfirm(
        "Are you sure?",
        `Do you want to remove ${provider.name} (by @${provider.repoOwner || "TheYogMehta"})?`,
        "Yes, remove it",
      );
      if (!confirmResult.isConfirmed) return;
    }

    if (
      taskType === "add" &&
      provider.MinAppVersion &&
      isAppVersionBelow(appVersion, provider.MinAppVersion)
    ) {
      swalError(
        "App Update Required",
        `This extension requires StrawVerse v${provider.MinAppVersion} or higher. You are currently on v${appVersion}. Please update your app to install this extension.`,
      );
      return;
    }

    setProcessingId(providerId);
    try {
      let res = null;
      if (window.sharedStateAPI && window.sharedStateAPI.extensions) {
        res = await window.sharedStateAPI.extensions(
          taskType,
          activeType,
          provider.name,
          provider.repoOwner || "TheYogMehta",
          provider.repoBaseUrl,
          provider.MinAppVersion,
        );
      } else {
        throw new Error("Extensions API not available in current environment.");
      }

      if (res && res.type === "success") {
        swalSuccess(
          "Success",
          res.message || `${provider.name} was processed successfully.`,
        );
        fetchMarketplace();
      } else {
        swalError("Error", res?.message || "Error performing scraper task.");
      }
    } catch (err) {
      console.error(err);
      swalError("Action Failed", err.message || "Scraper operation failed.");
    } finally {
      setProcessingId(null);
    }
  };

  const handleAddRepository = async () => {
    const { value: url } = await Swal.fire({
      background: "var(--bg-secondary)",
      color: "var(--text-main)",
      title: "Add Extension Repository",
      html: `
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5;">
          Enter a GitHub repository link or a direct raw URL to <code>marketplace.json</code>.
          Extensions will be installed under <code>/${activeType}/&lt;OWNER&gt;/</code>.
        </p>
      `,
      input: "url",
      inputPlaceholder: "https://github.com/username/my-strawverse-extensions",
      showCancelButton: true,
      confirmButtonText: "Add Repository",
      confirmButtonColor: "var(--accent)",
      cancelButtonColor: "var(--bg-tertiary)",
      inputValidator: (value) => {
        if (!value || !value.trim()) {
          return "Please enter a valid repository URL!";
        }
      },
    });

    if (url) {
      try {
        setLoading(true);
        let res = null;
        if (window.sharedStateAPI && window.sharedStateAPI.addExtensionRepo) {
          res = await window.sharedStateAPI.addExtensionRepo(url.trim());
        } else {
          const resp = await fetch("/api/marketplace/repos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url.trim() }),
          });
          res = await resp.json();
          if (res.error) throw new Error(res.error);
        }

        if (res && res.success) {
          swalSuccess(
            "Repository Added!",
            `Successfully loaded extensions from @${res.repo?.owner || "creator"}.`,
          );
          fetchMarketplace();
        } else {
          swalError("Failed to Add Repository", res?.error || "Unknown error");
        }
      } catch (err) {
        swalError("Failed to Add Repository", err.message);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleRemoveRepository = async (repo) => {
    const repoIdentifier =
      repo.id ||
      repo.url ||
      (repo.name ? `${repo.owner}/${repo.name}` : repo.owner);
    const repoDisplayName = repo.name
      ? `${repo.owner}/${repo.name}`
      : `@${repo.owner}`;

    const confirm = await swalConfirm(
      "Remove Repository?",
      `Do you want to remove ${repoDisplayName}? Installed extensions from this repository will remain on your device.`,
      "Remove",
    );
    if (!confirm.isConfirmed) return;

    try {
      setLoading(true);
      let res = null;
      if (window.sharedStateAPI && window.sharedStateAPI.removeExtensionRepo) {
        res = await window.sharedStateAPI.removeExtensionRepo(repoIdentifier);
      } else {
        const resp = await fetch(
          `/api/marketplace/repos?id=${encodeURIComponent(repoIdentifier)}`,
          {
            method: "DELETE",
          },
        );
        res = await resp.json();
        if (res.error) throw new Error(res.error);
      }

      if (res && res.success) {
        swalSuccess(
          "Repository Removed",
          `Repository ${repoDisplayName} was removed from your marketplace.`,
        );
        fetchMarketplace();
      }
    } catch (err) {
      swalError("Failed to Remove Repository", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreDefaultRepository = async () => {
    try {
      setLoading(true);
      let res = null;
      if (
        window.sharedStateAPI &&
        window.sharedStateAPI.restoreDefaultExtensionRepo
      ) {
        res = await window.sharedStateAPI.restoreDefaultExtensionRepo();
      } else {
        const resp = await fetch("/api/marketplace/repos/restore-default", {
          method: "POST",
        });
        res = await resp.json();
        if (res.error) throw new Error(res.error);
      }

      if (res && res.success) {
        swalSuccess(
          "Official Repository Restored",
          "Official StrawVerse extensions repository has been added back.",
        );
        fetchMarketplace();
      }
    } catch (err) {
      swalError("Failed to Restore Repository", err.message);
    } finally {
      setLoading(false);
    }
  };

  const visibleExtensions = extensions.filter((provider) => {
    // 1. Strict tab category matching
    const normTab = String(activeType || "").toLowerCase();
    const isMoviesTab = normTab === "movies" || normTab === "movies-tvshows";
    const pType = String(provider.type || "").toLowerCase();
    const pCategory = String(provider.category || "").toLowerCase();
    const matchesTab = isMoviesTab
      ? pType === "movies" || pCategory === "movies-tvshows"
      : pType === normTab || pCategory === normTab;

    if (!matchesTab) return false;

    // 2. Disabled scraper check
    if (provider.disabled) {
      return isInstalled(provider);
    }

    // 3. Strict repository selection filter
    if (selectedRepoFilter !== "all") {
      const filterLower = selectedRepoFilter.toLowerCase();
      const pRepo = (
        provider.repoId || `${provider.repoOwner || ""}/${provider.repoName || ""}`
      ).toLowerCase();
      if (pRepo !== filterLower) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="market-wrapper">
      <header className="market-header">
        <div className="market-header-row">
          <h1 className="market-title">Extensions</h1>

          <div className="market-header-actions">
            <div className="market-tabs-wrapper">
              <button
                onClick={() => setActiveType("Anime")}
                className={`market-tab-btn ${activeType === "Anime" ? "active" : ""}`}
              >
                Anime
              </button>
              <button
                onClick={() => setActiveType("Manga")}
                className={`market-tab-btn ${activeType === "Manga" ? "active" : ""}`}
              >
                Manga
              </button>
              <button
                onClick={() => setActiveType("Movies")}
                className={`market-tab-btn ${activeType === "Movies" ? "active" : ""}`}
              >
                Movies & Series
              </button>
            </div>

            <button
              onClick={handleAddRepository}
              className="btn-header-action btn-add-repo-primary"
              title="Add a custom extension repository"
            >
              <Plus size={16} />
              <span>Add Repo</span>
            </button>

            <button
              onClick={() => setShowRepoModal(true)}
              className="btn-header-action"
              title="Manage extension repositories"
            >
              <FolderGit2 size={16} />
              <span>Repos ({repos.length})</span>
            </button>

            {repos.length > 1 && (
              <select
                value={selectedRepoFilter}
                onChange={(e) => setSelectedRepoFilter(e.target.value)}
                className="repo-filter-select"
                title="Filter extensions by repository"
              >
                <option value="all">All Repositories ({repos.length})</option>
                {repos.map((r) => {
                  const val = r.id || `${r.owner}/${r.name}`;
                  const label = r.name
                    ? `${r.owner}/${r.name}`
                    : `@${r.owner}`;
                  return (
                    <option key={val} value={val}>
                      {label} {r.isDefault ? "(Official)" : ""}
                    </option>
                  );
                })}
              </select>
            )}
          </div>
        </div>
      </header>

      {loading ? (
        <div className="market-loading-center">
          <img src="/images/loading.gif" alt="loading" />
          <p>Connecting to extension repositories...</p>
        </div>
      ) : (
        <div className="market-grid">
          {visibleExtensions.length === 0 ? (
            <div className="market-loading-center">
              <p>No extensions available in active repositories.</p>
            </div>
          ) : (
            visibleExtensions.map((provider) => {
              const installed = isInstalled(provider);
              const inUse = installed && isProviderInUse(provider);
              const cardId =
                provider.uniqueId ||
                `${provider.repoId || `${provider.repoOwner || "TheYogMehta"}/${provider.repoName || "repo"}`}/${provider.name}`;
              const isProcessing = processingId === cardId;
              const logoUrl =
                provider.icon ||
                `${(
                  provider.repoBaseUrl ||
                  "https://raw.githubusercontent.com/TheYogMehta/extensions/refs/heads/main"
                ).replace(/\/$/, "")}/ico/${provider.name}.ico`;
              const installedVer = getInstalledVersion(provider);
              const hasUpdate = installedVer
                ? isUpdateAvailable(installedVer, provider.version)
                : false;
              const isOfficial =
                (provider.repoOwner || "").toLowerCase() === "theyogmehta";
              const isAppOutdated = provider.MinAppVersion
                ? isAppVersionBelow(appVersion, provider.MinAppVersion)
                : false;

              return (
                <div
                  key={cardId}
                  className={`market-card glass-panel ${inUse ? "in-use" : ""}`}
                >
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
                      <div className="market-card-title-row">
                        <h3 className="market-card-title">{provider.name}</h3>
                        <span
                          className={`market-repo-badge ${isOfficial ? "official" : ""}`}
                          title={`Repository: ${provider.repoName ? `${provider.repoOwner}/${provider.repoName}` : `@${provider.repoOwner || "TheYogMehta"}`}`}
                        >
                          {provider.repoName
                            ? `${provider.repoOwner}/${provider.repoName}`
                            : `@${provider.repoOwner || "TheYogMehta"}`}
                        </span>
                      </div>
                      <span className="market-version">
                        v{provider.version}
                        {installed && installedVer && (
                          <span
                            style={{
                              marginLeft: 6,
                              color: "var(--accent)",
                              fontWeight: 600,
                            }}
                          >
                            (installed: v{installedVer})
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {provider.disabled ? (
                    <div className="market-disabled-banner">
                      <ShieldAlert size={14} />
                      <span>Scraper Disabled / Obsolete</span>
                    </div>
                  ) : isAppOutdated ? (
                    <div
                      className="market-disabled-banner"
                      style={{
                        borderColor: "rgba(245, 158, 11, 0.4)",
                        background: "rgba(245, 158, 11, 0.1)",
                        color: "#fbbf24",
                      }}
                    >
                      <ShieldAlert size={14} />
                      <span>
                        Requires App v{provider.MinAppVersion}+ (You: v
                        {appVersion})
                      </span>
                    </div>
                  ) : null}

                  <div className="market-card-actions">
                    {isProcessing ? (
                      <button disabled className="btn-market-loading">
                        <Loader2 size={16} className="spin" />
                        <span>Processing...</span>
                      </button>
                    ) : isAppOutdated && !installed ? (
                      <button
                        onClick={() => handleAction("add", provider)}
                        className="btn-install"
                        style={{
                          opacity: 0.65,
                          background: "rgba(245, 158, 11, 0.15)",
                          borderColor: "rgba(245, 158, 11, 0.4)",
                          color: "#fbbf24",
                        }}
                        title={`Requires StrawVerse v${provider.MinAppVersion} or higher (current: v${appVersion})`}
                      >
                        <ShieldAlert size={14} />
                        <span>v{provider.MinAppVersion}+ Required</span>
                      </button>
                    ) : installed ? (
                      <>
                        {inUse ? (
                          <div
                            className="btn-in-use"
                            title="Currently selected as your active provider"
                          >
                            In Use
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn-use-provider"
                            onClick={() => handleUseProvider(provider)}
                            disabled={provider.disabled}
                            title={`Set ${provider.name} as active ${activeType.toLowerCase()} provider`}
                          >
                            Use Provider
                          </button>
                        )}

                        <div className="market-card-actions-row">
                          {!provider.disabled &&
                            (isAppOutdated ? (
                              <button
                                disabled
                                className="btn-update"
                                style={{ opacity: 0.5, cursor: "not-allowed" }}
                                title={`Update requires StrawVerse v${provider.MinAppVersion}`}
                              >
                                v{provider.MinAppVersion}+ Required
                              </button>
                            ) : hasUpdate ? (
                              <button
                                onClick={() => handleAction("add", provider)}
                                className="btn-update"
                                title={`New version v${provider.version} available!`}
                              >
                                Update
                              </button>
                            ) : (
                              <button
                                onClick={() => handleAction("add", provider)}
                                className="btn-reinstall"
                                title="Reinstall current version"
                              >
                                Reinstall
                              </button>
                            ))}
                          <button
                            onClick={() => handleAction("remove", provider)}
                            className="btn-remove"
                          >
                            Remove
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        onClick={() => handleAction("add", provider)}
                        className="btn-install"
                      >
                        <Download size={14} />
                        <span>Install Scraper</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Repositories Modal */}
      {showRepoModal && (
        <div
          className="repo-modal-backdrop"
          onClick={() => setShowRepoModal(false)}
        >
          <div
            className="repo-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="repo-modal-header">
              <h2>Extension Repositories</h2>
              <button
                onClick={() => setShowRepoModal(false)}
                className="btn-remove-repo"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="repo-modal-body">
              {repos.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "30px 20px",
                    color: "var(--text-muted)",
                  }}
                >
                  <p style={{ fontWeight: 600, fontSize: "14px" }}>
                    No extension repositories active.
                  </p>
                  <p style={{ fontSize: "12px", marginTop: "6px" }}>
                    Add a custom GitHub repository or restore the official
                    repository below.
                  </p>
                </div>
              ) : (
                repos.map((repo) => {
                  const repoKey =
                    repo.id || repo.url || `${repo.owner}/${repo.name}`;
                  const repoLabel = repo.name
                    ? `${repo.owner}/${repo.name}`
                    : `@${repo.owner}`;
                  return (
                    <div key={repoKey} className="repo-item-card">
                      <div className="repo-item-info">
                        <div className="repo-item-title-row">
                          <span className="repo-item-owner">{repoLabel}</span>
                          {repo.isDefault ? (
                            <span className="market-repo-badge official">
                              Official
                            </span>
                          ) : (
                            <span className="market-repo-badge">Custom</span>
                          )}
                        </div>
                        <span className="repo-item-url" title={repo.url}>
                          {repo.url}
                        </span>
                      </div>

                      <button
                        onClick={() => handleRemoveRepository(repo)}
                        className="btn-remove-repo"
                        title={`Remove ${repo.isDefault ? "official" : "custom"} repository`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div
              className="repo-modal-footer"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "10px",
              }}
            >
              {!repos.some((r) => r.isDefault) ? (
                <button
                  onClick={handleRestoreDefaultRepository}
                  className="btn-header-action"
                  style={{ borderRadius: 8 }}
                  title="Add back the official StrawVerse extensions repository"
                >
                  <RotateCcw size={14} />
                  <span>Restore Official Repo</span>
                </button>
              ) : (
                <div />
              )}
              <button
                onClick={() => {
                  setShowRepoModal(false);
                  handleAddRepository();
                }}
                className="btn-header-action btn-add-repo-primary"
                style={{ borderRadius: 8 }}
              >
                <Plus size={14} />
                <span>Add Another Repository</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
