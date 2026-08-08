package app.strawverse.android;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class NotificationActionReceiver extends BroadcastReceiver {
    private static final String TAG = "NotificationAction";

    public static final String ACTION_PAUSE = "app.strawverse.android.ACTION_PAUSE";
    public static final String ACTION_RESUME = "app.strawverse.android.ACTION_RESUME";
    public static final String ACTION_CANCEL = "app.strawverse.android.ACTION_CANCEL";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        Log.i(TAG, "Notification action received: " + action);

        new Thread(() -> {
            try {
                int serverPort = 3459;
                if (ACTION_PAUSE.equals(action)) {
                    sendPostRequest("http://127.0.0.1:" + serverPort + "/api/download/pause", null);
                } else if (ACTION_RESUME.equals(action)) {
                    sendPostRequest("http://127.0.0.1:" + serverPort + "/api/download/resume", null);
                } else if (ACTION_CANCEL.equals(action)) {
                    String epid = intent.getStringExtra("epid");
                    if (epid != null && !epid.isEmpty()) {
                        String jsonBody = "{\"AnimeEpId\":\"" + epid + "\"}";
                        sendPostRequest("http://127.0.0.1:" + serverPort + "/api/download/remove", jsonBody);
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to handle notification action: " + e.getMessage(), e);
            }
        }).start();
    }

    private void sendPostRequest(String urlStr, String jsonBody) {
        try {
            java.net.URL url = new java.net.URL(urlStr);
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(5000);
            conn.setDoOutput(true);

            if (jsonBody != null) {
                try (java.io.OutputStream os = conn.getOutputStream()) {
                    os.write(jsonBody.getBytes("UTF-8"));
                }
            } else {
                try (java.io.OutputStream os = conn.getOutputStream()) {
                    os.write("{}".getBytes("UTF-8"));
                }
            }
            int responseCode = conn.getResponseCode();
            Log.i(TAG, "Sent notification action to " + urlStr + ", response: " + responseCode);
            conn.disconnect();
        } catch (Exception e) {
            Log.e(TAG, "Failed to send request to " + urlStr + ": " + e.getMessage());
        }
    }
}
