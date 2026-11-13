const { queryOne, run } = require("./db");
const { logger } = require("./AppLogger");
const { getCanonicalDomain } = require("./extensionRegistry");

const cache = {};
const circuitBreaker = {};
const throughputCache = {};
const domainMaxCap = {};
const coolDownCache = {};
const lastTuningLogAt = {};
const TUNING_LOG_INTERVAL_MS = 30000;

function logTuning(domain, level, msg) {
  try {
    const now = Date.now();
    if (now - (lastTuningLogAt[domain] || 0) < TUNING_LOG_INTERVAL_MS) return;
    lastTuningLogAt[domain] = now;
    logger[level === "warn" ? "warn" : "info"](msg);
  } catch (_) {}
}

function markCoolingDown(key, durationMs = 60000) {
  if (!key) return;
  const cleanKey = String(key).trim().toLowerCase();
  coolDownCache[cleanKey] = Date.now() + durationMs;

  if (cache[cleanKey]) {
    const current = cache[cleanKey];
    const capped = Math.max(1, Math.floor(current / 2));
    domainMaxCap[cleanKey] = capped;
    cache[cleanKey] = capped;
    logger.warn(
      `[DomainConcurrency] Rate limit hit on '${cleanKey}'. Capped max concurrency ceiling to ${capped} and set ${Math.round(durationMs / 1000)}s cooldown.`,
    );
  } else {
    domainMaxCap[cleanKey] = 2;
    cache[cleanKey] = 2;
  }
}

function isCoolingDown(key) {
  if (!key) return false;
  const cleanKey = String(key).trim().toLowerCase();
  const until = coolDownCache[cleanKey];
  if (until && Date.now() < until) {
    return true;
  }
  if (until && Date.now() >= until) {
    delete coolDownCache[cleanKey];
  }
  return false;
}

function getCooldownRemaining(key) {
  if (!key) return 0;
  const cleanKey = String(key).trim().toLowerCase();
  const until = coolDownCache[cleanKey];
  if (until && Date.now() < until) {
    return Math.ceil((until - Date.now()) / 1000);
  }
  return 0;
}

function isCircuitOpen(domain) {
  return false;
}

function resetCircuit(domain) {
  if (circuitBreaker[domain]) {
    circuitBreaker[domain].failures = 0;
    circuitBreaker[domain].openedAt = null;
  }
}

function resetDomainConcurrency(domain) {
  if (!domain) {
    for (const d of Object.keys(cache)) {
      delete cache[d];
      delete throughputCache[d];
      resetCircuit(d);
    }
    return;
  }
  delete cache[domain];
  delete throughputCache[domain];
  resetCircuit(domain);
}

async function waitForCircuit(domain) {
  resetCircuit(domain);
}

/**
 * Extract clean root domain name from URL or Referer so subdomains share rate limits & speed tuning
 */
