package app.strawverse.android;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "StrawVerse";
    private static final int SERVER_PORT = 3459;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CloudflareBypassPlugin.class);
        super.onCreate(savedInstanceState);

        com.getcapacitor.Bridge bridge = getBridge();
        if (bridge != null) {
            bridge.getWebView().setWebViewClient(new com.getcapacitor.BridgeWebViewClient(bridge) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    String scheme = uri.getScheme();
                    String host = uri.getHost();
                    if (scheme != null && (scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
                        if (host != null && !host.equals("localhost") && !host.equals("127.0.0.1")) {
                            WebResourceResponse res = fetchNativelyWithHeaders(request);
                            if (res != null) {
                                return res;
                            }
                        }
                    }
                    return super.shouldInterceptRequest(view, request);
                }
            });
        }
        
        new Thread(() -> {
            try {
                if (bridge != null) {
                    java.lang.reflect.Field pluginsField = com.getcapacitor.Bridge.class.getDeclaredField("plugins");
                    pluginsField.setAccessible(true);
                    java.util.Map<String, com.getcapacitor.PluginHandle> plugins = 
                        (java.util.Map<String, com.getcapacitor.PluginHandle>) pluginsField.get(bridge);
                    
                    if (plugins != null) {
                        String globalJS = com.getcapacitor.JSExport.getGlobalJS(this, bridge.getConfig().isLoggingEnabled(), bridge.isDevMode());
                        String bridgeJS = com.getcapacitor.JSExport.getBridgeJS(this);
                        String pluginJS = com.getcapacitor.JSExport.getPluginJS(plugins.values());
                        String localUrlJS = "window.WEBVIEW_SERVER_URL = 'http://127.0.0.1:" + SERVER_PORT + "';";
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
                            "            fetch(window.WEBVIEW_SERVER_URL + '/api/ipc/native-response', {\n" +
                            "              method: 'POST',\n" +
                            "              headers: { 'Content-Type': 'application/json' },\n" +
                            "              body: JSON.stringify({\n" +
                            "                channel: 'native-response',\n" +
                            "                args: [req.requestId, true, { status: res.status, headers: res.headers, data: res.data, isBase64: res.isBase64 }]\n" +
                            "              })\n" +
                            "            }).catch(function(err) {\n" +
                            "              console.error('[nativeBridge] Failed to post native-response:', err);\n" +
                            "            });\n" +
                            "          }).catch(function(err) {\n" +
                            "            console.error('[nativeBridge] nativeRequest failed:', err);\n" +
                            "            fetch(window.WEBVIEW_SERVER_URL + '/api/ipc/native-response', {\n" +
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

                        runOnUiThread(() -> {
                            try {
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
                            } catch (Exception e) {
                                Log.e(TAG, "Failed to register document start script", e);
                            }
                        });
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to natively inject bridge for port 3459", e);
            }
        }).start();

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

    private WebResourceResponse fetchNativelyWithHeaders(WebResourceRequest request) {
        try {
            String url = request.getUrl().toString();
            Map<String, String> customHeaders = new HashMap<>();
            try {
                URL headersUrl = new URL("http://127.0.0.1:" + SERVER_PORT + "/api/proxy-headers?url=" + URLEncoder.encode(url, "UTF-8"));
                HttpURLConnection hConn = (HttpURLConnection) headersUrl.openConnection();
                hConn.setRequestMethod("GET");
                hConn.setConnectTimeout(1500);
                hConn.setReadTimeout(1500);
                int status = hConn.getResponseCode();
                if (status == 200) {
                    try (InputStream is = hConn.getInputStream();
                         BufferedReader reader = new BufferedReader(new InputStreamReader(is, "UTF-8"))) {
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = reader.readLine()) != null) {
                            sb.append(line);
                        }
                        org.json.JSONObject json = new org.json.JSONObject(sb.toString());
                        java.util.Iterator<String> keys = json.keys();
                        while (keys.hasNext()) {
                            String key = keys.next();
                            customHeaders.put(key, json.getString(key));
                        }
                    }
                }
                hConn.disconnect();
            } catch (Exception e) {
                Log.w(TAG, "Failed to fetch custom headers from proxy: " + e.getMessage());
            }

            URL targetUrl = new URL(url);
            HttpURLConnection conn = (HttpURLConnection) targetUrl.openConnection();
            conn.setRequestMethod(request.getMethod());
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setInstanceFollowRedirects(true);

            for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                conn.setRequestProperty(header.getKey(), header.getValue());
            }

            for (Map.Entry<String, String> header : customHeaders.entrySet()) {
                conn.setRequestProperty(header.getKey(), header.getValue());
            }

            String webViewCookie = android.webkit.CookieManager.getInstance().getCookie(url);
            if (webViewCookie != null && !webViewCookie.isEmpty()) {
                conn.setRequestProperty("Cookie", webViewCookie);
            }
            if (customHeaders.containsKey("Cookie")) {
                conn.setRequestProperty("Cookie", customHeaders.get("Cookie"));
            }

            int responseCode = conn.getResponseCode();
            String responseMessage = conn.getResponseMessage();
            if (responseMessage == null || responseMessage.isEmpty()) {
                responseMessage = "OK";
            }

            Map<String, String> responseHeaders = new HashMap<>();
            for (Map.Entry<String, List<String>> header : conn.getHeaderFields().entrySet()) {
                String key = header.getKey();
                if (key != null) {
                    List<String> values = header.getValue();
                    StringBuilder valSb = new StringBuilder();
                    for (int i = 0; i < values.size(); i++) {
                        valSb.append(values.get(i));
                        if (i < values.size() - 1) {
                            valSb.append(", ");
                        }
                    }
                    responseHeaders.put(key, valSb.toString());
                }
            }

            responseHeaders.put("Access-Control-Allow-Origin", "*");
            responseHeaders.put("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            responseHeaders.put("Access-Control-Allow-Headers", "*");

            String contentType = conn.getContentType();
            String mimeType = "image/jpeg";
            String encoding = "UTF-8";
            if (contentType != null) {
                String[] parts = contentType.split(";");
                mimeType = parts[0].trim();
                for (int i = 1; i < parts.length; i++) {
                    String part = parts[i].trim();
                    if (part.toLowerCase().startsWith("charset=")) {
                        encoding = part.substring(8).trim();
                    }
                }
            }

            InputStream responseStream = (responseCode >= 400) ? conn.getErrorStream() : conn.getInputStream();
            Log.i(TAG, "WebView Intercept Successful: " + url + " -> Response Code: " + responseCode);
            return new WebResourceResponse(mimeType, encoding, responseCode, responseMessage, responseHeaders, responseStream);
        } catch (Exception e) {
            Log.e(TAG, "Failed to natively fetch url in WebView interceptor: " + e.getMessage(), e);
            return null;
        }
    }
}
