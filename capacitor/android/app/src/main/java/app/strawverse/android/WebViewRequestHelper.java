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

    /**
     * Cloudflare binds cf_clearance to the TLS fingerprint of the browser
     * that solved the challenge.  Java's HttpURLConnection has a completely
     * different TLS fingerprint than the WebView, so even with valid cookies
     * Cloudflare returns 403.  For these hosts we must NOT intercept the
     * request — instead we sync cookies into CookieManager and let the
     * WebView (which has the matching fingerprint) fetch natively.
     */
    private static boolean isCloudflareProtectedHost(String host) {
        if (host == null) return false;
        host = host.toLowerCase();
        if (host.endsWith("animepahe.pw")) {
            return true;
        }
        return false;
    }

    /**
     * Sync database cookies + stored headers into CookieManager so the
     * WebView can send them on the native request we are about to let
     * through (returning null from shouldInterceptRequest).
     */
    private static void syncCookiesToCookieManager(Context context, String url) {
        try {
            String dbCookies = AppDatabase.getStoredCookiesForUrl(context, url);
            if (dbCookies != null && !dbCookies.isEmpty()) {
                Uri uri = Uri.parse(url);
                String host = uri.getHost();
                if (host == null) return;

                // Determine the parent domain so cookies cover all subdomains
                String parentDomain = host.replace("www.", "").toLowerCase();
                if (parentDomain.contains("animepahe")) {
                    parentDomain = "animepahe.pw";
                } else if (parentDomain.contains("kwik.cx") || parentDomain.contains("owocdn.top") || parentDomain.contains("uwucdn.top")) {
                    parentDomain = "kwik.cx";
                }

                for (String pair : dbCookies.split("; ")) {
                    String trimmed = pair.trim();
                    if (!trimmed.isEmpty()) {
                        // Set with Domain=.parentDomain so it covers all subdomains
                        String cookieStr = trimmed + "; Domain=." + parentDomain + "; Path=/; Secure; SameSite=None";
                        CookieManager.getInstance().setCookie(url, cookieStr);
                    }
                }
                CookieManager.getInstance().flush();
                Log.i(TAG, "Synced DB cookies to CookieManager for: " + url + " (domain=." + parentDomain + ")");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to sync cookies to CookieManager: " + e.getMessage());
        }
    }

    public static WebResourceResponse fetchNativelyWithHeaders(Context context, WebResourceRequest request) {
        try {
            String url = request.getUrl().toString();
            Uri uri = request.getUrl();
            String host = uri.getHost();
            
            if (isCloudflareProtectedHost(host)) {
                syncCookiesToCookieManager(context, url);
                Log.i(TAG, "Skipping interception for CF-protected host, delegating to WebView: " + url);
                return null;
            }

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
                if (header.getKey().equalsIgnoreCase("user-agent")) {
                    hasUserAgent = true;
                    conn.setRequestProperty(header.getKey(), CloudflareBypassPlugin.cleanUserAgent(header.getValue()));
                } else {
                    conn.setRequestProperty(header.getKey(), header.getValue());
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
                    String val = header.getValue();
                    if (header.getKey().equalsIgnoreCase("user-agent")) {
                        val = CloudflareBypassPlugin.cleanUserAgent(val);
                    }
                    conn.setRequestProperty(header.getKey(), val);
                }
            }

            String explicitCookie = customHeaders.get("Cookie");
            String webViewCookie = CookieManager.getInstance().getCookie(url);
            String finalCookie = AppDatabase.mergeCookies(explicitCookie, webViewCookie);
            if (finalCookie != null && !finalCookie.isEmpty()) {
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
            Log.i(TAG, "WebView Intercept: " + url + " -> Response Code: " + responseCode);
            return new WebResourceResponse(mimeType, encoding, responseCode, responseMessage, responseHeaders, responseStream);
        } catch (Exception e) {
            Log.e(TAG, "Failed to natively fetch url in WebView interceptor: " + e.getMessage(), e);
            return null;
        }
    }
}
