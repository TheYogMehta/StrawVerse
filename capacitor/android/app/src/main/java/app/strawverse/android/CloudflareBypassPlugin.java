package app.strawverse.android;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.ValueCallback;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.RelativeLayout;
import android.widget.TextView;
import android.util.Log;
import java.io.File;
import java.util.Map;

@CapacitorPlugin(name = "CloudflareBypass")
public class CloudflareBypassPlugin extends Plugin {

    @PluginMethod
    public void bypass(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("URL is required");
            return;
        }
        final String userAgent = call.getString("userAgent");

        Log.i("StrawVerseBypass", "bypass() called with URL: " + url + " UA: " + userAgent);

        final String finalUrl = url;
        String challengeUrl = url;
        try {
            Uri uri = Uri.parse(url);
            if (uri.getHost() != null && uri.getHost().contains("animepahe") && uri.getPath() != null && uri.getPath().startsWith("/api")) {
                challengeUrl = uri.getScheme() + "://" + uri.getAuthority() + "/";
            }
        } catch (Exception e) {
            Log.w("StrawVerseBypass", "Unable to normalize challenge URL", e);
        }
        final String finalChallengeUrl = challengeUrl;

        try {
            Uri challengeUri = Uri.parse(finalChallengeUrl);
            String host = challengeUri.getHost();
            if (host != null) {
                String baseDomain = host.startsWith("www.") ? host.substring(4) : host;
                String[] targetUrls = { finalChallengeUrl, finalUrl, "https://" + host + "/", "http://" + host + "/" };
                
                for (String tUrl : targetUrls) {
                    Log.i("StrawVerseBypass", "Cookies BEFORE clear for URL " + tUrl + ": " + CookieManager.getInstance().getCookie(tUrl));
                }

                String[] cookieStrings = {
                    "cf_clearance=; Max-Age=0; Path=/; Domain=" + baseDomain + "; Secure; SameSite=None",
                    "cf_clearance=; Max-Age=0; Path=/; Domain=." + baseDomain + "; Secure; SameSite=None",
                    "cf_clearance=; Max-Age=0; Path=/; Secure; SameSite=None",
                    "cf_clearance=; Max-Age=0; Path=/; Domain=" + baseDomain,
                    "cf_clearance=; Max-Age=0; Path=/; Domain=." + baseDomain,
                    "cf_clearance=; Max-Age=0; Path=/",
                    "cf_clearance=; Max-Age=0"
                };
                for (String tUrl : targetUrls) {
                    for (String cookieStr : cookieStrings) {
                        CookieManager.getInstance().setCookie(tUrl, cookieStr);
                    }
                }
                CookieManager.getInstance().flush();

                // Log after state
                for (String tUrl : targetUrls) {
                    Log.i("StrawVerseBypass", "Cookies AFTER clear for URL " + tUrl + ": " + CookieManager.getInstance().getCookie(tUrl));
                }
            }
        } catch (Exception e) {
            Log.w("StrawVerseBypass", "Failed to clear old cf_clearance cookie", e);
        }

        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    CookieManager.getInstance().removeAllCookies(new ValueCallback<Boolean>() {
                        @Override
                        public void onReceiveValue(final Boolean value) {
                            Log.i("StrawVerseBypass", "removeAllCookies callback returned: " + value);
                            getActivity().runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    try {
                                        CookieManager.getInstance().flush();

                                        Log.i("StrawVerseBypass", "Running UI Thread for dialog creation");
                                        
                                        LinearLayout rootLayout = new LinearLayout(getActivity());
                                        rootLayout.setOrientation(LinearLayout.VERTICAL);
                                        rootLayout.setLayoutParams(new LinearLayout.LayoutParams(
                                                LinearLayout.LayoutParams.MATCH_PARENT,
                                                LinearLayout.LayoutParams.MATCH_PARENT
                                        ));
                                        rootLayout.setBackgroundColor(Color.parseColor("#121214"));

                                        RelativeLayout toolbar = new RelativeLayout(getActivity());
                                        int toolbarHeight = (int) (56 * getActivity().getResources().getDisplayMetrics().density);
                                        toolbar.setLayoutParams(new RelativeLayout.LayoutParams(
                                                RelativeLayout.LayoutParams.MATCH_PARENT,
                                                toolbarHeight
                                        ));
                                        toolbar.setBackgroundColor(Color.parseColor("#1e1e24"));
                                        toolbar.setPadding(
                                                (int) (16 * getActivity().getResources().getDisplayMetrics().density),
                                                0,
                                                (int) (16 * getActivity().getResources().getDisplayMetrics().density),
                                                0
                                        );

                                        TextView titleView = new TextView(getActivity());
                                        titleView.setText("Verification Challenge");
                                        titleView.setTextColor(Color.WHITE);
                                        titleView.setTextSize(16);
                                        titleView.setTypeface(null, Typeface.BOLD);
                                        RelativeLayout.LayoutParams titleParams = new RelativeLayout.LayoutParams(
                                                RelativeLayout.LayoutParams.WRAP_CONTENT,
                                                RelativeLayout.LayoutParams.WRAP_CONTENT
                                        );
                                        titleParams.addRule(RelativeLayout.CENTER_IN_PARENT, RelativeLayout.TRUE);
                                        titleView.setLayoutParams(titleParams);
                                        toolbar.addView(titleView);

                                        TextView closeButton = new TextView(getActivity());
                                        closeButton.setText("✕");
                                        closeButton.setTextColor(Color.WHITE);
                                        closeButton.setTextSize(22);
                                        closeButton.setPadding(20, 20, 20, 20);
                                        closeButton.setClickable(true);
                                        closeButton.setFocusable(true);
                                        RelativeLayout.LayoutParams closeParams = new RelativeLayout.LayoutParams(
                                                RelativeLayout.LayoutParams.WRAP_CONTENT,
                                                RelativeLayout.LayoutParams.WRAP_CONTENT
                                        );
                                        closeParams.addRule(RelativeLayout.ALIGN_PARENT_RIGHT, RelativeLayout.TRUE);
                                        closeParams.addRule(RelativeLayout.CENTER_VERTICAL, RelativeLayout.TRUE);
                                        closeButton.setLayoutParams(closeParams);
                                        toolbar.addView(closeButton);

                                        rootLayout.addView(toolbar);

                                        final WebView webView = new WebView(getActivity());
                                        webView.getSettings().setJavaScriptEnabled(true);
                                        webView.getSettings().setDomStorageEnabled(true);
                                        
                                        final String effectiveUserAgent = (userAgent != null && !userAgent.isEmpty())
                                            ? userAgent
                                            : webView.getSettings().getUserAgentString();
                                        webView.getSettings().setUserAgentString(effectiveUserAgent);
                                        
                                        // Enable desktop mode viewport settings
                                        webView.getSettings().setUseWideViewPort(true);
                                        webView.getSettings().setLoadWithOverviewMode(true);
                                        
                                        webView.getSettings().setSupportZoom(true);
                                        webView.getSettings().setBuiltInZoomControls(true);
                                        webView.getSettings().setDisplayZoomControls(false);

                                        CookieManager.getInstance().setAcceptCookie(true);
                                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                                            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
                                        }

                                        LinearLayout.LayoutParams webViewParams = new LinearLayout.LayoutParams(
                                                LinearLayout.LayoutParams.MATCH_PARENT,
                                                LinearLayout.LayoutParams.MATCH_PARENT
                                        );
                                        webViewParams.weight = 1;
                                        webView.setLayoutParams(webViewParams);
                                        rootLayout.addView(webView);

                                        final android.app.Dialog dialog = new android.app.Dialog(getActivity(), android.R.style.Theme_NoTitleBar);
                                        dialog.setContentView(rootLayout);
                                        dialog.setCancelable(true);

                                        final boolean[] finished = {false};
                                        final Map<String, String> capturedClientHints = new java.util.concurrent.ConcurrentHashMap<>();
                                        final android.os.Handler handler = new android.os.Handler();
                                        final Runnable cookiePoller = new Runnable() {
                                            @Override
                                            public void run() {
                                                if (finished[0]) return;

                                                String cookieString = CookieManager.getInstance().getCookie(finalUrl);
                                                if (cookieString != null && cookieString.contains("cf_clearance")) {
                                                    Log.i("StrawVerseBypass", "Cookie poller detected cf_clearance!");
                                                    finished[0] = true;
                                                    handler.removeCallbacks(this);
                                                    CookieManager.getInstance().flush();
                                                    JSObject ret = new JSObject();
                                                    ret.put("cookies", cookieString);
                                                    ret.put("userAgent", effectiveUserAgent);
                                                    
                                                    JSObject hints = new JSObject();
                                                    for (Map.Entry<String, String> entry : capturedClientHints.entrySet()) {
                                                        hints.put(entry.getKey(), entry.getValue());
                                                    }
                                                    ret.put("clientHints", hints);

                                                    call.resolve(ret);
                                                    dialog.dismiss();
                                                    webView.destroy();
                                                    return;
                                                }
                                                handler.postDelayed(this, 500);
                                            }
                                        };

                                        closeButton.setOnClickListener(new View.OnClickListener() {
                                            @Override
                                            public void onClick(View v) {
                                                Log.i("StrawVerseBypass", "✕ close button clicked by user");
                                                finished[0] = true;
                                                handler.removeCallbacks(cookiePoller);

                                                call.reject("Cloudflare verification cancelled");
                                                dialog.dismiss();
                                                webView.destroy();
                                            }
                                        });

                                        dialog.setOnCancelListener(new android.content.DialogInterface.OnCancelListener() {
                                            @Override
                                            public void onCancel(android.content.DialogInterface dialogInterface) {
                                                Log.i("StrawVerseBypass", "Dialog cancelled / back pressed");
                                                finished[0] = true;
                                                handler.removeCallbacks(cookiePoller);

                                                call.reject("Cloudflare verification cancelled");
                                                webView.destroy();
                                            }
                                        });

                                        webView.setWebViewClient(new WebViewClient() {
                                            @Override
                                            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                                                String reqUrl = request.getUrl().toString();
                                                if (reqUrl.contains("animepahe")) {
                                                    Log.i("StrawVerseBypass", "WebView Request: " + request.getMethod() + " -> " + reqUrl);
                                                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                                                        Map<String, String> headers = request.getRequestHeaders();
                                                        Log.i("StrawVerseBypass", "WebView Request Headers: " + headers.toString());
                                                        for (Map.Entry<String, String> entry : headers.entrySet()) {
                                                            String key = entry.getKey().toLowerCase();
                                                            if (key.startsWith("sec-ch-ua")) {
                                                                capturedClientHints.put(entry.getKey(), entry.getValue());
                                                            }
                                                        }
                                                    }
                                                }
                                                return super.shouldInterceptRequest(view, request);
                                            }

                                            @Override
                                            public void onPageFinished(WebView view, String finishedUrl) {
                                                super.onPageFinished(view, finishedUrl);
                                                Log.i("StrawVerseBypass", "WebView loaded page: " + finishedUrl);
                                                handler.post(cookiePoller);
                                            }

                                            @Override
                                            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                                                super.onReceivedError(view, errorCode, description, failingUrl);
                                                Log.e("StrawVerseBypass", "WebView error: " + description + " for URL: " + failingUrl);
                                                if (finished[0]) return;
                                                finished[0] = true;
                                                handler.removeCallbacks(cookiePoller);
                                                call.reject("WebView load error: " + description);
                                                dialog.dismiss();
                                                view.destroy();
                                            }
                                        });

