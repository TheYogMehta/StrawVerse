const binary = require("./binary");
const runner = require("./runner");
const probe = require("./probe");
const remux = require("./remux");
const castTranscode = require("./castTranscode");

module.exports = {
  // Binary resolution, validation & diagnostics
  ENCODER_IDS: binary.ENCODER_IDS,
  HW_ENCODER_PROFILES: binary.HW_ENCODER_PROFILES,
  isAndroidRuntime: binary.isAndroidRuntime,
  invalidateBinaryCache: binary.invalidateBinaryCache,
  validateFfmpegBinary: binary.validateFfmpegBinary,
  resolveFfmpegBinary: binary.resolveFfmpegBinary,
  getFfmpegPath: binary.getFfmpegPath,
  getCandidateEncodersForPlatform: binary.getCandidateEncodersForPlatform,
  detectHardwareEncoders: binary.detectHardwareEncoders,
  resolveActiveEncoder: binary.resolveActiveEncoder,
  getFfmpegDiagnostics: binary.getFfmpegDiagnostics,

  // Process execution & lifecycle
  FfmpegError: runner.FfmpegError,
  redactSensitiveArgs: runner.redactSensitiveArgs,
  buildSpawnEnv: runner.buildSpawnEnv,
  createProgressParser: runner.createProgressParser,
  gracefulKill: runner.gracefulKill,
  terminateAll: runner.terminateAll,
  getActiveProcessCount: runner.getActiveProcessCount,
  spawnTrackedFfmpeg: runner.spawnTrackedFfmpeg,
  runFfmpeg: runner.runFfmpeg,

  // Media probing & subtitle extraction
  parseMediaProbeOutput: probe.parseMediaProbeOutput,
  probeMedia: probe.probeMedia,
  sanitizeSubLang: probe.sanitizeSubLang,
  planSubtitleExtractions: probe.planSubtitleExtractions,
  extractSubtitlesSinglePass: probe.extractSubtitlesSinglePass,

  // Download remuxing
  getRemuxConcurrencyLimit: remux.getRemuxConcurrencyLimit,
  acquireRemuxSlot: remux.acquireRemuxSlot,
  sanitizeMetadataValue: remux.sanitizeMetadataValue,
  buildRemuxArgs: remux.buildRemuxArgs,
  buildFallbackConfigs: remux.buildFallbackConfigs,
  remuxMedia: remux.remuxMedia,

  // Cast transcoding & cleanup
  escapeSubtitleFilterPath: castTranscode.escapeSubtitleFilterPath,
  getEncoderProfileArgs: castTranscode.getEncoderProfileArgs,
  buildCastBurnArgs: castTranscode.buildCastBurnArgs,
  startCastBurn: castTranscode.startCastBurn,
  sweepOrphanedCastDirs: castTranscode.sweepOrphanedCastDirs,
};
