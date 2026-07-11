package app.strawverse.android;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.MediaController;
import android.widget.VideoView;
import android.widget.Toast;

public class PlayerActivity extends Activity {

    private VideoView videoView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);

        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );

        videoView = new VideoView(this);
        setContentView(videoView);

        String videoUrl = getIntent().getStringExtra("videoUrl");
        Bundle headersBundle = getIntent().getBundleExtra("headers");
        if (videoUrl == null) {
            Toast.makeText(this, "Error: Invalid stream URL", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        try {
            MediaController mediaController = new MediaController(this);
            mediaController.setAnchorView(videoView);
            videoView.setMediaController(mediaController);

            if (headersBundle != null && !headersBundle.isEmpty()) {
                java.util.Map<String, String> headersMap = new java.util.HashMap<>();
                for (String key : headersBundle.keySet()) {
                    headersMap.put(key, headersBundle.getString(key));
                }
                videoView.setVideoURI(Uri.parse(videoUrl), headersMap);
            } else {
                videoView.setVideoURI(Uri.parse(videoUrl));
            }

            videoView.setOnPreparedListener(mp -> videoView.start());

            videoView.setOnErrorListener((mp, what, extra) -> {
                Toast.makeText(PlayerActivity.this, "Playback Error", Toast.LENGTH_SHORT).show();
                finish();
                return true;
            });

            videoView.setOnCompletionListener(mp -> finish());

        } catch (Exception e) {
            Toast.makeText(this, "Failed to initialize player: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            finish();
        }
    }

    @Override
    protected void onDestroy() {
        if (videoView != null) {
            videoView.stopPlayback();
        }
        super.onDestroy();
    }
}
