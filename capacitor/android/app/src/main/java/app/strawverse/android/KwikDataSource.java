package app.strawverse.android;

import android.net.Uri;
import android.util.Log;
import androidx.media3.common.C;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * A DataSource wrapper that handles segment-level HLS fixes:
 * 1. Strips PNG wrapper headers from HLS segments (required for kwik.cx obfuscation).
 * 2. Rewrites M3U8 playlists dynamically to inject explicit IVs for AES-128 HLS streams.
 *    This fixes playback hangs when seeking or resuming on streams where dropped HLS segments
 *    cause a mismatch between sequence number (used as default IV) and the actual filename-based IV.
 */
public class KwikDataSource implements DataSource {
    private static final String TAG = "KwikDataSource";
    private final DataSource upstream;
    private byte[] peekBuffer;
    private int peekOffset;
    private int peekLength;
    private boolean shouldStrip;

    public KwikDataSource(DataSource upstream) {
        this.upstream = upstream;
    }

    @Override
    public void addTransferListener(TransferListener transferListener) {
        upstream.addTransferListener(transferListener);
    }

    @Override
    public long open(DataSpec dataSpec) throws IOException {
        long bytesRemaining = upstream.open(dataSpec);
        shouldStrip = false;
        peekOffset = 0;
        peekLength = 0;
        peekBuffer = null;

        String uriStr = dataSpec.uri.toString();
        boolean isRangeRequest = dataSpec.position > 0;

        Log.i(TAG, "open: uri=" + uriStr + ", position=" + dataSpec.position + ", limit=" + bytesRemaining);

        // Handle HLS playlist rewriting dynamically to inject explicit IV attributes matching segment filename numbers
        if (uriStr.contains(".m3u8") && !isRangeRequest) {
            try {
                byte[] rawManifest = downloadAllBytes();
                String manifestStr = new String(rawManifest, StandardCharsets.UTF_8);
                byte[] rewrittenManifest = rewriteM3u8(manifestStr);
                
                peekBuffer = rewrittenManifest;
                peekOffset = 0;
                peekLength = rewrittenManifest.length;
                
                Log.i(TAG, "Successfully dynamically rewritten M3U8 playlist to inject explicit IV attributes");
                return rewrittenManifest.length;
            } catch (Exception e) {
                Log.e(TAG, "Failed rewriting M3U8 playlist: " + e.getMessage(), e);
                // Fallback will happen as we cleared buffers
            }
        }

        // Do not check signature on range requests starting inside a file
        if (isRangeRequest) {
            return bytesRemaining;
        }

        // Peek at the first 1024 bytes to check for PNG header signature
        peekBuffer = new byte[1024];
        peekLength = 0;
        while (peekLength < 1024) {
            int read = upstream.read(peekBuffer, peekLength, 1024 - peekLength);
            if (read == C.RESULT_END_OF_INPUT) {
                break;
            }
            peekLength += read;
        }

        // Hex print the first 32 bytes for debugging CDNs
        StringBuilder sb = new StringBuilder();
        int logLen = Math.min(peekLength, 32);
        for (int i = 0; i < logLen; i++) {
            sb.append(String.format("%02X ", peekBuffer[i]));
        }
        Log.i(TAG, "Peeked first " + logLen + " bytes: " + sb.toString() + " (uri: " + uriStr + ")");

        if (peekLength >= 8 &&
            (peekBuffer[0] & 0xFF) == 0x89 &&
            (peekBuffer[1] & 0xFF) == 0x50 &&
            (peekBuffer[2] & 0xFF) == 0x4E &&
            (peekBuffer[3] & 0xFF) == 0x47 &&
            (peekBuffer[4] & 0xFF) == 0x0D &&
            (peekBuffer[5] & 0xFF) == 0x0A &&
            (peekBuffer[6] & 0xFF) == 0x1A &&
            (peekBuffer[7] & 0xFF) == 0x0A) {

            // Found PNG header, search for IEND chunk marker
            int iendOffset = -1;
            for (int i = 0; i < Math.min(peekLength - 3, 1020); i++) {
                if ((peekBuffer[i] & 0xFF) == 0x49 &&
                    (peekBuffer[i + 1] & 0xFF) == 0x45 &&
                    (peekBuffer[i + 2] & 0xFF) == 0x4E &&
                    (peekBuffer[i + 3] & 0xFF) == 0x44) {
                    iendOffset = i;
                    break;
                }
            }
            if (iendOffset != -1) {
                int skipBytes = iendOffset + 8; // IEND (4) + CRC (4)
                shouldStrip = true;
                peekOffset = skipBytes;
                Log.i(TAG, "Stripped " + skipBytes + " byte PNG wrapper from segment: " + uriStr);

                if (bytesRemaining != C.LENGTH_UNSET) {
                    return bytesRemaining - skipBytes;
                }
                return C.LENGTH_UNSET;
            } else {
                Log.w(TAG, "PNG header detected but IEND not found within first 1024 bytes");
                peekOffset = 0;
            }
        } else {
            // Not a PNG-wrapped segment, return buffered data as-is
            peekOffset = 0;
        }

        return bytesRemaining;
    }

