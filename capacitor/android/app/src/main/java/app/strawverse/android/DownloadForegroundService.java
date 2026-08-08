package app.strawverse.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service that keeps the app alive and the CPU running while downloads
 * are in progress. This prevents Android from killing the Node.js process when the
 * screen is off or the app is in the background.
 */
public class DownloadForegroundService extends Service {
    private static final String TAG = "DownloadFGService";
    private static final String CHANNEL_ID = "strawverse_downloads";
    private static final String CHANNEL_NAME = "StrawVerse Downloads";
    private static final int NOTIFICATION_ID = 4004;

    private PowerManager.WakeLock wakeLock;
    private static boolean isRunning = false;
    private java.util.concurrent.ScheduledExecutorService notificationPoller;

    public static boolean isRunning() {
        return isRunning;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        acquireWakeLock();
        Log.i(TAG, "Download foreground service created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        isRunning = true;

        Notification notification = buildNotification("Downloading...", 0, 0);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+ requires foregroundServiceType
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        requestBatteryOptimizationExclusion();
        startNotificationPolling();

        Log.i(TAG, "Download foreground service started");
        return START_STICKY;
    }

    private void startNotificationPolling() {
        if (notificationPoller != null && !notificationPoller.isShutdown()) return;
        notificationPoller = java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
        notificationPoller.scheduleAtFixedRate(() -> {
            try {
                java.net.URL url = new java.net.URL("http://127.0.0.1:3459/api/internal/download-progress");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(2000);
                conn.setReadTimeout(2000);
                int code = conn.getResponseCode();
                if (code == 200) {
                    java.io.InputStream is = conn.getInputStream();
                    java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                    byte[] buf = new byte[1024];
                    int len;
                    while ((len = is.read(buf)) != -1) {
                        bos.write(buf, 0, len);
                    }
                    is.close();
                    String json = bos.toString("UTF-8");
                    org.json.JSONObject obj = new org.json.JSONObject(json);
                    String caption = obj.optString("caption", "");
                    int currentSegments = obj.optInt("currentSegments", 0);
                    int totalSegments = obj.optInt("totalSegments", 0);
                    String epid = obj.optString("epid", null);
                    boolean isPaused = obj.optBoolean("isPaused", false);

                    if (!caption.isEmpty() && totalSegments > 0) {
                        DownloadNotificationManager.getInstance(DownloadForegroundService.this)
                            .updateProgress(caption, currentSegments, totalSegments, epid, isPaused);
                    }
                }
                conn.disconnect();
            } catch (Exception e) {
                // Silently ignore if server is unready
            }
        }, 1, 2, java.util.concurrent.TimeUnit.SECONDS);
    }

    private void stopNotificationPolling() {
        if (notificationPoller != null) {
            try {
                notificationPoller.shutdownNow();
            } catch (Exception ignored) {}
            notificationPoller = null;
        }
    }

    private void requestBatteryOptimizationExclusion() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                String packageName = getPackageName();
                if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
                    Intent batteryIntent = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    batteryIntent.setData(android.net.Uri.parse("package:" + packageName));
                    batteryIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(batteryIntent);
                    Log.i(TAG, "Requested battery optimization exclusion");
                } else {
                    Log.i(TAG, "Already excluded from battery optimizations");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to request battery optimization exclusion: " + e.getMessage());
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        stopNotificationPolling();
        releaseWakeLock();
        Log.i(TAG, "Download foreground service destroyed");
        super.onDestroy();
    }

    public void updateNotification(String title, int current, int total) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, buildNotification(title, current, total));
        }
    }

    private Notification buildNotification(String title, int current, int total) {
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title != null && !title.isEmpty() ? title : "Downloading...")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW);

        if (total > 0) {
            int progress = (int) (((double) current / total) * 100);
            builder.setContentText(progress + "% (" + current + " / " + total + " segments)")
                   .setSubText(progress + "%")
                   .setProgress(total, current, false);
        } else {
            builder.setContentText("Preparing download...")
                   .setProgress(100, 0, true);
        }

        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps downloads running when the screen is off");
            channel.setSound(null, null);
            channel.enableVibration(false);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "StrawVerse::DownloadWakeLock"
            );
            // Acquire with a 6-hour timeout as a safety net
            wakeLock.acquire(6 * 60 * 60 * 1000L);
            Log.i(TAG, "WakeLock acquired");
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
            Log.i(TAG, "WakeLock released");
        }
    }

    // Static helpers to start/stop the service from anywhere
    public static void start(Context context) {
        if (isRunning) {
            Log.d(TAG, "Service already running, skipping start");
            return;
        }
        try {
            Intent intent = new Intent(context, DownloadForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            Log.i(TAG, "Requested foreground service start");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start foreground service: " + e.getMessage(), e);
        }
    }

    public static void stop(Context context) {
        if (!isRunning) {
            Log.d(TAG, "Service not running, skipping stop");
            return;
        }
        try {
            Intent intent = new Intent(context, DownloadForegroundService.class);
            context.stopService(intent);
            Log.i(TAG, "Requested foreground service stop");
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop foreground service: " + e.getMessage(), e);
        }
    }
}
