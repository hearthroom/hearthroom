package club.hearthroom.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/** Shared native layout rules: system-bar insets, a 480dp content column, and fades that respect "remove animations". */
final class Ui {
    static void insets(View root) {
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }
    /** Centers content at most 480dp wide with 24dp gutters, so tablets and landscape do not stretch it. */
    static void column(View... views) {
        for (View view : views) view.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            float dp = v.getResources().getDisplayMetrics().density;
            int side = Math.max((int) (24 * dp), (int) ((r - l - 480 * dp) / 2));
            if (v.getPaddingLeft() != side) v.post(() -> v.setPadding(side, v.getPaddingTop(), side, v.getPaddingBottom()));
        });
    }
    static boolean animations() { return ValueAnimator.areAnimatorsEnabled(); }
    static void fadeIn(View view, long ms) {
        if (view.getVisibility() == View.VISIBLE) return;
        view.setVisibility(View.VISIBLE);
        if (animations()) { view.setAlpha(0f); view.animate().alpha(1f).setDuration(ms); }
    }
    static void fadeOut(View view, long ms) {
        if (view.getVisibility() != View.VISIBLE) return;
        if (!animations()) { view.setVisibility(View.GONE); return; }
        view.animate().alpha(0f).setDuration(ms).withEndAction(() -> view.setVisibility(View.GONE));
    }
    static String routeName(Context context, String host) {
        int[] names = {R.string.route_1, R.string.route_2, R.string.route_3, R.string.route_4};
        return context.getString(names[Routes.number(host) - 1]);
    }
}
