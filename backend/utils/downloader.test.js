const test = require("node:test");
const assert = require("node:assert");
const { downloader, mergeWebVttChunks } = require("./downloader");

test("mergeWebVttChunks merges segmented HLS VTT chunks and deduplicates boundary cues", () => {
  const chunk1 = `WEBVTT
X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000

00:00:01.000 --> 00:00:03.000 align:start
Hello world

00:00:03.500 --> 00:00:05.000
Boundary cue`;

  const chunk2 = `WEBVTT
X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000

00:00:03.500 --> 00:00:05.000
Boundary cue

00:00:06.000 --> 00:00:08.500
Final cue`;

  const merged = mergeWebVttChunks([chunk1, chunk2]);
  assert.ok(merged.startsWith("WEBVTT\n\n"));
  assert.strictEqual(merged.match(/WEBVTT/g).length, 1);
  assert.strictEqual(merged.match(/Boundary cue/g).length, 1);
  assert.ok(merged.includes("00:00:01.000 --> 00:00:03.000 align:start\nHello world"));
  assert.ok(merged.includes("00:00:06.000 --> 00:00:08.500\nFinal cue"));
});

test("downloader.convertToSRT preserves cues that include WebVTT positioning settings", () => {
  const dl = new downloader({
    directory: "/tmp",
    streamUrl: "https://example.com/playlist.m3u8",
    Epnum: 1,
  });

  const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.250 align:start position:10%
First subtitle

00:01:02.500 --> 00:01:05.000 line:85%
Second subtitle`;

  const srt = dl.convertToSRT(vtt);
  assert.ok(srt.includes("00:00:01,000 --> 00:00:03,250\nFirst subtitle"));
  assert.ok(srt.includes("00:01:02,500 --> 00:01:05,000\nSecond subtitle"));
});
