// Some HLS hosts inject ad-image segments (e.g. TikTok CDN creatives) into
// variant playlists — sometimes as the ENTIRE playlist, a decoy with no real
// video. MPV locks onto the image codec ("Video: png") and chokes, or the
// playlist is left empty after filtering. These patterns identify ad URIs so
// the proxy can drop them and the stream verifier can reject ad-only sources.
const AD_SEGMENT_PATTERNS = [
  /tiktokcdn/i,
  /ad-site/i,
  /doubleclick/i,
  /googleads/i,
  /imasdk/i,
  /\/ads?\//i,
  /vast/i,
  /preroll/i,
  /\.image(\?|$)/i,
];

const isAdSegmentUrl = (url) =>
  AD_SEGMENT_PATTERNS.some((re) => re.test(url));

// Count how many segment lines in a media playlist are real (non-ad) video.
// `base` is used to absolutize relative segment URIs.
const countPlayableSegments = (playlistBody, base = "") => {
  const lines = String(playlistBody)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let playable = 0;
  let total = 0;
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    const abs = line.startsWith("http") ? line : base + line;
    total++;
    if (!isAdSegmentUrl(abs)) playable++;
  }
  return { playable, total };
};

module.exports = { isAdSegmentUrl, countPlayableSegments };
