const dgram = require("dgram");
const http = require("http");
const https = require("https");
const os = require("os");
const url = require("url");

const { logger } = require("./AppLogger");

function xmlEscape(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseSecondsFromTimeStr(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return 0;
  const parts = timeStr.trim().split(":").map(parseFloat);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function formatSecondsToTimeStr(totalSeconds) {
  const secs = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [
    String(h).padStart(2, "0"),
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0"),
  ].join(":");
}

class CastService {
  constructor() {
    this.discoveredDevices = new Map(); // id -> device
    this.activeSession = null;
    this.pollTimer = null;
  }

  /**
   * Resolves the primary local network IPv4 address for Wi-Fi / LAN.
   * Filters out virtual adapters (Docker, Tailscale, Wireguard, veth).
   */
  getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      const lower = name.toLowerCase();
      if (
        lower.startsWith("docker") ||
        lower.startsWith("veth") ||
        lower.startsWith("tailscale") ||
        lower.startsWith("wg") ||
        lower.startsWith("tun") ||
        lower.startsWith("tap") ||
        lower.startsWith("br-")
      ) {
        continue;
      }

      for (const addr of addrs) {
        if (addr.family === "IPv4" && !addr.internal) {
          const ip = addr.address;
          let priority = 0;
          if (ip.startsWith("192.168.")) priority = 3;
          else if (ip.startsWith("10.")) priority = 2;
          else if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) priority = 1;

          if (lower.includes("wl") || lower.includes("wi-fi") || lower.includes("wlan")) {
            priority += 0.5;
          }

          candidates.push({ ip, priority, name });
        }
      }
    }

    candidates.sort((a, b) => b.priority - a.priority);
    return candidates.length > 0 ? candidates[0].ip : "127.0.0.1";
  }

  /**
   * Discovers TV devices on the local network using SSDP and mDNS.
   * @param {number} timeoutMs
   * @returns {Promise<Array>} List of discovered devices
   */
  async discoverDevices(timeoutMs = 3500) {
    const interfaces = os.networkInterfaces();
    const scanTargets = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      const lower = name.toLowerCase();
      if (
        lower.startsWith("docker") ||
        lower.startsWith("veth") ||
        lower.startsWith("tailscale") ||
        lower.startsWith("wg")
      ) {
        continue;
      }
      for (const addr of addrs) {
        if (addr.family === "IPv4" && !addr.internal) {
          scanTargets.push({ iface: name, ip: addr.address });
        }
      }
    }

    const discoveredInScan = new Map();

    const fetchDescription = (locationUrl) =>
      new Promise((resolve) => {
        try {
          const parsed = new URL(locationUrl);
          const reqModule = parsed.protocol === "https:" ? https : http;
          const req = reqModule.get(
            locationUrl,
            { timeout: 3000 },
            (res) => {
              if (res.statusCode < 200 || res.statusCode >= 300) {
                return resolve(null);
              }
              let xml = "";
              res.on("data", (chunk) => (xml += chunk));
              res.on("end", () => {
                resolve({ locationUrl, xml, origin: parsed.origin });
              });
            },
          );
          req.on("error", () => resolve(null));
          req.on("timeout", () => {
            req.destroy();
            resolve(null);
          });
        } catch (_) {
          resolve(null);
        }
      });

    // Run SSDP discovery across all local interfaces
    const sockets = [];
    const ssdpPromises = scanTargets.map(
      ({ iface, ip }) =>
        new Promise((resolve) => {
          let socket;
          try {
            socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
            sockets.push(socket);
          } catch (err) {
            return resolve();
          }

          socket.on("message", async (msg, rinfo) => {
            const text = msg.toString();
            const locationMatch = text.match(/LOCATION:\s*(http:\/\/[^\r\n]+)/i);
            if (!locationMatch) return;

            const loc = locationMatch[1].trim();
            if (discoveredInScan.has(loc)) return;
            discoveredInScan.set(loc, true);

            const desc = await fetchDescription(loc);
            if (!desc || !desc.xml) return;

            const xml = desc.xml;
            const hasAVTransport = xml.includes(
              "urn:schemas-upnp-org:service:AVTransport:1",
            );
            const isMediaRenderer =
              xml.includes("urn:schemas-upnp-org:device:MediaRenderer:1") ||
              xml.includes("MediaRenderer");

            if (!hasAVTransport && !isMediaRenderer) return;

            const fnMatch = xml.match(/<friendlyName>([^<]+)<\/friendlyName>/i);
            const modelMatch = xml.match(/<modelName>([^<]+)<\/modelName>/i);
            const manMatch = xml.match(/<manufacturer>([^<]+)<\/manufacturer>/i);
            const udnMatch = xml.match(/<UDN>([^<]+)<\/UDN>/i);

            // Extract service controlURLs safely by iterating each <service> block
            const serviceBlocks = xml.match(/<service>[\s\S]*?<\/service>/gi) || [];
            let avControlUrl = null;
            let renderingControlUrl = null;

            for (const block of serviceBlocks) {
              if (/urn:schemas-upnp-org:service:AVTransport/i.test(block)) {
                const m = block.match(/<controlURL>([^<]+)<\/controlURL>/i);
                if (m) avControlUrl = new URL(m[1].trim(), desc.origin).toString();
              } else if (/urn:schemas-upnp-org:service:RenderingControl/i.test(block)) {
                const m = block.match(/<controlURL>([^<]+)<\/controlURL>/i);
                if (m) renderingControlUrl = new URL(m[1].trim(), desc.origin).toString();
              }
            }

            if (!avControlUrl) return;

            const friendlyName = fnMatch ? fnMatch[1].trim() : "Smart TV";
            const modelName = modelMatch ? modelMatch[1].trim() : "DLNA Device";
            const manufacturer = manMatch ? manMatch[1].trim() : "Unknown";
            const id = udnMatch ? udnMatch[1].trim() : `dlna-${rinfo.address}`;

            const device = {
              id,
              name: friendlyName,
              type: "dlna",
              manufacturer,
              model: modelName,
              address: rinfo.address,
              location: loc,
              controlUrl: avControlUrl,
              renderingControlUrl,
            };

            this.discoveredDevices.set(id, device);
          });

          socket.bind(0, ip, () => {
            try {
              socket.setBroadcast(true);
              socket.setMulticastTTL(4);
              socket.setMulticastInterface(ip);
            } catch (_) {}

            const queries = [
              "urn:schemas-upnp-org:device:MediaRenderer:1",
              "urn:schemas-upnp-org:service:AVTransport:1",
              "ssdp:all",
            ];

            for (const st of queries) {
              const msg = [
                "M-SEARCH * HTTP/1.1",
                "HOST: 239.255.255.250:1900",
                'MAN: "ssdp:discover"',
                "MX: 2",
                `ST: ${st}`,
                "",
                "",
              ].join("\r\n");

              socket.send(Buffer.from(msg), 0, msg.length, 1900, "239.255.255.250");
            }

            setTimeout(resolve, timeoutMs - 500);
          });
        }),
    );

    await Promise.all(ssdpPromises);

    for (const s of sockets) {
      try {
        s.close();
      } catch (_) {}
    }

    return Array.from(this.discoveredDevices.values());
  }

  /**
   * Sends a SOAP XML action to a UPnP controlURL.
   */
  sendSoapAction(controlUrl, serviceType, actionName, argsObj = {}) {
    return new Promise((resolve, reject) => {
      try {
        const parsed = new URL(controlUrl);
        const reqModule = parsed.protocol === "https:" ? https : http;

        let argsXml = "";
        for (const [k, v] of Object.entries(argsObj)) {
          argsXml += `<${k}>${v}</${k}>\n`;
        }

        const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${actionName} xmlns:u="${serviceType}">
      ${argsXml}
    </u:${actionName}>
  </s:Body>
</s:Envelope>`;

        const options = {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
          path: parsed.pathname + (parsed.search || ""),
          method: "POST",
          headers: {
            "Content-Type": 'text/xml; charset="utf-8"',
            SOAPAction: `"${serviceType}#${actionName}"`,
            "Content-Length": Buffer.byteLength(soapBody),
          },
          timeout: 6000,
        };

        const req = reqModule.request(options, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(
                new Error(
                  `SOAP Action ${actionName} failed with status ${res.statusCode}: ${data}`,
                ),
              );
            }
          });
        });

        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error(`SOAP Action ${actionName} timed out`));
        });

        req.write(soapBody);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Starts casting media to a device.
   */
  async castToDevice(device, mediaOptions) {
    if (!device || !device.controlUrl) {
      throw new Error("Invalid cast device or missing AVTransport control URL");
    }

    const {
      streamUrl,
      title = "StrawVerse Stream",
      position = 0,
      mimeType = "video/mp4",
      poster = "",
      subtitles = [],
      activeSubtitle = null,
      headers = {},
    } = mediaOptions;

    const isHls =
      mimeType.includes("mpegurl") ||
      mimeType.includes("apple") ||
      streamUrl.toLowerCase().includes(".m3u8");

    // Samsung Tizen MediaRenderer requires http-get:*:video/mp4:* to be the primary
    // descriptor, even for HLS streams (which Tizen plays via its native media pipeline).
    // If application/vnd.apple.mpegurl is first, Samsung TV rejects SetAVTransportURI with error 714 (Illegal MIME-type).
    const resElements = isHls
      ? `<res protocolInfo="http-get:*:video/mp4:*">${xmlEscape(streamUrl)}</res>
    <res protocolInfo="http-get:*:application/vnd.apple.mpegurl:*">${xmlEscape(streamUrl)}</res>
    <res protocolInfo="http-get:*:application/x-mpegURL:*">${xmlEscape(streamUrl)}</res>`
      : `<res protocolInfo="http-get:*:${mimeType || "video/mp4"}:*">${xmlEscape(streamUrl)}</res>
    <res protocolInfo="http-get:*:video/mp4:*">${xmlEscape(streamUrl)}</res>`;

    const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
  <item id="1" parentID="0" restricted="1">
    <dc:title>${xmlEscape(title)}</dc:title>
    <upnp:class>object.item.videoItem</upnp:class>
    ${poster ? `<upnp:albumArtURI>${xmlEscape(poster)}</upnp:albumArtURI>` : ""}
    ${resElements}
  </item>
</DIDL-Lite>`;

    logger.info(`[cast] Sending SetAVTransportURI to ${device.name} (${device.address}): ${streamUrl}`);

    // 0. Stop any existing playback or error state on the TV
    try {
      await this.sendSoapAction(
        device.controlUrl,
        "urn:schemas-upnp-org:service:AVTransport:1",
        "Stop",
        { InstanceID: 0 },
      );
    } catch (_) {}

    // 1. Set URI
    await this.sendSoapAction(
      device.controlUrl,
      "urn:schemas-upnp-org:service:AVTransport:1",
      "SetAVTransportURI",
      {
        InstanceID: 0,
        CurrentURI: xmlEscape(streamUrl),
        CurrentURIMetaData: xmlEscape(didl),
      },
    );

    // 2. Allow TV 800ms to initialize AVTransport pipeline for the new URI before sending Play
    await new Promise((r) => setTimeout(r, 800));

    try {
      await this.sendSoapAction(
        device.controlUrl,
        "urn:schemas-upnp-org:service:AVTransport:1",
        "Play",
        {
          InstanceID: 0,
          Speed: 1,
        },
      );
    } catch (playErr) {
      logger.warn(`[cast] Initial Play returned: ${playErr.message}. Retrying in 1.2s...`);
      await new Promise((r) => setTimeout(r, 1200));
      await this.sendSoapAction(
        device.controlUrl,
        "urn:schemas-upnp-org:service:AVTransport:1",
        "Play",
        {
          InstanceID: 0,
          Speed: 1,
        },
      );
    }

    // 3. Seek to position if specified
    if (position > 0) {
      setTimeout(async () => {
        try {
          await this.seek(position, device);
        } catch (e) {
          logger.warn(`[cast] Initial seek to ${position}s failed: ${e.message}`);
        }
      }, 1200);
    }

    // Set active session
    this.activeSession = {
      device,
      media: {
        title,
        streamUrl,
        position: position || 0,
        duration: 0,
        state: "PLAYING",
        lastUpdate: Date.now(),
      },
    };

    this.startStatusPolling();
    return this.activeSession;
  }

  async play(device = this.activeSession?.device) {
    if (!device) throw new Error("No active cast device");
    await this.sendSoapAction(
      device.controlUrl,
      "urn:schemas-upnp-org:service:AVTransport:1",
      "Play",
      { InstanceID: 0, Speed: 1 },
    );
    if (this.activeSession) this.activeSession.media.state = "PLAYING";
  }

  async pause(device = this.activeSession?.device) {
    if (!device) throw new Error("No active cast device");
    await this.sendSoapAction(
      device.controlUrl,
      "urn:schemas-upnp-org:service:AVTransport:1",
      "Pause",
      { InstanceID: 0 },
    );
    if (this.activeSession) this.activeSession.media.state = "PAUSED";
  }

  async stop(device = this.activeSession?.device) {
    if (!device) throw new Error("No active cast device");
    try {
      await this.sendSoapAction(
        device.controlUrl,
        "urn:schemas-upnp-org:service:AVTransport:1",
        "Stop",
        { InstanceID: 0 },
      );
    } catch (_) {}
    this.stopStatusPolling();
    this.activeSession = null;
  }

  async seek(seconds, device = this.activeSession?.device) {
    if (!device) throw new Error("No active cast device");
    const timeStr = formatSecondsToTimeStr(seconds);
    await this.sendSoapAction(
      device.controlUrl,
      "urn:schemas-upnp-org:service:AVTransport:1",
      "Seek",
      {
        InstanceID: 0,
        Unit: "REL_TIME",
        Target: timeStr,
      },
    );
    if (this.activeSession) this.activeSession.media.position = seconds;
  }

  async setVolume(volumePercent, device = this.activeSession?.device) {
    if (!device || !device.renderingControlUrl) {
      throw new Error("Device does not support RenderingControl volume");
    }
    const vol = Math.max(0, Math.min(100, Math.round(volumePercent)));
    await this.sendSoapAction(
      device.renderingControlUrl,
      "urn:schemas-upnp-org:service:RenderingControl:1",
      "SetVolume",
      {
        InstanceID: 0,
        Channel: "Master",
        DesiredVolume: vol,
      },
    );
  }

  async getPositionInfo(device = this.activeSession?.device) {
    if (!device) return null;
    try {
      const xml = await this.sendSoapAction(
        device.controlUrl,
        "urn:schemas-upnp-org:service:AVTransport:1",
        "GetPositionInfo",
        { InstanceID: 0 },
      );
      const relTimeMatch = xml.match(/<RelTime>([^<]+)<\/RelTime>/i);
      const trackDurationMatch = xml.match(
        /<TrackDuration>([^<]+)<\/TrackDuration>/i,
      );

      const relTime = relTimeMatch ? relTimeMatch[1] : "00:00:00";
      const durationStr = trackDurationMatch ? trackDurationMatch[1] : "00:00:00";

      const currentSecs = parseSecondsFromTimeStr(relTime);
      const durationSecs = parseSecondsFromTimeStr(durationStr);

      if (this.activeSession) {
        this.activeSession.media.position = currentSecs;
        if (durationSecs > 0) this.activeSession.media.duration = durationSecs;
        this.activeSession.media.lastUpdate = Date.now();
      }

      return {
        position: currentSecs,
        duration: durationSecs,
        relTime,
        durationStr,
      };
    } catch (_) {
      return null;
    }
  }

  async getTransportInfo(device = this.activeSession?.device) {
    if (!device) return null;
    try {
      const xml = await this.sendSoapAction(
        device.controlUrl,
        "urn:schemas-upnp-org:service:AVTransport:1",
        "GetTransportInfo",
        { InstanceID: 0 },
      );
      const stateMatch = xml.match(
        /<CurrentTransportState>([^<]+)<\/CurrentTransportState>/i,
      );
      const state = stateMatch ? stateMatch[1].trim() : "STOPPED";
      if (this.activeSession) {
        if (state === "PLAYING") this.activeSession.media.state = "PLAYING";
        else if (state === "PAUSED_PLAYBACK") this.activeSession.media.state = "PAUSED";
        else if (state === "STOPPED" || state === "NO_MEDIA_PRESENT") {
          this.activeSession.media.state = "STOPPED";
        }
      }
      return state;
    } catch (_) {
      return null;
    }
  }

  startStatusPolling() {
    this.stopStatusPolling();
    this.pollTimer = setInterval(async () => {
      if (!this.activeSession || !this.activeSession.device) {
        this.stopStatusPolling();
        return;
      }
      try {
        await this.getPositionInfo();
        await this.getTransportInfo();
      } catch (_) {}
    }, 2000);
  }

  stopStatusPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getStatus() {
    if (!this.activeSession) {
      return { isCasting: false };
    }
    return {
      isCasting: true,
      device: {
        id: this.activeSession.device.id,
        name: this.activeSession.device.name,
        type: this.activeSession.device.type,
        model: this.activeSession.device.model,
      },
      media: this.activeSession.media,
    };
  }
}

const castServiceInstance = new CastService();
module.exports = castServiceInstance;
