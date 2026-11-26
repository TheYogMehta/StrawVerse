let axios = null;
try {
  axios = require("axios");
} catch (_) {
  axios = null;
}
const { logger } = require("./AppLogger");
const { queryOne, run, getKeyValue } = require("./db");
const {
  normalizeTitleForMatch,
  extractYearFromDate,
  normalizeMediaKind,
  scoreMovieMatch,
} = require("./constants");

const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 6 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8000;
const MIN_MATCH_SCORE = 65;

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_EXTERNAL_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "imdb.com",
  "www.imdb.com",
  "themoviedb.org",
  "www.themoviedb.org",
  "myanimelist.net",
  "anilist.co",
]);

const ALLOWED_IMAGE_HOSTS = new Set([
  "image.tmdb.org",
  "s4.anilist.co",
  "cdn.myanimelist.net",
  "images.metahub.space",
  "m.media-amazon.com",
]);

const inFlightRequests = new Map();

function isValidYoutubeId(id) {
  return typeof id === "string" && YOUTUBE_ID_RE.test(id.trim());
}

function extractYoutubeId(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (YOUTUBE_ID_RE.test(trimmed)) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
      const seg = parsed.pathname.replace(/^\/+/, "").split("/")[0];
      return isValidYoutubeId(seg) ? seg : null;
    }
    if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "www.youtube-nocookie.com" ||
      host === "youtube-nocookie.com"
    ) {
      const vParam = parsed.searchParams.get("v");
      if (isValidYoutubeId(vParam)) return vParam;
      const embedMatch = parsed.pathname.match(/\/embed\/([A-Za-z0-9_-]{11})/);
      if (embedMatch && isValidYoutubeId(embedMatch[1])) return embedMatch[1];
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeUrlAgainstHosts(rawUrl, allowedHosts) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:") return null;
    if (!allowedHosts.has(parsed.hostname.toLowerCase())) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function sanitizeExternalUrl(rawUrl) {
  return sanitizeUrlAgainstHosts(rawUrl, ALLOWED_EXTERNAL_HOSTS);
}

function sanitizeImageUrl(rawUrl) {
  return sanitizeUrlAgainstHosts(rawUrl, ALLOWED_IMAGE_HOSTS);
}

function buildTrailerItem(youtubeId, title = "Official Trailer", type = "Trailer") {
  const cleanId = extractYoutubeId(youtubeId);
  if (!cleanId) return null;
  const normalizedType =
    type === "Teaser" || type === "Clip" ? type : "Trailer";
  return {
    youtubeId: cleanId,
    title: typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : "Official Trailer",
    type: normalizedType,
    watchUrl: `https://www.youtube.com/watch?v=${cleanId}`,
  };
}

function emptyEnrichment(source = "none") {
  return {
    found: false,
    cached: false,
    source,
    rating: null,
    runtime: null,
    status: null,
    releaseYear: null,
    directors: [],
    studios: [],
    cast: [],
    trailers: [],
    externalUrls: {},
  };
}

function hasAnyEnrichmentContent(payload) {
  if (!payload) return false;
  return Boolean(
    payload.rating ||
      payload.runtime ||
      payload.status ||
      (payload.directors && payload.directors.length > 0) ||
      (payload.studios && payload.studios.length > 0) ||
      (payload.cast && payload.cast.length > 0) ||
      (payload.trailers && payload.trailers.length > 0) ||
      (payload.externalUrls && Object.keys(payload.externalUrls).length > 0),
  );
}

function parsePositiveInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0 || num > 99999999) return null;
  return num;
}

function buildCacheKey({ type, title, id, malId, year, mediaType, hasTmdbKey }) {
  const normTitle = normalizeTitleForMatch(title || "");
  const normYear = extractYearFromDate(year) || "";
  if (type === "Anime") {
    const parsedMalId = parsePositiveInt(malId);
    if (parsedMalId) {
      return `anime:default:mal:${parsedMalId}`;
    }
    return `anime:default:title:${normTitle}:${normYear}`;
  }

  const tier = hasTmdbKey ? "tmdb" : "keyless";
  const normKind = normalizeMediaKind(mediaType) || "";
  const idStr = typeof id === "string" ? id.trim() : "";
  if (hasTmdbKey) {
    const tmdbMatch = idStr.match(/^(movie|tv):(\d+)$/i);
    if (tmdbMatch) {
      return `movies:tmdb:id:${tmdbMatch[1].toLowerCase()}:${tmdbMatch[2]}`;
    }
  }
  if (/^tt\d{5,}$/i.test(idStr)) {
    return `movies:${tier}:imdb:${idStr.toLowerCase()}`;
  }
  return `movies:${tier}:title:${normTitle}:${normKind}:${normYear}`;
}

function maskApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return null;
  const trimmed = apiKey.trim();
  if (!trimmed) return null;
  const tail = trimmed.slice(-4);
  return `${"•".repeat(8)}${tail}`;
}

async function defaultHttpGet(url, options = {}) {
  if (axios) {
    const response = await axios.get(url, {
      timeout: UPSTREAM_TIMEOUT_MS,
      ...options,
    });
    return response.data;
  }
  const target = new URL(url);
  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== null) target.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(target.toString(), {
    method: "GET",
    headers: options.headers || {},
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function defaultHttpPost(url, body, options = {}) {
  if (axios) {
    const response = await axios.post(url, body, {
      timeout: UPSTREAM_TIMEOUT_MS,
      ...options,
    });
    return response.data;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── ANILIST ADAPTER ──────────────────────────────────────────────────────────

const ANILIST_MEDIA_FIELDS = `
  id
  idMal
  siteUrl
  title { romaji english native }
  averageScore
  duration
  status
  seasonYear
  startDate { year }
  trailer { id site }
  studios(isMain: true) { nodes { name } }
  staff(sort: RELEVANCE, perPage: 15) {
    edges {
      role
      node {
        name { full }
        image { large }
        siteUrl
      }
    }
  }
  characters(sort: [ROLE, RELEVANCE], perPage: 12) {
    edges {
      role
      node {
        name { full }
        image { large }
        siteUrl
      }
      voiceActors(sort: [RELEVANCE]) {
        name { full }
        languageV2
        image { large }
        siteUrl
      }
    }
  }
`;

const ANILIST_BY_MAL_QUERY = `
  query ($idMal: Int) {
    Media(idMal: $idMal, type: ANIME) {
      ${ANILIST_MEDIA_FIELDS}
    }
  }
`;

const ANILIST_BY_SEARCH_QUERY = `
  query ($search: String) {
    Page(page: 1, perPage: 6) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        ${ANILIST_MEDIA_FIELDS}
      }
    }
  }
`;

function formatAniListStatus(status) {
  if (!status) return null;
  const map = {
    FINISHED: "Finished",
    RELEASING: "Airing",
    NOT_YET_RELEASED: "Upcoming",
    CANCELLED: "Cancelled",
    HIATUS: "Hiatus",
  };
  return map[status] || status;
}

function normalizeAniListMedia(media) {
  if (!media) return emptyEnrichment("anilist");

  const trailers = [];
  if (media.trailer && String(media.trailer.site || "").toLowerCase() === "youtube") {
    const t = buildTrailerItem(media.trailer.id, "Official Trailer", "Trailer");
    if (t) trailers.push(t);
  }

  const directorSeen = new Set();
  const directors = [];
  for (const edge of media.staff?.edges || []) {
    const role = edge?.role || "";
    const name = edge?.node?.name?.full;
    if (!name || !/director/i.test(role)) continue;
    const key = name.toLowerCase();
    if (directorSeen.has(key)) continue;
    directorSeen.add(key);
    directors.push({
      name,
      role: role.trim() || "Director",
      image: sanitizeImageUrl(edge.node?.image?.large),
      profileUrl: sanitizeExternalUrl(edge.node?.siteUrl),
    });
    if (directors.length >= 5) break;
  }

  const studios = [];
  const studioSeen = new Set();
  for (const studio of media.studios?.nodes || []) {
    if (!studio?.name) continue;
    const key = studio.name.toLowerCase();
    if (studioSeen.has(key)) continue;
    studioSeen.add(key);
    studios.push(studio.name);
    if (studios.length >= 5) break;
  }

  const cast = [];
  for (const edge of media.characters?.edges || []) {
    const charName = edge?.node?.name?.full;
    if (!charName) continue;
    const voiceActors = [];
    const seenLangs = new Set();
    for (const va of edge.voiceActors || []) {
      const vaName = va?.name?.full;
      const lang = va?.languageV2 || "Unknown";
      if (!vaName) continue;
      if (lang !== "Japanese" && lang !== "English") continue;
      if (seenLangs.has(lang)) continue;
      seenLangs.add(lang);
      voiceActors.push({
        name: vaName,
        language: lang,
        image: sanitizeImageUrl(va.image?.large),
        profileUrl: sanitizeExternalUrl(va.siteUrl),
      });
    }

    const primaryVa =
      voiceActors.find((v) => v.language === "Japanese") || voiceActors[0] || null;
    cast.push({
      name: primaryVa ? primaryVa.name : charName,
      role: primaryVa ? charName : edge.role || "Character",
      image: primaryVa?.image || sanitizeImageUrl(edge.node?.image?.large),
      profileUrl:
        primaryVa?.profileUrl || sanitizeExternalUrl(edge.node?.siteUrl),
      characterName: charName,
      characterImage: sanitizeImageUrl(edge.node?.image?.large),
      voiceActors,
    });
    if (cast.length >= 12) break;
  }

  const externalUrls = {};
  const anilistUrl = sanitizeExternalUrl(media.siteUrl);
  if (anilistUrl) externalUrls.anilist = anilistUrl;
  if (media.idMal) {
    const malUrl = sanitizeExternalUrl(`https://myanimelist.net/anime/${media.idMal}`);
    if (malUrl) externalUrls.mal = malUrl;
  }

  const releaseYear = media.seasonYear
    ? String(media.seasonYear)
    : media.startDate?.year
      ? String(media.startDate.year)
      : null;

  const result = {
    found: true,
    cached: false,
    source: "anilist",
    rating:
      typeof media.averageScore === "number" && media.averageScore > 0
        ? {
            score: Number((media.averageScore / 10).toFixed(1)),
            scale: 100,
            label: "AniList",
            votes: null,
          }
        : null,
    runtime:
      typeof media.duration === "number" && media.duration > 0
        ? `${media.duration} min/ep`
        : null,
    status: formatAniListStatus(media.status),
    releaseYear,
    directors,
    studios,
    cast,
    trailers,
    externalUrls,
  };
  result.found = hasAnyEnrichmentContent(result);
  return result;
}

function pickBestAnimeMatch(target, candidates) {
  let best = null;
  let bestScore = -Infinity;
  for (const cand of candidates || []) {
    const titles = [
      cand?.title?.english,
      cand?.title?.romaji,
      cand?.title?.native,
      cand?.title,
    ].filter((t) => typeof t === "string" && t.trim());
    const candYear = cand?.seasonYear || cand?.startDate?.year || cand?.year || null;
    for (const candTitle of titles) {
      const score = scoreMovieMatch(
        { title: target.title, year: target.year },
        { title: candTitle, year: candYear },
      );
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
  }
  return bestScore >= MIN_MATCH_SCORE ? best : null;
}

async function fetchAniListEnrichment({ malId, title, year }, deps = {}) {
  const httpPost = deps.httpPost || defaultHttpPost;
  const parsedMalId = parsePositiveInt(malId);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (parsedMalId) {
    try {
      const data = await httpPost(
        "https://graphql.anilist.co",
        { query: ANILIST_BY_MAL_QUERY, variables: { idMal: parsedMalId } },
        { headers },
      );
      const media = data?.data?.Media;
      if (media) {
        return normalizeAniListMedia(media);
      }
    } catch {
      // Fall through to title search if idMal lookup fails
    }
  }

  if (title) {
    const data = await httpPost(
      "https://graphql.anilist.co",
      { query: ANILIST_BY_SEARCH_QUERY, variables: { search: title } },
      { headers },
    );
    const list = data?.data?.Page?.media || [];
    const matched = pickBestAnimeMatch({ title, year }, list);
    if (matched) {
      return normalizeAniListMedia(matched);
    }
  }

  return emptyEnrichment("anilist");
}

// ─── JIKAN FALLBACK ADAPTER ───────────────────────────────────────────────────

function normalizeJikanData(anime, charactersData = [], staffData = []) {
  if (!anime) return emptyEnrichment("jikan");

  const trailers = [];
  const ytId =
    anime.trailer?.youtube_id || extractYoutubeId(anime.trailer?.embed_url || anime.trailer?.url);
  if (ytId) {
    const t = buildTrailerItem(ytId, "Official Trailer", "Trailer");
    if (t) trailers.push(t);
  }

  const directors = [];
  const directorSeen = new Set();
  for (const entry of staffData || []) {
    const positions = Array.isArray(entry?.positions) ? entry.positions : [];
    const dirPos = positions.find((p) => /director/i.test(String(p)));
    const name = entry?.person?.name;
    if (!name || !dirPos) continue;
    const key = name.toLowerCase();
    if (directorSeen.has(key)) continue;
    directorSeen.add(key);
    directors.push({
      name,
      role: dirPos,
      image: sanitizeImageUrl(entry.person?.images?.jpg?.image_url),
      profileUrl: sanitizeExternalUrl(entry.person?.url),
    });
    if (directors.length >= 5) break;
  }

  const studios = (anime.studios || [])
    .map((s) => s?.name)
    .filter(Boolean)
    .slice(0, 5);

  const cast = [];
  for (const entry of charactersData || []) {
    const charName = entry?.character?.name;
    if (!charName) continue;
    const voiceActors = [];
    const seenLangs = new Set();
    for (const va of entry.voice_actors || []) {
      const vaName = va?.person?.name;
      const lang = va?.language || "Unknown";
      if (!vaName) continue;
      if (lang !== "Japanese" && lang !== "English") continue;
      if (seenLangs.has(lang)) continue;
      seenLangs.add(lang);
      voiceActors.push({
        name: vaName,
        language: lang,
        image: sanitizeImageUrl(va.person?.images?.jpg?.image_url),
        profileUrl: sanitizeExternalUrl(va.person?.url),
      });
    }
    const primaryVa =
      voiceActors.find((v) => v.language === "Japanese") || voiceActors[0] || null;
    const charImg = sanitizeImageUrl(entry.character?.images?.jpg?.image_url);
    const charUrl = sanitizeExternalUrl(entry.character?.url);
    cast.push({
      name: primaryVa ? primaryVa.name : charName,
      role: primaryVa ? charName : entry.role || "Character",
      image: primaryVa?.image || charImg,
      profileUrl: primaryVa?.profileUrl || charUrl,
      characterName: charName,
      characterImage: charImg,
      voiceActors,
    });
    if (cast.length >= 12) break;
  }

  const externalUrls = {};
  const malUrl = sanitizeExternalUrl(anime.url);
  if (malUrl) externalUrls.mal = malUrl;

  const result = {
    found: true,
    cached: false,
    source: "jikan",
    rating:
      typeof anime.score === "number" && anime.score > 0
        ? {
            score: Number(anime.score.toFixed(1)),
            scale: 10,
            label: "MAL",
            votes: typeof anime.scored_by === "number" ? anime.scored_by : null,
          }
        : null,
    runtime:
      typeof anime.duration === "string" && anime.duration !== "Unknown"
        ? anime.duration.replace(/\s*per ep\.?/i, "/ep")
        : null,
    status: anime.status || null,
    releaseYear: anime.year ? String(anime.year) : extractYearFromDate(anime.aired?.from),
    directors,
    studios,
    cast,
    trailers,
    externalUrls,
  };
  result.found = hasAnyEnrichmentContent(result);
  return result;
}

async function fetchJikanEnrichment({ malId, title, year }, deps = {}) {
  const httpGet = deps.httpGet || defaultHttpGet;
  let targetMalId = parsePositiveInt(malId);

  if (!targetMalId && title) {
    const searchRes = await httpGet(
      `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=5`,
    );
    const matched = pickBestAnimeMatch({ title, year }, searchRes?.data || []);
    if (matched?.mal_id) {
      targetMalId = matched.mal_id;
    }
  }

  if (!targetMalId) return emptyEnrichment("jikan");

  const [fullRes, charsRes, staffRes] = await Promise.allSettled([
    httpGet(`https://api.jikan.moe/v4/anime/${targetMalId}/full`),
    httpGet(`https://api.jikan.moe/v4/anime/${targetMalId}/characters`),
    httpGet(`https://api.jikan.moe/v4/anime/${targetMalId}/staff`),
  ]);

  const anime = fullRes.status === "fulfilled" ? fullRes.value?.data : null;
  if (!anime) return emptyEnrichment("jikan");

  const chars = charsRes.status === "fulfilled" ? charsRes.value?.data || [] : [];
  const staff = staffRes.status === "fulfilled" ? staffRes.value?.data || [] : [];
  return normalizeJikanData(anime, chars, staff);
}

// ─── TMDB ADAPTER ─────────────────────────────────────────────────────────────

function tmdbHeadersAndParams(apiKey) {
  const trimmed = String(apiKey || "").trim();
  if (trimmed.startsWith("eyJ")) {
    return {
      headers: { Authorization: `Bearer ${trimmed}`, Accept: "application/json" },
      params: {},
    };
  }
  return {
    headers: { Accept: "application/json" },
    params: { api_key: trimmed },
  };
}

function normalizeTmdbData(detail, resolvedKind) {
  if (!detail) return emptyEnrichment("tmdb");

  const trailerPriority = { Trailer: 0, Teaser: 1, Clip: 2 };
  const rawVideos = (detail.videos?.results || [])
    .filter(
      (v) =>
        String(v?.site || "").toLowerCase() === "youtube" &&
        isValidYoutubeId(v?.key) &&
        Object.prototype.hasOwnProperty.call(trailerPriority, v?.type),
    )
    .sort((a, b) => {
      const typeDiff =
        (trailerPriority[a.type] ?? 9) - (trailerPriority[b.type] ?? 9);
      if (typeDiff !== 0) return typeDiff;
      return (b.official ? 1 : 0) - (a.official ? 1 : 0);
    });

  const trailers = [];
  const seenYt = new Set();
  for (const v of rawVideos) {
    if (seenYt.has(v.key)) continue;
    seenYt.add(v.key);
    const item = buildTrailerItem(v.key, v.name || v.type, v.type);
    if (item) trailers.push(item);
    if (trailers.length >= 4) break;
  }

  const directors = [];
  const directorSeen = new Set();
  const addDirector = (person, role) => {
    if (!person?.name) return;
    const key = person.name.toLowerCase();
    if (directorSeen.has(key)) return;
    directorSeen.add(key);
    directors.push({
      name: person.name,
      role,
      image: person.profile_path
        ? sanitizeImageUrl(`https://image.tmdb.org/t/p/w185${person.profile_path}`)
        : null,
      profileUrl: person.id
        ? sanitizeExternalUrl(`https://www.themoviedb.org/person/${person.id}`)
        : null,
    });
  };

  if (resolvedKind === "tv" && Array.isArray(detail.created_by)) {
    for (const creator of detail.created_by) {
      addDirector(creator, "Creator");
      if (directors.length >= 5) break;
    }
  }
  for (const crewMember of detail.credits?.crew || []) {
    if (directors.length >= 5) break;
    if (crewMember?.job === "Director" || crewMember?.job === "Series Director") {
      addDirector(crewMember, crewMember.job);
    }
  }

  const studioSource =
    resolvedKind === "tv" && Array.isArray(detail.networks) && detail.networks.length > 0
      ? detail.networks
      : detail.production_companies || [];
  const studios = studioSource
    .map((s) => s?.name)
    .filter(Boolean)
    .slice(0, 5);

  const cast = [];
  const rawCast = [...(detail.credits?.cast || [])].sort(
    (a, b) => (a?.order ?? 999) - (b?.order ?? 999),
  );
  for (const member of rawCast) {
    if (!member?.name) continue;
    cast.push({
      name: member.name,
      role: member.character || null,
      image: member.profile_path
        ? sanitizeImageUrl(`https://image.tmdb.org/t/p/w185${member.profile_path}`)
        : null,
      profileUrl: member.id
        ? sanitizeExternalUrl(`https://www.themoviedb.org/person/${member.id}`)
        : null,
    });
    if (cast.length >= 12) break;
  }

  let runtime = null;
  if (resolvedKind === "movie" && typeof detail.runtime === "number" && detail.runtime > 0) {
    runtime = `${detail.runtime} min`;
  } else if (
    resolvedKind === "tv" &&
    Array.isArray(detail.episode_run_time) &&
    detail.episode_run_time[0] > 0
  ) {
    runtime = `${detail.episode_run_time[0]} min/ep`;
  }

  const externalUrls = {};
  if (detail.id) {
    const tmdbUrl = sanitizeExternalUrl(
      `https://www.themoviedb.org/${resolvedKind}/${detail.id}`,
    );
    if (tmdbUrl) externalUrls.tmdb = tmdbUrl;
  }
  const imdbId = detail.external_ids?.imdb_id || detail.imdb_id;
  if (imdbId && /^tt\d+$/i.test(imdbId)) {
    const imdbUrl = sanitizeExternalUrl(`https://www.imdb.com/title/${imdbId}`);
    if (imdbUrl) externalUrls.imdb = imdbUrl;
  }

  const result = {
    found: true,
    cached: false,
    source: "tmdb",
    rating:
      typeof detail.vote_average === "number" && detail.vote_average > 0
        ? {
            score: Number(detail.vote_average.toFixed(1)),
            scale: 10,
            label: "TMDB",
            votes: typeof detail.vote_count === "number" ? detail.vote_count : null,
          }
        : null,
    runtime,
    status: detail.status || null,
    releaseYear:
      extractYearFromDate(detail.release_date || detail.first_air_date) || null,
    directors,
    studios,
    cast,
    trailers,
    externalUrls,
  };
  result.found = hasAnyEnrichmentContent(result);
  return result;
}

async function fetchTmdbEnrichment({ id, title, year, mediaType, apiKey }, deps = {}) {
  const httpGet = deps.httpGet || defaultHttpGet;
  if (!apiKey) return emptyEnrichment("tmdb");

  const { headers, params } = tmdbHeadersAndParams(apiKey);
  const directMatch = typeof id === "string" ? id.trim().match(/^(movie|tv):(\d+)$/i) : null;

  if (directMatch) {
    const directKind = directMatch[1].toLowerCase();
    const directId = directMatch[2];
    try {
      const detail = await httpGet(`https://api.themoviedb.org/3/${directKind}/${directId}`, {
        headers,
        params: { ...params, append_to_response: "videos,credits,external_ids" },
      });
      if (detail) {
        const score = scoreMovieMatch(
          { title, year, mediaType },
          {
            title: detail.title || detail.name || "",
            year: detail.release_date || detail.first_air_date,
            type: directKind,
          },
        );
        if (!title || score >= 35) {
          return normalizeTmdbData(detail, directKind);
        }
      }
    } catch {
      // Fall through to search if direct ID doesn't resolve on TMDB
    }
  }

  if (!title) return emptyEnrichment("tmdb");
  const normKind = normalizeMediaKind(mediaType);
  const searchEndpoint = normKind === "tv" ? "tv" : normKind === "movie" ? "movie" : "multi";
  const searchParams = { ...params, query: title };
  const parsedYear = extractYearFromDate(year);
  if (parsedYear && searchEndpoint === "movie") searchParams.year = parsedYear;
  if (parsedYear && searchEndpoint === "tv") searchParams.first_air_date_year = parsedYear;

  const searchData = await httpGet(`https://api.themoviedb.org/3/search/${searchEndpoint}`, {
    headers,
    params: searchParams,
  });

  const candidates = (searchData?.results || []).filter((item) => {
    const k = item?.media_type || searchEndpoint;
    return k === "movie" || k === "tv";
  });

  let best = null;
  let bestScore = -Infinity;
  for (const cand of candidates) {
    const candKind = cand.media_type || searchEndpoint;
    const score = scoreMovieMatch(
      { title, year, mediaType },
      {
        title: cand.title || cand.name || "",
        year: cand.release_date || cand.first_air_date,
        type: candKind,
      },
    );
    if (score > bestScore) {
      bestScore = score;
      best = { item: cand, kind: candKind };
    }
  }

  if (!best || bestScore < MIN_MATCH_SCORE) {
    return emptyEnrichment("tmdb");
  }

  const detail = await httpGet(
    `https://api.themoviedb.org/3/${best.kind}/${best.item.id}`,
    {
      headers,
      params: { ...params, append_to_response: "videos,credits,external_ids" },
    },
  );
  return normalizeTmdbData(detail, best.kind);
}

// ─── CINEMETA ADAPTER (KEYLESS MOVIES/SERIES) ────────────────────────────────

function normalizeCinemetaMeta(meta) {
  if (!meta) return emptyEnrichment("cinemeta");

  const trailers = [];
  const seenYt = new Set();
  const rawTrailers = [
    ...(Array.isArray(meta.trailers) ? meta.trailers : []),
    ...(Array.isArray(meta.trailerStreams) ? meta.trailerStreams : []),
  ];
  for (const t of rawTrailers) {
    const ytId = extractYoutubeId(t?.source || t?.ytId || t?.url);
    if (!ytId || seenYt.has(ytId)) continue;
    seenYt.add(ytId);
    const item = buildTrailerItem(
      ytId,
      t?.title || "Official Trailer",
      t?.type === "Teaser" ? "Teaser" : "Trailer",
    );
    if (item) trailers.push(item);
    if (trailers.length >= 4) break;
  }

  const rawDirectors = Array.isArray(meta.director)
    ? meta.director
    : typeof meta.director === "string"
      ? meta.director.split(",").map((d) => d.trim())
      : [];
  const directors = rawDirectors
    .filter(Boolean)
    .slice(0, 5)
    .map((name) => ({
      name,
      role: "Director",
      image: null,
      profileUrl: null,
    }));

  const rawCast = Array.isArray(meta.cast)
    ? meta.cast
    : typeof meta.cast === "string"
      ? meta.cast.split(",").map((c) => c.trim())
      : [];
  const cast = rawCast
    .filter(Boolean)
    .slice(0, 12)
    .map((name) => ({
      name,
      role: null,
      image: null,
      profileUrl: null,
    }));

  const parsedRating = meta.imdbRating ? parseFloat(meta.imdbRating) : NaN;
  const externalUrls = {};
  if (meta.imdb_id && /^tt\d+$/i.test(meta.imdb_id)) {
    const imdbUrl = sanitizeExternalUrl(`https://www.imdb.com/title/${meta.imdb_id}`);
    if (imdbUrl) externalUrls.imdb = imdbUrl;
  } else if (meta.id && /^tt\d+$/i.test(meta.id)) {
    const imdbUrl = sanitizeExternalUrl(`https://www.imdb.com/title/${meta.id}`);
    if (imdbUrl) externalUrls.imdb = imdbUrl;
  }

  const result = {
    found: true,
    cached: false,
    source: "cinemeta",
    rating:
      !Number.isNaN(parsedRating) && parsedRating > 0
        ? {
            score: Number(parsedRating.toFixed(1)),
            scale: 10,
            label: "IMDb",
            votes: null,
          }
        : null,
    runtime:
      typeof meta.runtime === "string" && meta.runtime.trim()
        ? meta.runtime.trim()
        : null,
    status: meta.status || null,
    releaseYear: extractYearFromDate(meta.releaseInfo || meta.year) || null,
    directors,
    studios: [],
    cast,
    trailers,
    externalUrls,
  };
  result.found = hasAnyEnrichmentContent(result);
  return result;
}

async function fetchCinemetaEnrichment({ id, title, year, mediaType }, deps = {}) {
  const httpGet = deps.httpGet || defaultHttpGet;

  const idStr = typeof id === "string" ? id.trim() : "";
  const normKind = normalizeMediaKind(mediaType) ||
    (idStr.startsWith("tv:") ? "tv" : idStr.startsWith("movie:") ? "movie" : null);

  if (/^tt\d{5,}$/i.test(idStr)) {
    const kinds = normKind === "tv" ? ["series"] : normKind === "movie" ? ["movie"] : ["movie", "series"];
    for (const cKind of kinds) {
      try {
        const res = await httpGet(`https://v3-cinemeta.strem.io/meta/${cKind}/${idStr}.json`);
        if (res?.meta) return normalizeCinemetaMeta(res.meta);
      } catch {
        // try next
      }
    }
  }

  if (!title) return emptyEnrichment("cinemeta");

  const searchKinds =
    normKind === "tv" ? ["series"] : normKind === "movie" ? ["movie"] : ["movie", "series"];

  const searchResults = await Promise.allSettled(
    searchKinds.map(async (cKind) => {
      const res = await httpGet(
        `https://v3-cinemeta.strem.io/catalog/${cKind}/top/search=${encodeURIComponent(title)}.json`,
      );
      return (res?.metas || []).map((m) => ({ ...m, _cKind: cKind }));
    }),
  );

  const candidates = [];
  for (const r of searchResults) {
    if (r.status === "fulfilled" && Array.isArray(r.value)) {
      candidates.push(...r.value);
    }
  }

  let best = null;
  let bestScore = -Infinity;
  for (const cand of candidates) {
    const score = scoreMovieMatch(
      { title, year, mediaType },
      {
        title: cand.name || "",
        year: cand.releaseInfo || cand.year,
        type: cand._cKind === "series" ? "tv" : "movie",
      },
    );
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  if (!best || bestScore < MIN_MATCH_SCORE || !best.id) {
    return emptyEnrichment("cinemeta");
  }

  const metaRes = await httpGet(
    `https://v3-cinemeta.strem.io/meta/${best._cKind}/${encodeURIComponent(best.id)}.json`,
  );
  return normalizeCinemetaMeta(metaRes?.meta);
}

// ─── ORCHESTRATOR + SQLITE CACHE ──────────────────────────────────────────────

async function resolveUpstreamEnrichment(params, apiKey, deps) {
  if (params.type === "Anime") {
    try {
      const anilist = await fetchAniListEnrichment(params, deps);
      if (anilist.found) return anilist;
    } catch (err) {
      logger.warn(`[enrichment] AniList lookup failed for "${params.title}": ${err.message}`);
    }

    try {
      const jikan = await fetchJikanEnrichment(params, deps);
      if (jikan.found) return jikan;
    } catch (err) {
      logger.warn(`[enrichment] Jikan fallback failed for "${params.title}": ${err.message}`);
    }
    return emptyEnrichment("none");
  }

  if (apiKey) {
    try {
      const tmdb = await fetchTmdbEnrichment({ ...params, apiKey }, deps);
      if (tmdb.found) return tmdb;
    } catch (err) {
      logger.warn(`[enrichment] TMDB lookup failed for "${params.title}": ${err.message}`);
    }
  }

  try {
    const cinemeta = await fetchCinemetaEnrichment(params, deps);
    if (cinemeta.found) return cinemeta;
  } catch (err) {
    logger.warn(`[enrichment] Cinemeta lookup failed for "${params.title}": ${err.message}`);
  }

  return emptyEnrichment("none");
}

async function getMediaEnrichment(rawParams = {}, deps = {}) {
  const type = rawParams.type === "Movies" ? "Movies" : rawParams.type === "Anime" ? "Anime" : null;
  const title = typeof rawParams.title === "string" ? rawParams.title.trim() : "";
  if (!type || !title) {
    return emptyEnrichment("none");
  }

  const params = {
    type,
    title: title.slice(0, 200),
    id: typeof rawParams.id === "string" ? rawParams.id.trim().slice(0, 512) : "",
    malId: parsePositiveInt(rawParams.malId),
    year: extractYearFromDate(rawParams.year),
    mediaType: normalizeMediaKind(rawParams.mediaType),
    forceRefresh: rawParams.forceRefresh === true || rawParams.forceRefresh === "1" || rawParams.forceRefresh === "true",
  };

  const dbQueryOne = deps.queryOne || queryOne;
  const dbRun = deps.run || run;
  const getSettingFn = deps.getSetting || ((k) => getKeyValue("Settings", k));
  const nowFn = deps.now || (() => Date.now());

  let tmdbApiKey = null;
  if (params.type === "Movies") {
    try {
      const storedKey = await getSettingFn("tmdbApiKey");
      if (typeof storedKey === "string" && storedKey.trim()) {
        tmdbApiKey = storedKey.trim();
      }
    } catch {
      tmdbApiKey = null;
    }
  }

  const cacheKey = buildCacheKey({
    ...params,
    hasTmdbKey: Boolean(tmdbApiKey),
  });

  let stalePayload = null;
  const now = nowFn();

  try {
    const cachedRow = await dbQueryOne(
      "SELECT payload_json, expires_at FROM MediaEnrichmentCache WHERE cache_key = ? LIMIT 1",
      [cacheKey],
    );
    if (cachedRow?.payload_json) {
      const parsed = JSON.parse(cachedRow.payload_json);
      if (cachedRow.expires_at > now && !params.forceRefresh) {
        return { ...parsed, cached: true };
      }
      if (parsed?.found) {
        stalePayload = parsed;
      }
    }
  } catch {
    // Ignore corrupt cache row and re-fetch
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const fresh = await resolveUpstreamEnrichment(params, tmdbApiKey, deps);
      const fetchedAt = nowFn();

      if (!fresh.found && stalePayload) {
        return { ...stalePayload, cached: true, stale: true };
      }

      const ttl = fresh.found ? HIT_TTL_MS : MISS_TTL_MS;
      try {
        await dbRun(
          `INSERT INTO MediaEnrichmentCache (cache_key, media_type, source, payload_json, fetched_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(cache_key) DO UPDATE SET
             media_type = excluded.media_type,
             source = excluded.source,
             payload_json = excluded.payload_json,
             fetched_at = excluded.fetched_at,
             expires_at = excluded.expires_at`,
          [
            cacheKey,
            params.type,
            fresh.source || "none",
            JSON.stringify(fresh),
            fetchedAt,
            fetchedAt + ttl,
          ],
        );
      } catch (cacheErr) {
        logger.warn(`[enrichment] Cache write failed: ${cacheErr.message}`);
      }

      return fresh;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, promise);
  return promise;
}

module.exports = {
  HIT_TTL_MS,
  MISS_TTL_MS,
  MIN_MATCH_SCORE,
  isValidYoutubeId,
  extractYoutubeId,
  sanitizeExternalUrl,
  sanitizeImageUrl,
  buildTrailerItem,
  buildCacheKey,
  maskApiKey,
  normalizeAniListMedia,
  normalizeJikanData,
  normalizeTmdbData,
  normalizeCinemetaMeta,
  fetchAniListEnrichment,
  fetchJikanEnrichment,
  fetchTmdbEnrichment,
  fetchCinemetaEnrichment,
  getMediaEnrichment,
};
