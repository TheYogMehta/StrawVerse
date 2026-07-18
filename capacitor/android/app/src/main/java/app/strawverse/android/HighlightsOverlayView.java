package app.strawverse.android;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;
import org.json.JSONArray;
import org.json.JSONObject;

public class HighlightsOverlayView extends View {
    private JSONArray skipTimesArray;
    private long durationMs;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF rect = new RectF();
    private View timeBarView;

    public HighlightsOverlayView(Context context) {
        super(context);
        paint.setStyle(Paint.Style.FILL);
    }

    public void setSkipTimes(JSONArray skipTimesArray, long durationMs) {
        this.skipTimesArray = skipTimesArray;
        this.durationMs = durationMs;
        invalidate();
    }

    public void setTimeBarView(View timeBarView) {
        this.timeBarView = timeBarView;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (skipTimesArray == null || durationMs <= 0) return;

        float timeBarAlpha = 1.0f;
        if (timeBarView != null) {
            if (timeBarView.getVisibility() != View.VISIBLE) {
                return;
            }
            timeBarAlpha = timeBarView.getAlpha();
            if (timeBarAlpha <= 0.01f) {
                return;
            }
        }

        int width = getWidth();
        int height = getHeight();

        canvas.save();

        if (timeBarView != null) {
            canvas.translate(timeBarView.getTranslationX(), timeBarView.getTranslationY());
            canvas.scale(timeBarView.getScaleX(), timeBarView.getScaleY(), width / 2.0f, height / 2.0f);
        }

        float density = getResources().getDisplayMetrics().density;
        float paddingLeft = 12 * density;
        float paddingRight = 12 * density;
        float drawableWidth = width - paddingLeft - paddingRight;

        float trackHeight = 4 * density;
        float top = (height - trackHeight) / 2.0f;
        float bottom = top + trackHeight;

        for (int i = 0; i < skipTimesArray.length(); i++) {
            try {
                JSONObject st = skipTimesArray.getJSONObject(i);
                String skipType = st.optString("skip_type", "");
                JSONObject interval = st.optJSONObject("interval");
                if (interval != null) {
                    double start = interval.optDouble("start_time", 0.0);
                    double end = interval.optDouble("end_time", 0.0);

                    float startX = paddingLeft + (float) ((start * 1000.0 / durationMs) * drawableWidth);
                    float endX = paddingLeft + (float) ((end * 1000.0 / durationMs) * drawableWidth);

                    startX = Math.max(paddingLeft, Math.min(startX, width - paddingRight));
                    endX = Math.max(paddingLeft, Math.min(endX, width - paddingRight));

                    if (endX > startX) {
                        int baseAlpha = 140; // 55% of 255
                        int targetAlpha = (int) (baseAlpha * timeBarAlpha);
                        
                        if ("ed".equalsIgnoreCase(skipType) || "mixed-ed".equalsIgnoreCase(skipType)) {
                            paint.setColor(0xFFF97316); // Fully opaque orange
                        } else {
                            paint.setColor(0xFF3B82F6); // Fully opaque blue
                        }
                        paint.setAlpha(targetAlpha);

                        rect.set(startX, top, endX, bottom);
                        canvas.drawRoundRect(rect, 2 * density, 2 * density, paint);
                    }
                }
            } catch (Exception e) {
                // Ignore
            }
        }
        canvas.restore();
    }
}
