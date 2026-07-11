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

@CapacitorPlugin(name = "CloudflareBypass")
public class CloudflareBypassPlugin extends Plugin {

    @PluginMethod
    public void bypass(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("URL is required");
            return;
        }

        Log.i("StrawVerseBypass", "bypass() called with URL: " + url);

        final String finalUrl = url;
        String userAgent = call.getString("userAgent");
        if (userAgent == null) {
            userAgent = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
        }
        final String finalUserAgent = userAgent;

        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    CookieManager.getInstance().removeAllCookies(null);
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
                    webView.getSettings().setUserAgentString(finalUserAgent);
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
                    final android.os.Handler handler = new android.os.Handler();
                    final Runnable cookiePoller = new Runnable() {
                        @Override
                        public void run() {
                            if (finished[0]) return;

                            String cookieString = CookieManager.getInstance().getCookie(finalUrl);
                            if (cookieString != null && cookieString.contains("cf_clearance")) {
                                Log.i("StrawVerseBypass", "Cookie poller detected cf_clearance!");
                                finished[0] = true;
                                JSObject ret = new JSObject();
                                ret.put("cookies", cookieString);
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

                            String cookieString = CookieManager.getInstance().getCookie(finalUrl);
                            JSObject ret = new JSObject();
                            ret.put("cookies", cookieString);
                            call.resolve(ret);
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

                            String cookieString = CookieManager.getInstance().getCookie(finalUrl);
                            JSObject ret = new JSObject();
                            ret.put("cookies", cookieString);
                            call.resolve(ret);
                            webView.destroy();
                        }
                    });

                    webView.setWebViewClient(new WebViewClient() {
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
                    CookieManager.getInstance().removeAllCookies(new android.webkit.ValueCallback<Boolean>() {
                        @Override
                        public void onReceiveValue(Boolean value) {
                            webView.loadUrl(finalUrl);
                            dialog.show();
                            handler.post(cookiePoller);
                        }
                    });

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
                    String localApiUrl = "http://127.0.0.1:3459/api/proxy-headers?url=" + java.net.URLEncoder.encode(videoUrl, "UTF-8");
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
}
