// Run: node --test backend/utils/constants.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  getEpisodeNumberFromFilename,
  mediaServerFileBase,
  hasLocalMediaFiles,
  formatMovieFilename,
  formatEpisodeFilename,
  scoreMovieMatch,
  rankMovieCandidates,
} = require("./constants");

test("episode number from both naming schemes", () => {
  assert.strictEqual(getEpisodeNumberFromFilename("5Ep.mp4"), 5);
  assert.strictEqual(getEpisodeNumberFromFilename("Frieren - S01E05 [1080p].mp4"), 5);
  // Leading digits in the title must not win over SxxExx
  assert.strictEqual(getEpisodeNumberFromFilename("86 Eighty-Six - S02E11 [720p].mp4"), 11);
  assert.strictEqual(getEpisodeNumberFromFilename("Show - S01E12.5 [1080p].mp4"), 12.5);
  assert.strictEqual(getEpisodeNumberFromFilename("Show - S1EP05.mp4"), 5);
  assert.strictEqual(getEpisodeNumberFromFilename("One Piece - 1052.mp4"), 1052);
  assert.strictEqual(getEpisodeNumberFromFilename("Episode 04.mp4"), 4);
});

test("file name comes from the Show/Season NN folder", () => {
  const dir = path.join("dl", "Anime", "Kaguya-sama Love is War", "Season 03");
  assert.strictEqual(
    mediaServerFileBase(dir, "3", "1080p"),
    "Kaguya-sama Love is War - S03E03 [1080p]",
  );
  assert.strictEqual(
    mediaServerFileBase(dir, "12.5", "1080p"),
    "Kaguya-sama Love is War - S03E12.5 [1080p]",
  );
  assert.strictEqual(
    mediaServerFileBase(path.join("dl", "Show", "Season 00"), 1, null),
    "Show - S00E01",
  );
  assert.strictEqual(
    mediaServerFileBase(path.join("dl", "Show", "Season 01"), "0.5", null),
    "Show - S01E00.5",
  );
  // Not a season folder: show name is the folder, season 1
  assert.strictEqual(
    mediaServerFileBase(path.join("dl", "Overlord IV"), 120, "720p"),
    "Overlord IV - S01E120 [720p]",
  );
});

