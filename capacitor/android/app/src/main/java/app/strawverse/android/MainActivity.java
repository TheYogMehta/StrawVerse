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
import java.io.File;
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
    private android.app.AlertDialog permissionDialog;

    private void launchPermissionSettings() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            try {
                android.content.Intent intent = new android.content.Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                android.net.Uri uri = android.net.Uri.fromParts("package", getPackageName(), null);
                intent.setData(uri);
                startActivity(intent);
            } catch (Exception e) {
                android.content.Intent intent = new android.content.Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                startActivity(intent);
            }
        }
    }

    private void startPermissionPolling() {
        new Thread(() -> {
            while (true) {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                    if (android.os.Environment.isExternalStorageManager()) {
                        runOnUiThread(() -> {
                            if (permissionDialog != null && permissionDialog.isShowing()) {
                                permissionDialog.dismiss();
                            }
                            try {
                                Intent intent = new Intent(MainActivity.this, MainActivity.class);
                                intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                                startActivity(intent);
                            } catch (Exception e) {
                                Log.e(TAG, "Failed to auto-resume app: " + e.getMessage());
                            }
                        });
                        break;
                    }
                } else {
                    break;
                }
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    break;
                }
            }
        }).start();
    }

    private void showPermissionDialog() {
        if (permissionDialog != null && permissionDialog.isShowing()) return;

        runOnUiThread(() -> {
            android.app.AlertDialog.Builder builder = new android.app.AlertDialog.Builder(MainActivity.this);
            builder.setTitle("Storage Permission Required");
            builder.setMessage("Strawverse requires All Files Access permission to store downloads, databases, and scrapers in public storage. Please grant this permission to continue.");
            builder.setCancelable(false);
            builder.setPositiveButton("Grant Permission", (dialog, which) -> {
                launchPermissionSettings();
                startPermissionPolling();
            });
            permissionDialog = builder.create();
            permissionDialog.show();
        });
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CloudflareBypassPlugin.class);
        super.onCreate(savedInstanceState);

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            if (!android.os.Environment.isExternalStorageManager()) {
                showPermissionDialog();
            }
        }

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
                            "      window.sharedStateAPI.on('native-request', function(req) {\n" +
                            "        var CloudflareBypass = window.Capacitor?.Plugins?.CloudflareBypass;\n" +
                            "        if (CloudflareBypass) {\n" +
                            "          CloudflareBypass.nativeRequest({\n" +
                            "            url: req.url,\n" +
                            "            method: req.method,\n" +
                            "            headers: req.headers,\n" +
                            "            body: req.body\n" +
                            "          }).then(function(res) {\n" +
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
    public void onResume() {
        super.onResume();
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            if (android.os.Environment.isExternalStorageManager()) {
                if (permissionDialog != null && permissionDialog.isShowing()) {
                    permissionDialog.dismiss();
                }
                new Thread(() -> {
                    try {
                        java.io.File extStorage = android.os.Environment.getExternalStorageDirectory();
                        java.io.File publicRoot = new java.io.File(extStorage, "Strawverse");
                        
                        new java.io.File(publicRoot, "data").mkdirs();
                        new java.io.File(publicRoot, "Anime").mkdirs();
                        new java.io.File(publicRoot, "Manga").mkdirs();
                        java.io.File scrapperRoot = new java.io.File(publicRoot, "scrapper");
                        new java.io.File(scrapperRoot, "Anime").mkdirs();
                        new java.io.File(scrapperRoot, "Manga").mkdirs();
                        new java.io.File(scrapperRoot, "ico").mkdirs();
                        Log.i(TAG, "Successfully pre-created Strawverse folders in public storage on resume");
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to create public folders on resume: " + e.getMessage());
                    }
                }).start();
            } else {
                showPermissionDialog();
            }
        }
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
        return WebViewRequestHelper.fetchNativelyWithHeaders(getApplicationContext(), request);
    }
}