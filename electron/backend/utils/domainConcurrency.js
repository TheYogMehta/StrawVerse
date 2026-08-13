const { queryOne, run } = require("./db");
const { logger } = require("./AppLogger");

const cache = {};
const circuitBreaker = {};
const throughputCache = {};
const domainMaxCap = {};
const coolDownCache = {};

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

  if (hostname.includes("owocdn") || hostname.includes("uwucdn")) {
    return "kwik.cx";
  } else if (hostname.includes("animepahe")) {
    return "animepahe.pw";
  }

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

function getDomainConcurrency(domain, defaultInitial = 4) {
  if (!domain) return Math.max(1, defaultInitial);
  if (cache[domain] !== undefined) {
    return Math.max(1, cache[domain]);
  }

  try {
    const row = queryOne(
      "SELECT current_concurrency, max_concurrency FROM DomainConcurrency WHERE domain = ? LIMIT 1",
      [domain],
    );
    if (row) {
      let avgConcurrency = Math.max(1, defaultInitial);
      if (row.current_concurrency && row.max_concurrency) {
        avgConcurrency = Math.max(
          1,
          Math.round(
            (Number(row.current_concurrency) + Number(row.max_concurrency)) / 2,
          ),
        );
      } else if (row.current_concurrency) {
        avgConcurrency = Math.max(1, Number(row.current_concurrency));
      }
      cache[domain] = avgConcurrency;
      return cache[domain];
    }
  } catch (e) {}

  cache[domain] = Math.max(1, defaultInitial);
  return cache[domain];
}

function setDomainErrorCap(domain, failedAtConcurrency) {
  if (!domain) return;
  const cap = Math.max(1, failedAtConcurrency - 1);
  if (!domainMaxCap[domain] || cap < domainMaxCap[domain]) {
    domainMaxCap[domain] = cap;
  }
  cache[domain] = domainMaxCap[domain];
  delete throughputCache[domain];
  logger.warn(
    `[DomainConcurrency] 404/Rate-limit hit! Setting max speed limit for '${domain}' to ${domainMaxCap[domain]} (failed at ${failedAtConcurrency})`,
  );
}

function stepDownConcurrency(domain) {
  if (!domain) return 1;
  const current = cache[domain] || 2;
  const targetCap = domainMaxCap[domain]
    ? Math.min(current, domainMaxCap[domain])
    : Math.max(1, current - 1);
  const stepped = Math.max(1, targetCap);
  cache[domain] = stepped;
  logger.info(
    `[DomainConcurrency] Download speed degraded. Decreasing concurrency on '${domain}' from ${current} -> ${stepped}`,
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
  cache[domain] = newConcurrency;
  domainMaxCap[domain] = newConcurrency;
  delete throughputCache[domain];

  logger.warn(
    `[DomainConcurrency] 404/Rate-limit hit! Setting max speed limit for '${domain}' to ${newConcurrency}`,
  );

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
        newConcurrency = current + 1;
        if (domainMaxCap[domain] && newConcurrency > domainMaxCap[domain]) {
          newConcurrency = domainMaxCap[domain];
          logger.info(
            `[DomainConcurrency] 404/Rate-limit ceiling reached (${mbps}). Keeping speed constant on '${domain}' at max speed ${newConcurrency}`,
          );
        } else {
          logger.info(
            `[DomainConcurrency] Good speed (+${(speedDiffRatio * 100).toFixed(1)}%, ${mbps}). Increasing concurrency on '${domain}' from ${current} -> ${newConcurrency}`,
          );
        }
      } else if (speedDiffRatio < -0.05 && current > 1) {
        newConcurrency = Math.max(1, current - 1);
        logger.warn(
          `[DomainConcurrency] Bad speed (${(speedDiffRatio * 100).toFixed(1)}%, ${mbps}). Decreasing concurrency on '${domain}' from ${current} -> ${newConcurrency}`,
        );
      } else {
        newConcurrency = current;
        logger.info(
          `[DomainConcurrency] Mid speed (${mbps}). Keeping speed constant on '${domain}' at ${current}`,
        );
      }
      throughputCache[domain] = 0.3 * batchThroughput + 0.7 * prevThroughput;
    } else {
      throughputCache[domain] = batchThroughput;
      newConcurrency = Math.max(1, current);
      logger.info(
        `[DomainConcurrency] Initial speed sample (${mbps}). Keeping speed constant on '${domain}' at ${newConcurrency}`,
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

function recordDomainSuccess(domain) {
  resetCircuit(domain);
}

module.exports = {
  extractDomain,
  getDomainConcurrency,
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
};
