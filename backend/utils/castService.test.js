const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const castService = require("./castService");
const {
  rewriteHlsPlaylist,
  isPlaylistUrl,
  getMimeType,
  convertToVtt,
  convertToSrt,
  convertAssToSrt,
  convertAssToVtt,
  prepareSubtitlesForCast,
  getLanguageCode,
  resolveCdnHeaders,
  activeCastBurnSession,
  startBurnSession,
  cleanupBurnSession,
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

test("castService: prepareSubtitlesForCast deduplicates mirror CDNs and prioritizes CC over signs", () => {
  const rawWithMirrors = [
    { url: "https://vault-90.phantomcdn.top/sub_eng_3.ass", lang: "English (English Signs [CR])", default: false },
    { url: "https://vault-90.phantomcdn.top/sub_eng_4.srt", lang: "English (English Closed Captions [CR])", default: false },
    { url: "https://vault-90.phantomcdn.top/sub_fre_7.ass", lang: "French (CR)", default: false },
    // Duplicate CDN mirror tracks:
    { url: "https://vault-90.rundowncdn.top/sub_eng_3.ass", lang: "English (English Signs [CR])", default: false },
    { url: "https://vault-90.rundowncdn.top/sub_eng_4.srt", lang: "English (English Closed Captions [CR])", default: false },
    { url: "https://vault-90.rundowncdn.top/sub_fre_7.ass", lang: "French (CR)", default: false },
  ];

  const prepared = prepareSubtitlesForCast(rawWithMirrors, ["English"]);
  // Mirrors must be deduplicated
  assert.strictEqual(prepared.length, 3);
  // Full dialogue / CC subtitle must be picked as default over signs
  const cc = prepared.find((s) => s.lang.includes("Closed Captions"));
  assert.ok(cc);
  assert.strictEqual(cc.default, true);

  const signs = prepared.find((s) => s.lang.includes("Signs"));
  assert.ok(signs);
  assert.strictEqual(signs.default, false);
});

test("castService: convertAssToVtt and convertAssToSrt parse ASS dialogue events", () => {
  const assSample = `[Script Info]
Title: Sample ASS
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:01:23.45,0:01:26.78,Default,,0,0,0,,{\\i1}Hello{\\i0} from ASS!\\NSecond line
Dialogue: 0,0:01:30.10,0:01:32.20,Default,,0,0,0,,Next dialogue cue.`;

  const vtt = convertToVtt(assSample);
  assert.ok(vtt.startsWith("WEBVTT\n\n"));
  assert.ok(vtt.includes("00:01:23.450 --> 00:01:26.780"));
  assert.ok(vtt.includes("Hello from ASS!\nSecond line"));
  assert.ok(vtt.includes("00:01:30.100 --> 00:01:32.200"));
  assert.ok(vtt.includes("Next dialogue cue."));

  const srt = convertToSrt(assSample);
  assert.ok(srt.includes("00:01:23,450 --> 00:01:26,780"));
  assert.ok(srt.includes("Hello from ASS!\nSecond line"));
  assert.ok(srt.includes("00:01:30,100 --> 00:01:32,200"));
  assert.ok(srt.includes("Next dialogue cue."));
});

test("castService: resolveCdnHeaders infers correct Referer and Origin for known CDNs", () => {
  const rundownHeaders = resolveCdnHeaders(
    "https://vault-91.rundowncdn.top/_v7/1234/audio/seg-1-f1-a0-a1.png",
    {}
  );
  assert.strictEqual(rundownHeaders.Referer, "https://flixcloud.cc/");
  assert.strictEqual(rundownHeaders.Origin, "https://flixcloud.cc");
  assert.ok(rundownHeaders["User-Agent"]);

  const kwikHeaders = resolveCdnHeaders(
    "https://na-01.owocdn.top/hls2/01/00001/chunk.ts",
    {}
  );
  assert.strictEqual(kwikHeaders.Referer, "https://kwik.cx/");

  // Explicit headers should override
  const customHeaders = resolveCdnHeaders(
    "https://vault-91.rundowncdn.top/seg.png",
    { Referer: "https://megacloud.tv/" }
  );
  assert.strictEqual(customHeaders.Referer, "https://megacloud.tv/");
});

test("castService: rewriteHlsPlaylist filters out broken relative parent audio tracks", () => {
  const masterWithBrokenAudio = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="eng",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="../broken/audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5184,RESOLUTION=1920x1080
http://127.0.0.1:4000/reanime/abc/video.m3u8`;

  const rewritten = rewriteHlsPlaylist(
    masterWithBrokenAudio,
    "http://127.0.0.1:4000/reanime/abc/master.m3u8",
    { Referer: "https://flixcloud.cc/" },
    "192.168.1.55",
    9545
  );

  assert.ok(!rewritten.includes("broken/audio.m3u8"));
  assert.ok(rewritten.includes("video.m3u8"));
});

test("castService: cleanupBurnSession cleans up active process and directory", () => {
  const dummyDir = path.join(os.tmpdir(), `dummy_hls_${Date.now()}`);
  const dummySub = path.join(os.tmpdir(), `dummy_sub_${Date.now()}.srt`);
  fs.mkdirSync(dummyDir, { recursive: true });
  fs.writeFileSync(dummySub, "1\n00:00:00,000 --> 00:00:01,000\nTest\n");

  activeCastBurnSession.hlsDir = dummyDir;
  activeCastBurnSession.subFilePath = dummySub;
  activeCastBurnSession.sessionId = 99999;

  cleanupBurnSession();

  assert.strictEqual(activeCastBurnSession.hlsDir, null);
  assert.strictEqual(activeCastBurnSession.subFilePath, null);
  assert.strictEqual(activeCastBurnSession.sessionId, null);
  assert.strictEqual(fs.existsSync(dummyDir), false);
  assert.strictEqual(fs.existsSync(dummySub), false);
});

test("castService: discoverDevices handles UDP EHOSTUNREACH socket errors without uncaught exception", async () => {
  const EventEmitter = require("node:events");
  const dgram = require("node:dgram");
  const origCreateSocket = dgram.createSocket;
  const origNetworkInterfaces = os.networkInterfaces;

  os.networkInterfaces = () => ({
    en0: [{ family: "IPv4", internal: false, address: "192.168.1.50" }],
  });

  dgram.createSocket = () => {
    const emitter = new EventEmitter();
    emitter.bind = (_port, _ip, cb) => {
      if (cb) cb();
      setImmediate(() => {
        const err = new Error("recvmsg EHOSTUNREACH");
        err.code = "EHOSTUNREACH";
        emitter.emit("error", err);
      });
    };
    emitter.setBroadcast = () => {};
    emitter.setMulticastTTL = () => {};
    emitter.setMulticastInterface = () => {};
    emitter.send = (_buf, _off, _len, _port, _addr, cb) => {
      if (cb) cb(null);
    };
    emitter.close = () => {};
    return emitter;
  };

  try {
    const devices = await castService.discoverDevices(600);
    assert.ok(Array.isArray(devices));
  } finally {
    dgram.createSocket = origCreateSocket;
    os.networkInterfaces = origNetworkInterfaces;
  }
});
