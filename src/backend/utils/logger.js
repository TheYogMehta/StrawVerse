class HLSLogger {
  constructor(
    caption = "downloading",
    epid = "downloadep",
    indent = 0,
    quiet = false,
  ) {
    this.quiet = quiet;
    this.totalSegments = 0;
    this.currentSegments = 0;
    this.caption = caption;
    this.epid = epid;
    this.lastLogTime = 0;
  }
  logProgress() {
    const now = Date.now();
    const isFinal = this.currentSegments >= this.totalSegments || this.totalSegments === 0;
    if (!isFinal && this.currentSegments > 1 && now - this.lastLogTime < 800) {
      return;
    }
    this.lastLogTime = now;

    fetch(`http://localhost:${global.PORT}/api/logger`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        caption: this.caption,
        totalSegments: this.totalSegments,
        currentSegments: this.currentSegments,
        epid: this.epid,
      }),
    }).catch((err) => {
      console.log("Error updating download progress:", err);
    });
  }

  logger = (...args) => {
    if (!this.quiet && typeof args[0] === "string") {
      const matches = args[0].match(/Queueing (\d+) segment/);
      if (matches?.[1]) {
        this.totalSegments = parseInt(matches[1]);
        this.currentSegments++;
        this.logProgress();
      } else if (args[0] === "Received:") {
        this.currentSegments++;
        this.logProgress();
      } else if (args[0] === "Spawning FFMPEG") {
        this.currentSegments++;
        this.logProgress();
      }
    }
  };
}

module.exports = HLSLogger;
