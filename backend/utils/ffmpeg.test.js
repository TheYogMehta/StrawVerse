const test = require("node:test");
const assert = require("node:assert");
const EventEmitter = require("node:events");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ffmpeg = require("./ffmpeg");

function makeFakeSpawn(handler) {
  const calls = [];
  const spawnStub = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (sig = "SIGTERM") => {
      child.killed = true;
      child.signalCode = sig;
      setImmediate(() => {
        child.emit("exit", null, sig);
        child.emit("close", null, sig);
      });
    };

    setImmediate(() => {
      handler({ bin, args, opts, child, callIndex: calls.length - 1 });
    });

    return child;
  };
  spawnStub.calls = calls;
  return spawnStub;
}

test("ffmpeg/runner: redactSensitiveArgs masks -headers payload and URL query tokens", () => {
  const args = [
    "-y",
    "-headers",
    "Cookie: session=secret\r\nReferer: https://example.com\r\n",
    "-i",
    "https://cdn.example.com/master.m3u8?token=abc123",
    "-c:v",
    "copy",
  ];
  const redacted = ffmpeg.redactSensitiveArgs(args);
  assert.strictEqual(redacted[2], "[REDACTED]");
  assert.strictEqual(
    redacted[4],
    "https://cdn.example.com/master.m3u8?[REDACTED]",
  );
  assert.strictEqual(redacted[6], "copy");
});

test("ffmpeg/runner: createProgressParser computes throttled percentage and handles end", () => {
  const events = [];
  const feed = ffmpeg.createProgressParser(100, (p) => events.push(p));

  feed("out_time_us=50000000\nspeed=2.0x\nbitrate=1200kbits/s\nprogress=continue\n");
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].percent, 50);
  assert.strictEqual(events[0].outTimeSec, 50);
  assert.strictEqual(events[0].speed, "2.0x");
  assert.strictEqual(events[0].bitrate, "1200kbits/s");

  feed("out_time_us=100000000\nprogress=end\n");
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[1].percent, 100);
  assert.strictEqual(events[1].end, true);
});

test("ffmpeg/runner: runFfmpeg handles AbortSignal and caps stderr tail at 64KB", async () => {
  const controller = new AbortController();
  const spawnStub = makeFakeSpawn(({ child }) => {
    child.stderr.emit("data", Buffer.from("x".repeat(80 * 1024)));
    controller.abort();
  });

  await assert.rejects(
    () =>
      ffmpeg.runFfmpeg(["-i", "in.ts", "out.mp4"], {
        binaryPath: "/usr/bin/ffmpeg",
        signal: controller.signal,
        spawnImpl: spawnStub,
      }),
    (err) => {
      assert.strictEqual(err.code, "ABORTED");
      assert.ok(Buffer.byteLength(err.stderrTail, "utf8") <= 64 * 1024);
      return true;
    },
  );
  assert.strictEqual(ffmpeg.getActiveProcessCount(), 0);
});

test("ffmpeg/runner: runFfmpeg enforces timeoutMs", async () => {
  const spawnStub = makeFakeSpawn(() => {
    // Intentionally never exits until killed
  });

  await assert.rejects(
    () =>
      ffmpeg.runFfmpeg(["-version"], {
        binaryPath: "/usr/bin/ffmpeg",
        timeoutMs: 40,
        spawnImpl: spawnStub,
      }),
    (err) => {
      assert.strictEqual(err.code, "TIMEOUT");
      return true;
    },
  );
});

