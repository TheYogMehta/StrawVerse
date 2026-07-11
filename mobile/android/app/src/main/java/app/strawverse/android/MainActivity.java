package app.strawverse.android;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

/**
 * Handles the MAL OAuth deep link (strawverse://callback?code=...).
 *
 * MyAnimeList redirects the system browser to the strawverse:// scheme after
 * the user approves access (same scheme the desktop app registers). Android
 * routes that intent here; we forward the authorization code straight to the
 * embedded Node backend's /mal/callback endpoint, which exchanges it for a
 * token and pushes a "mal" event to the GUI over SSE. This is done natively
 * so it works even before/without the WebView's JS bridge.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "StrawVerse";
    private static final int SERVER_PORT = 3459;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleDeepLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleDeepLink(intent);
    }

    private void handleDeepLink(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null || !"strawverse".equals(uri.getScheme())) return;

        String code = uri.getQueryParameter("code");
        if (code == null || code.isEmpty()) {
            Log.w(TAG, "Deep link received without code parameter: " + uri);
            return;
        }

        forwardMalCallback(code);
    }

    private void forwardMalCallback(String code) {
        new Thread(() -> {
            // The Node server may still be booting if the app was cold-started
            // by the deep link; retry briefly.
            for (int attempt = 0; attempt < 20; attempt++) {
                try {
                    String encoded = URLEncoder.encode(code, "UTF-8");
                    URL url = new URL("http://127.0.0.1:" + SERVER_PORT + "/mal/callback?code=" + encoded);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setConnectTimeout(3000);
                    conn.setReadTimeout(15000);
                    int status = conn.getResponseCode();
                    try (InputStream is = conn.getInputStream()) {
                        while (is.read() != -1) { /* drain */ }
                    } catch (Exception ignored) {}
                    conn.disconnect();
                    Log.i(TAG, "MAL callback forwarded, HTTP " + status);
                    return;
                } catch (Exception e) {
                    Log.w(TAG, "MAL callback attempt " + (attempt + 1) + " failed: " + e.getMessage());
                    try {
                        Thread.sleep(1500);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
            }
            Log.e(TAG, "MAL callback could not be delivered to the local server");
        }).start();
    }
}
