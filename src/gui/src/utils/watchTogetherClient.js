// Opcodes matching Go server protocol
export const OPCODES = {
  JOIN_ROOM: 0x01,
  ROOM_JOINED: 0x02,
  USER_EVENT: 0x03,
  PLAY_PAUSE: 0x04,
  TIME_SYNC: 0x05,
  LOAD_MEDIA: 0x06,
  CLIENT_READY: 0x07,
  START_PLAYBACK: 0x08,
  ADD_QUEUE: 0x09,
  CHAT_MSG: 0x0a,
  PING: 0x0b,
  PONG: 0x0c,
  ERROR: 0x0d,
};

export const USER_EVENTS = {
  JOINED: 0x00,
  LEFT: 0x01,
};

class WatchTogetherClient {
  constructor() {
    this.ws = null;
    const stored = localStorage.getItem("strawverse_wt_server");
    this.serverUrl = stored
      ? this.formatUrl(stored)
      : "wss://strawverse-wt.theyogmehta.online/ws";
    this.isConnected = false;
    this.roomCode = null;
    this.isHost = false;
    this.userID = null;
    this.username = "Guest";
    this.users = []; // Array of { id, username }
    this.queue = []; // Array of { providerID, animeID, episode, title }
    this.listeners = new Map();
    this.pingInterval = null;
    this.pingLatency = 0;
  }

  formatUrl(url) {
    let formatted = (url || "").trim();
    if (!formatted)
      return "wss://strawverse-wt.theyogmehta.online/ws";
    if (formatted.startsWith("https://")) {
      formatted = formatted.replace("https://", "wss://");
    } else if (formatted.startsWith("http://")) {
      formatted = formatted.replace("http://", "ws://");
    }
    if (!formatted.startsWith("wss://") && !formatted.startsWith("ws://")) {
      formatted = "wss://" + formatted;
    }
    if (!formatted.endsWith("/ws")) {
      formatted = formatted.replace(/\/+$/, "") + "/ws";
    }
    return formatted;
  }

  setServerUrl(url) {
    const formatted = this.formatUrl(url);
    this.serverUrl = formatted;
    localStorage.setItem("strawverse_wt_server", formatted);
  }