test("ffmpeg/binary: validateFfmpegBinary rejects relative and invalid paths, accepts valid executable", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-ffbin-"));
  const fakeBin = path.join(tmpDir, "ffmpeg");
  fs.writeFileSync(fakeBin, "#!/bin/sh\n", { mode: 0o755 });

  try {
    const rel = await ffmpeg.validateFfmpegBinary("relative/ffmpeg");
    assert.strictEqual(rel.valid, false);

    const missing = await ffmpeg.validateFfmpegBinary(path.join(tmpDir, "nope"));
    assert.strictEqual(missing.valid, false);

    const dirCheck = await ffmpeg.validateFfmpegBinary(tmpDir);
    assert.strictEqual(dirCheck.valid, false);

    const spawnStub = makeFakeSpawn(({ child }) => {
      child.stderr.emit("data", Buffer.from("ffmpeg version 7.1.1 Copyright\n"));
      child.exitCode = 0;
      child.emit("close", 0, null);
    });

    const ok = await ffmpeg.validateFfmpegBinary(fakeBin, {
      spawnImpl: spawnStub,
      platform: "darwin",
    });
    assert.strictEqual(ok.valid, true);
    assert.strictEqual(ok.version, "7.1.1");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ffmpeg/binary: resolveFfmpegBinary prioritizes custom Desktop path and ignores it on Android", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-ffres-"));
  const customBin = path.join(tmpDir, "custom-ffmpeg");
  const androidBin = path.join(tmpDir, "libffmpeg.so");
  fs.writeFileSync(customBin, "bin", { mode: 0o755 });
  fs.writeFileSync(androidBin, "so", { mode: 0o755 });

  const prevNativeDir = process.env.NATIVE_LIB_DIR;
  try {
    ffmpeg.invalidateBinaryCache();
    const spawnStub = makeFakeSpawn(({ child }) => {
      child.stderr.emit("data", Buffer.from("ffmpeg version 7.0.2\n"));
      child.exitCode = 0;
      child.emit("close", 0, null);
    });

    const desktopRes = await ffmpeg.resolveFfmpegBinary({
      forceRefresh: true,
      android: false,
      platform: "darwin",
      settingsLoader: async () => ({ ffmpegCustomPath: customBin }),
      spawnImpl: spawnStub,
    });
    assert.strictEqual(desktopRes.source, "custom");
    assert.strictEqual(desktopRes.path, customBin);
    assert.strictEqual(desktopRes.version, "7.0.2");

    process.env.NATIVE_LIB_DIR = tmpDir;
    ffmpeg.invalidateBinaryCache();
    const androidRes = await ffmpeg.resolveFfmpegBinary({
      forceRefresh: true,
      android: true,
      settingsLoader: async () => ({ ffmpegCustomPath: customBin }),
      spawnImpl: spawnStub,
    });
    assert.strictEqual(androidRes.source, "android-jni");
    assert.strictEqual(androidRes.path, androidBin);
  } finally {
    if (prevNativeDir === undefined) delete process.env.NATIVE_LIB_DIR;
    else process.env.NATIVE_LIB_DIR = prevNativeDir;
    ffmpeg.invalidateBinaryCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ffmpeg/binary: platform encoder candidate order and resolveActiveEncoder behavior", () => {
  assert.deepStrictEqual(
    ffmpeg.getCandidateEncodersForPlatform({ platform: "darwin", android: false }),
    ["videotoolbox"],
  );
  assert.deepStrictEqual(
    ffmpeg.getCandidateEncodersForPlatform({ platform: "win32", android: false }),
    ["nvenc", "qsv", "amf"],
  );
  assert.deepStrictEqual(
    ffmpeg.getCandidateEncodersForPlatform({ platform: "linux", android: false }),
    ["nvenc", "vaapi", "qsv"],
  );
  assert.deepStrictEqual(
    ffmpeg.getCandidateEncodersForPlatform({ platform: "linux", android: true }),
    [],
  );

  assert.strictEqual(ffmpeg.resolveActiveEncoder("auto", ["videotoolbox", "software"]), "videotoolbox");
  assert.strictEqual(ffmpeg.resolveActiveEncoder("software", ["videotoolbox", "software"]), "software");
  assert.strictEqual(ffmpeg.resolveActiveEncoder("qsv", ["nvenc", "qsv", "software"]), "qsv");
  assert.strictEqual(ffmpeg.resolveActiveEncoder("nvenc", ["videotoolbox", "software"]), "software");
});

