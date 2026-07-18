package app.strawverse.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Window;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.Player;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.datasource.cronet.CronetDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.chromium.net.CronetEngine;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

public class PlayerActivity extends Activity {

    private PlayerView playerView;
    private Player player;
    private ExoPlayer rawPlayer;

    private LinearLayout topBar;
    private TextView titleTextView;

    private TextView hudTextView;
    private final Handler hudHandler = new Handler(Looper.getMainLooper());
    private final Runnable hudRunnable = new Runnable() {
        @Override
        public void run() {
            hudTextView.setVisibility(View.GONE);
        }
    };

    private Button skipButton;

    // Gesture variables
    private float startX = 0f;
    private float startY = 0f;
    private float startVal = 0f;
    private boolean isLeft = false;
    private boolean isDragging = false;       // vertical drag (volume/brightness)
    private boolean isHorizontalDrag = false; // horizontal drag (seek)
    private long seekStartPositionMs = 0;
    private int accumulatedSeekSecs = 0;
    private static final int TOUCH_SLOP = 30; // Min drag pixels to initiate gesture

    // Dynamic player states
    private String animeTitle = "Anime Stream";
    private String currentVideoUrl;
    private JSONArray subtitlesArray = new JSONArray();
    private JSONArray sourcesArray = new JSONArray();
    private JSONArray skipTimesArray = new JSONArray();
    private int currentSourceIndex = 0;
    private int selectedSubtitleIndex = -1; // -1 means disabled/off by default

    // History tracking fields
    private String animeId = "";
    private double episodeNumber = 0.0;
    private String provider = "";
    private String imageUrl = "";
    private String malid = "";
    private long lastReportTimeMs = 0;
    private boolean autoSkipIntro = true;
    private double lastProgressTimeSecs = -1;
    private boolean hasSeekedToProgress = false;

    private String currentEpisodeId = "";
    private boolean downloaded = false;
    private String subdub = "sub";
    private JSONArray episodesListArray = new JSONArray();
    private ImageView prevButton;
    private ImageView nextButton;
    private JSONObject prevEpisode;
    private JSONObject nextEpisode;
    private HighlightsOverlayView highlightsOverlayView;

    // Timer for skip check
    private final Handler skipCheckHandler = new Handler(Looper.getMainLooper());
    private final Runnable skipCheckRunnable = new Runnable() {
        @Override
        public void run() {
            if (player != null && player.isPlaying()) {
                long currentSecs = player.getCurrentPosition() / 1000;
                checkSkipIntervals(currentSecs);
                setupSeekbarHighlights();

                if ((skipTimesArray == null || skipTimesArray.length() == 0) && malid != null && !malid.isEmpty()) {
                    long duration = player.getDuration();
                    if (duration > 0) {
                        fetchSkipTimesFromAniSkip(malid, episodeNumber, duration);
                    }
                }

                long now = System.currentTimeMillis();
                if (now - lastReportTimeMs >= 10000) {
                    lastReportTimeMs = now;
                    reportProgress();
                }
            }
            skipCheckHandler.postDelayed(this, 500);
        }
    };

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

        // Read intent data
        Intent intent = getIntent();
        animeId = intent.getStringExtra("animeId");
        if (animeId == null) animeId = "";
        currentEpisodeId = intent.getStringExtra("episodeId");
        if (currentEpisodeId == null) currentEpisodeId = "";
        episodeNumber = intent.getDoubleExtra("episodeNumber", 0.0);
        downloaded = intent.getBooleanExtra("downloaded", false);
        subdub = intent.getStringExtra("subdub");
        if (subdub == null) subdub = "sub";
        provider = intent.getStringExtra("provider");
        if (provider == null) provider = "";
        imageUrl = intent.getStringExtra("image");
        if (imageUrl == null) imageUrl = "";
        malid = intent.getStringExtra("malid");
        if (malid == null) malid = "";
        final String baseAnimeTitle = intent.getStringExtra("animeTitle");
        animeTitle = baseAnimeTitle != null ? baseAnimeTitle : "Anime Stream";

        String episodesListStr = intent.getStringExtra("episodesList");
        if (episodesListStr != null && !episodesListStr.isEmpty()) {
            try {
                episodesListArray = new JSONArray(episodesListStr);
            } catch (Exception e) {
                Log.e("PlayerActivity", "Failed to parse episodesList: " + e.getMessage());
            }
        }

        String currentEpTitle = "";
        if (episodesListArray != null && episodesListArray.length() > 0) {
            for (int i = 0; i < episodesListArray.length(); i++) {
                try {
                    JSONObject ep = episodesListArray.getJSONObject(i);
                    String epId = ep.optString("id", "");
                    if (!epId.isEmpty() && epId.equals(currentEpisodeId)) {
                        currentEpTitle = ep.optString("title", "");
                        break;
                    }
                    double epNum = ep.optDouble("number", -1.0);
                    if (Math.abs(epNum - episodeNumber) < 0.01) {
                        currentEpTitle = ep.optString("title", "");
                        break;
                    }
                } catch (Exception e) {}
            }
        }

        String displayTitle = "EP: " + formatEpisodeNumber(episodeNumber);
        if (!currentEpTitle.isEmpty()) {
            displayTitle = displayTitle + " | " + currentEpTitle;
        }

        // Programmatic Layout construction
        FrameLayout rootLayout = new FrameLayout(this);
        rootLayout.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        // Media3 PlayerView
        playerView = new PlayerView(this);
        playerView.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        
        // Hide default settings button by removing it from parent layout to prevent standard picker
        try {
            View defaultSettings = playerView.findViewById(androidx.media3.ui.R.id.exo_settings);
            if (defaultSettings != null && defaultSettings.getParent() instanceof ViewGroup) {
                ((ViewGroup) defaultSettings.getParent()).removeView(defaultSettings);
            }
        } catch (Exception e) {
            Log.e("PlayerActivity", "Failed to remove default settings button: " + e.getMessage());
        }

        rootLayout.addView(playerView);

