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
 import com.getcapacitor.JSArray;
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
import java.util.HashMap;
import org.json.JSONObject;
import java.util.List;
import java.util.ArrayList;
import net.hampoelz.capacitor.nodejs.DatabaseBridge;

@CapacitorPlugin(name = "CloudflareBypass")
public class CloudflareBypassPlugin extends Plugin {
    private WebView backgroundWebView = null;
    private String lastLoadedOrigin = null;
    private boolean isWebViewLoading = false;
    private String expectedWebViewOrigin = null;
    private final List<Runnable> pendingTasks = new ArrayList<>();
    private final List<PluginCall> pendingTaskCalls = new ArrayList<>();
    private final Map<String, PluginCall> activeFetchCalls = new java.util.concurrent.ConcurrentHashMap<>();

    private void sendNativeResponseToNode(String requestId, boolean success, JSONObject response, String error) {
        try {
            JSONObject nodeResponse = new JSONObject();
            try {
                nodeResponse.put("requestId", Integer.parseInt(requestId));
            } catch (NumberFormatException nfe) {
                nodeResponse.put("requestId", requestId);
            }
            nodeResponse.put("success", success);
            nodeResponse.put("response", response);
            nodeResponse.put("error", error);

            net.hampoelz.capacitor.nodejs.DatabaseBridge.getInstance()
                .sendEventToNode("native-response", nodeResponse);
        } catch (Exception e) {
            Log.e("StrawVerseBypass", "Failed to send native-response event to Node: " + e.getMessage());
        }
    }

    public static String cleanUserAgent(String ua) {
        if (ua == null) return null;
        return ua.replaceAll("(?i)\\s*;?\\s*wv\\b", "")
                 .replaceAll("(?i)Version/[0-9.]+\\s+", "");
    }

    @PluginMethod
    public void bypass(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("URL is required");
            return;
        }
        final String userAgent = cleanUserAgent(call.getString("userAgent"));
        final String referer = call.getString("referer");

        Log.i("StrawVerseBypass", "bypass() called with URL: " + url + " UA: " + userAgent + " Ref: " + referer);

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
                String[] targetUrls = { finalChallengeUrl, finalUrl, "https://" + host + "/" };
                
                for (String tUrl : targetUrls) {
                    Log.i("StrawVerseBypass", "Cookies BEFORE clear for URL " + tUrl + ": " + CookieManager.getInstance().getCookie(tUrl));
                }