test("ffmpeg/probe: parseMediaProbeOutput & single-pass subtitle extraction with safe args", async () => {
  const sampleStderr = [
    "  Duration: 00:24:10.50, start: 0.000000, bitrate: 2500 kb/s",
    "  Stream #0:0(und): Video: h264 (High), yuv420p, 1920x1080",
    "  Stream #0:1(jpn): Audio: aac (LC), 48000 Hz, stereo",
    "  Stream #0:2(eng): Subtitle: ass (default)",
    "  Stream #0:3(eng): Subtitle: subrip",
    "  Stream #0:4(jpn): Subtitle: hdmv_pgs_subtitle",
  ].join("\n");

  const parsed = ffmpeg.parseMediaProbeOutput(sampleStderr);
  assert.strictEqual(parsed.durationSec, 24 * 60 + 10.5);
  assert.strictEqual(parsed.videoStreams.length, 1);
  assert.strictEqual(parsed.audioStreams.length, 1);
  assert.strictEqual(parsed.subtitleStreams.length, 3);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-probe-"));
  const videoPath = path.join(tmpDir, "[Fansub] Show's Episode, 01.mkv");
  const subsDir = path.join(tmpDir, "subs");
  fs.writeFileSync(videoPath, "fake");

  try {
    const spawnStub = makeFakeSpawn(({ args, child }) => {
      if (args.includes("-i") && args.length === 4) {
        child.stderr.emit("data", Buffer.from(sampleStderr));
        child.exitCode = 1; // ffmpeg -i without output exits 1
        child.emit("close", 1, null);
        return;
      }
      // Single-pass extraction creates both .vtt files
      for (const a of args) {
        if (typeof a === "string" && a.endsWith(".vtt")) {
          fs.writeFileSync(a, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n");
        }
      }
      child.exitCode = 0;
      child.emit("close", 0, null);
    });

    const extracted = await ffmpeg.extractSubtitlesSinglePass(videoPath, subsDir, 1, {
      binaryPath: "/usr/bin/ffmpeg",
      spawnImpl: spawnStub,
    });

    assert.strictEqual(spawnStub.calls.length, 2); // 1 probe + 1 batch extract
    assert.strictEqual(spawnStub.calls[1].opts.shell, false);
    assert.strictEqual(extracted.length, 2);
    assert.ok(extracted[0].url.includes("1Ep.eng.vtt"));
    assert.ok(extracted[1].url.includes("1Ep.eng.2.vtt"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ffmpeg/remux: buildRemuxArgs produces MP4 faststart vs MKV native subtitle args", () => {
  const mp4Args = ffmpeg.buildRemuxArgs({
    videoInput: "/tmp/1Ep.ts",
    subtitles: [{ path: "/tmp/subs/1Ep.eng.vtt", lang: "en", title: "English\nSub" }],
    outputPath: "/tmp/1Ep.mp4",
    container: "mp4",
  });
  assert.ok(mp4Args.includes("-movflags"));
  assert.ok(mp4Args.includes("+faststart"));
  assert.ok(mp4Args.includes("mov_text"));
  assert.ok(mp4Args.includes("title=English Sub"));

  const mkvArgs = ffmpeg.buildRemuxArgs({
    videoInput: "/tmp/1Ep.ts",
    subtitles: [{ path: "/tmp/subs/1Ep.eng.ass", lang: "en", title: "English" }],
    outputPath: "/tmp/1Ep.mkv",
    container: "mkv",
  });
  assert.ok(!mkvArgs.includes("-movflags"));
  const csIdx = mkvArgs.indexOf("-c:s");
  assert.strictEqual(mkvArgs[csIdx + 1], "copy");
});

test("ffmpeg/remux: remuxMedia retries audio repair on ADTS error and atomically promotes output", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-remux-"));
  const tsPath = path.join(tmpDir, "1Ep.ts");
  const outPath = path.join(tmpDir, "1Ep.mp4");
  fs.writeFileSync(tsPath, Buffer.alloc(1024));

  try {
    let attempt = 0;
    const spawnStub = makeFakeSpawn(({ args, child }) => {
      attempt++;
      const target = args[args.length - 1];
      if (attempt === 1) {
        child.stderr.emit("data", Buffer.from("Malformed AAC bitstream: aac_adtstoasc\n"));
        child.exitCode = 1;
        child.emit("close", 1, null);
        return;
      }
      fs.writeFileSync(target, Buffer.alloc(2048));
      child.stdout.emit("data", Buffer.from("out_time_us=1000000\nprogress=end\n"));
      child.exitCode = 0;
      child.emit("close", 0, null);
    });

    const progressUpdates = [];
    const res = await ffmpeg.remuxMedia({
      videoInput: tsPath,
      subtitles: [{ path: path.join(tmpDir, "1Ep.en.vtt"), lang: "en" }],
      outputPath: outPath,
      container: "mp4",
      durationSec: 10,
      binaryPath: "/usr/bin/ffmpeg",
      concurrencyLimit: 1,
      spawnImpl: spawnStub,
      onProgress: (p) => progressUpdates.push(p),
    });

    assert.strictEqual(attempt, 2);
    assert.strictEqual(res.strategy, "audio repair + subtitles");
    assert.strictEqual(fs.existsSync(outPath), true);
    assert.strictEqual(fs.existsSync(`${outPath}.remux.mp4`), false);
    assert.ok(progressUpdates.some((p) => p.percent === 100));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ffmpeg/remux: remuxMedia rejects suspiciously tiny MP4 compared to large TS input", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-remux-tiny-"));
  const tsPath = path.join(tmpDir, "1Ep.ts");
  const outPath = path.join(tmpDir, "1Ep.mp4");
  fs.writeFileSync(tsPath, Buffer.alloc(2.5 * 1024 * 1024));

  try {
    const spawnStub = makeFakeSpawn(({ args, child }) => {
      const target = args[args.length - 1];
      fs.writeFileSync(target, Buffer.alloc(512));
      child.exitCode = 0;
      child.emit("close", 0, null);
    });

    await assert.rejects(
      () =>
        ffmpeg.remuxMedia({
          videoInput: tsPath,
          outputPath: outPath,
          container: "mp4",
          durationSec: 10,
          binaryPath: "/usr/bin/ffmpeg",
          concurrencyLimit: 1,
          spawnImpl: spawnStub,
        }),
      (err) => {
        assert.strictEqual(err.code, "INVALID_OUTPUT");
        return true;
      },
    );
    assert.strictEqual(fs.existsSync(outPath), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ffmpeg/cast: escapeSubtitleFilterPath and buildCastBurnArgs handle special characters & VAAPI", () => {
  const escaped = ffmpeg.escapeSubtitleFilterPath(
    "C:\\Anime\\[SubsPlease] Show, Ep:1 'test';sub.srt",
  );
  assert.strictEqual(
    escaped,
    "C\\:/Anime/\\[SubsPlease\\] Show\\, Ep\\:1 \\'test\\'\\;sub.srt",
  );

  const vaapiArgs = ffmpeg.buildCastBurnArgs({
    inputSource: "/tmp/video.mp4",
    subFilePath: "/tmp/[Sub] a,b.srt",
    hlsDir: "/tmp/hls",
    encoderId: "vaapi",
    position: 42,
  });
  assert.ok(vaapiArgs.includes("-vaapi_device"));
  assert.ok(vaapiArgs.includes("h264_vaapi"));
  const vfVal = vaapiArgs[vaapiArgs.indexOf("-vf") + 1];
  assert.ok(vfVal.includes("format=nv12,hwupload"));
  assert.ok(vfVal.includes("\\[Sub\\] a\\,b.srt"));
  assert.ok(vaapiArgs.includes("-ss"));
});

test("ffmpeg/cast: startCastBurn auto-falls back to libx264 when HW encoder crashes before first segment", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-cast-fb-"));
  const fakeBin = path.join(tmpDir, "ffmpeg");
  fs.writeFileSync(fakeBin, "bin", { mode: 0o755 });

  try {
    ffmpeg.invalidateBinaryCache();
    let burnAttempt = 0;
    const spawnStub = makeFakeSpawn(({ args, child }) => {
      // Encoder probe (-f null -)
      if (args.includes("null")) {
        child.exitCode = 0;
        child.emit("close", 0, null);
        return;
      }

      burnAttempt++;
      if (burnAttempt === 1) {
        // Simulated HW crash before seg_0000.ts
        child.stderr.emit("data", Buffer.from("Error initializing encoder\n"));
        child.exitCode = 1;
        child.emit("exit", 1, null);
        child.emit("close", 1, null);
        return;
      }

      // Software fallback writes index.m3u8 with seg_0000.ts
      fs.writeFileSync(
        path.join(tmpDir, "index.m3u8"),
        "#EXTM3U\n#EXTINF:2.0,\nseg_0000.ts\n",
      );
    });

    const detected = await ffmpeg.detectHardwareEncoders({
      binaryPath: fakeBin,
      forceRefresh: true,
      platform: "darwin",
      android: false,
      spawnImpl: spawnStub,
    });
    assert.deepStrictEqual(detected, ["videotoolbox", "software"]);

    const session = await ffmpeg.startCastBurn({
      filePath: "/tmp/video.mp4",
      subFilePath: "/tmp/sub.srt",
      hlsDir: tmpDir,
      preferredEncoder: "auto",
      binaryPath: fakeBin,
      spawnImpl: spawnStub,
      startupTimeoutMs: 2000,
    });

    assert.strictEqual(session.encoder, "software");
    assert.strictEqual(session.ready, true);
    assert.strictEqual(burnAttempt, 2);

    await session.stop();
  } finally {
    ffmpeg.invalidateBinaryCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ffmpeg/cast: sweepOrphanedCastDirs cleans up stale temp dirs and srt files", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sv-sweep-"));
  const castDir = path.join(tmpRoot, "strawverse_cast_12345");
  const subFile = path.join(tmpRoot, "strawverse_sub_12345.srt");
  const keepFile = path.join(tmpRoot, "unrelated.txt");

  fs.mkdirSync(castDir);
  fs.writeFileSync(path.join(castDir, "index.m3u8"), "x");
  fs.writeFileSync(subFile, "sub");
  fs.writeFileSync(keepFile, "keep");

  try {
    const removed = ffmpeg.sweepOrphanedCastDirs(tmpRoot, 0);
    assert.strictEqual(removed, 2);
    assert.strictEqual(fs.existsSync(castDir), false);
    assert.strictEqual(fs.existsSync(subFile), false);
    assert.strictEqual(fs.existsSync(keepFile), true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
