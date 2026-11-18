const test = require("node:test");
const assert = require("node:assert");
const castService = require("./castService");
const {
  rewriteHlsPlaylist,
  isPlaylistUrl,
  getMimeType,
  convertToVtt,
  convertToSrt,
  prepareSubtitlesForCast,
  getLanguageCode,
} = require("../routes/cast");

test("castService: getLocalIpAddress returns valid non-empty IPv4", () => {
  const ip = castService.getLocalIpAddress();
  assert.ok(typeof ip === "string");
  assert.match(ip, /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
});

test("castService: getStatus returns initial isCasting=false", () => {
  const status = castService.getStatus();
  assert.deepStrictEqual(status, { isCasting: false });
});

test("castService: discoverDevices returns an array", async () => {
  // Quick 1-second scan
  const devices = await castService.discoverDevices(1000);
  assert.ok(Array.isArray(devices));
});

test("castService: isPlaylistUrl correctly detects m3u8 playlists", () => {
  assert.strictEqual(isPlaylistUrl("http://example.com/master.m3u8"), true);
  assert.strictEqual(
    isPlaylistUrl("http://127.0.0.1:4000/reanime/123/video.m3u8?token=xyz"),
    true
  );
  assert.strictEqual(isPlaylistUrl("http://example.com/chunk.ts"), false);
  assert.strictEqual(
    isPlaylistUrl("https://cdn.top/audio/seg-1-f1-a0-a1.png"),
    false
  );
});

test("castService: rewriteHlsPlaylist rewrites child playlists to stream and keys/chunks to segment", () => {
  const masterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="jpn",NAME="Native",DEFAULT=YES,AUTOSELECT=YES,URI="http://127.0.0.1:4000/reanime/abc/audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5184,RESOLUTION=1920x1080,AUDIO="audio"
http://127.0.0.1:4000/reanime/abc/video.m3u8`;

  const rewritten = rewriteHlsPlaylist(
    masterManifest,
    "http://127.0.0.1:4000/reanime/abc/master.m3u8",
    { Referer: "https://flixcloud.cc/" },
    "192.168.1.55",
    9545
  );

  // Audio and video playlists must route through /api/cast/stream
  assert.match(
    rewritten,
    /URI="http:\/\/192\.168\.1\.55:9545\/api\/cast\/stream\?url=http%3A%2F%2F127\.0\.0\.1%3A4000%2Freanime%2Fabc%2Faudio\.m3u8/
  );
  assert.match(
    rewritten,
    /http:\/\/192\.168\.1\.55:9545\/api\/cast\/stream\?url=http%3A%2F%2F127\.0\.0\.1%3A4000%2Freanime%2Fabc%2Fvideo\.m3u8/
  );

  // Child playlist with encryption key and segments
  const childManifest = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="http://127.0.0.1:4000/reanime/abc/key.bin",IV=0x123456
#EXTINF:6.0,
https://cdn.example.com/chunk-1.webp`;

  const rewrittenChild = rewriteHlsPlaylist(
    childManifest,
    "http://127.0.0.1:4000/reanime/abc/video.m3u8",
    { Referer: "https://flixcloud.cc/" },
    "192.168.1.55",
    9545
  );

  // Key and video segment must route through /api/cast/segment with proxy headers
  assert.match(
    rewrittenChild,
    /URI="http:\/\/192\.168\.1\.55:9545\/api\/cast\/segment\?url=http%3A%2F%2F127\.0\.0\.1%3A4000%2Freanime%2Fabc%2Fkey\.bin/
  );
  assert.match(
    rewrittenChild,
    /http:\/\/192\.168\.1\.55:9545\/api\/cast\/segment\?url=https%3A%2F%2Fcdn\.example\.com%2Fchunk-1\.webp/
  );
});

test("castService: rewriteHlsPlaylist injects subtitles into master playlist", () => {
  const masterManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5184,RESOLUTION=1920x1080
http://127.0.0.1:4000/video.m3u8`;

  const subtitles = [
    { url: "https://example.com/subs_eng.srt", lang: "English", default: true },
    { url: "https://example.com/subs_spa.srt", lang: "Spanish", default: false },
  ];

  const rewritten = rewriteHlsPlaylist(
    masterManifest,
    "http://127.0.0.1:4000/master.m3u8",
    { Referer: "https://flixcloud.cc/" },
    "192.168.1.55",
    9545,
    subtitles
  );

  // Subtitle tags must be present with TYPE=SUBTITLES
  assert.match(rewritten, /#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES/);
  assert.match(rewritten, /#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Spanish",DEFAULT=NO/);
  assert.match(rewritten, /URI="http:\/\/192\.168\.1\.55:9545\/api\/cast\/subtitles\.m3u8\?url=https%3A%2F%2Fexample\.com%2Fsubs_eng\.srt/);
  // SUBTITLES="subs" must be appended to the stream-inf line
  assert.match(rewritten, /#EXT-X-STREAM-INF:BANDWIDTH=5184,RESOLUTION=1920x1080,SUBTITLES="subs"/);
});

test("castService: convertToVtt correctly converts SRT to WebVTT", () => {
  const srt = `1
00:00:04,523 --> 00:00:06,592
Hello world

2
00:00:06,593 --> 00:00:09,763
Second subtitle line`;

  const vtt = convertToVtt(srt);
  assert.ok(vtt.startsWith("WEBVTT\n\n"));
  assert.ok(vtt.includes("00:00:04.523 --> 00:00:06.592"));
  assert.ok(vtt.includes("00:00:06.593 --> 00:00:09.763"));
  assert.ok(vtt.includes("Hello world"));
});

test("castService: prepareSubtitlesForCast normalizes and selects preferred language as default", () => {
  const raw = [
    { url: "https://example.com/chi.srt", lang: "Chinese (Simplified)", default: false },
    { url: "https://example.com/eng.srt", lang: "English (Track 2 (ENG))", default: false },
    { url: "https://example.com/spa.srt", lang: "Spanish", default: false },
  ];

  const prepared = prepareSubtitlesForCast(raw, ["English"]);
  assert.strictEqual(prepared.length, 3);
  const eng = prepared.find((s) => s.lang.includes("English"));
  assert.ok(eng);
  assert.strictEqual(eng.default, true);

  const chi = prepared.find((s) => s.lang.includes("Chinese"));
  assert.ok(chi);
  assert.strictEqual(chi.default, false);
});