                String[] cookieStrings = {
                    "cf_clearance=; Max-Age=0; Path=/; Domain=" + baseDomain + "; Secure; HttpOnly; SameSite=None",
                    "cf_clearance=; Max-Age=0; Path=/; Domain=." + baseDomain + "; Secure; HttpOnly; SameSite=None",
                    "cf_clearance=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=None",
                    "cf_clearance=; Max-Age=0; Path=/; Domain=" + baseDomain + "; Secure; HttpOnly",
                    "cf_clearance=; Max-Age=0; Path=/; Domain=." + baseDomain + "; Secure; HttpOnly",
                    "cf_clearance=; Max-Age=0; Path=/; HttpOnly",
                    "cf_clearance=; Max-Age=0; HttpOnly",
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
                    
                    final String effectiveUserAgent = cleanUserAgent((userAgent != null && !userAgent.isEmpty())
                        ? userAgent
                        : webView.getSettings().getUserAgentString());
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
                            if (reqUrl.contains("animepahe") || reqUrl.contains("anikototv") || reqUrl.contains("megaplay") || reqUrl.contains("weebcentral") || reqUrl.contains("allmanga") || reqUrl.contains("anineko")) {
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

                     Map<String, String> extraHeaders = new java.util.HashMap<>();
                     String finalRef = (referer != null && !referer.isEmpty()) ? referer : null;
                      if (finalRef == null) {
                          Map<String, String> rules = AppDatabase.getHeadersForUrl(getContext(), finalChallengeUrl);
                          if (rules.containsKey("Referer")) {
                              finalRef = rules.get("Referer");
                          }
                      }
                     if (finalRef != null && !finalRef.isEmpty()) {
                         extraHeaders.put("Referer", finalRef);
                     }
                     Log.i("StrawVerseBypass", "Loading challenge URL in WebView and showing Dialog with extra headers: " + extraHeaders);
                     webView.loadUrl(finalChallengeUrl, extraHeaders);
                    dialog.show();
                    handler.post(cookiePoller);

                } catch (Exception e) {
                    Log.e("StrawVerseBypass", "Error building dialog", e);
                    call.reject("Failed to create WebView: " + e.getMessage());
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
        final String animeId = call.getString("animeId", "");
        final String episodeId = call.getString("episodeId", "");
        final double episodeNumber = call.getDouble("episodeNumber", 0.0);
        final boolean downloaded = call.getBoolean("downloaded", false);
        final String subdub = call.getString("subdub", "sub");
        final String provider = call.getString("provider", "");
        final String animeTitle = call.getString("animeTitle", "Anime Stream");
        final String image = call.getString("image", "");
        final String malid = call.getData().optString("malid", "");

        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Context context = getActivity();
                    Intent intent = new Intent(context, PlayerActivity.class);
                    intent.putExtra("animeId", animeId);
                    intent.putExtra("episodeId", episodeId);
                    intent.putExtra("episodeNumber", episodeNumber);
                    intent.putExtra("downloaded", downloaded);
                    intent.putExtra("subdub", subdub);
                    intent.putExtra("provider", provider);
                    intent.putExtra("animeTitle", animeTitle);
                    intent.putExtra("image", image);
                    intent.putExtra("malid", malid);
                    context.startActivity(intent);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Failed to open player: " + e.getMessage());
                }
            }
        });
    }



    @PluginMethod
    public void nativeRequest(final PluginCall call) {
        String url = call.getString("url");
        if (url != null && (url.contains("animepahe") || url.contains("anikototv") || url.contains("megaplay") || url.contains("weebcentral") || url.contains("allmanga") || url.contains("anineko") || url.contains("kwik.cx") || url.contains("owocdn.top") || url.contains("uwucdn.top"))) {
            executeWebViewRequest(url, call.getString("method"), call.getObject("headers"), call.getString("body"), call);
            return;
        }

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
                            if (key.equalsIgnoreCase("user-agent")) {
                                hasUA = true;
                                value = cleanUserAgent(value);
                            }
                            if (key.equalsIgnoreCase("cookie")) {
                                explicitCookies = value;
                                continue;
                            }
                            if (key.equalsIgnoreCase("accept-encoding")) continue;
                            conn.setRequestProperty(key, value);
                        }
                    }
                    if (!hasUA) conn.setRequestProperty("User-Agent", cleanUserAgent(webViewUA));
                    if (conn.getRequestProperty("Accept") == null) {
                        conn.setRequestProperty("Accept", "*/*");
                    }
                    if (conn.getRequestProperty("Accept-Language") == null) {
                        conn.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
                    }

                    String browserCookies = CookieManager.getInstance().getCookie(url);
                    String mergedCookies = AppDatabase.mergeCookies(explicitCookies, browserCookies);
                    if (!mergedCookies.isEmpty()) {
                        conn.setRequestProperty("Cookie", mergedCookies);
                        Log.i("StrawVerseBypass", "nativeRequest cookies: " + AppDatabase.cookieNames(mergedCookies));
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
                    String reqId = call.getString("requestId", call.getCallbackId());
                    sendNativeResponseToNode(reqId, true, ret, null);

                } catch (Exception e) {
                    Log.e("StrawVerseBypass", "nativeRequest failed for " + url, e);
                    String errMsg = "Native request failed: " + e.getMessage();
                    call.reject(errMsg);
                    String reqId = call.getString("requestId", call.getCallbackId());
                    sendNativeResponseToNode(reqId, false, null, errMsg);
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

    private void initBackgroundWebView() {
        if (backgroundWebView != null) return;
        
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                backgroundWebView = new WebView(getActivity());
                backgroundWebView.getSettings().setJavaScriptEnabled(true);
                backgroundWebView.getSettings().setDomStorageEnabled(true);
                
                String webViewUA = android.webkit.WebSettings.getDefaultUserAgent(getContext());
                backgroundWebView.getSettings().setUserAgentString(webViewUA);
                
                CookieManager.getInstance().setAcceptCookie(true);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    CookieManager.getInstance().setAcceptThirdPartyCookies(backgroundWebView, true);
                }
                
                backgroundWebView.addJavascriptInterface(CloudflareBypassPlugin.this, "AndroidFetchBridge");
                
                backgroundWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            String reqUrl = request.getUrl().toString();
                            if (reqUrl.contains("animepahe") || reqUrl.contains("anikototv") || reqUrl.contains("megaplay") || reqUrl.contains("weebcentral") || reqUrl.contains("allmanga") || reqUrl.contains("anineko")) {
                                Log.i("StrawVerseBypass", "Background WebView Request: " + request.getMethod() + " -> " + reqUrl);
                                Log.i("StrawVerseBypass", "Background WebView Request Headers: " + request.getRequestHeaders().toString());
                            }
                        }
                        return super.shouldInterceptRequest(view, request);
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        super.onPageFinished(view, url);
                        view.evaluateJavascript("window.location.origin", value -> {
                            String actualOrigin = value == null ? "" : value.replace("\"", "");
                            if (expectedWebViewOrigin == null || !expectedWebViewOrigin.equals(actualOrigin)) {
                                failPendingTasks("Background WebView origin mismatch: expected "
                                        + expectedWebViewOrigin + ", got " + actualOrigin);
                                    return;
                                }
                                Log.i("StrawVerseBypass", "Background WebView origin ready: " + actualOrigin);
                                isWebViewLoading = false;
                                runPendingTasks();
                            });
                        }
                    
                        @Override
                        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                            failPendingTasks("Background WebView failed to initialize: " + description);
                        }
                    });
            }
        });
    }

    private void queuePendingTask(Runnable task, PluginCall call) {
        pendingTasks.add(task);
        pendingTaskCalls.add(call);
    }

    private void runPendingTasks() {
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                List<Runnable> tasks = new ArrayList<>(pendingTasks);
                pendingTasks.clear();
                pendingTaskCalls.clear();
                for (Runnable task : tasks) {
                    task.run();
                }
            }
        });
    }

    private void failPendingTasks(String message) {
        Log.e("StrawVerseBypass", message);
        isWebViewLoading = false;
        lastLoadedOrigin = null;
        expectedWebViewOrigin = null;
        List<PluginCall> calls = new ArrayList<>(pendingTaskCalls);
        pendingTasks.clear();
        pendingTaskCalls.clear();
        for (PluginCall pendingCall : calls) {
            activeFetchCalls.remove(pendingCall.getCallbackId());
            pendingCall.reject(message);
        }
    }

    private static String quoteForJavascript(String value) {
        return JSONObject.quote(value == null ? "" : value);
    }

    @PluginMethod
    public void cancelNativeRequests(final PluginCall call) {
        final JSArray requestIds = call.getArray("requestIds", new JSArray());
        getActivity().runOnUiThread(() -> {
            for (int i = 0; i < requestIds.length(); i++) {
                String requestId = requestIds.optString(i, "");
                PluginCall activeCall = activeFetchCalls.remove(requestId);
                if (activeCall != null) {
                    activeCall.reject("Native request cancelled");
                }
                for (int index = pendingTaskCalls.size() - 1; index >= 0; index--) {
                    PluginCall pendingCall = pendingTaskCalls.get(index);
                    if (requestId.equals(pendingCall.getString("requestId", pendingCall.getCallbackId()))) {
                        pendingTaskCalls.remove(index);
                        pendingTasks.remove(index);
                        pendingCall.reject("Native request cancelled");
                    }
                }
                // Abort only the WebView fetch belonging to this specific
                // requestId. A single global abort controller used to kill
                // whichever fetch happened to be in flight (e.g. a page-3
                // HTML fetch aborted by a stale image request timeout).
                if (backgroundWebView != null && !requestId.isEmpty()) {
                    String quotedId = quoteForJavascript(requestId);
                    backgroundWebView.evaluateJavascript(
                            "if(window.__strawverseAbortControllers){var c=window.__strawverseAbortControllers[" + quotedId + "];"
                                    + "if(c){c.abort();delete window.__strawverseAbortControllers[" + quotedId + "];}}",
                            null
                    );
                }
            }
            call.resolve();
        });
    }

    @android.webkit.JavascriptInterface
    public void onFetchResponse(final String requestId, final String value) {
        Log.i("StrawVerseBypass", "Received WebView fetch response for ID: " + requestId);
        final PluginCall call = activeFetchCalls.remove(requestId);
        if (call == null) {
            Log.w("StrawVerseBypass", "No active PluginCall found for ID: " + requestId);
            return;
        }
        
        try {
            if (value == null || value.isEmpty()) {
                call.reject("Empty response from WebView fetch");
                return;
            }
            
            JSONObject responseObj = new JSONObject(value);
            if (responseObj.has("error")) {
                String errMsg = responseObj.getString("error");
                call.reject(errMsg);
                sendNativeResponseToNode(requestId, false, null, errMsg);
                return;
            }
            
            int status = responseObj.getInt("status");
            String responseData = responseObj.optString("data", "");
            JSONObject resHeaders = responseObj.getJSONObject("headers");
            
            String base64Data;
            if (responseObj.optBoolean("isBase64", false)) {
                base64Data = responseData;
            } else {
                base64Data = android.util.Base64.encodeToString(
                        responseData.getBytes("utf-8"), 
                        android.util.Base64.NO_WRAP
                );
            }
            
            JSObject jsResHeaders = new JSObject();
            java.util.Iterator<String> keys = resHeaders.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                jsResHeaders.put(key, resHeaders.getString(key));
            }
            
            JSObject ret = new JSObject();
            ret.put("status", status);
            ret.put("data", base64Data);
            ret.put("isBase64", true);
            ret.put("headers", jsResHeaders);
            
            Log.i("StrawVerseBypass", "WebView fetch completed asynchronously: status " + status);
            call.resolve(ret);
            sendNativeResponseToNode(requestId, true, ret, null);
            
        } catch (Exception e) {
            Log.e("StrawVerseBypass", "Failed to parse WebView fetch output in interface", e);
            String errMsg = "Failed to parse WebView fetch output: " + e.getMessage();
            call.reject(errMsg);
            sendNativeResponseToNode(requestId, false, null, errMsg);
        }
    }

    private void executeWebViewRequest(final String url, final String method, final JSObject headers, final String body, final PluginCall call) {
        initBackgroundWebView();
        
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Uri uri = Uri.parse(url);
                    final String finalOrigin = uri.getScheme() + "://" + uri.getAuthority() + "/";
                    
                    if (backgroundWebView == null) {
                        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(this, 100);
                        return;
                    }
                    backgroundWebView.onResume();
                    backgroundWebView.resumeTimers();

                    String reqUA = null;
                    if (headers != null) {
                        reqUA = headers.optString("User-Agent", headers.optString("user-agent", ""));
                    }
                    if (reqUA == null || reqUA.isEmpty()) {
                        reqUA = AppDatabase.getStoredUserAgent(getContext(), url);
                    }
                    if (reqUA != null && !reqUA.isEmpty()) {
                        backgroundWebView.getSettings().setUserAgentString(cleanUserAgent(reqUA));
                    } else {
                        String webViewUA = cleanUserAgent(android.webkit.WebSettings.getDefaultUserAgent(getContext()));
                        backgroundWebView.getSettings().setUserAgentString(webViewUA);
                    }

                    String cookieVal = null;
                    if (headers != null) {
                        cookieVal = headers.optString("Cookie", headers.optString("cookie", ""));
                    }
                    if (cookieVal == null || cookieVal.isEmpty()) {
                        String cfCookie = AppDatabase.getStoredCfClearanceCookie(getContext(), url);
                        if (cfCookie != null && !cfCookie.isEmpty()) {
                            cookieVal = "cf_clearance=" + cfCookie;
                        }
                    }
                    
                    if (cookieVal != null && !cookieVal.isEmpty()) {
                        String host = uri.getHost();
                        if (host != null) {
                            for (String pair : cookieVal.split(";")) {
                                String cleanPair = pair.trim();
                                if (!cleanPair.isEmpty()) {
                                    String cookieString1 = cleanPair + "; Domain=" + host + "; Path=/; Secure; HttpOnly; SameSite=None";
                                    CookieManager.getInstance().setCookie(finalOrigin, cookieString1);
                                    String cookieString2 = cleanPair + "; Domain=." + host + "; Path=/; Secure; HttpOnly; SameSite=None";
                                    CookieManager.getInstance().setCookie(finalOrigin, cookieString2);
                                }
                            }
                            CookieManager.getInstance().flush();
                            Log.i("StrawVerseBypass", "Synced cookies to CookieManager for: " + finalOrigin);
                        }
                    }
                    
                    if (isWebViewLoading) {
                        queuePendingTask(this, call);
                        return;
                    }
                    
                    if (!finalOrigin.equals(lastLoadedOrigin)) {
                        String origin = uri.getScheme() + "://" + uri.getAuthority();
                        Log.i("StrawVerseBypass", "Initializing same-origin background WebView document: " + origin);
                        isWebViewLoading = true;
                        lastLoadedOrigin = finalOrigin;
                        expectedWebViewOrigin = origin;
                        queuePendingTask(this, call);
                        String bootstrapHtml = "<!doctype html><html><head><meta charset=\"utf-8\"></head>"
                                + "<body></body></html>";
                        backgroundWebView.loadDataWithBaseURL(
                                finalOrigin,
                                bootstrapHtml,
                                "text/html",
                                "UTF-8",
                                null
                        );
                        return;
                    }
                    
                    Log.i("StrawVerseBypass", "Executing WebView fetch for: " + url);
                    
                    JSObject fetchOptions = new JSObject();
                    String effectiveMethod = method == null ? "GET" : method.toUpperCase();
                    fetchOptions.put("method", effectiveMethod);
                    fetchOptions.put("credentials", "include");
                    
                    if (headers != null) {
                        JSObject fetchHeaders = new JSObject();
                        java.util.Iterator<String> keys = headers.keys();
                        while (keys.hasNext()) {
                            String key = keys.next();
                            if (key.equalsIgnoreCase("cookie") || key.equalsIgnoreCase("host") || key.equalsIgnoreCase("user-agent")) {
                                continue;
                            }
                            fetchHeaders.put(key, headers.getString(key));
                        }
                        fetchOptions.put("headers", fetchHeaders);
                    }
                    
                    if (body != null && !body.isEmpty()) {
                        fetchOptions.put("body", body);
                    }
                    
                    final String requestId = call.getString("requestId", call.getCallbackId());
                    activeFetchCalls.put(requestId, call);
                    String jsCode = "(function() {\n" +
                        "  var url = " + quoteForJavascript(url) + ";\n" +
                        "  var options = " + fetchOptions.toString() + ";\n" +
                        "  var reqId = " + quoteForJavascript(requestId) + ";\n" +
                        "  var controller = new AbortController();\n" +
                        "  window.__strawverseAbortControllers = window.__strawverseAbortControllers || {};\n" +
                        "  window.__strawverseAbortControllers[reqId] = controller;\n" +
                        "  var cleanup = function() {\n" +
                        "    if (window.__strawverseAbortControllers) { delete window.__strawverseAbortControllers[reqId]; }\n" +
                        "  };\n" +
                        "  options.signal = controller.signal;\n" +
                        "  fetch(url, options)\n" +
                        "    .then(function(res) {\n" +
                        "      return res.blob().then(function(blob) {\n" +
                        "        var headers = {};\n" +
                        "        res.headers.forEach(function(val, key) {\n" +
                        "          headers[key] = val;\n" +
                        "        });\n" +
                        "        var reader = new FileReader();\n" +
                        "        reader.onloadend = function() {\n" +
                        "          cleanup();\n" +
                        "          var base64data = reader.result.split(',')[1] || '';\n" +
                        "          AndroidFetchBridge.onFetchResponse(reqId, JSON.stringify({\n" +
                        "            status: res.status,\n" +
                        "            headers: headers,\n" +
                        "            data: base64data,\n" +
                        "            isBase64: true\n" +
                        "          }));\n" +
                        "        };\n" +
                        "        reader.readAsDataURL(blob);\n" +
                        "      });\n" +
                        "    })\n" +
                        "    .catch(function(err) {\n" +
                        "      cleanup();\n" +
                        "      AndroidFetchBridge.onFetchResponse(reqId, JSON.stringify({ error: err.message || String(err) }));\n" +
                        "    });\n" +
                        "})()";
                    
                    backgroundWebView.evaluateJavascript(jsCode, null);
                    
                } catch (Exception e) {
                    Log.e("StrawVerseBypass", "Error setting up WebView request", e);
                    String reqId = call.getString("requestId", call.getCallbackId());
                    activeFetchCalls.remove(reqId);
                    pendingTasks.remove(this);
                    pendingTaskCalls.remove(call);
                    String errMsg = "Error setting up WebView request: " + e.getMessage();
                    call.reject(errMsg);
                    sendNativeResponseToNode(reqId, false, null, errMsg);
                }
            }
        });
    }
}