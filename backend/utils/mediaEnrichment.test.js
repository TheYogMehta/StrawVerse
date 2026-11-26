const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HIT_TTL_MS,
  isValidYoutubeId,
  extractYoutubeId,
  sanitizeExternalUrl,
  sanitizeImageUrl,
  buildCacheKey,
  maskApiKey,
  normalizeAniListMedia,
  normalizeJikanData,
  normalizeTmdbData,
  normalizeCinemetaMeta,
  fetchTmdbEnrichment,
  fetchCinemetaEnrichment,
  getMediaEnrichment,
} = require("./mediaEnrichment");

function createMemoryDb() {
  const store = new Map();
  return {
    store,
    queryOne: async (sql, params = []) => {
      if (sql.includes("FROM MediaEnrichmentCache")) {
        return store.get(params[0]) || null;
      }
      return null;
    },
    run: async (sql, params = []) => {
      if (sql.includes("INSERT INTO MediaEnrichmentCache")) {
        const [cache_key, media_type, source, payload_json, fetched_at, expires_at] = params;
        store.set(cache_key, {
          cache_key,
          media_type,
          source,
          payload_json,
          fetched_at,
          expires_at,
        });
      }
    },
  };
}

test("YouTube ID extraction & validation blocks unsafe inputs", () => {
  assert.equal(isValidYoutubeId("dQw4w9WgXcQ"), true);
  assert.equal(isValidYoutubeId("short"), false);
  assert.equal(isValidYoutubeId("dQw4w9WgXcQ<script>"), false);

  assert.equal(
    extractYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"),
    "dQw4w9WgXcQ",
  );
  assert.equal(extractYoutubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(
    extractYoutubeId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(extractYoutubeId("javascript:alert(1)"), null);
});

test("URL sanitizers enforce https and host allowlists", () => {
  assert.equal(
    sanitizeExternalUrl("https://www.imdb.com/title/tt0137523/"),
    "https://www.imdb.com/title/tt0137523/",
  );
  assert.equal(sanitizeExternalUrl("http://www.imdb.com/title/tt0137523/"), null);
  assert.equal(sanitizeExternalUrl("https://evil.example.com/phish"), null);
  assert.equal(sanitizeExternalUrl("javascript:alert(1)"), null);

  assert.equal(
    sanitizeImageUrl("https://image.tmdb.org/t/p/w185/abc.jpg"),
    "https://image.tmdb.org/t/p/w185/abc.jpg",
  );
  assert.equal(sanitizeImageUrl("https://untrusted.cdn.net/pic.jpg"), null);
});

test("maskApiKey masks prefix and preserves last 4 characters", () => {
  assert.equal(maskApiKey("1234567890abcdef"), "••••••••cdef");
  assert.equal(maskApiKey(""), null);
});

test("normalizeAniListMedia maps trailer, directors, studios, and JP/EN VAs", () => {
  const normalized = normalizeAniListMedia({
    id: 21,
    idMal: 21,
    siteUrl: "https://anilist.co/anime/21",
    averageScore: 87,
    duration: 24,
    status: "RELEASING",
    seasonYear: 1999,
    trailer: { id: "dQw4w9WgXcQ", site: "youtube" },
    studios: { nodes: [{ name: "Toei Animation" }] },
    staff: {
      edges: [
        {
          role: "Director",
          node: {
            name: { full: "Kounosuke Uda" },
            image: { large: "https://s4.anilist.co/file/anilistcdn/staff/1.jpg" },
            siteUrl: "https://anilist.co/staff/1",
          },
        },
        {
          role: "Original Creator",
          node: { name: { full: "Eiichiro Oda" } },
        },
      ],
    },
    characters: {
      edges: [
        {
          role: "MAIN",
          node: {
            name: { full: "Monkey D. Luffy" },
            image: { large: "https://s4.anilist.co/file/anilistcdn/char/40.jpg" },
            siteUrl: "https://anilist.co/character/40",
          },
          voiceActors: [
            {
              name: { full: "Mayumi Tanaka" },
              languageV2: "Japanese",
              image: { large: "https://s4.anilist.co/file/anilistcdn/va/1.jpg" },
              siteUrl: "https://anilist.co/staff/95001",
            },
            {
              name: { full: "Colleen Clinkenbeard" },
              languageV2: "English",
              image: { large: "https://s4.anilist.co/file/anilistcdn/va/2.jpg" },
              siteUrl: "https://anilist.co/staff/95002",
            },
          ],
        },
      ],
    },
  });

  assert.equal(normalized.found, true);
  assert.equal(normalized.source, "anilist");
  assert.equal(normalized.rating.score, 8.7);
  assert.equal(normalized.runtime, "24 min/ep");
  assert.equal(normalized.status, "Airing");
  assert.deepEqual(normalized.studios, ["Toei Animation"]);
  assert.equal(normalized.directors.length, 1);
  assert.equal(normalized.directors[0].name, "Kounosuke Uda");
  assert.equal(normalized.trailers[0].youtubeId, "dQw4w9WgXcQ");
  assert.equal(normalized.cast.length, 1);
  assert.equal(normalized.cast[0].voiceActors.length, 2);
  assert.equal(normalized.externalUrls.mal, "https://myanimelist.net/anime/21");
});

test("normalizeJikanData normalizes Jikan fallback payloads", () => {
  const res = normalizeJikanData(
    {
      url: "https://myanimelist.net/anime/1",
      score: 8.75,
      scored_by: 1000000,
      duration: "24 min per ep",
      status: "Finished Airing",
      year: 1998,
      trailer: { youtube_id: "qig4KOK2R2g" },
      studios: [{ name: "Sunrise" }],
    },
    [
      {
        role: "Main",
        character: {
          name: "Spike Spiegel",
          images: { jpg: { image_url: "https://cdn.myanimelist.net/images/c1.jpg" } },
          url: "https://myanimelist.net/character/1",
        },
        voice_actors: [
          {
            language: "Japanese",
            person: {
              name: "Koichi Yamadera",
              images: { jpg: { image_url: "https://cdn.myanimelist.net/images/p1.jpg" } },
              url: "https://myanimelist.net/people/11",
            },
          },
        ],
      },
    ],
    [
      {
        positions: ["Director"],
        person: { name: "Shinichiro Watanabe", url: "https://myanimelist.net/people/2009" },
      },
    ],
  );

  assert.equal(res.found, true);
  assert.equal(res.source, "jikan");
  assert.equal(res.rating.score, 8.8);
  assert.equal(res.runtime, "24 min/ep");
  assert.equal(res.trailers[0].youtubeId, "qig4KOK2R2g");
  assert.equal(res.directors[0].name, "Shinichiro Watanabe");
  assert.equal(res.cast[0].name, "Koichi Yamadera");
});

test("normalizeTmdbData prioritizes official trailers and maps crew/cast", () => {
  const res = normalizeTmdbData(
    {
      id: 550,
      title: "Fight Club",
      release_date: "1999-10-15",
      runtime: 139,
      status: "Released",
      vote_average: 8.43,
      vote_count: 29000,
      production_companies: [{ name: "20th Century Fox" }],
      external_ids: { imdb_id: "tt0137523" },
      videos: {
        results: [
          { site: "YouTube", type: "Clip", key: "aaaaaaaaaaa", name: "Clip 1", official: false },
          { site: "YouTube", type: "Trailer", key: "qtRKdVHc-cE", name: "Official Trailer", official: true },
          { site: "YouTube", type: "Teaser", key: "bbbbbbbbbbb", name: "Teaser", official: true },
        ],
      },
      credits: {
        crew: [
          { id: 7467, name: "David Fincher", job: "Director", profile_path: "/fincher.jpg" },
        ],
        cast: [
          { id: 287, name: "Brad Pitt", character: "Tyler Durden", order: 1, profile_path: "/brad.jpg" },
          { id: 819, name: "Edward Norton", character: "Narrator", order: 0, profile_path: "/ed.jpg" },
        ],
      },
    },
    "movie",
  );

  assert.equal(res.found, true);
  assert.equal(res.source, "tmdb");
  assert.equal(res.trailers[0].youtubeId, "qtRKdVHc-cE");
  assert.equal(res.trailers[1].type, "Teaser");
  assert.equal(res.cast[0].name, "Edward Norton");
  assert.equal(res.cast[0].image, "https://image.tmdb.org/t/p/w185/ed.jpg");
  assert.equal(res.directors[0].name, "David Fincher");
  assert.equal(res.externalUrls.imdb, "https://www.imdb.com/title/tt0137523");
  assert.equal(res.externalUrls.tmdb, "https://www.themoviedb.org/movie/550");
});

test("normalizeCinemetaMeta maps IMDb rating, trailers, directors, and cast", () => {
  const res = normalizeCinemetaMeta({
    id: "tt0137523",
    imdbRating: "8.8",
    runtime: "139 min",
    releaseInfo: "1999",
    director: ["David Fincher"],
    cast: ["Edward Norton", "Brad Pitt"],
    trailers: [{ source: "qtRKdVHc-cE", type: "Trailer" }],
  });

  assert.equal(res.found, true);
  assert.equal(res.source, "cinemeta");
  assert.equal(res.rating.score, 8.8);
  assert.equal(res.rating.label, "IMDb");
  assert.equal(res.trailers[0].youtubeId, "qtRKdVHc-cE");
  assert.equal(res.cast.length, 2);
});

test("fetchCinemetaEnrichment and fetchTmdbEnrichment reject low-confidence mismatches", async () => {
  const cinemetaMiss = await fetchCinemetaEnrichment(
    { title: "Inception", year: "2010", mediaType: "movie" },
    {
      httpGet: async () => ({
        metas: [{ id: "tt9999999", name: "Totally Unrelated Documentary", releaseInfo: "1992" }],
      }),
    },
  );
  assert.equal(cinemetaMiss.found, false);

  const tmdbMiss = await fetchTmdbEnrichment(
    { title: "Inception", year: "2010", mediaType: "movie", apiKey: "test-key-1234567890" },
    {
      httpGet: async () => ({
        results: [{ id: 99, media_type: "movie", title: "Random Film", release_date: "1980-01-01" }],
      }),
    },
  );
  assert.equal(tmdbMiss.found, false);
});

test("getMediaEnrichment caches hits, upgrades tier on TMDB key, and falls back to stale cache", async () => {
  const db = createMemoryDb();
  let nowMs = 1_700_000_000_000;
  let upstreamCalls = 0;

  const cinemetaMockGet = async (url) => {
    upstreamCalls++;
    if (url.includes("/catalog/")) {
      return { metas: [{ id: "tt1375666", name: "Inception", releaseInfo: "2010" }] };
    }
    return {
      meta: {
        id: "tt1375666",
        imdbRating: "8.8",
        runtime: "148 min",
        director: ["Christopher Nolan"],
        cast: ["Leonardo DiCaprio"],
        trailers: [{ source: "YoHD9XEInc0", type: "Trailer" }],
      },
    };
  };

  let activeTmdbKey = null;
  const baseDeps = {
    ...db,
    getSetting: async () => activeTmdbKey,
    now: () => nowMs,
    httpGet: cinemetaMockGet,
  };

  // 1st call: fetches Cinemeta and caches
  const first = await getMediaEnrichment(
    { type: "Movies", title: "Inception", year: "2010", mediaType: "movie" },
    baseDeps,
  );
  assert.equal(first.found, true);
  assert.equal(first.source, "cinemeta");
  assert.equal(first.cached, false);
  const callsAfterFirst = upstreamCalls;

  // 2nd call: served from cache
  const second = await getMediaEnrichment(
    { type: "Movies", title: "Inception", year: "2010", mediaType: "movie" },
    baseDeps,
  );
  assert.equal(second.cached, true);
  assert.equal(upstreamCalls, callsAfterFirst);

  // Adding a TMDB key switches cache tier key and fetches TMDB
  activeTmdbKey = "tmdb-v3-key-1234567890";
  const tmdbRes = await getMediaEnrichment(
    { type: "Movies", title: "Inception", year: "2010", mediaType: "movie" },
    {
      ...baseDeps,
      httpGet: async (url) => {
        if (url.includes("/search/movie")) {
          return { results: [{ id: 27205, title: "Inception", release_date: "2010-07-16" }] };
        }
        return {
          id: 27205,
          title: "Inception",
          release_date: "2010-07-16",
          runtime: 148,
          vote_average: 8.4,
          vote_count: 35000,
          videos: { results: [{ site: "YouTube", type: "Trailer", key: "YoHD9XEInc0", official: true }] },
          credits: {
            crew: [{ id: 525, name: "Christopher Nolan", job: "Director" }],
            cast: [{ id: 6193, name: "Leonardo DiCaprio", character: "Cobb", order: 0 }],
          },
        };
      },
    },
  );
  assert.equal(tmdbRes.found, true);
  assert.equal(tmdbRes.source, "tmdb");
  assert.notEqual(
    buildCacheKey({ type: "Movies", title: "Inception", year: "2010", mediaType: "movie", hasTmdbKey: false }),
    buildCacheKey({ type: "Movies", title: "Inception", year: "2010", mediaType: "movie", hasTmdbKey: true }),
  );

  // Expired cache + failing upstream returns stale cache gracefully
  activeTmdbKey = null;
  nowMs += HIT_TTL_MS + 1000;
  const staleFallback = await getMediaEnrichment(
    { type: "Movies", title: "Inception", year: "2010", mediaType: "movie" },
    {
      ...baseDeps,
      httpGet: async () => {
        throw new Error("Network down");
      },
    },
  );
  assert.equal(staleFallback.found, true);
  assert.equal(staleFallback.cached, true);
  assert.equal(staleFallback.stale, true);
});
