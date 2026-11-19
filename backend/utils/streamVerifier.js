const axios = require("axios");

async function verifyStreamReachability(
  streamUrl,
  headers = {},
  isM3U8 = true,
) {
  if (!streamUrl || !streamUrl.startsWith("http")) return { ok: true };
  const client = global.axios || axios;
  const combinedHeaders = {
    ...(global.getHeaders ? global.getHeaders(streamUrl) : {}),
    ...headers,
  };
  const isDirect =
    isM3U8 === false ||
    Boolean(streamUrl.split("?")[0].match(/\.(mp4|mkv|webm|mov|avi)$/i));
  if (isDirect && !combinedHeaders.Range && !combinedHeaders.range) {
    combinedHeaders.Range = "bytes=0-10";
  }
  try {
    const probeRes = await client.get(streamUrl, {
      headers: combinedHeaders,
      timeout: 2000,
      skipBypass: true,
      validateStatus: (status) => status < 400,
    });
    if (probeRes.status >= 400) {
      return {
        ok: false,
        status: probeRes.status,
        isProtected: probeRes.status === 403 || probeRes.status === 503,
        message: `HTTP ${probeRes.status}`,
      };
    }

    const contentType = (
      probeRes.headers?.["content-type"] || ""
    ).toLowerCase();
    const dataStr = typeof probeRes.data === "string" ? probeRes.data : "";

    const isHtml =
      contentType.includes("text/html") ||
      dataStr.includes("<html") ||
      dataStr.includes("<!DOCTYPE");

    if (isHtml) {
      return {
        ok: false,
        status: probeRes.status,
        isProtected: false,
        message: "Stream URL returned HTML page instead of media",
      };
    }

    if (isDirect) {
      if (
        contentType.includes("application/json") ||
        (dataStr && dataStr.trim().startsWith("{"))
      ) {
        return {
          ok: false,
          status: probeRes.status,
          isProtected: false,
          message: "Direct video URL returned JSON error response",
        };
      }
    }

    if (
      typeof probeRes.data === "string" &&
      probeRes.data.includes("#EXTM3U")
    ) {
      const lines = probeRes.data
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      let mediaPlaylistUrl = null;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
          if (i + 1 < lines.length && !lines[i + 1].startsWith("#")) {
            mediaPlaylistUrl = new URL(lines[i + 1], streamUrl).href;
            break;
          }
        }
      }

      if (mediaPlaylistUrl) {
        try {
          const subRes = await client.get(mediaPlaylistUrl, {
            headers: combinedHeaders,
            timeout: 5000,
            skipBypass: true,
            validateStatus: (s) => s < 400,
          });
          if (subRes.status >= 400) {
            return {
              ok: false,
              status: subRes.status,
              message: `sub-playlist HTTP ${subRes.status}`,
            };
          }
        } catch (subErr) {
          return {
            ok: false,
            status: subErr.response?.status,
            message: `sub-playlist failed (${subErr.response?.status ? `HTTP ${subErr.response.status}` : subErr.message})`,
          };
        }
      }
    }

    return { ok: true };
  } catch (probeErr) {
    const status = probeErr.response?.status;
    const isProtected = status === 403 || status === 503;
    return {
      ok: false,
      status,
      isProtected,
      message: status ? `HTTP ${status}` : probeErr.message,
    };
  }
}

module.exports = { verifyStreamReachability };
