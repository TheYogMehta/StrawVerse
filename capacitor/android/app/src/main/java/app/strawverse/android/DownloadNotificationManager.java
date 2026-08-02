package app.strawverse.android;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import androidx.core.app.NotificationCompat;

public class DownloadNotificationManager {
    private static final String TAG = "DownloadNotification";
    private static final String CHANNEL_ID = "strawverse_downloads";
    private static final String CHANNEL_NAME = "StrawVerse Downloads";
    private static final int NOTIFICATION_ID = 4004;

    private static DownloadNotificationManager instance;
    private Context context;
    private NotificationManager notificationManager;
    private boolean enabled = true;

    private DownloadNotificationManager(Context context) {
        this.context = context.getApplicationContext();
        this.notificationManager = (NotificationManager) this.context.getSystemService(Context.NOTIFICATION_SERVICE);
        createNotificationChannel();
    }

    public static synchronized DownloadNotificationManager getInstance(Context context) {
        if (instance == null) {
            instance = new DownloadNotificationManager(context);
        }
        return instance;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
        if (!enabled) {
            cancelNotification();
        }
    }

    public boolean isEnabled() {
        return this.enabled;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows active download progress for anime and manga episodes");
            channel.setSound(null, null);
            channel.enableVibration(false);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    public void updateProgress(String title, int currentSegments, int totalSegments, String epid, boolean isPaused) {
        if (!enabled || notificationManager == null) {
            return;
        }

        if (totalSegments <= 0 || "Nothing in progress".equals(title)) {
            cancelNotification();
            return;
        }

        int progress = (int) (((double) currentSegments / totalSegments) * 100);
        if (progress > 100) progress = 100;
        boolean isMerging = currentSegments >= totalSegments - 2;

        String contentText = isMerging
            ? "Merging segments..."
            : String.format("%s%d%% (%d / %d segments)", (isPaused ? "[PAUSED] " : ""), progress, currentSegments, totalSegments);

        Intent openAppIntent = new Intent(context, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        // Pause Action Intent
        Intent pauseIntent = new Intent(context, NotificationActionReceiver.class);
        pauseIntent.setAction(NotificationActionReceiver.ACTION_PAUSE);
        PendingIntent pausePendingIntent = PendingIntent.getBroadcast(
            context,
            1,
            pauseIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        // Resume Action Intent
        Intent resumeIntent = new Intent(context, NotificationActionReceiver.class);
        resumeIntent.setAction(NotificationActionReceiver.ACTION_RESUME);
        PendingIntent resumePendingIntent = PendingIntent.getBroadcast(
            context,
            2,
            resumeIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        // Cancel Action Intent
        Intent cancelIntent = new Intent(context, NotificationActionReceiver.class);
        cancelIntent.setAction(NotificationActionReceiver.ACTION_CANCEL);
        if (epid != null) {
            cancelIntent.putExtra("epid", epid);
        }
        PendingIntent cancelPendingIntent = PendingIntent.getBroadcast(
            context,
            3,
            cancelIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_MUTABLE : 0)
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title != null && !title.isEmpty() ? title : "Downloading...")
            .setContentText(contentText)
            .setSubText(progress + "%")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW);

        if (isMerging) {
            builder.setProgress(100, 100, true);
        } else {
            builder.setProgress(totalSegments, currentSegments, false);
        }

        // Add Pause / Resume action button
        if (isPaused) {
            builder.addAction(android.R.drawable.ic_media_play, "Resume", resumePendingIntent);
        } else {
            builder.addAction(android.R.drawable.ic_media_pause, "Pause", pausePendingIntent);
        }

        // Add Cancel action button
        builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", cancelPendingIntent);

        notificationManager.notify(NOTIFICATION_ID, builder.build());
    }

    public void updateProgress(String title, int currentSegments, int totalSegments, String epid) {
        updateProgress(title, currentSegments, totalSegments, epid, false);
    }

    public void cancelNotification() {
        if (notificationManager != null) {
            notificationManager.cancel(NOTIFICATION_ID);
        }
    }
}
