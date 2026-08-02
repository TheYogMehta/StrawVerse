const NodeJS = window.Capacitor?.Plugins?.CapacitorNodeJS;

const PORT = 3459;
const APP_URL = `http://127.0.0.1:${PORT}/`;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;

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
      //
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

    const healthTimeout = 60000;
    waitForHealth(healthTimeout).then((healthy) => {
      if (healthy) {
        navigate();
      } else if (!navigated) {
        showError(
          "The local server did not respond in time. Please retry, or reinstall the app if this keeps happening.",
        );
      }
    });

    try {
      await NodeJS.whenReady();
      setStatus("Waiting for server…");
    } catch (e) {
      console.warn("whenReady failed, relying on health check:", e);
    }
  } catch (err) {
    if (!navigated) {
      showError(`Failed to start: ${err.message || err}`);
    }
  }
}

main();
