package app.strawverse.android;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.ui.PlayerView;
import androidx.media3.datasource.cronet.CronetDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.datasource.DataSpec;

import org.chromium.net.CronetEngine;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

public class PlayerActivity extends Activity {

    private PlayerView playerView;
    private ExoPlayer player;

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

        playerView = new PlayerView(this);
        setContentView(playerView);

        String videoUrl = getIntent().getStringExtra("videoUrl");
        Bundle headersBundle = getIntent().getBundleExtra("headers");
        if (videoUrl == null) {
            Toast.makeText(this, "Error: Invalid stream URL", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        try {
            player = new ExoPlayer.Builder(this).build();
            playerView.setPlayer(player);

            final Map<String, String> headersMap = new HashMap<>();
            if (headersBundle != null && !headersBundle.isEmpty()) {
                for (String key : headersBundle.keySet()) {
                    headersMap.put(key, headersBundle.getString(key));
                }
            }

            CronetEngine cronetEngine = new CronetEngine.Builder(this).build();
            Executor executor = Executors.newSingleThreadExecutor();

            String userAgentString = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
            if (headersMap.containsKey("User-Agent")) {
                userAgentString = headersMap.get("User-Agent");
            } else if (headersMap.containsKey("user-agent")) {
                userAgentString = headersMap.get("user-agent");
            }

            CronetDataSource.Factory cronetDataSourceFactory =
                    new CronetDataSource.Factory(cronetEngine, executor)
                            .setUserAgent(userAgentString);

            ResolvingDataSource.Factory resolvingFactory =
                    new ResolvingDataSource.Factory(
                            cronetDataSourceFactory,
                            new ResolvingDataSource.Resolver() {
                                @Override
                                public DataSpec resolveDataSpec(DataSpec dataSpec) {
                                    if (!headersMap.isEmpty()) {
                                        return dataSpec.buildUpon()
                                                .setHttpRequestHeaders(headersMap)
                                                .build();
                                    }
                                    return dataSpec;
                                }
                            }
                    );

            MediaSource mediaSource = new DefaultMediaSourceFactory(resolvingFactory)
                    .createMediaSource(MediaItem.fromUri(Uri.parse(videoUrl)));

            player.setMediaSource(mediaSource);
            player.prepare();
            player.play();

        } catch (Exception e) {
            Toast.makeText(this, "Failed to initialize player: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            finish();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) {
            player.pause();
        }
    }

    @Override
    protected void onDestroy() {
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
