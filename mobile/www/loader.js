/**
 * StrawVerse Android loader.
 *
 * Runs inside the Capacitor WebView before the real app loads:
 *   1. Starts the embedded Node.js runtime (capacitor-nodejs).
 *   2. Waits for the "server-ready" channel message OR polls /health.
 *   3. Navigates the WebView to the local Express server, which serves the
 *      exact same React GUI used by the desktop app.
 */
// No bundler in www/ — Capacitor injects native plugin proxies globally.
const NodeJS = window.Capacitor?.Plugins?.CapacitorNodeJS;

const PORT = 3459;
const APP_URL = `http://localhost:${PORT}/`;
const HEALTH_URL = `http://localhost:${PORT}/health`;

const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const spinnerEl = document.getElementById("spinner");
const retryEl = document.getElementById("retry");

function setStatus(text) {
  statusEl.textContent = text;
}

function showError(message) {
  spinnerEl.style.display = "none";
  errorEl.style.display = "block";
  errorEl.textContent = message;
  retryEl.style.display = "inline-block";
}

retryEl.addEventListener("click", () => window.location.reload());

let navigated = false;
function navigate() {
  if (navigated) return;
  navigated = true;
  window.location.replace(APP_URL);
}

async function waitForHealth(timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(HEALTH_URL, { cache: "no-store" });
      if (res.ok) return true;
    } catch (_) {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  try {
    if (!NodeJS) {
      showError(
        "Native bridge unavailable. This page must run inside the StrawVerse Android app.",
      );
      return;
    }
    NodeJS.addListener("server-ready", () => {
      setStatus("Loading interface…");
      navigate();
    });
    NodeJS.addListener("boot-error", (event) => {
      const message =
        (event && event.args && event.args[0] && event.args[0].message) ||
        "Unknown engine error";
      showError(`Engine failed to start: ${message}`);
    });

    setStatus("Starting engine…");
    await NodeJS.whenReady();

    // Fallback: if the channel message was missed (e.g. app resumed),
    // poll the health endpoint directly.
    setStatus("Waiting for server…");
    const healthy = await waitForHealth();
    if (healthy) {
      navigate();
    } else if (!navigated) {
      showError(
        "The local server did not respond in time. Please retry, or reinstall the app if this keeps happening.",
      );
    }
  } catch (err) {
    showError(`Failed to start: ${err.message || err}`);
  }
}

main();