function extractDomain(urlStr, refererStr) {
  let hostname = "";
  try {
    if (urlStr) {
      hostname = new URL(urlStr).hostname.replace(/^www\./i, "").toLowerCase();
    }
  } catch (e) {}

  if (!hostname && refererStr) {
    try {
      hostname = new URL(refererStr).hostname
        .replace(/^www\./i, "")
        .toLowerCase();
    } catch (e) {}
  }

  if (!hostname) return "default";
  hostname = getCanonicalDomain(hostname);

  const parts = hostname.split(".");
  if (parts.length > 2) {
    const tld2 = parts.slice(-2).join(".");
    if (
      ["co.uk", "com.br", "co.jp", "net.au", "or.kr", "com.au"].includes(
        tld2,
      ) &&
      parts.length > 3
    ) {
      return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
  }

  return hostname;
}

async function getInitialDomainConcurrency(domain, defaultInitial = 4) {
  if (!domain) return Math.max(1, defaultInitial);

  try {
    const row = await queryOne(
      "SELECT current_concurrency, max_concurrency, failed_requests FROM DomainConcurrency WHERE domain = ? LIMIT 1",
      [domain],
    );
    if (row && row.failed_requests > 0 && row.current_concurrency) {
      // Floor restored caps at 4 so one old throttled session doesn't pin
      // future downloads to 1-2 threads forever; the adaptive loop still
      // backs off fast on real 429s/cooling-down.
      const restored = Math.max(4, Number(row.current_concurrency));
      domainMaxCap[domain] = restored;
    }
  } catch (e) {}

  delete throughputCache[domain];

  const targetCap = domainMaxCap[domain] || Infinity;
  const warmup = Math.max(1, Math.min(defaultInitial, targetCap));
  cache[domain] = warmup;
  return cache[domain];
}

async function getDomainConcurrency(domain, defaultInitial = 4) {
  if (!domain) return Math.max(1, defaultInitial);
  if (cache[domain] !== undefined) {
    return Math.max(1, cache[domain]);
  }
  return getInitialDomainConcurrency(domain, defaultInitial);
}

function setDomainErrorCap(domain, failedAtConcurrency) {
  if (!domain) return;
  const cap = Math.max(2, failedAtConcurrency - 1);
  const shouldLog = !domainMaxCap[domain] || cap < domainMaxCap[domain];
  if (!domainMaxCap[domain] || cap < domainMaxCap[domain]) {
    domainMaxCap[domain] = cap;
  }
  cache[domain] = domainMaxCap[domain];
  delete throughputCache[domain];
  if (shouldLog) {
    logger.warn(
      `[DomainConcurrency] 404/Rate-limit hit! Setting max speed limit for '${domain}' to ${domainMaxCap[domain]} (failed at ${failedAtConcurrency})`,
    );
  }
  try {
    run(
      `INSERT INTO DomainConcurrency (domain, current_concurrency, max_concurrency, total_requests, failed_requests, updated_at)
       VALUES (?, ?, ?, 1, 1, ?)
       ON CONFLICT(domain) DO UPDATE SET
         current_concurrency = excluded.current_concurrency,
         failed_requests = DomainConcurrency.failed_requests + 1,
         updated_at = excluded.updated_at`,
      [domain, domainMaxCap[domain], domainMaxCap[domain], Date.now()],
    );
  } catch (e) {}
}

function stepDownConcurrency(domain) {
  if (!domain) return 1;
  const current = cache[domain] || 2;
  const targetCap = domainMaxCap[domain]
    ? Math.min(current, domainMaxCap[domain])
    : Math.max(1, current - 1);
  const stepped = Math.max(1, targetCap);
  cache[domain] = stepped;
  logTuning(
    domain,
    "info",
    `[DomainConcurrency] Download speed degraded. Concurrency on '${domain}' now ${stepped} (was ${current})`,
  );
  return stepped;
}

function setRecoveryCap(domain) {
  if (!domain) return;
  const current = cache[domain] || 1;
  const newCap = domainMaxCap[domain]
    ? Math.min(current, domainMaxCap[domain])
    : current;
  domainMaxCap[domain] = newCap;
  cache[domain] = newCap;
  delete throughputCache[domain];

  logger.warn(
    `[DomainConcurrency] 404/Rate-limit hit! Setting max speed limit for '${domain}' to ${newCap}`,
  );

  try {
    run(
      `INSERT INTO DomainConcurrency (domain, current_concurrency, max_concurrency, total_requests, failed_requests, updated_at)
       VALUES (?, ?, ?, 1, 0, ?)
       ON CONFLICT(domain) DO UPDATE SET
         current_concurrency = excluded.current_concurrency,
         max_concurrency = excluded.max_concurrency,
         updated_at = excluded.updated_at`,
      [domain, newCap, newCap, Date.now()],
    );
  } catch (e) {}
}

function recordDomainFailure(domain, currentVal, statusCode = null) {
  if (!domain) return;
  const current = currentVal || cache[domain] || 2;
  const newConcurrency = Math.max(1, current - 1);
  const shouldLog =
    !domainMaxCap[domain] || newConcurrency < domainMaxCap[domain];
  cache[domain] = newConcurrency;
  domainMaxCap[domain] = newConcurrency;
  delete throughputCache[domain];

  if (shouldLog) {
    logger.warn(
      `[DomainConcurrency] 404/Rate-limit hit! Setting max speed limit for '${domain}' to ${newConcurrency}`,
    );
  }

  try {
    run(
      `INSERT INTO DomainConcurrency (domain, current_concurrency, max_concurrency, total_requests, failed_requests, updated_at)
       VALUES (?, ?, ?, 1, 1, ?)
       ON CONFLICT(domain) DO UPDATE SET
         current_concurrency = excluded.current_concurrency,
         total_requests = DomainConcurrency.total_requests + 1,
         failed_requests = DomainConcurrency.failed_requests + 1,
         updated_at = excluded.updated_at`,
      [domain, newConcurrency, newConcurrency, Date.now()],
    );
  } catch (e) {
    logger.error(
      `[DomainConcurrency] Error saving failure for ${domain}: ${e.message}`,
    );
  }
}

function recordDomainBatchSuccess(domain, batchThroughput = null) {
  if (!domain) return;
  resetCircuit(domain);
  const current = cache[domain] || 4;
  let newConcurrency = current;

  if (batchThroughput && batchThroughput > 0) {
    const prevThroughput = throughputCache[domain] || null;
    const mbps = (batchThroughput / (1024 * 1024)).toFixed(2) + " MB/s";

    if (prevThroughput) {
      const speedDiffRatio =
        (batchThroughput - prevThroughput) / prevThroughput;

      if (speedDiffRatio > 0.05) {
        // Ramp up faster on clearly improving links (+2 on strong gains),
        // still capped by domainMaxCap below.
        newConcurrency = current + (speedDiffRatio > 0.25 ? 2 : 1);
        if (domainMaxCap[domain] && newConcurrency > domainMaxCap[domain]) {
          domainMaxCap[domain] = Math.min(16, domainMaxCap[domain] + 1);
          newConcurrency = domainMaxCap[domain];
          logTuning(
            domain,
            "info",
            `[DomainConcurrency] '${domain}' recovering ceiling: ${mbps}, concurrency ${newConcurrency}`,
          );
        } else {
          logTuning(
            domain,
            "info",
            `[DomainConcurrency] '${domain}' good speed (+${(speedDiffRatio * 100).toFixed(1)}%, ${mbps}), concurrency ${current} -> ${newConcurrency}`,
          );
        }
      } else if (
        speedDiffRatio < -0.15 &&
        current > 4 &&
        batchThroughput > 1024 * 1024
      ) {
        newConcurrency = Math.max(4, current - 1);
        logTuning(
          domain,
          "warn",
          `[DomainConcurrency] '${domain}' slow (${(speedDiffRatio * 100).toFixed(1)}%, ${mbps}), concurrency ${current} -> ${newConcurrency}`,
        );
      } else {
        newConcurrency = current;
        if (domainMaxCap[domain] && current >= domainMaxCap[domain]) {
          domainMaxCap[domain] = Math.min(16, domainMaxCap[domain] + 1);
        }
        logTuning(
          domain,
          "info",
          `[DomainConcurrency] '${domain}' steady (${mbps}), concurrency ${current}`,
        );
      }
      throughputCache[domain] = 0.3 * batchThroughput + 0.7 * prevThroughput;
    } else {
      throughputCache[domain] = batchThroughput;
      newConcurrency = Math.max(1, current);
      logTuning(
        domain,
        "info",
        `[DomainConcurrency] '${domain}' initial sample (${mbps}), concurrency ${newConcurrency}`,
      );
    }
  }

  if (domainMaxCap[domain]) {
    newConcurrency = Math.min(newConcurrency, domainMaxCap[domain]);
  }

  cache[domain] = Math.max(1, newConcurrency);

  try {
    run(
      `INSERT INTO DomainConcurrency (domain, current_concurrency, max_concurrency, total_requests, failed_requests, updated_at)
       VALUES (?, ?, ?, 1, 0, ?)
       ON CONFLICT(domain) DO UPDATE SET
         current_concurrency = excluded.current_concurrency,
         max_concurrency = MAX(DomainConcurrency.max_concurrency, excluded.current_concurrency),
         total_requests = DomainConcurrency.total_requests + 1,
         updated_at = excluded.updated_at`,
      [domain, newConcurrency, newConcurrency, Date.now()],
    );
  } catch (e) {}
}

async function syncDomainConcurrencyFromMappingDb() {
  try {
    const { mappingQueryAll } = require("./db");
    const rows = await mappingQueryAll(
      "SELECT domain, current_concurrency, max_concurrency FROM domain_concurrency",
    );
    if (rows && rows.length > 0) {
      for (const r of rows) {
        if (r.domain && r.max_concurrency) {
          domainMaxCap[r.domain] = r.max_concurrency;
          if (r.current_concurrency) {
            cache[r.domain] = r.current_concurrency;
          }
        }
      }
    }
  } catch (e) {}
}

function recordDomainSuccess(domain) {
  resetCircuit(domain);
}

module.exports = {
  extractDomain,
  getDomainConcurrency,
  getInitialDomainConcurrency,
  recordDomainFailure,
  recordDomainSuccess,
  recordDomainBatchSuccess,
  isCircuitOpen,
  waitForCircuit,
  resetDomainConcurrency,
  markCoolingDown,
  isCoolingDown,
  getCooldownRemaining,
  setDomainErrorCap,
  stepDownConcurrency,
  setRecoveryCap,
  syncDomainConcurrencyFromMappingDb,
};
