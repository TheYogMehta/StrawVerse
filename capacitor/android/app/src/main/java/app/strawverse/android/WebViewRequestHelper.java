package app.strawverse.android;

import android.content.Context;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.CookieManager;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class WebViewRequestHelper {
    private static final String TAG = "WebViewRequestHelper";

    public static WebResourceResponse fetchNativelyWithHeaders(Context context, WebResourceRequest request) {
        try {
            String url = request.getUrl().toString();
            Map<String, String> customHeaders = AppDatabase.getHeadersForUrl(context, url);
            if (customHeaders.isEmpty()) {
                return null;
            }

            URL targetUrl = new URL(url);
            HttpURLConnection conn = (HttpURLConnection) targetUrl.openConnection();
            conn.setRequestMethod(request.getMethod());
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setInstanceFollowRedirects(true);

            boolean hasUserAgent = false;
            for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                conn.setRequestProperty(header.getKey(), header.getValue());
                if (header.getKey().equalsIgnoreCase("user-agent")) {
                    hasUserAgent = true;
                }
            }

            String dbUA = AppDatabase.getStoredUserAgent(context, url);
            if (dbUA != null && !dbUA.isEmpty()) {
                conn.setRequestProperty("User-Agent", CloudflareBypassPlugin.cleanUserAgent(dbUA));
            } else if (!hasUserAgent) {
                String defaultUA = CloudflareBypassPlugin.cleanUserAgent(android.webkit.WebSettings.getDefaultUserAgent(context));
                conn.setRequestProperty("User-Agent", defaultUA);
            }

            for (Map.Entry<String, String> header : customHeaders.entrySet()) {
                if (!header.getKey().equalsIgnoreCase("cookie")) {
                    conn.setRequestProperty(header.getKey(), header.getValue());
                }
            }

            String finalCookie = "";
            if (customHeaders.containsKey("Cookie")) {
                finalCookie = customHeaders.get("Cookie");
            }
            String webViewCookie = CookieManager.getInstance().getCookie(url);
            if (webViewCookie != null && !webViewCookie.isEmpty()) {
                if (!finalCookie.isEmpty()) {
                    finalCookie = finalCookie + " " + webViewCookie;
                } else {
                    finalCookie = webViewCookie;
                }
            }
            if (!finalCookie.isEmpty()) {
                conn.setRequestProperty("Cookie", finalCookie);
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
