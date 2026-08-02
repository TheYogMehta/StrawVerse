const { queryOne, run } = require("./db");
const { logger } = require("./AppLogger");

const cache = {};
const successStreak = {};

/**
 * Extract clean domain name from URL or Referer
 */
function extractDomain(urlStr, refererStr) {
  const combined = (urlStr || "") + " " + (refererStr || "");
  let domain = "";
  try {
    if (urlStr) {
      domain = new URL(urlStr).hostname.replace(/^www\./i, "").toLowerCase();
    }
  } catch (e) {}

  if (!domain && refererStr) {
    try {
      domain = new URL(refererStr).hostname
        .replace(/^www\./i, "")
        .toLowerCase();
    } catch (e) {}
  }

  if (domain.includes("owocdn") || domain.includes("uwucdn")) {
    domain = "kwik.cx";
  } else if (domain.includes("animepahe")) {
    domain = "animepahe.pw";
  }
  return domain || "default";
}

/**
 * Get current optimal concurrency for a domain (from DB/cache or initial default max limit)
 */
async function getDomainConcurrency(domain, defaultMax = 16) {
  if (!domain) return defaultMax;
  if (cache[domain] !== undefined) {
    return cache[domain];
  }

  try {
    const row = await queryOne(
      "SELECT current_concurrency, max_concurrency FROM DomainConcurrency WHERE domain = ? LIMIT 1",
      [domain],
    );
    if (row && row.current_concurrency) {
      cache[domain] = Math.max(1, Number(row.current_concurrency));
      return cache[domain];
    }
  } catch (e) {}

  if (/animepahe|pahe|kwik|owocdn|uwucdn/i.test(domain)) {
    cache[domain] = 2;
  } else {
    cache[domain] = defaultMax;
  }
  return cache[domain];
}

/**
 * Record a rate-limit failure (HTTP 429 / 403 / connection drop)
 * Halves current concurrency for the domain (down to min 1) and saves to DB.
 */
async function recordDomainFailure(domain, currentVal) {
  if (!domain) return;
  const current = currentVal || cache[domain] || 16;
  const newConcurrency = Math.max(1, Math.floor(current / 2));
  cache[domain] = newConcurrency;
  successStreak[domain] = 0;

  logger.warn(
    `[DomainConcurrency] Rate limit/failure on domain '${domain}'. Reduced concurrency from ${current} -> ${newConcurrency}`,
  );

  try {
    await run(
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

/**
 * Record a successful segment request.
 * Ramps concurrency back up by +1 after 20 consecutive successful requests up to maxLimit.
 */
async function recordDomainSuccess(domain, maxLimit = 16) {
  if (!domain) return;
  const current = cache[domain] || 2;
  successStreak[domain] = (successStreak[domain] || 0) + 1;

  if (successStreak[domain] >= 20 && current < maxLimit) {
    const newConcurrency = Math.min(maxLimit, current + 1);
    cache[domain] = newConcurrency;
    successStreak[domain] = 0;

    logger.info(
      `[DomainConcurrency] Smooth download streak on domain '${domain}'. Scaled up concurrency from ${current} -> ${newConcurrency}`,
    );

    try {
      await run(
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
  } else {
    try {
      await run(
        `INSERT INTO DomainConcurrency (domain, current_concurrency, max_concurrency, total_requests, failed_requests, updated_at)
         VALUES (?, ?, ?, 1, 0, ?)
         ON CONFLICT(domain) DO UPDATE SET
           total_requests = DomainConcurrency.total_requests + 1,
           updated_at = excluded.updated_at`,
        [domain, current, current, Date.now()],
      );
    } catch (e) {}
  }
}

module.exports = {
  extractDomain,
  getDomainConcurrency,
  recordDomainFailure,
  recordDomainSuccess,
};