                                        Log.i("StrawVerseBypass", "Loading challenge URL in WebView and showing Dialog");
                                        webView.loadUrl(finalChallengeUrl);
                                        dialog.show();
                                        handler.post(cookiePoller);

                                    } catch (Exception e) {
                                        Log.e("StrawVerseBypass", "Error building dialog", e);
                                        call.reject("Failed to create WebView: " + e.getMessage());
                                    }
                                }
                            });
                        }
                    });
                } catch (Exception e) {
                    Log.e("StrawVerseBypass", "Error launching removeAllCookies", e);
                    call.reject("Failed to initialize cookies removal: " + e.getMessage());
                }
            }
        });
    }

    private Intent pendingInstallIntent = null;

    @PluginMethod
    public void installApk(PluginCall call) {
        String filePath = call.getString("path");
        if (filePath == null) {
            call.reject("File path is required");
            return;
        }

        try {
            File file = new File(filePath);
            if (!file.exists()) {
                call.reject("File does not exist: " + filePath);
                return;
            }

            Context context = getContext();
            Uri fileUri = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                file
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(fileUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!context.getPackageManager().canRequestPackageInstalls()) {
                    pendingInstallIntent = intent;
                    
                    Intent settingsIntent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + context.getPackageName())
                    );
                    startActivityForResult(call, settingsIntent, "installSettingsResult");
                    return;
                }
            }

            context.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to install APK: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void installSettingsResult(PluginCall call, ActivityResult result) {
        if (pendingInstallIntent != null) {
            Context context = getContext();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (context.getPackageManager().canRequestPackageInstalls()) {
                    try {
                        context.startActivity(pendingInstallIntent);
                        call.resolve();
                    } catch (Exception e) {
                        call.reject("Failed to install APK: " + e.getMessage());
                    }
                } else {
                    call.reject("Permission to install unknown apps was denied");
                }
            }
            pendingInstallIntent = null;
        }
    }

    @PluginMethod
    public void playVideo(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("URL is required");
            return;
        }

        final String videoUrl = url;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final Bundle headersBundle = new Bundle();
                try {
                    String localApiUrl = "http://127.0.0.1:3459/api/proxy-headers?method=GET&url=" + java.net.URLEncoder.encode(videoUrl, "UTF-8");
                    java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(localApiUrl).openConnection();
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(2000);
                    conn.setReadTimeout(2000);
                    if (conn.getResponseCode() == 200) {
                        java.io.InputStream in = conn.getInputStream();
                        java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(in));
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = reader.readLine()) != null) {
                            sb.append(line);
                        }
                        reader.close();
                        
                        org.json.JSONObject json = new org.json.JSONObject(sb.toString());
                        java.util.Iterator<String> keys = json.keys();
                        while (keys.hasNext()) {
                            String key = keys.next();
                            headersBundle.putString(key, json.getString(key));
                        }
                    }
                } catch (Exception e) {
                    Log.e("StrawVerseBypass", "Failed to fetch proxy headers dynamically: " + e.getMessage());
                }

                getActivity().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            Context context = getActivity();
                            Intent intent = new Intent(context, PlayerActivity.class);
                            intent.putExtra("videoUrl", videoUrl);
                            intent.putExtra("headers", headersBundle);
                            context.startActivity(intent);
                            call.resolve();
                        } catch (Exception e) {
                            call.reject("Failed to open player: " + e.getMessage());
                        }
                    }
                });
            }
        }).start();
    }

    private static String mergeCookies(String explicitCookies, String browserCookies) {
        java.util.LinkedHashMap<String, String> merged = new java.util.LinkedHashMap<>();
        addCookies(merged, explicitCookies);
        addCookies(merged, browserCookies);
        StringBuilder result = new StringBuilder();
        for (Map.Entry<String, String> cookie : merged.entrySet()) {
            if (result.length() > 0) result.append("; ");
            result.append(cookie.getKey()).append("=").append(cookie.getValue());
        }
        return result.toString();
    }

    private static void addCookies(java.util.LinkedHashMap<String, String> target, String cookieString) {
        if (cookieString == null || cookieString.trim().isEmpty()) return;
        for (String pair : cookieString.split(";")) {
            int separator = pair.indexOf('=');
            if (separator <= 0) continue;
            String name = pair.substring(0, separator).trim();
            String value = pair.substring(separator + 1).trim();
            if (!name.isEmpty()) target.put(name, value);
        }
    }

    private static String cookieNames(String cookieString) {
        java.util.ArrayList<String> names = new java.util.ArrayList<>();
        for (String pair : cookieString.split(";")) {
            int separator = pair.indexOf('=');
            if (separator > 0) names.add(pair.substring(0, separator).trim());
        }
        return names.toString();
    }

    @PluginMethod
    public void nativeRequest(final PluginCall call) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String url = call.getString("url");
                String method = call.getString("method");
                if (method == null) method = "GET";
                JSObject headers = call.getObject("headers");
                String body = call.getString("body");

                java.net.HttpURLConnection conn = null;
                java.io.InputStream is = null;
                try {
                    Log.i("StrawVerseBypass", "nativeRequest: " + method + " -> " + url);
                    java.net.URL urlObj = new java.net.URL(url);
                    conn = (java.net.HttpURLConnection) urlObj.openConnection();
                    conn.setRequestMethod(method.toUpperCase());
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(15000);
                    conn.setDoInput(true);
                    conn.setRequestProperty("Accept-Encoding", "identity");

                    String webViewUA = android.webkit.WebSettings.getDefaultUserAgent(getContext());
                    boolean hasUA = false;
                    String explicitCookies = null;
                    if (headers != null) {
                        java.util.Iterator<String> keys = headers.keys();
                        while (keys.hasNext()) {
                            String key = keys.next();
                            String value = headers.getString(key);
                            if (key.equalsIgnoreCase("user-agent")) hasUA = true;
                            if (key.equalsIgnoreCase("cookie")) {
                                explicitCookies = value;
                                continue;
                            }
                            if (key.equalsIgnoreCase("accept-encoding")) continue;
                            conn.setRequestProperty(key, value);
                        }
                    }
                    if (!hasUA) conn.setRequestProperty("User-Agent", webViewUA);
                    if (conn.getRequestProperty("Accept") == null) {
                        conn.setRequestProperty("Accept", "*/*");
                    }
                    if (conn.getRequestProperty("Accept-Language") == null) {
                        conn.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
                    }

                    String browserCookies = CookieManager.getInstance().getCookie(url);
                    String mergedCookies = mergeCookies(explicitCookies, browserCookies);
                    if (!mergedCookies.isEmpty()) {
                        conn.setRequestProperty("Cookie", mergedCookies);
                        Log.i("StrawVerseBypass", "nativeRequest cookies: " + cookieNames(mergedCookies));
                    }
                    if ("POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method)) {
                        if (body != null) {
                            conn.setDoOutput(true);
                            try (java.io.OutputStream os = conn.getOutputStream()) {
                                byte[] input = body.getBytes("utf-8");
                                os.write(input, 0, input.length);
                            }
                        }
                    }
                    int responseCode = conn.getResponseCode();
                    String contentType = conn.getContentType();
                    int contentLength = conn.getContentLength();
                    Log.i("StrawVerseBypass", "nativeRequest response code: " + responseCode + ", type: " + contentType + ", length: " + contentLength);
                    
                    is = (responseCode >= 200 && responseCode < 300) 
                        ? conn.getInputStream() 
                        : conn.getErrorStream();
                        
                    byte[] responseBytes;
                    if (is != null) {
                        try (java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream()) {
                            byte[] buffer = new byte[4096];
                            int len;
                            while ((len = is.read(buffer)) != -1) {
                                bos.write(buffer, 0, len);
                            }
                            responseBytes = bos.toByteArray();
                        }
                    } else {
                        responseBytes = new byte[0];
                    }

                    Log.i("StrawVerseBypass", "nativeRequest read " + responseBytes.length + " bytes");

                    String base64Data = android.util.Base64.encodeToString(responseBytes, android.util.Base64.NO_WRAP);

                    JSObject resHeaders = new JSObject();
                    for (java.util.Map.Entry<String, java.util.List<String>> entries : conn.getHeaderFields().entrySet()) {
                        String key = entries.getKey();
                        if (key != null) {
                            resHeaders.put(key, String.join(", ", entries.getValue()));
                            if (key.equalsIgnoreCase("set-cookie")) {
                                for (String setCookie : entries.getValue()) {
                                    CookieManager.getInstance().setCookie(url, setCookie);
                                }
                            }
                        }
                    }
                    CookieManager.getInstance().flush();

                    JSObject ret = new JSObject();
                    ret.put("status", responseCode);
                    ret.put("data", base64Data);
                    ret.put("isBase64", true);
                    ret.put("headers", resHeaders);
                    call.resolve(ret);

                } catch (Exception e) {
                    Log.e("StrawVerseBypass", "nativeRequest failed for " + url, e);
                    call.reject("Native request failed: " + e.getMessage());
                } finally {
                    if (is != null) {
                        try {
                            is.close();
                        } catch (Exception ignored) {}
                    }
                    if (conn != null) {
                        try {
                            conn.disconnect();
                        } catch (Exception ignored) {}
                    }
                }
            }
        }).start();
    }
}