test("show folder holding only season folders is not empty", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sv-"));
  try {
    const season = path.join(root, "Show", "Season 02");
    fs.mkdirSync(season, { recursive: true });
    fs.writeFileSync(path.join(season, "Show - S02E01 [1080p].mp4"), "x");
    const show = path.join(root, "Show");
    assert.strictEqual(hasLocalMediaFiles(show, "Anime"), false); // direct only
    assert.strictEqual(hasLocalMediaFiles(show, "Anime", true), true);
    assert.strictEqual(hasLocalMediaFiles(season, "Anime"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("single movie naming conversion and formatting", () => {
  // Single movie formats to clean title with default and title_only
  assert.strictEqual(
    formatMovieFilename({ title: "Inception", isSingleMovie: true }),
    "Inception.mp4",
  );
  assert.strictEqual(
    formatMovieFilename({
      title: "Inception",
      isSingleMovie: true,
      namingScheme: "title_only",
    }),
    "Inception.mp4",
  );

  // Single movie with plex_jellyfin naming includes year and quality if provided
  assert.strictEqual(
    formatMovieFilename({
      title: "Inception",
      isSingleMovie: true,
      namingScheme: "plex_jellyfin",
      quality: "1080p",
      year: "2010",
    }),
    "Inception (2010) [1080p].mp4",
  );
  assert.strictEqual(
    formatMovieFilename({
      title: "Inception",
      isSingleMovie: true,
      namingScheme: "plex_jellyfin",
      quality: "1080p",
    }),
    "Inception [1080p].mp4",
  );

  // Series under Movies & Series formats with season and episode numbers
  assert.strictEqual(
    formatMovieFilename({
      title: "Breaking Bad",
      isSingleMovie: false,
      epNum: 1,
      season: 1,
      namingScheme: "default",
    }),
    "Breaking Bad - 01.mp4",
  );
  assert.strictEqual(
    formatMovieFilename({
      title: "Breaking Bad",
      isSingleMovie: false,
      epNum: 1,
      season: 1,
      namingScheme: "title_s01e01",
    }),
    "Breaking Bad - S01E01.mp4",
  );
  assert.strictEqual(
    formatMovieFilename({
      title: "Breaking Bad",
      isSingleMovie: false,
      epNum: 2,
      season: 1,
      namingScheme: "title_ep",
    }),
    "Breaking Bad - Episode 2.mp4",
  );

  // formatEpisodeFilename delegates appropriately for movies
  assert.strictEqual(
    formatEpisodeFilename({
      title: "Spirited Away",
      isSingleMovie: true,
      namingScheme: "default",
    }),
    "Spirited Away.mp4",
  );

  // mediaServerFileBase supports single movies
  assert.strictEqual(
    mediaServerFileBase(
      path.join("dl", "MoviesSeries", "Inception"),
      1,
      "1080p",
      true,
      "Inception",
      "2010",
    ),
    "Inception (2010) [1080p]",
  );
});

test("movie filenames do not false-positive as episode numbers", () => {
  assert.strictEqual(getEpisodeNumberFromFilename("Inception.mp4"), null);
  assert.strictEqual(getEpisodeNumberFromFilename("Inception (2010).mp4"), null);
  assert.strictEqual(
    getEpisodeNumberFromFilename("Inception (2010) [1080p].mp4"),
    null,
  );
  assert.strictEqual(getEpisodeNumberFromFilename("Inception [1080p].mp4"), null);
  assert.strictEqual(getEpisodeNumberFromFilename("Fight Club (1999).mkv"), null);
});

test("movie match scoring and confidence ranking", () => {
  const highScore = scoreMovieMatch(
    { title: "Inception", year: "2010-07-16", mediaType: "Movie" },
    { title: "Inception", year: "2010", type: "Movie" },
  );
  assert.strictEqual(highScore, 100);

  // Clear winner -> high confidence
  const clear = rankMovieCandidates(
    { title: "Inception", year: "2010", mediaType: "Movie" },
    [
      { id: "m1", title: "Inception", year: "2010", type: "Movie" },
      { id: "m2", title: "Inception: The Cobol Job", year: "2010", type: "Movie" },
    ],
  );
  assert.strictEqual(clear.confidence, "high");
  assert.strictEqual(clear.match?.id, "m1");

  // Ambiguous remakes with same title & no year -> low confidence
  const remake = rankMovieCandidates(
    { title: "Dune", mediaType: "Movie" },
    [
      { id: "d1", title: "Dune", year: "1984", type: "Movie" },
      { id: "d2", title: "Dune", year: "2021", type: "Movie" },
    ],
  );
  assert.strictEqual(remake.confidence, "low");
  assert.strictEqual(remake.match, null);
  assert.strictEqual(remake.candidates.length, 2);

  // Movie vs TV disambiguation
  const kindSplit = rankMovieCandidates(
    { title: "Fargo", year: "1996", mediaType: "Movie" },
    [
      { id: "f-tv", title: "Fargo", year: "2014", type: "TV" },
      { id: "f-mv", title: "Fargo", year: "1996", type: "Movie" },
    ],
  );
  assert.strictEqual(kindSplit.confidence, "high");
  assert.strictEqual(kindSplit.match?.id, "f-mv");

  // Manual query always forces picker ("low")
  const manual = rankMovieCandidates(
    { title: "Inception", year: "2010", mediaType: "Movie" },
    [{ id: "m1", title: "Inception", year: "2010", type: "Movie" }],
    true,
  );
  assert.strictEqual(manual.confidence, "low");
  assert.strictEqual(manual.match, null);

  // Empty results -> none
  const empty = rankMovieCandidates({ title: "Nonexistent" }, []);
  assert.strictEqual(empty.confidence, "none");
  assert.strictEqual(empty.candidates.length, 0);
});
