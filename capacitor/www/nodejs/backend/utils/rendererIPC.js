/**
 * Utility function to safely broadcast IPC messages to the Capacitor/NodeJS bridge without throw risk.
 */
function sendToRenderer(channel, payload) {
  if (channel === "download-logger") {
    global.__latestDownloadProgress = payload;
  }
  if (global.win && !global.win.isDestroyed() && global.win.webContents) {
    try {
      global.win.webContents.send(channel, payload);
    } catch (err) {
      console.error(`[IPC Send Error] Channel ${channel}:`, err.message);
    }
  }
}

module.exports = {
  sendToRenderer,
};