        // Top Overlay Controller Bar
        topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setBackgroundColor(0x80000000); // 50% semi-transparent black
        FrameLayout.LayoutParams topBarParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT);
        topBarParams.gravity = Gravity.TOP;
        topBar.setLayoutParams(topBarParams);
        topBar.setPadding(35, 25, 35, 25);
        topBar.setGravity(Gravity.CENTER_VERTICAL);

        // Back button
        ImageView backButton = new ImageView(this);
        backButton.setImageResource(R.drawable.ic_back);
        backButton.setScaleType(ImageView.ScaleType.FIT_CENTER);
        backButton.setColorFilter(0xFFFFFFFF); // Tint white
        int arrowSize = (int) (24 * getResources().getDisplayMetrics().density);
        LinearLayout.LayoutParams backParams = new LinearLayout.LayoutParams(arrowSize, arrowSize);
        backParams.setMargins(20, 0, 35, 0);
        backButton.setLayoutParams(backParams);
        backButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        topBar.addView(backButton);

        android.util.TypedValue outValue = new android.util.TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, outValue, true);
        int btnSize = (int) (32 * getResources().getDisplayMetrics().density);

        // Previous Episode Button
        prevButton = new ImageView(this);
        prevButton.setImageResource(R.drawable.ic_prev);
        prevButton.setScaleType(ImageView.ScaleType.FIT_CENTER);
        prevButton.setColorFilter(0xFFFFFFFF);
        prevButton.setBackgroundResource(outValue.resourceId);
        LinearLayout.LayoutParams prevParams = new LinearLayout.LayoutParams(btnSize, btnSize);
        prevParams.setMargins(15, 0, 15, 0);
        prevButton.setLayoutParams(prevParams);
        prevButton.setPadding(6, 6, 6, 6);
        prevButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (prevEpisode != null) {
                    loadNewEpisode(prevEpisode);
                }
            }
        });
        topBar.addView(prevButton);

        // Title
        titleTextView = new TextView(this);
        titleTextView.setText(displayTitle);
        titleTextView.setTextColor(0xFFFFFFFF);
        titleTextView.setTextSize(18);
        titleTextView.setTypeface(null, Typeface.BOLD);
        titleTextView.setSingleLine(true);
        titleTextView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f);
        titleTextView.setLayoutParams(titleParams);
        topBar.addView(titleTextView);

        // Next Episode Button
        nextButton = new ImageView(this);
        nextButton.setImageResource(R.drawable.ic_next);
        nextButton.setScaleType(ImageView.ScaleType.FIT_CENTER);
        nextButton.setColorFilter(0xFFFFFFFF);
        nextButton.setBackgroundResource(outValue.resourceId);
        LinearLayout.LayoutParams nextParams = new LinearLayout.LayoutParams(btnSize, btnSize);
        nextParams.setMargins(15, 0, 15, 0);
        nextButton.setLayoutParams(nextParams);
        nextButton.setPadding(6, 6, 6, 6);
        nextButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (nextEpisode != null) {
                    loadNewEpisode(nextEpisode);
                }
            }
        });
        topBar.addView(nextButton);

        // Settings gear icon
        ImageView btnSettingsIcon = new ImageView(this);
        int iconSize = (int) (36 * getResources().getDisplayMetrics().density);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(iconSize, iconSize);
        iconParams.setMargins(15, 0, 20, 0);
        btnSettingsIcon.setLayoutParams(iconParams);
        btnSettingsIcon.setImageResource(R.drawable.ic_settings);
        btnSettingsIcon.setColorFilter(0xFFFFFFFF);
        btnSettingsIcon.setPadding(6, 6, 6, 6);
        btnSettingsIcon.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showCustomSettingsDialog();
            }
        });
        topBar.addView(btnSettingsIcon);

        rootLayout.addView(topBar);

        // Volume / Brightness HUD Center Overlay
        hudTextView = new TextView(this);
        FrameLayout.LayoutParams hudParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT);
        hudParams.gravity = Gravity.CENTER;
        hudTextView.setLayoutParams(hudParams);
        hudTextView.setTextColor(0xFFFFFFFF);
        hudTextView.setTextSize(20);
        hudTextView.setPadding(50, 25, 50, 25);
        hudTextView.setVisibility(View.GONE);
        GradientDrawable hudBg = new GradientDrawable();
        hudBg.setColor(0xAA000000);
        hudBg.setCornerRadius(25);
        hudTextView.setBackground(hudBg);
        rootLayout.addView(hudTextView);

        // Floating skip Intro / Outro button at the bottom-right corner
        skipButton = new Button(this);
        float density = getResources().getDisplayMetrics().density;
        FrameLayout.LayoutParams skipParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT);
        skipParams.gravity = Gravity.BOTTOM | Gravity.RIGHT;
        skipParams.setMargins(0, 0, (int) (48 * density), (int) (72 * density)); // Positioned safely above seekbar
        skipButton.setLayoutParams(skipParams);
        skipButton.setTextColor(0xFFFFFFFF);
        skipButton.setTextSize(14);
        int paddingLR = (int) (20 * density);
        int paddingTB = (int) (10 * density);
        skipButton.setPadding(paddingLR, paddingTB, paddingLR, paddingTB);
        skipButton.setVisibility(View.GONE);
        
        GradientDrawable skipBg = new GradientDrawable();
        skipBg.setColor(0xFF3B82F6); // modern vibrant blue
        skipBg.setCornerRadius(8 * density);
        skipButton.setBackground(skipBg);
        rootLayout.addView(skipButton);

        setContentView(rootLayout);

        // Initialize highlights overlay view on ExoPlayer seekbar
        initSeekbarHighlightsOverlay();

        // Update Prev and Next episode button states
        updatePrevNextButtons();

        // Bind topBar visibility to ExoPlayer controls visibility
        playerView.setControllerVisibilityListener(new PlayerView.ControllerVisibilityListener() {
            @Override
            public void onVisibilityChanged(int visibility) {
                topBar.setVisibility(visibility);
            }
        });

        // Fetch settings and history progress in background
        fetchHistoryAndSettings();

        // Start background fetch to retrieve sources
        fetchSourcesNatively(animeId, currentEpisodeId, episodeNumber, downloaded, subdub, provider);
    }

    private void initSeekbarHighlightsOverlay() {
        try {
            final View timeBarView = playerView.findViewById(androidx.media3.ui.R.id.exo_progress);
            if (timeBarView != null && timeBarView.getParent() instanceof ViewGroup) {
                final ViewGroup parent = (ViewGroup) timeBarView.getParent();
                int index = parent.indexOfChild(timeBarView);
                ViewGroup.LayoutParams originalParams = timeBarView.getLayoutParams();

                parent.removeView(timeBarView);

                // Subclass FrameLayout to invalidate the highlights overlay on every dispatchDraw pass.
                // This ensures it stays perfectly in sync with the seekbar's alpha/translation animation frames.
                FrameLayout container = new FrameLayout(this) {
                    @Override
                    protected void dispatchDraw(Canvas canvas) {
                        if (highlightsOverlayView != null) {
                            highlightsOverlayView.invalidate();
                        }
                        super.dispatchDraw(canvas);
                    }
                };
                
                highlightsOverlayView = new HighlightsOverlayView(this);
                highlightsOverlayView.setClickable(false);
                highlightsOverlayView.setFocusable(false);
                highlightsOverlayView.setTimeBarView(timeBarView);

                FrameLayout.LayoutParams layoutParams = new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT);

                container.addView(highlightsOverlayView, layoutParams);
                container.addView(timeBarView, new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));

                parent.addView(container, index, originalParams);
            }
        } catch (Exception e) {
            Log.e("PlayerActivity", "Failed to initialize seekbar highlights overlay: " + e.getMessage());
        }
    }

    private void updatePrevNextButtons() {
        prevEpisode = null;
        nextEpisode = null;

        Log.d("PlayerActivity", "updatePrevNextButtons start: currentEpisodeId=" + currentEpisodeId + ", episodeNumber=" + episodeNumber);

        if (episodesListArray != null && episodesListArray.length() > 0) {
            try {
                int currentIndex = -1;
                List<JSONObject> sortedList = new ArrayList<>();
                for (int i = 0; i < episodesListArray.length(); i++) {
                    sortedList.add(episodesListArray.getJSONObject(i));
                }
                
                java.util.Collections.sort(sortedList, new java.util.Comparator<JSONObject>() {
                    @Override
                    public int compare(JSONObject a, JSONObject b) {
                        double numA = a.optDouble("number", 0.0);
                        double numB = b.optDouble("number", 0.0);
                        return Double.compare(numA, numB);
                    }
                });

                for (int i = 0; i < sortedList.size(); i++) {
                    JSONObject ep = sortedList.get(i);
                    String epId = ep.optString("id", "");
                    if (!epId.isEmpty() && epId.equals(currentEpisodeId)) {
                        currentIndex = i;
                        break;
                    }
                    double epNum = ep.optDouble("number", -1.0);
                    if (Math.abs(epNum - episodeNumber) < 0.01) {
                        currentIndex = i;
                        break;
                    }
                }

                Log.d("PlayerActivity", "updatePrevNextButtons match result: currentIndex=" + currentIndex + ", listSize=" + sortedList.size());

                if (currentIndex != -1) {
                    if (currentIndex > 0) {
                        prevEpisode = sortedList.get(currentIndex - 1);
                    }
                    if (currentIndex < sortedList.size() - 1) {
                        nextEpisode = sortedList.get(currentIndex + 1);
                    }
                }
            } catch (Exception e) {
                Log.e("PlayerActivity", "Failed updating prev/next targets: " + e.getMessage());
            }
        }

        Log.d("PlayerActivity", "updatePrevNextButtons outcomes: prevEpisode=" 
            + (prevEpisode != null ? prevEpisode.optDouble("number") : "null") 
            + ", nextEpisode=" 
            + (nextEpisode != null ? nextEpisode.optDouble("number") : "null"));

        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (prevButton != null) {
                    if (prevEpisode != null) {
                        prevButton.setAlpha(1.0f);
                        prevButton.setEnabled(true);
                        prevButton.setClickable(true);
                    } else {
                        prevButton.setAlpha(0.3f);
                        prevButton.setEnabled(false);
                        prevButton.setClickable(false);
                    }
                }
                if (nextButton != null) {
                    if (nextEpisode != null) {
                        nextButton.setAlpha(1.0f);
                        nextButton.setEnabled(true);
                        nextButton.setClickable(true);
                    } else {
                        nextButton.setAlpha(0.3f);
                        nextButton.setEnabled(false);
                        nextButton.setClickable(false);
                    }
                }
            }
        });
    }

    private void loadNewEpisode(JSONObject ep) {
        try {
            if (player != null) {
                player.stop();
                player.release();
                player = null;
            }
            
            skipButton.setVisibility(View.GONE);
            if (highlightsOverlayView != null) {
                highlightsOverlayView.setSkipTimes(null, 0);
            }
            
            currentEpisodeId = ep.getString("id");
            episodeNumber = ep.optDouble("number", 0.0);
            
            skipTimesArray = new JSONArray();
            hasSeekedToProgress = false;
            lastProgressTimeSecs = -1;
            hasFetchedSkipTimes = false;
            isFetchingSkipTimes = false;
            
            String epTitle = ep.optString("title", "");
            if (epTitle.isEmpty()) {
                titleTextView.setText("EP: " + formatEpisodeNumber(episodeNumber));
            } else {
                titleTextView.setText("EP: " + formatEpisodeNumber(episodeNumber) + " | " + epTitle);
            }
            
            updatePrevNextButtons();
            fetchHistoryAndSettings();
            fetchSourcesNatively(animeId, currentEpisodeId, episodeNumber, downloaded, subdub, provider);
            
        } catch (Exception e) {
            Log.e("PlayerActivity", "Failed to load new episode: " + e.getMessage());
            Toast.makeText(this, "Failed loading next episode: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private String formatEpisodeNumber(double epNum) {
        if (epNum == (long) epNum) {
            return String.format("%d", (long) epNum);
        } else {
            return String.format("%s", epNum);
        }
    }

    private void fetchSourcesNatively(final String animeId, final String ep, final double epNum, final boolean downloaded, final String subdub, final String provider) {
        android.util.Log.d("PlayerActivity", "fetchSourcesNatively: ep=" + ep + ", provider=" + provider + ", downloaded=" + downloaded);
        showHudOverlay("Fetching video sources...");
        hudTextView.setVisibility(View.VISIBLE);
        hudHandler.removeCallbacks(hudRunnable);

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject body = new JSONObject();
                    if (downloaded) {
                        body.put("ep", animeId);
                        body.put("epNum", epNum);
                        body.put("Downloaded", true);
                        body.put("subdub", subdub);
                    } else {
                        body.put("ep", ep);
                        body.put("Downloaded", false);
                        body.put("subdub", subdub);
                        body.put("provider", provider);
                    }

                    URL url = new URL("http://127.0.0.1:3459/api/watch");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    conn.setRequestProperty("Accept", "application/json");
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(15000);

                    try (OutputStream os = conn.getOutputStream()) {
                        byte[] input = body.toString().getBytes("utf-8");
                        os.write(input, 0, input.length);
                    }

                    int code = conn.getResponseCode();
                    if (code == 200) {
                        BufferedReader br = new BufferedReader(
                                new InputStreamReader(conn.getInputStream(), "utf-8"));
                        StringBuilder response = new StringBuilder();
                        String responseLine = null;
                        while ((responseLine = br.readLine()) != null) {
                            response.append(responseLine.trim());
                        }
                        
                        final JSONObject data = new JSONObject(response.toString());
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                onSourcesFetched(data);
                            }
                        });
                    } else {
                        throw new Exception("HTTP error code: " + code);
                    }
                } catch (final Exception e) {
                    Log.e("PlayerActivity", "Failed to fetch sources: " + e.getMessage());
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            hudTextView.setVisibility(View.GONE);
                            showErrorAndFinish("Failed to load video player resources: " + e.getMessage());
                        }
                    });
                }
            }
        }).start();
    }

    private void onSourcesFetched(JSONObject data) {
        try {
            hudTextView.setVisibility(View.GONE);

            sourcesArray = data.optJSONArray("sources");
            subtitlesArray = data.optJSONArray("subtitles");
            skipTimesArray = data.optJSONArray("skipTimes");

            if (sourcesArray == null) {
                sourcesArray = new JSONArray();
            }
            if (subtitlesArray == null) {
                subtitlesArray = new JSONArray();
            }
            if (skipTimesArray == null) {
                skipTimesArray = new JSONArray();
            }

            if (sourcesArray.length() == 0) {
                showErrorAndFinish("No video sources found for this episode.");
                return;
            }

            // Choose preferred source
            int preferredIndex = 0;
            for (int i = 0; i < sourcesArray.length(); i++) {
                String q = sourcesArray.getJSONObject(i).optString("quality", "");
                if ("1080p".equalsIgnoreCase(q)) {
                    preferredIndex = i;
                    break;
                }
            }
            if (preferredIndex == 0) {
                for (int i = 0; i < sourcesArray.length(); i++) {
                    String q = sourcesArray.getJSONObject(i).optString("quality", "");
                    if ("720p".equalsIgnoreCase(q)) {
                        preferredIndex = i;
                        break;
                    }
                }
            }

            currentSourceIndex = preferredIndex;
            JSONObject sourceObj = sourcesArray.getJSONObject(preferredIndex);
            currentVideoUrl = sourceObj.getString("url");

            // Extract headers
            final Map<String, String> headersMap = new HashMap<>();
            JSONObject hdrs = sourceObj.optJSONObject("headers");
            if (hdrs != null) {
                java.util.Iterator<String> keys = hdrs.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    headersMap.put(key, hdrs.getString(key));
                }
            }

            // Get DB clearance cookies/UA
            Map<String, String> dbHeaders = AppDatabase.getHeadersForUrl(this, currentVideoUrl);
            for (Map.Entry<String, String> entry : dbHeaders.entrySet()) {
                if (!headersMap.containsKey(entry.getKey())) {
                    headersMap.put(entry.getKey(), entry.getValue());
                }
            }

            String webViewCookie = CookieManager.getInstance().getCookie(currentVideoUrl);
            if (webViewCookie != null && !webViewCookie.isEmpty()) {
                headersMap.put("Cookie", webViewCookie);
            }

            initializePlayer(currentVideoUrl, headersMap);

        } catch (Exception e) {
            Log.e("PlayerActivity", "Error processing fetched sources: " + e.getMessage());
            showErrorAndFinish("Failed processing video sources: " + e.getMessage());
        }
    }

    private void showErrorAndFinish(String message) {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setMessage(message);
        builder.setPositiveButton("OK", new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                finish();
            }
        });
        builder.setCancelable(false);
        builder.show();
    }

    private void initializePlayer(String videoUrl, final Map<String, String> headers) {
        try {
            if (player != null) {
                player.release();
            }

            Log.d("PlayerActivity", "initializePlayer: videoUrl=" + videoUrl + ", headers=" + headers.toString());
            rawPlayer = new ExoPlayer.Builder(this).build();
            player = new ForwardingPlayer(rawPlayer) {
                @Override
                public Player.Commands getAvailableCommands() {
                    Player.Commands commands = super.getAvailableCommands();
                    Player.Commands.Builder builder = commands.buildUpon();
                    if (nextEpisode != null) {
                        builder.add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM);
                    } else {
                        builder.remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM);
                    }
                    if (prevEpisode != null) {
                        builder.add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM);
                    } else {
                        builder.remove(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM);
                    }
                    return builder.build();
                }

                @Override
                public boolean isCommandAvailable(int command) {
                    if (command == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM) {
                        return nextEpisode != null;
                    }
                    if (command == Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) {
                        return prevEpisode != null;
                    }
                    return super.isCommandAvailable(command);
                }

                @Override
                public void seekToNextMediaItem() {
                    if (nextEpisode != null) {
                        loadNewEpisode(nextEpisode);
                    }
                }

                @Override
                public void seekToPreviousMediaItem() {
                    if (prevEpisode != null) {
                        loadNewEpisode(prevEpisode);
                    }
                }
            };
            player.addListener(new androidx.media3.common.Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int playbackState) {
                    String stateString;
                    switch (playbackState) {
                        case androidx.media3.common.Player.STATE_IDLE:
                            stateString = "STATE_IDLE";
                            break;
                        case androidx.media3.common.Player.STATE_BUFFERING:
                            stateString = "STATE_BUFFERING";
                            break;
                        case androidx.media3.common.Player.STATE_READY:
                            stateString = "STATE_READY";
                            break;
                        case androidx.media3.common.Player.STATE_ENDED:
                            stateString = "STATE_ENDED";
                            break;
                        default:
                            stateString = "UNKNOWN";
                            break;
                    }
                    Log.d("PlayerActivity", "ExoPlayer playback state changed: " + stateString);
                }

                @Override
                public void onPlayerError(androidx.media3.common.PlaybackException error) {
                    Log.e("PlayerActivity", "ExoPlayer playback error: " + error.getMessage(), error);
                }
            });
            player.setTrackSelectionParameters(
                    player.getTrackSelectionParameters()
                            .buildUpon()
                            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                            .build()
            );
            playerView.setPlayer(player);

            CronetEngine cronetEngine = new CronetEngine.Builder(this).build();
            Executor executor = Executors.newSingleThreadExecutor();

            String userAgentString = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
            if (headers.containsKey("User-Agent")) {
                userAgentString = headers.get("User-Agent");
            } else if (headers.containsKey("user-agent")) {
                userAgentString = headers.get("user-agent");
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
                                    if (!headers.isEmpty()) {
                                        Map<String, String> mergedHeaders = new java.util.HashMap<>(dataSpec.httpRequestHeaders);
                                        mergedHeaders.putAll(headers);
                                        return dataSpec.buildUpon()
                                                .setHttpRequestHeaders(mergedHeaders)
                                                .build();
                                    }
                                    return dataSpec;
                                }
                            }
                    );

            // Wrap with KwikDataSource to strip PNG headers from obfuscated segments
            DataSource.Factory kwikFactory = () -> new KwikDataSource(resolvingFactory.createDataSource());

            // Load subtitle tracks if available
            List<MediaItem.SubtitleConfiguration> subtitleConfigurations = getSubtitleConfigurations();

            MediaItem mediaItem = new MediaItem.Builder()
                    .setUri(Uri.parse(videoUrl))
                    .setSubtitleConfigurations(subtitleConfigurations)
                    .build();

            MediaSource mediaSource = new DefaultMediaSourceFactory(kwikFactory)
                    .createMediaSource(mediaItem);

            rawPlayer.setMediaSource(mediaSource);
            applyResumePosition();
            player.prepare();
            player.play();

            // Set up highlights color bar marker in Seek Timeline
            setupSeekbarHighlights();

            // Start skip checker loop
            skipCheckHandler.removeCallbacks(skipCheckRunnable);
            skipCheckHandler.post(skipCheckRunnable);

        } catch (Exception e) {
            Toast.makeText(this, "Failed to initialize player: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            finish();
        }
    }

    private List<MediaItem.SubtitleConfiguration> getSubtitleConfigurations() {
        List<MediaItem.SubtitleConfiguration> configs = new ArrayList<>();
        if (subtitlesArray != null) {
            for (int i = 0; i < subtitlesArray.length(); i++) {
                try {
                    JSONObject subObj = subtitlesArray.getJSONObject(i);
                    String url = subObj.getString("url");
                    String lang = subObj.optString("lang", "Subtitle " + (i + 1));

                    MediaItem.SubtitleConfiguration config = new MediaItem.SubtitleConfiguration.Builder(Uri.parse(url))
                            .setMimeType(MimeTypes.TEXT_VTT)
                            .setLanguage(lang)
                            .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                            .build();
                    configs.add(config);
                } catch (Exception e) {
                    Log.e("PlayerActivity", "Failed parsing subtitle configurations: " + e.getMessage());
                }
            }
        }
        return configs;
    }

    private void setupSeekbarHighlights() {
        if (highlightsOverlayView != null && player != null) {
            highlightsOverlayView.setSkipTimes(skipTimesArray, player.getDuration());
        }
    }

    private void checkSkipIntervals(long currentSecs) {
        if (skipTimesArray == null || skipTimesArray.length() == 0) {
            skipButton.setVisibility(View.GONE);
            return;
        }
        try {
            for (int i = 0; i < skipTimesArray.length(); i++) {
                JSONObject st = skipTimesArray.getJSONObject(i);
                String skipType = st.optString("skip_type", "");
                JSONObject interval = st.optJSONObject("interval");
                if (interval != null) {
                    double start = interval.optDouble("start_time", 0.0);
                    double end = interval.optDouble("end_time", 0.0);
                    if (currentSecs >= start && currentSecs < end) {
                        final double skipTarget = end;
                        if (autoSkipIntro) {
                            if (player != null) {
                                player.seekTo((long) (skipTarget * 1000));
                                skipButton.setVisibility(View.GONE);
                                showHudOverlay("Skipped " + ("ed".equalsIgnoreCase(skipType) ? "Outro" : "Intro"));
                                return;
                            }
                        }
                        String btnText = "Skip Intro";
                        if ("ed".equalsIgnoreCase(skipType)) {
                            btnText = "Skip Outro";
                        }
                        skipButton.setText(btnText);
                        skipButton.setVisibility(View.VISIBLE);
                        skipButton.setOnClickListener(new View.OnClickListener() {
                            @Override
                            public void onClick(View v) {
                                if (player != null) {
                                    player.seekTo((long) (skipTarget * 1000));
                                    skipButton.setVisibility(View.GONE);
                                }
                            }
                        });
                        return;
                    }
                }
            }
        } catch (Exception e) {
            Log.e("PlayerActivity", "Error checking skip time bounds: " + e.getMessage());
        }
        skipButton.setVisibility(View.GONE);
    }

    private void showServerSelectionDialog() {
        if (sourcesArray == null || sourcesArray.length() == 0) {
            Toast.makeText(this, "No other servers available", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            final String[] items = new String[sourcesArray.length()];
            for (int i = 0; i < sourcesArray.length(); i++) {
                items[i] = sourcesArray.getJSONObject(i).optString("quality", "Source " + (i + 1));
            }

            AlertDialog.Builder builder = new AlertDialog.Builder(this);
            builder.setTitle("Select Server / Quality");
            builder.setSingleChoiceItems(items, currentSourceIndex, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    dialog.dismiss();
                    switchSource(which);
                }
            });
            builder.show();
        } catch (Exception e) {
            Log.e("PlayerActivity", "Failed loading server selector: " + e.getMessage());
        }
    }

    private void switchSource(int index) {
        if (sourcesArray == null || index < 0 || index >= sourcesArray.length()) return;
        try {
            currentSourceIndex = index;
            JSONObject sourceObj = sourcesArray.getJSONObject(index);
            final String newUrl = sourceObj.getString("url");

            // Extract custom headers
            final Map<String, String> newHeadersMap = new HashMap<>();
            JSONObject hdrs = sourceObj.optJSONObject("headers");
            if (hdrs != null) {
                java.util.Iterator<String> keys = hdrs.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    newHeadersMap.put(key, hdrs.getString(key));
                }
            }

            // Sync database headers
            Map<String, String> dbHeaders = AppDatabase.getHeadersForUrl(this, newUrl);
            for (Map.Entry<String, String> entry : dbHeaders.entrySet()) {
                if (!newHeadersMap.containsKey(entry.getKey())) {
                    newHeadersMap.put(entry.getKey(), entry.getValue());
                }
            }

            String webViewCookie = CookieManager.getInstance().getCookie(newUrl);
            if (webViewCookie != null && !webViewCookie.isEmpty()) {
                newHeadersMap.put("Cookie", webViewCookie);
            }

            String userAgentString = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
            if (newHeadersMap.containsKey("User-Agent")) {
                userAgentString = newHeadersMap.get("User-Agent");
            } else if (newHeadersMap.containsKey("user-agent")) {
                userAgentString = newHeadersMap.get("user-agent");
            }

            final Map<String, String> finalHeaders = newHeadersMap;
            final long currentPosition = player.getCurrentPosition();

            CronetEngine cronetEngine = new CronetEngine.Builder(this).build();
            Executor executor = Executors.newSingleThreadExecutor();

            CronetDataSource.Factory cronetDataSourceFactory =
                    new CronetDataSource.Factory(cronetEngine, executor)
                            .setUserAgent(userAgentString);

            ResolvingDataSource.Factory resolvingFactory =
                    new ResolvingDataSource.Factory(
                            cronetDataSourceFactory,
                            new ResolvingDataSource.Resolver() {
                                @Override
                                public DataSpec resolveDataSpec(DataSpec dataSpec) {
                                    if (!finalHeaders.isEmpty()) {
                                        Map<String, String> mergedHeaders = new java.util.HashMap<>(dataSpec.httpRequestHeaders);
                                        mergedHeaders.putAll(finalHeaders);
                                        return dataSpec.buildUpon()
                                                .setHttpRequestHeaders(mergedHeaders)
                                                .build();
                                    }
                                    return dataSpec;
                                }
                            }
                    );

            // Wrap with KwikDataSource to strip PNG headers from obfuscated segments
            DataSource.Factory kwikFactory = () -> new KwikDataSource(resolvingFactory.createDataSource());

            List<MediaItem.SubtitleConfiguration> subtitleConfigurations = getSubtitleConfigurations();

            MediaItem mediaItem = new MediaItem.Builder()
                    .setUri(Uri.parse(newUrl))
                    .setSubtitleConfigurations(subtitleConfigurations)
                    .build();

            MediaSource mediaSource = new DefaultMediaSourceFactory(kwikFactory)
                    .createMediaSource(mediaItem);

            rawPlayer.setMediaSource(mediaSource);
            player.prepare();
            player.seekTo(currentPosition);
            player.play();

            setupSeekbarHighlights();
            Toast.makeText(this, "Switched server to: " + sourceObj.optString("quality"), Toast.LENGTH_SHORT).show();

        } catch (Exception e) {
            Toast.makeText(this, "Failed to load new server: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void showSubtitlesSelectionDialog() {
        showSubtitlesSelectionDialog(null);
    }

    private void showSubtitlesSelectionDialog(final TextView txtSubtitle) {
        if (subtitlesArray == null || subtitlesArray.length() == 0) {
            Toast.makeText(this, "No subtitles available", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            final String[] items = new String[subtitlesArray.length() + 1];
            items[0] = "Subtitles Off";
            for (int i = 0; i < subtitlesArray.length(); i++) {
                items[i + 1] = subtitlesArray.getJSONObject(i).optString("lang", "Language " + (i + 1));
            }

            AlertDialog.Builder builder = new AlertDialog.Builder(this);
            builder.setTitle("Select Subtitles");
            builder.setSingleChoiceItems(items, selectedSubtitleIndex + 1, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    dialog.dismiss();
                    selectSubtitle(which - 1);
                    if (txtSubtitle != null) {
                        if (which == 0) {
                            txtSubtitle.setText("Off");
                        } else {
                            txtSubtitle.setText(items[which]);
                        }
                    }
                }
            });
            builder.show();
        } catch (Exception e) {
            Log.e("PlayerActivity", "Failed loading subtitle selector: " + e.getMessage());
        }
    }

    private void selectSubtitle(int index) {
        selectedSubtitleIndex = index;
        if (index == -1) {
            player.setTrackSelectionParameters(
                    player.getTrackSelectionParameters()
                            .buildUpon()
                            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                            .build()
            );
            Toast.makeText(this, "Subtitles turned off", Toast.LENGTH_SHORT).show();
        } else {
            try {
                JSONObject subObj = subtitlesArray.getJSONObject(index);
                String lang = subObj.optString("lang", "");
                player.setTrackSelectionParameters(
                        player.getTrackSelectionParameters()
                                .buildUpon()
                                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                                .setPreferredTextLanguage(lang)
                                .build()
                );
                Toast.makeText(this, "Subtitles selected: " + lang, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Log.e("PlayerActivity", "Failed selecting subtitle track: " + e.getMessage());
            }
        }
    }

    // Touch volume & brightness (vertical) and seek (horizontal) swipe overrides
    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        int width = getResources().getDisplayMetrics().widthPixels;
        int height = getResources().getDisplayMetrics().heightPixels;

        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                startX = event.getX();
                startY = event.getY();
                isDragging = false;
                isHorizontalDrag = false;
                accumulatedSeekSecs = 0;
                isLeft = startX < (width / 2f);
                if (player != null) {
                    seekStartPositionMs = player.getCurrentPosition();
                }
                break;

            case MotionEvent.ACTION_MOVE:
                float dx = Math.abs(event.getX() - startX);
                float dy = Math.abs(event.getY() - startY);

                // Determine gesture direction on first significant movement
                if (!isDragging && !isHorizontalDrag) {
                    if (dy > TOUCH_SLOP && dy > dx) {
                        // Vertical drag → volume / brightness
                        isDragging = true;
                        if (isLeft) {
                            AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                            startVal = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                        } else {
                            float brightness = getWindow().getAttributes().screenBrightness;
                            if (brightness < 0) {
                                try {
                                    brightness = Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS) / 255f;
                                } catch (Exception e) {
                                    brightness = 0.5f;
                                }
                            }
                            startVal = brightness;
                        }
                    } else if (dx > TOUCH_SLOP && dx > dy) {
                        // Horizontal drag → seek
                        isHorizontalDrag = true;
                    }
                }

                if (isDragging) {
                    float deltaY = startY - event.getY();
                    float percentChange = deltaY / height;

                    if (isLeft) {
                        AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                        int maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                        int newVol = (int) (startVal + (percentChange * maxVol));
                        newVol = Math.max(0, Math.min(maxVol, newVol));
                        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, newVol, 0);
                        showHudOverlay((int) ((newVol / (float) maxVol) * 100) + "%", R.drawable.ic_volume);
                    } else {
                        float newBrightness = startVal + percentChange;
                        newBrightness = Math.max(0.01f, Math.min(1.0f, newBrightness));
                        WindowManager.LayoutParams lp = getWindow().getAttributes();
                        lp.screenBrightness = newBrightness;
                        getWindow().setAttributes(lp);
                        showHudOverlay((int) (newBrightness * 100) + "%", R.drawable.ic_brightness);
                    }
                    return true;
                }

                if (isHorizontalDrag && player != null) {
                    float deltaX = event.getX() - startX;
                    // Scale: full screen width swipe = 90 seconds of seek
                    float seekScale = 90f;
                    accumulatedSeekSecs = (int) ((deltaX / width) * seekScale);

                    // Clamp so we don't seek past start or end
                    long duration = player.getDuration();
                    if (duration > 0) {
                        long targetMs = seekStartPositionMs + (accumulatedSeekSecs * 1000L);
                        if (targetMs < 0) {
                            accumulatedSeekSecs = (int) (-(seekStartPositionMs / 1000));
                        } else if (targetMs > duration) {
                            accumulatedSeekSecs = (int) ((duration - seekStartPositionMs) / 1000);
                        }
                    }

                    if (accumulatedSeekSecs != 0) {
                        String prefix = accumulatedSeekSecs > 0 ? "+" : "";
                        int icon = accumulatedSeekSecs > 0 ? R.drawable.ic_forward : R.drawable.ic_rewind;
                        showHudOverlay(prefix + accumulatedSeekSecs + "s", icon);
                    }
                    return true;
                }
                break;

            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (isDragging) {
                    isDragging = false;
                    hudHandler.removeCallbacks(hudRunnable);
                    hudHandler.postDelayed(hudRunnable, 800);
                    return true;
                }
                if (isHorizontalDrag) {
                    isHorizontalDrag = false;
                    // Apply the accumulated seek on finger lift
                    if (player != null && accumulatedSeekSecs != 0) {
                        long targetMs = seekStartPositionMs + (accumulatedSeekSecs * 1000L);
                        long duration = player.getDuration();
                        if (duration > 0) {
                            targetMs = Math.max(0, Math.min(targetMs, duration));
                        }
                        player.seekTo(targetMs);
                    }
                    accumulatedSeekSecs = 0;
                    hudHandler.removeCallbacks(hudRunnable);
                    hudHandler.postDelayed(hudRunnable, 800);
                    return true;
                }
                break;
        }
        return super.dispatchTouchEvent(event);
    }

    private Dialog settingsSheetDialog;

    private void showCustomSettingsDialog() {
        if (settingsSheetDialog != null && settingsSheetDialog.isShowing()) {
            settingsSheetDialog.dismiss();
        }

        settingsSheetDialog = new Dialog(this);
        settingsSheetDialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        settingsSheetDialog.setContentView(R.layout.player_settings_sheet);

        Window window = settingsSheetDialog.getWindow();
        if (window != null) {
            int width = (int) (320 * getResources().getDisplayMetrics().density);
            window.setLayout(width, ViewGroup.LayoutParams.MATCH_PARENT);
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.setGravity(Gravity.RIGHT);
            window.setWindowAnimations(android.R.style.Animation_InputMethod);
            
            // Immersive full screen for settings dialog
            window.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }

        // Layout menus
        final View layoutMainMenu = settingsSheetDialog.findViewById(R.id.layout_main_menu);
        final View layoutSpeedMenu = settingsSheetDialog.findViewById(R.id.layout_speed_menu);
        final View layoutSubtitlesMenu = settingsSheetDialog.findViewById(R.id.layout_subtitles_menu);
        final View layoutServerMenu = settingsSheetDialog.findViewById(R.id.layout_server_menu);

        // Server text
        final TextView txtServer = settingsSheetDialog.findViewById(R.id.txt_current_server);
        if (txtServer != null) {
            if (sourcesArray != null && currentSourceIndex >= 0 && currentSourceIndex < sourcesArray.length()) {
                try {
                    txtServer.setText(sourcesArray.getJSONObject(currentSourceIndex).optString("quality", "Source " + (currentSourceIndex + 1)));
                } catch (Exception e) {
                    txtServer.setText("Default");
                }
            } else {
                txtServer.setText("Default");
            }
        }

        // Speed text
        final TextView txtSpeed = settingsSheetDialog.findViewById(R.id.txt_current_speed);
        float currentSpeed = 1.0f;
        if (player != null) {
            currentSpeed = player.getPlaybackParameters().speed;
        }
        if (txtSpeed != null) {
            txtSpeed.setText(currentSpeed == 1.0f ? "Normal (1.0x)" : String.format("%.2fx", currentSpeed));
        }

        // Subtitles text
        final TextView txtSubtitle = settingsSheetDialog.findViewById(R.id.txt_current_subtitle);
        if (txtSubtitle != null) {
            if (selectedSubtitleIndex == -1 || subtitlesArray == null || subtitlesArray.length() == 0) {
                txtSubtitle.setText("Off");
            } else {
                try {
                    txtSubtitle.setText(subtitlesArray.getJSONObject(selectedSubtitleIndex).optString("lang", "On"));
                } catch (Exception e) {
                    txtSubtitle.setText("On");
                }
            }
        }

        // Containers
        final LinearLayout containerSpeed = settingsSheetDialog.findViewById(R.id.container_speed_options);
        final LinearLayout containerSubtitles = settingsSheetDialog.findViewById(R.id.container_subtitles_options);
        final LinearLayout containerServer = settingsSheetDialog.findViewById(R.id.container_server_options);

        // Server row click
        View rowServer = settingsSheetDialog.findViewById(R.id.row_server);
        if (rowServer != null) {
            rowServer.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (layoutMainMenu != null) layoutMainMenu.setVisibility(View.GONE);
                    if (layoutServerMenu != null) layoutServerMenu.setVisibility(View.VISIBLE);
                    populateServerOptions(containerServer, txtServer);
                }
            });
        }

        // Setup row click listeners
        View rowSpeed = settingsSheetDialog.findViewById(R.id.row_speed);
        if (rowSpeed != null) {
            rowSpeed.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (layoutMainMenu != null) layoutMainMenu.setVisibility(View.GONE);
                    if (layoutSpeedMenu != null) layoutSpeedMenu.setVisibility(View.VISIBLE);
                    populateSpeedOptions(containerSpeed, txtSpeed);
                }
            });
        }

        View rowSubtitles = settingsSheetDialog.findViewById(R.id.row_subtitles);
        if (rowSubtitles != null) {
            rowSubtitles.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (layoutMainMenu != null) layoutMainMenu.setVisibility(View.GONE);
                    if (layoutSubtitlesMenu != null) layoutSubtitlesMenu.setVisibility(View.VISIBLE);
                    populateSubtitlesOptions(containerSubtitles, txtSubtitle);
                }
            });
        }

        // Setup back buttons
        View btnBackServer = settingsSheetDialog.findViewById(R.id.btn_back_server);
        if (btnBackServer != null) {
            btnBackServer.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (layoutServerMenu != null) layoutServerMenu.setVisibility(View.GONE);
                    if (layoutMainMenu != null) layoutMainMenu.setVisibility(View.VISIBLE);
                }
            });
        }

        View btnBackSpeed = settingsSheetDialog.findViewById(R.id.btn_back_speed);
        if (btnBackSpeed != null) {
            btnBackSpeed.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (layoutSpeedMenu != null) layoutSpeedMenu.setVisibility(View.GONE);
                    if (layoutMainMenu != null) layoutMainMenu.setVisibility(View.VISIBLE);
                }
            });
        }

        View btnBackSubtitles = settingsSheetDialog.findViewById(R.id.btn_back_subtitles);
        if (btnBackSubtitles != null) {
            btnBackSubtitles.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (layoutSubtitlesMenu != null) layoutSubtitlesMenu.setVisibility(View.GONE);
                    if (layoutMainMenu != null) layoutMainMenu.setVisibility(View.VISIBLE);
                }
            });
        }

        settingsSheetDialog.show();
    }

    private View createOptionRow(String title, boolean isSelected, View.OnClickListener onClickListener) {
        LinearLayout row = new LinearLayout(this);
        row.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (int) (48 * getResources().getDisplayMetrics().density)
        ));
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(
                (int) (12 * getResources().getDisplayMetrics().density), 0,
                (int) (12 * getResources().getDisplayMetrics().density), 0
        );

        row.setBackgroundResource(R.drawable.ripple_white);
        row.setClickable(true);
        row.setFocusable(true);

        TextView textView = new TextView(this);
        LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f);
        textView.setLayoutParams(textParams);
        textView.setText(title);
        textView.setTextColor(isSelected ? 0xFF3B82F6 : 0xFFFFFFFF);
        textView.setTextSize(15);
        if (isSelected) {
            textView.setTypeface(null, Typeface.BOLD);
        }
        row.addView(textView);

        if (isSelected) {
            ImageView checkIcon = new ImageView(this);
            LinearLayout.LayoutParams checkParams = new LinearLayout.LayoutParams(
                    (int) (20 * getResources().getDisplayMetrics().density),
                    (int) (20 * getResources().getDisplayMetrics().density)
            );
            checkIcon.setLayoutParams(checkParams);
            checkIcon.setImageResource(R.drawable.ic_check);
            checkIcon.setColorFilter(0xFF3B82F6);
            row.addView(checkIcon);
        }

        row.setOnClickListener(onClickListener);
        return row;
    }

    private void populateSpeedOptions(final LinearLayout container, final TextView txtSpeed) {
        if (container == null) return;
        container.removeAllViews();

        final float[] speeds = {0.25f, 0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 1.75f, 2.0f};
        final String[] speedLabels = {"0.25x", "0.5x", "0.75x", "Normal (1.0x)", "1.25x", "1.5x", "1.75x", "2.0x"};

        float currentSpeed = 1.0f;
        if (player != null) {
            currentSpeed = player.getPlaybackParameters().speed;
        }

        for (int i = 0; i < speeds.length; i++) {
            final float speed = speeds[i];
            String label = speedLabels[i];
            boolean isSelected = Math.abs(speed - currentSpeed) < 0.05f;

            View row = createOptionRow(label, isSelected, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (player != null) {
                        player.setPlaybackSpeed(speed);
                        if (txtSpeed != null) {
                            txtSpeed.setText(speed == 1.0f ? "Normal (1.0x)" : String.format("%.2fx", speed));
                        }
                    }
                    populateSpeedOptions(container, txtSpeed);
                }
            });
            container.addView(row);
        }
    }

    private void populateSubtitlesOptions(final LinearLayout container, final TextView txtSubtitle) {
        if (container == null) return;
        container.removeAllViews();

        if (subtitlesArray == null || subtitlesArray.length() == 0) {
            TextView noSubText = new TextView(this);
            noSubText.setText("No subtitles available");
            noSubText.setTextColor(0x88FFFFFF);
            noSubText.setPadding(20, 20, 20, 20);
            container.addView(noSubText);
            return;
        }

        // Add "Off" row
        boolean isOffSelected = selectedSubtitleIndex == -1;
        View offRow = createOptionRow("Subtitles Off", isOffSelected, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                selectSubtitle(-1);
                if (txtSubtitle != null) txtSubtitle.setText("Off");
                populateSubtitlesOptions(container, txtSubtitle);
            }
        });
        container.addView(offRow);

        // Add language rows
        for (int i = 0; i < subtitlesArray.length(); i++) {
            final int index = i;
            String lang = "";
            try {
                lang = subtitlesArray.getJSONObject(i).optString("lang", "Language " + (i + 1));
            } catch (Exception e) {
                lang = "Language " + (i + 1);
            }
            final String finalLang = lang;
            boolean isSelected = selectedSubtitleIndex == index;

            View row = createOptionRow(lang, isSelected, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    selectSubtitle(index);
                    if (txtSubtitle != null) txtSubtitle.setText(finalLang);
                    populateSubtitlesOptions(container, txtSubtitle);
                }
            });
            container.addView(row);
        }
    }

    private void populateServerOptions(final LinearLayout container, final TextView txtServer) {
        if (container == null) return;
        container.removeAllViews();

        if (sourcesArray == null || sourcesArray.length() == 0) {
            TextView noSrc = new TextView(this);
            noSrc.setText("No servers available");
            noSrc.setTextColor(0x88FFFFFF);
            noSrc.setPadding(20, 20, 20, 20);
            container.addView(noSrc);
            return;
        }

        for (int i = 0; i < sourcesArray.length(); i++) {
            final int index = i;
            String label = "";
            try {
                label = sourcesArray.getJSONObject(i).optString("quality", "Source " + (i + 1));
            } catch (Exception e) {
                label = "Source " + (i + 1);
            }
            final String finalLabel = label;
            boolean isSelected = currentSourceIndex == index;

            View row = createOptionRow(label, isSelected, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (settingsSheetDialog != null) settingsSheetDialog.dismiss();
                    switchSource(index);
                }
            });
            container.addView(row);
        }
    }

    private void showHudOverlay(String text) {
        showHudOverlay(text, 0);
    }

    private void showHudOverlay(String text, int iconResId) {
        hudTextView.setText(text);
        if (iconResId != 0) {
            hudTextView.setCompoundDrawablesWithIntrinsicBounds(iconResId, 0, 0, 0);
            hudTextView.setCompoundDrawablePadding(20);
        } else {
            hudTextView.setCompoundDrawablesWithIntrinsicBounds(0, 0, 0, 0);
        }
        hudTextView.setVisibility(View.VISIBLE);
        hudHandler.removeCallbacks(hudRunnable);
    }

    private void reportProgress() {
        if (player == null || animeId == null || animeId.isEmpty()) return;
        final long currentPosition = player.getCurrentPosition();
        final long duration = player.getDuration();
        if (duration <= 0) return;

        final double currentSecs = currentPosition / 1000.0;
        final double durationSecs = duration / 1000.0;

        Executors.newSingleThreadExecutor().execute(new Runnable() {
            @Override
            public void run() {
                try {
                    URL url = new URL("http://127.0.0.1:3459/api/history/update");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(3000);
                    conn.setReadTimeout(3000);

                    JSONObject payload = new JSONObject();
                    payload.put("mediaId", animeId);
                    payload.put("type", "Anime");
                    payload.put("title", animeTitle);
                    payload.put("number", episodeNumber);
                    payload.put("currentTime", currentSecs);
                    payload.put("duration", durationSecs);
                    payload.put("timeSpent", 10);
                    payload.put("image", imageUrl);
                    payload.put("provider", provider);
                    if (malid != null && !malid.isEmpty()) {
                        payload.put("malid", malid);
                    }

                    String jsonStr = payload.toString();
                    try (OutputStream os = conn.getOutputStream()) {
                        byte[] input = jsonStr.getBytes("utf-8");
                        os.write(input, 0, input.length);
                    }
                    conn.getResponseCode();
                    conn.disconnect();
                } catch (Exception e) {
                    Log.e("PlayerActivity", "Failed updating watch history: " + e.getMessage());
                }
            }
        });
    }

    private synchronized void applyResumePosition() {
        if (player == null || hasSeekedToProgress || lastProgressTimeSecs <= 0) return;
        long seekPosMs = (long) (Math.max(0.0, lastProgressTimeSecs - 5.0) * 1000);
        player.seekTo(seekPosMs);
        hasSeekedToProgress = true;
    }

    private void fetchHistoryAndSettings() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                // 1. Fetch settings
                try {
                    URL url = new URL("http://127.0.0.1:3459/api/settings/get");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(3000);
                    conn.setReadTimeout(3000);
                    
                    JSONObject payload = new JSONObject();
                    payload.put("args", new JSONArray());
                    try (OutputStream os = conn.getOutputStream()) {
                        byte[] input = payload.toString().getBytes("utf-8");
                        os.write(input, 0, input.length);
                    }
                    
                    int code = conn.getResponseCode();
                    if (code == 200) {
                        BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "utf-8"));
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = br.readLine()) != null) {
                            sb.append(line);
                        }
                        JSONObject response = new JSONObject(sb.toString());
                        JSONObject result = response.optJSONObject("result");
                        if (result != null) {
                            JSONObject settings = result.optJSONObject("settings");
                            if (settings != null) {
                                autoSkipIntro = settings.optBoolean("autoSkipIntro", true);
                            }
                        }
                    }
                    conn.disconnect();
                } catch (Exception e) {
                    Log.e("PlayerActivity", "Error fetching settings: " + e.getMessage());
                }

                // 2. Fetch watch history progress
                if (animeId != null && !animeId.isEmpty()) {
                    try {
                        String urlStr = "http://127.0.0.1:3459/api/history/progress?mediaId=" 
                            + Uri.encode(animeId) + "&type=Anime";
                        URL url = new URL(urlStr);
                        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                        conn.setRequestMethod("GET");
                        conn.setConnectTimeout(3000);
                        conn.setReadTimeout(3000);
                        
                        int code = conn.getResponseCode();
                        if (code == 200) {
                            BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "utf-8"));
                            StringBuilder sb = new StringBuilder();
                            String line;
                            while ((line = br.readLine()) != null) {
                                sb.append(line);
                            }
                            JSONObject response = new JSONObject(sb.toString());
                            JSONObject lastProgress = response.optJSONObject("lastProgress");
                            if (lastProgress != null) {
                                double savedEpNum = lastProgress.optDouble("number", -1.0);
                                if (Math.abs(savedEpNum - episodeNumber) < 0.01) {
                                    lastProgressTimeSecs = lastProgress.optDouble("currentTime", 0.0);
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            applyResumePosition();
                                        }
                                    });
                                }
                            }
                        }
                        conn.disconnect();
                    } catch (Exception e) {
                        Log.e("PlayerActivity", "Error fetching watch progress: " + e.getMessage());
                    }
                }
            }
        }).start();
    }

    private boolean isFetchingSkipTimes = false;
    private boolean hasFetchedSkipTimes = false;

    private void fetchSkipTimesFromAniSkip(final String malId, final double epNum, final long durationMs) {
        if (isFetchingSkipTimes || hasFetchedSkipTimes) return;
        hasFetchedSkipTimes = true;
        isFetchingSkipTimes = true;
        
        final long durationSecs = durationMs / 1000;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    int epInt = (int) epNum;
                    String urlStr = "https://api.aniskip.com/v2/skip-times/" + malId + "/" + epInt 
                        + "?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&episodeLength=" + durationSecs;
                    
                    URL url = new URL(urlStr);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(5000);
                    conn.setReadTimeout(5000);
                    
                    int code = conn.getResponseCode();
                    if (code == 200) {
                        BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), "utf-8"));
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = br.readLine()) != null) {
                            sb.append(line);
                        }
                        JSONObject response = new JSONObject(sb.toString());
                        if (response.optBoolean("found", false)) {
                            JSONArray results = response.optJSONArray("results");
                            if (results != null) {
                                final JSONArray normalizedList = new JSONArray();
                                for (int i = 0; i < results.length(); i++) {
                                    JSONObject st = results.getJSONObject(i);
                                    JSONObject normalizedSt = new JSONObject();
                                    
                                    String skipType = st.optString("skipType", st.optString("skip_type", ""));
                                    normalizedSt.put("skip_type", skipType);
                                    
                                    JSONObject interval = st.optJSONObject("interval");
                                    if (interval != null) {
                                        JSONObject normalizedInterval = new JSONObject();
                                        double start = interval.optDouble("startTime", interval.optDouble("start_time", 0.0));
                                        double end = interval.optDouble("endTime", interval.optDouble("end_time", 0.0));
                                        normalizedInterval.put("start_time", start);
                                        normalizedInterval.put("end_time", end);
                                        normalizedSt.put("interval", normalizedInterval);
                                    }
                                    normalizedList.put(normalizedSt);
                                }
                                
                                runOnUiThread(new Runnable() {
                                    @Override
                                    public void run() {
                                        skipTimesArray = normalizedList;
                                        setupSeekbarHighlights();
                                    }
                                });
                            }
                        }
                    }
                    conn.disconnect();
                } catch (Exception e) {
                    Log.e("PlayerActivity", "Failed to fetch skip times from AniSkip: " + e.getMessage());
                } finally {
                    isFetchingSkipTimes = false;
                }
            }
        }).start();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) {
            reportProgress();
            player.pause();
        }
        skipCheckHandler.removeCallbacks(skipCheckRunnable);
    }

    @Override
    protected void onDestroy() {
        skipCheckHandler.removeCallbacks(skipCheckRunnable);
        if (player != null) {
            reportProgress();
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
