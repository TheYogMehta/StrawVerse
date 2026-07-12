/**
 * discord-rpc stub for Android.
 *
 * Discord Rich Presence connects to a local Discord desktop client over an
 * IPC socket - that doesn't exist on Android. This stub keeps utils/discord.js
 * loadable; every connection attempt fails fast and the backend's existing
 * error handling treats RPC as unavailable.
 */

const EventEmitter = require("events");

class Client extends EventEmitter {
  constructor() {
    super();
    this.user = null;
  }
  login() {
    return Promise.reject(
      new Error("Discord RPC is not available on Android"),
    );
  }
  setActivity() {
    return Promise.resolve();
  }
  clearActivity() {
    return Promise.resolve();
  }
  destroy() {
    return Promise.resolve();
  }
}

module.exports = { Client, register: () => {} };
