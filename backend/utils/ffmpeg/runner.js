const { spawn } = require("child_process");
const path = require("path");
const { logger } = require("../AppLogger");

const MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_GRACE_MS = 1500;
const PROGRESS_THROTTLE_MS = 400;

const activeProcesses = new Set();

/**
 * Structured error returned by all FFmpeg engine operations.
 */
class FfmpegError extends Error {
  constructor(
    message,
    { code = "NON_ZERO_EXIT", exitCode = null, signal = null, stderrTail = "", cause = null } = {},
  ) {
    super(message);
    this.name = "FfmpegError";
    this.code = code;
    this.exitCode = exitCode;
    this.signal = signal;
    this.stderrTail = stderrTail;
    if (cause) this.cause = cause;
  }
}

/**
 * Redacts HTTP header values (cookies, auth tokens, referers) and sensitive URLs from FFmpeg args before logging.
 * @param {string[]} args
 * @returns {string[]}
 */
function redactSensitiveArgs(args) {
  if (!Array.isArray(args)) return [];
  const redacted = [];
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    if (arg === "-headers" && i + 1 < args.length) {
      redacted.push(arg, "[REDACTED]");
      i++;
      continue;
    }
    if (arg.startsWith("http://") || arg.startsWith("https://")) {
      try {
        const u = new URL(arg);
        if (u.search) {
          redacted.push(`${u.origin}${u.pathname}?[REDACTED]`);
          continue;
        }
      } catch (_) {}
    }
    redacted.push(arg);
  }
  return redacted;
}

/**
 * Builds child spawn environment ensuring Android/Linux native library dirs are discoverable.
 * @param {string} binaryPath
 * @param {NodeJS.ProcessEnv} [extraEnv]
 * @returns {NodeJS.ProcessEnv}
 */
function buildSpawnEnv(binaryPath, extraEnv = {}) {
  const nativeDir = binaryPath ? path.dirname(binaryPath) : "";
  const existingLd = process.env.LD_LIBRARY_PATH || "";
  const ldLibraryPath = nativeDir
    ? existingLd
      ? `${nativeDir}:${existingLd}`
      : nativeDir
    : existingLd;

  return {
    ...process.env,
    ...(ldLibraryPath ? { LD_LIBRARY_PATH: ldLibraryPath } : {}),
    ...extraEnv,
  };
}

/**
 * Appends a chunk to a rolling UTF-8 tail buffer capped at maxBytes.
 */
function appendTail(current, chunk, maxBytes = MAX_STDERR_BYTES) {
  const next = current + chunk;
  if (Buffer.byteLength(next, "utf8") <= maxBytes) return next;
  return next.slice(-maxBytes);
}

/**
 * Parses FFmpeg `-progress pipe:1` key=value blocks.
 * Accumulates fields until `progress=continue` or `progress=end` arrives.
 */
function createProgressParser(durationSec, onProgress) {
  let state = {
    outTimeUs: 0,
    speed: null,
    bitrate: null,
  };
  let lastEmitAt = 0;
  let remainder = "";

  return function feed(chunk) {
    remainder += chunk;
    const lines = remainder.split(/\r?\n/);
    remainder = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();

      if (key === "out_time_us" || key === "out_time_ms") {
        const parsed = Number(val);
        if (Number.isFinite(parsed) && parsed >= 0) {
          // FFmpeg emits microseconds for both out_time_us and (historically) out_time_ms
          state.outTimeUs = parsed;
        }
      } else if (key === "speed") {
        state.speed = val === "N/A" ? null : val;
      } else if (key === "bitrate") {
        state.bitrate = val === "N/A" ? null : val;
      } else if (key === "progress") {
        const isEnd = val === "end";
        const now = Date.now();
        if (!isEnd && now - lastEmitAt < PROGRESS_THROTTLE_MS) {
          continue;
        }
        lastEmitAt = now;
        const outTimeSec = state.outTimeUs / 1_000_000;
        let percent = null;
        if (isEnd) {
          percent = 100;
        } else if (Number.isFinite(durationSec) && durationSec > 0) {
          percent = Math.max(0, Math.min(99, Math.floor((outTimeSec / durationSec) * 100)));
        }
        if (typeof onProgress === "function") {
          try {
            onProgress({
              percent,
              outTimeSec,
              speed: state.speed,
              bitrate: state.bitrate,
              end: isEnd,
            });
          } catch (_) {}
        }
      }
    }
  };
}

/**
 * Gracefully stops an FFmpeg child process (SIGTERM -> grace period -> SIGKILL).
 * @param {import("child_process").ChildProcess} child
 * @param {number} [graceMs]
 * @returns {Promise<void>}
 */
function gracefulKill(child, graceMs = DEFAULT_GRACE_MS) {
  if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) {
    activeProcesses.delete(child);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let forceTimer = null;

    const done = () => {
      if (settled) return;
      settled = true;
      if (forceTimer) clearTimeout(forceTimer);
      activeProcesses.delete(child);
      resolve();
    };

    child.once("close", done);
    child.once("exit", done);

    try {
      child.kill("SIGTERM");
    } catch (_) {
      done();
      return;
    }

    forceTimer = setTimeout(() => {
      try {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      } catch (_) {}
      done();
    }, graceMs);
    if (typeof forceTimer.unref === "function") {
      forceTimer.unref();
    }
  });
}

/**
 * Terminates all tracked active FFmpeg child processes (used on shutdown).
 * @param {number} [graceMs]
 * @returns {Promise<void>}
 */
