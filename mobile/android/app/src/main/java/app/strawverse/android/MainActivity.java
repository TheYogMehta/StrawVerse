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

public class MainActivity extends BridgeActivity {

    private static final String TAG = "StrawVerse";
    private static final int SERVER_PORT = 3459;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CloudflareBypassPlugin.class);
        super.onCreate(savedInstanceState);
        
        try {
            com.getcapacitor.Bridge bridge = getBridge();
            if (bridge != null) {
                java.lang.reflect.Field pluginsField = com.getcapacitor.Bridge.class.getDeclaredField("plugins");
                pluginsField.setAccessible(true);
                java.util.Map<String, com.getcapacitor.PluginHandle> plugins = 
                    (java.util.Map<String, com.getcapacitor.PluginHandle>) pluginsField.get(bridge);
                
                if (plugins != null) {
                    String globalJS = com.getcapacitor.JSExport.getGlobalJS(this, bridge.getConfig().isLoggingEnabled(), bridge.isDevMode());
                    String bridgeJS = com.getcapacitor.JSExport.getBridgeJS(this);
                    String pluginJS = com.getcapacitor.JSExport.getPluginJS(plugins.values());
                    String localUrlJS = "window.WEBVIEW_SERVER_URL = 'http://localhost:" + SERVER_PORT + "';";
                    String customMobileBridgeJS = 
                        "(function() {\n" +
                        "  var esCheckInterval = setInterval(function() {\n" +
                        "    if (window.sharedStateAPI && typeof window.sharedStateAPI.on === 'function') {\n" +
                        "      clearInterval(esCheckInterval);\n" +
                        "      console.log('[nativeBridge] Injected custom mobile listeners natively!');\n" +
                        "      window.sharedStateAPI.on('native-request', function(req) {\n" +
                        "        console.log('[nativeBridge] Handling native-request for URL via injected script:', req.url);\n" +
                        "        var CloudflareBypass = window.Capacitor?.Plugins?.CloudflareBypass;\n" +
                        "        if (CloudflareBypass) {\n" +
                        "          CloudflareBypass.nativeRequest({\n" +
                        "            url: req.url,\n" +
                        "            method: req.method,\n" +
                        "            headers: req.headers,\n" +
                        "            body: req.body\n" +
                        "          }).then(function(res) {\n" +
                        "            console.log('[nativeBridge] nativeRequest resolved successfully for', req.url);\n" +
                        "            fetch(window.WEBVIEW_SERVER_URL + '/api/ipc/invoke', {\n" +
                        "              method: 'POST',\n" +
                        "              headers: { 'Content-Type': 'application/json' },\n" +
                        "              body: JSON.stringify({\n" +
                        "                channel: 'native-response',\n" +
                        "                args: [req.requestId, true, { status: res.status, headers: res.headers, data: res.data }]\n" +
                        "              })\n" +
                        "            }).catch(function(err) {\n" +
                        "              console.error('[nativeBridge] Failed to post native-response:', err);\n" +
                        "            });\n" +
                        "          }).catch(function(err) {\n" +
                        "            console.error('[nativeBridge] nativeRequest failed:', err);\n" +
                        "            fetch(window.WEBVIEW_SERVER_URL + '/api/ipc/invoke', {\n" +
                        "              method: 'POST',\n" +
                        "              headers: { 'Content-Type': 'application/json' },\n" +
                        "              body: JSON.stringify({\n" +
                        "                channel: 'native-response',\n" +
                        "                args: [req.requestId, false, null, err.message || String(err)]\n" +
                        "              })\n" +
                        "            }).catch(function(e) {\n" +
                        "              console.error('[nativeBridge] Failed to post native-response error:', e);\n" +
                        "            });\n" +
                        "          });\n" +
                        "        } else {\n" +
                        "          console.error('[nativeBridge] CloudflareBypass is undefined for nativeRequest');\n" +
                        "        }\n" +
                        "      });\n" +
                        "    }\n" +
                        "  }, 200);\n" +
                        "})();";
                    String script = globalJS + "\n\n" + localUrlJS + "\n\n" + bridgeJS + "\n\n" + pluginJS + "\n\n" + customMobileBridgeJS;

                    if (androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.DOCUMENT_START_SCRIPT)) {
                        java.util.Set<String> allowedOrigins = new java.util.HashSet<>();
                        allowedOrigins.add("http://localhost:" + SERVER_PORT);
                        allowedOrigins.add("http://127.0.0.1:" + SERVER_PORT);
                        
                        androidx.webkit.WebViewCompat.addDocumentStartJavaScript(
                            bridge.getWebView(),
                            script,
                            allowedOrigins
                        );
                        Log.i(TAG, "Natively injected Capacitor bridge for port " + SERVER_PORT + " via DOCUMENT_START_SCRIPT");
                    } else {
                        Log.w(TAG, "DOCUMENT_START_SCRIPT is not supported on this device!");
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to natively inject bridge for port 3459", e);
        }

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