    private byte[] downloadAllBytes() throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] temp = new byte[4096];
        while (true) {
            int read = upstream.read(temp, 0, temp.length);
            if (read == C.RESULT_END_OF_INPUT) {
                break;
            }
            bos.write(temp, 0, read);
        }
        return bos.toByteArray();
    }

    private byte[] rewriteM3u8(String content) {
        String[] lines = content.split("\n");
        StringBuilder sb = new StringBuilder();
        String currentKeyUri = null;

        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.startsWith("#EXT-X-KEY:")) {
                // Parse key URI
                int uriIndex = trimmed.indexOf("URI=\"");
                if (uriIndex != -1) {
                    int endQuote = trimmed.indexOf("\"", uriIndex + 5);
                    if (endQuote != -1) {
                        currentKeyUri = trimmed.substring(uriIndex + 5, endQuote);
                    }
                }
                // We drop the original tag to avoid duplicate declarations since we inject per-segment
                continue;
            }

            // If it is a segment line (URL)
            if (!trimmed.startsWith("#") && !trimmed.isEmpty() && currentKeyUri != null) {
                int segIndex = trimmed.indexOf("segment-");
                if (segIndex != -1) {
                    long segNum = parseSegmentNumber(trimmed, segIndex);
                    if (segNum != -1) {
                        String hexIv = String.format("%032x", segNum);
                        sb.append("#EXT-X-KEY:METHOD=AES-128,URI=\"")
                          .append(currentKeyUri)
                          .append("\",IV=0x")
                          .append(hexIv)
                          .append("\n");
                    }
                }
            }

            sb.append(line).append("\n");
        }
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    private long parseSegmentNumber(String line, int segIndex) {
        int i = segIndex + 8;
        StringBuilder numSb = new StringBuilder();
        while (i < line.length() && Character.isDigit(line.charAt(i))) {
            numSb.append(line.charAt(i));
            i++;
        }
        if (numSb.length() > 0) {
            try {
                return Long.parseLong(numSb.toString());
            } catch (NumberFormatException e) {
                // Ignore
            }
        }
        return -1;
    }

    @Override
    public int read(byte[] buffer, int offset, int readLength) throws IOException {
        if (readLength == 0) {
            return 0;
        }

        // Drain the peek buffer first
        if (peekBuffer != null && peekOffset < peekLength) {
            int available = peekLength - peekOffset;
            int toCopy = Math.min(available, readLength);
            System.arraycopy(peekBuffer, peekOffset, buffer, offset, toCopy);
            peekOffset += toCopy;
            if (peekOffset >= peekLength) {
                // Done with peek buffer, free it
                peekBuffer = null;
            }
            return toCopy;
        }

        return upstream.read(buffer, offset, readLength);
    }

    @Override
    public Uri getUri() {
        return upstream.getUri();
    }

    @Override
    public Map<String, List<String>> getResponseHeaders() {
        return upstream.getResponseHeaders();
    }

    @Override
    public void close() throws IOException {
        peekBuffer = null;
        upstream.close();
    }
}