async function terminateAll(graceMs = DEFAULT_GRACE_MS) {
  const children = Array.from(activeProcesses);
  if (children.length === 0) return;
  await Promise.allSettled(children.map((child) => gracefulKill(child, graceMs)));
}

function getActiveProcessCount() {
  return activeProcesses.size;
}

/**
 * Spawns a tracked FFmpeg child process without shell interpolation.
 */
function spawnTrackedFfmpeg(binaryPath, args, { env, stdio, spawnImpl = spawn } = {}) {
  if (!binaryPath || typeof binaryPath !== "string") {
    throw new FfmpegError("FFmpeg binary path is missing", {
      code: "BINARY_NOT_FOUND",
    });
  }
  const child = spawnImpl(binaryPath, args, {
    shell: false,
    env: buildSpawnEnv(binaryPath, env),
    stdio: stdio || ["ignore", "pipe", "pipe"],
  });
  activeProcesses.add(child);
  const untrack = () => activeProcesses.delete(child);
  child.once("close", untrack);
  child.once("exit", untrack);
  child.once("error", untrack);
  return child;
}

/**
 * Runs an FFmpeg command to completion with progress parsing, timeout, and AbortSignal support.
 */
async function runFfmpeg(
  args,
  {
    binaryPath,
    env,
    signal,
    timeoutMs = 0,
    durationSec = null,
    onProgress = null,
    onStderrLine = null,
    allowNonZeroExit = false,
    spawnImpl = spawn,
  } = {},
) {
  if (signal?.aborted) {
    throw new FfmpegError("FFmpeg execution aborted", { code: "ABORTED" });
  }

  let resolvedBin = binaryPath;
  if (!resolvedBin) {
    const { getFfmpegPath } = require("./binary");
    resolvedBin = await getFfmpegPath();
  }
  if (!resolvedBin) {
    throw new FfmpegError("FFmpeg binary not found", {
      code: "BINARY_NOT_FOUND",
    });
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnTrackedFfmpeg(resolvedBin, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        spawnImpl,
      });
    } catch (err) {
      if (err instanceof FfmpegError) return reject(err);
      return reject(
        new FfmpegError(`Failed to start FFmpeg: ${err.message}`, {
          code: err.code === "ENOENT" ? "BINARY_NOT_FOUND" : "SPAWN_ERROR",
          cause: err,
        }),
      );
    }

    let stderrTail = "";
    let stderrLineRem = "";
    let settled = false;
    let timeoutTimer = null;
    let abortReason = null;

    const progressFeed =
      typeof onProgress === "function"
        ? createProgressParser(durationSec, onProgress)
        : null;

    const cleanupListeners = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      reject(err);
    };

    const succeed = (result) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      resolve(result);
    };

    const onAbort = () => {
      abortReason = "ABORTED";
      gracefulKill(child).finally(() => {
        fail(
          new FfmpegError("FFmpeg execution aborted", {
            code: "ABORTED",
            stderrTail,
          }),
        );
      });
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        abortReason = "TIMEOUT";
        gracefulKill(child).finally(() => {
          fail(
            new FfmpegError(`FFmpeg timed out after ${timeoutMs}ms`, {
              code: "TIMEOUT",
              stderrTail,
            }),
          );
        });
      }, timeoutMs);
      if (typeof timeoutTimer.unref === "function") {
        timeoutTimer.unref();
      }
    }

    if (child.stdout) {
      child.stdout.on("data", (data) => {
        if (progressFeed) {
          progressFeed(data.toString("utf8"));
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data) => {
        const str = data.toString("utf8");
        stderrTail = appendTail(stderrTail, str);
        if (typeof onStderrLine === "function") {
          stderrLineRem += str;
          const lines = stderrLineRem.split(/\r?\n/);
          stderrLineRem = lines.pop() || "";
          for (const line of lines) {
            if (line.trim()) {
              try {
                onStderrLine(line);
              } catch (_) {}
            }
          }
        }
      });
    }

    child.once("error", (err) => {
      if (abortReason) return;
      fail(
        new FfmpegError(`Failed to start FFmpeg: ${err.message}`, {
          code: err.code === "ENOENT" ? "BINARY_NOT_FOUND" : "SPAWN_ERROR",
          stderrTail,
          cause: err,
        }),
      );
    });

    child.once("close", (code, sig) => {
      if (abortReason === "ABORTED") {
        return fail(
          new FfmpegError("FFmpeg execution aborted", {
            code: "ABORTED",
            exitCode: code,
            signal: sig,
            stderrTail,
          }),
        );
      }
      if (abortReason === "TIMEOUT") {
        return fail(
          new FfmpegError(`FFmpeg timed out after ${timeoutMs}ms`, {
            code: "TIMEOUT",
            exitCode: code,
            signal: sig,
            stderrTail,
          }),
        );
      }
      if (code !== 0 && !allowNonZeroExit) {
        logger.debug?.(
          `[FFmpeg] Command failed (${code}): ${redactSensitiveArgs(args).join(" ")}`,
        );
        return fail(
          new FfmpegError(
            `FFmpeg exited with code ${code}${sig ? ` (signal: ${sig})` : ""}`,
            {
              code: "NON_ZERO_EXIT",
              exitCode: code,
              signal: sig,
              stderrTail,
            },
          ),
        );
      }
      succeed({ code: code ?? 0, signal: sig || null, stderrTail });
    });
  });
}

module.exports = {
  FfmpegError,
  MAX_STDERR_BYTES,
  redactSensitiveArgs,
  buildSpawnEnv,
  createProgressParser,
  gracefulKill,
  terminateAll,
  getActiveProcessCount,
  spawnTrackedFfmpeg,
  runFfmpeg,
};