  getServerUrl() {
    return this.serverUrl;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event).filter((cb) => cb !== callback);
    this.listeners.set(event, callbacks);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((cb) => cb(data));
    }
  }

  connect(username = "Guest") {
    return new Promise((resolve, reject) => {
      this.username = username;
      if (
        this.ws &&
        (this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING)
      ) {
        resolve();
        return;
      }

      try {
        this.ws = new WebSocket(this.serverUrl);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
          this.isConnected = true;
          this.startPing();
          this.emit("connected");
          resolve();
        };

        this.ws.onclose = () => {
          this.cleanup();
          this.emit("disconnected");
        };

        this.ws.onerror = (err) => {
          this.emit("error", { message: "WebSocket connection error" });
          reject(err);
        };

        this.ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            this.handleBinaryMessage(event.data);
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect() {
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  cleanup() {
    this.isConnected = false;
    this.roomCode = null;
    this.isHost = false;
    this.userID = null;
    this.users = [];
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  startPing() {
    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
        const buf = new ArrayBuffer(9);
        const view = new DataView(buf);
        view.setUint8(0, OPCODES.PING);
        view.setBigInt64(1, BigInt(Date.now()), true);
        this.ws.send(buf);
      }
    }, 10000);
  }

  createRoom(username) {
    return this.joinRoom("CREATE", username);
  }

  async joinRoom(code, username) {
    if (!this.isConnected) {
      await this.connect(username);
    }

    const enc = new TextEncoder();
    const nameBytes = enc.encode(username || this.username);
    const codePadded = (code || "CREATE").padEnd(6, " ").slice(0, 6);
    const codeBytes = enc.encode(codePadded);

    const buf = new ArrayBuffer(1 + 6 + 1 + nameBytes.length);
    const view = new DataView(buf);
    view.setUint8(0, OPCODES.JOIN_ROOM);

    const u8 = new Uint8Array(buf);
    u8.set(codeBytes, 1);
    u8.set([nameBytes.length], 7);
    u8.set(nameBytes, 8);

    this.ws.send(buf);
  }

  sendPlayPause(isPlaying, timestamp) {
    if (!this.isConnected || !this.roomCode) return;
    const buf = new ArrayBuffer(1 + 1 + 4);
    const view = new DataView(buf);
    view.setUint8(0, OPCODES.PLAY_PAUSE);
    view.setUint8(1, isPlaying ? 1 : 0);
    view.setFloat32(2, timestamp, false);
    this.ws.send(buf);
  }

  sendTimeSync(timestamp, speed = 1.0) {
    if (!this.isConnected || !this.roomCode) return;
    const buf = new ArrayBuffer(1 + 4 + 4);
    const view = new DataView(buf);
    view.setUint8(0, OPCODES.TIME_SYNC);
    view.setFloat32(1, timestamp, false);
    view.setFloat32(5, speed, false);
    this.ws.send(buf);
  }

  sendLoadMedia(providerID, animeID, episodeNum) {
    if (!this.isConnected || !this.roomCode) return;
    const buf = new ArrayBuffer(1 + 2 + 4 + 2);
    const view = new DataView(buf);
    view.setUint8(0, OPCODES.LOAD_MEDIA);
    view.setUint16(1, providerID || 0, false);
    view.setUint32(3, animeID || 0, false);
    view.setUint16(7, episodeNum || 1, false);
    this.ws.send(buf);
  }

  sendClientReady() {
    if (!this.isConnected || !this.roomCode) return;
    const buf = new ArrayBuffer(2);
    const view = new DataView(buf);
    view.setUint8(0, OPCODES.CLIENT_READY);
    view.setUint8(1, this.userID || 0);
    this.ws.send(buf);
  }

  sendAddQueue(providerID, animeID, episodeNum, title = "") {
    if (!this.isConnected || !this.roomCode) return;
    const item = { providerID, animeID, episode: episodeNum, title };
    this.queue.push(item);
    this.emit("queueUpdated", this.queue);

    const buf = new ArrayBuffer(1 + 2 + 4 + 2);
    const view = new DataView(buf);
    view.setUint8(0, OPCODES.ADD_QUEUE);
    view.setUint16(1, providerID || 0, false);
    view.setUint32(3, animeID || 0, false);
    view.setUint16(7, episodeNum || 1, false);
    this.ws.send(buf);
  }

  sendChatMessage(text) {
    if (!this.isConnected || !this.roomCode || !text.trim()) return;
    const enc = new TextEncoder();
    const senderBytes = enc.encode(this.username);
    const msgBytes = enc.encode(text.trim());

    const buf = new ArrayBuffer(
      1 + 1 + senderBytes.length + 2 + msgBytes.length,
    );
    const view = new DataView(buf);
    view.setUint8(0, OPCODES.CHAT_MSG);
    view.setUint8(1, senderBytes.length);

    const u8 = new Uint8Array(buf);
    u8.set(senderBytes, 2);
    view.setUint16(2 + senderBytes.length, msgBytes.length, false);
    u8.set(msgBytes, 4 + senderBytes.length);

    this.ws.send(buf);
  }

  handleBinaryMessage(buffer) {
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    const dec = new TextDecoder();
    const opcode = view.getUint8(0);

    switch (opcode) {
      case OPCODES.ROOM_JOINED: {
        this.isHost = view.getUint8(1) === 1;
        this.userID = view.getUint8(2);
        this.roomCode = dec.decode(u8.subarray(3, 9)).trim();
        this.users = [
          { id: this.userID, username: this.username, isHost: this.isHost },
        ];
        this.emit("roomJoined", {
          roomCode: this.roomCode,
          isHost: this.isHost,
          userID: this.userID,
        });
        break;
      }

      case OPCODES.USER_EVENT: {
        const eventType = view.getUint8(1);
        const uID = view.getUint8(2);
        const nameLen = view.getUint8(3);
        const username = dec.decode(u8.subarray(4, 4 + nameLen));

        if (eventType === USER_EVENTS.JOINED) {
          if (!this.users.some((u) => u.id === uID)) {
            this.users.push({ id: uID, username, isHost: false });
          }
        } else if (eventType === USER_EVENTS.LEFT) {
          this.users = this.users.filter((u) => u.id !== uID);
        }
        this.emit("usersChanged", this.users);
        break;
      }

      case OPCODES.PLAY_PAUSE: {
        const isPlaying = view.getUint8(1) === 1;
        const timestamp = view.getFloat32(2, false);
        this.emit("playPause", { isPlaying, timestamp });
        break;
      }

      case OPCODES.TIME_SYNC: {
        const timestamp = view.getFloat32(1, false);
        const speed = view.getFloat32(5, false);
        this.emit("timeSync", { timestamp, speed });
        break;
      }

      case OPCODES.LOAD_MEDIA: {
        const providerID = view.getUint16(1, false);
        const animeID = view.getUint32(3, false);
        const episode = view.getUint16(7, false);
        this.emit("loadMedia", { providerID, animeID, episode });
        break;
      }

      case OPCODES.CLIENT_READY: {
        const uID = view.getUint8(1);
        this.emit("clientReady", { userID: uID });
        break;
      }

      case OPCODES.START_PLAYBACK: {
        this.emit("startPlayback");
        break;
      }

      case OPCODES.ADD_QUEUE: {
        const providerID = view.getUint16(1, false);
        const animeID = view.getUint32(3, false);
        const episode = view.getUint16(7, false);
        const item = { providerID, animeID, episode };
        this.queue.push(item);
        this.emit("queueUpdated", this.queue);
        break;
      }

      case OPCODES.CHAT_MSG: {
        const sLen = view.getUint8(1);
        const sender = dec.decode(u8.subarray(2, 2 + sLen));
        const mLen = view.getUint16(2 + sLen, false);
        const message = dec.decode(u8.subarray(4 + sLen, 4 + sLen + mLen));
        this.emit("chatMessage", { sender, message, timestamp: new Date() });
        break;
      }

      case OPCODES.PONG: {
        const clientTime = Number(view.getBigInt64(1, true));
        this.pingLatency = Date.now() - clientTime;
        this.emit("ping", this.pingLatency);
        break;
      }

      case OPCODES.ERROR: {
        const code = view.getUint8(1);
        const mLen = view.getUint16(2, false);
        const message = dec.decode(u8.subarray(4, 4 + mLen));
        this.emit("error", { code, message });
        break;
      }
    }
  }
}

export const watchTogetherClient = new WatchTogetherClient();
export default watchTogetherClient;
