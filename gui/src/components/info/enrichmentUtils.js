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

export function isValidYoutubeId(id) {
  return typeof id === "string" && YOUTUBE_ID_RE.test(id.trim());
}

export function sanitizeExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:") return null;
    if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getInitials(name) {
  if (!name || typeof name !== "string") return "?";
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
