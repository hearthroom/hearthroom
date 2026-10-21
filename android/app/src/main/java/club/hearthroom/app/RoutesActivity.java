package club.hearthroom.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.*;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The routes screen (S3), also shown when nothing is reachable (S2). Returns the chosen route to
 * the caller, which opens it; choosing a route by hand turns automatic selection off.
 */
public final class RoutesActivity extends Activity {
    static final String REASON = "reason", HOST = "host", SWITCHED = "switched";
    static final String UNREACHABLE = "unreachable", OFFLINE = "offline", FIXED_UNAVAILABLE = "fixed", FROM_SHORTCUT = "shortcut", FROM_WEB = "web";
    static final int RESULT_UPDATES = RESULT_FIRST_USER;
    private final Handler main = new Handler(Looper.getMainLooper());
    private ExecutorService probes;
    private final Map<String, Long> latency = new HashMap<>(), answered = new HashMap<>();
    private long started;
    private final Map<String, View> rows = new HashMap<>();
    RouteProbe probe = new RouteProbe();
    private RouteStore store;
    private Routes routes;
    private Switch auto;
    private Button open;
    private int round;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.routes);
        Ui.insets(findViewById(R.id.routes_root));
        Ui.column(findViewById(R.id.column));
        View footer = findViewById(R.id.footer);
        footer.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> padFooter());
        layoutFooter();
        store = new RouteStore(this);
        routes = store.routes();
        String reason = getIntent().getStringExtra(REASON);
        if (UNREACHABLE.equals(reason) || OFFLINE.equals(reason)) {
            boolean offline = OFFLINE.equals(reason);
            findViewById(R.id.failure).setVisibility(View.VISIBLE);
            ((TextView) findViewById(R.id.failure_title)).setText(offline ? R.string.offline_title : R.string.unreachable_title);
            ((TextView) findViewById(R.id.failure_body)).setText(offline ? R.string.offline_body : R.string.unreachable_body);
            View settings = findViewById(R.id.network_settings);
            settings.setVisibility(offline ? View.VISIBLE : View.GONE);
            settings.setOnClickListener(v -> { try { startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS)); } catch (ActivityNotFoundException ignored) {} });
            findViewById(R.id.retry).setOnClickListener(v -> recheck());
        }
        findViewById(R.id.back).setOnClickListener(v -> finish());
        findViewById(R.id.recheck).setOnClickListener(v -> { Background.refresh(this, true); recheck(); });
        auto = findViewById(R.id.auto);
        auto.setChecked(!store.fixed());
        auto.setOnCheckedChangeListener((b, on) -> store.setFixed(!on));
        findViewById(R.id.auto_row).setOnClickListener(v -> auto.toggle());
        open = findViewById(R.id.open);
        open.setOnClickListener(v -> choose(store.current()));
        ((TextView) findViewById(R.id.version)).setText(getString(R.string.routes_version, BuildConfig.VERSION_NAME));
        findViewById(R.id.check_updates).setOnClickListener(v -> { setResult(RESULT_UPDATES); finish(); });
        LinearLayout list = findViewById(R.id.rows);
        String language = getResources().getConfiguration().getLocales().get(0).toLanguageTag();
        for (String host : routes.enabled()) {
            View row = getLayoutInflater().inflate(R.layout.route_row, list, false);
            ((TextView) row.findViewById(R.id.row_name)).setText(Ui.routeName(this, host));
            ((TextView) row.findViewById(R.id.row_host)).setText(host);
            String note = routes.note(host, language);
            if (!note.isEmpty()) { TextView tag = row.findViewById(R.id.row_tag); tag.setText(note); tag.setVisibility(View.VISIBLE); }
            row.setOnClickListener(v -> tap(host));
            rows.put(host, row); list.addView(row);
        }
        recheck();
    }
    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        layoutFooter();
    }
    private void layoutFooter() {
        View footer = findViewById(R.id.footer);
        LinearLayout parent = findViewById(getResources().getConfiguration().screenHeightDp < 480 ? R.id.column : R.id.routes_root);
        if (footer.getParent() != parent) {
            ((ViewGroup) footer.getParent()).removeView(footer);
            parent.addView(footer);
        }
        padFooter();
    }
    private void padFooter() {
        View footer = findViewById(R.id.footer);
        float density = getResources().getDisplayMetrics().density;
        int side = footer.getParent() == findViewById(R.id.column) ? 0
            : Math.max((int) (24 * density), (int) ((footer.getWidth() - 480 * density) / 2));
        if (footer.getPaddingLeft() != side) footer.setPadding(side, footer.getPaddingTop(), side, footer.getPaddingBottom());
    }
    /** Every row re-tests on its own and updates as soon as its answer arrives. */
    private void recheck() {
        if (probes != null) probes.shutdownNow();
        probes = Executors.newFixedThreadPool(Routes.HOSTS.size());
        latency.clear(); int run = ++round; started = android.os.SystemClock.uptimeMillis();
        findViewById(R.id.retry).setEnabled(false);
        for (String host : rows.keySet()) {
            render(host);
            probes.execute(() -> { long ms = probe.probe(host); main.post(() -> { if (run != round || isFinishing()) return; latency.put(host, ms); answered.put(host, android.os.SystemClock.uptimeMillis() - started); render(host); settled();
                main.postDelayed(() -> { if (run == round && !isFinishing()) settled(); }, RoutePlanner.PREFERENCE_WINDOW); }); });
        }
        render(null);
    }
    private void settled() {
        if (latency.size() == rows.size()) findViewById(R.id.retry).setEnabled(true);
        if (findViewById(R.id.failure).getVisibility() != View.VISIBLE) return;
        // From "nothing reachable": once a route answers, automatic mode opens it by the same rules as launch.
        String current = store.current();
        if (store.fixed()) { if (current != null && reachable(current)) choose(current); return; }
        RoutePlanner planner = new RoutePlanner(routes.enabled(), current, false);
        for (String host : latency.keySet()) planner.result(host, reachable(host), answered.get(host));
        RoutePlanner.Decision d = planner.decide(latency.size() == rows.size() ? RoutePlanner.PROBE_TIMEOUT : android.os.SystemClock.uptimeMillis() - started);
        // The launcher announces a switch before opening, as at launch.
        if (d.kind == RoutePlanner.Kind.OPEN) { setResult(RESULT_OK, new Intent().putExtra(HOST, d.host).putExtra(SWITCHED, d.switched)); finish(); }
    }
    private boolean reachable(String host) { Long ms = latency.get(host); return ms != null && ms >= 0; }
    private void render(String only) {
        String current = store.current(), switched = store.autoSwitched();
        for (Map.Entry<String, View> e : rows.entrySet()) {
            String host = e.getKey(); View row = e.getValue();
            if (only != null && !only.equals(host)) continue;
            boolean isCurrent = host.equals(current);
            row.findViewById(R.id.row_check).setVisibility(isCurrent ? View.VISIBLE : View.INVISIBLE);
            ((TextView) row.findViewById(R.id.row_name)).setTypeface(android.graphics.Typeface.create(isCurrent ? "sans-serif-medium" : "sans-serif", android.graphics.Typeface.NORMAL));
            TextView tag = row.findViewById(R.id.row_tag);
            String note = routes.note(host, getResources().getConfiguration().getLocales().get(0).toLanguageTag());
            String label = isCurrent ? getString(host.equals(switched) ? R.string.route_switched_here : R.string.route_current) : store.visited(host) ? getString(R.string.route_visited) : "";
            String text = note.isEmpty() ? label : label.isEmpty() ? note : label + " · " + note;
            tag.setText(text); tag.setVisibility(text.isEmpty() ? View.GONE : View.VISIBLE);
            TextView state = row.findViewById(R.id.row_status);
            Long ms = latency.get(host);
            state.setText(ms == null ? getString(R.string.route_checking) : ms < 0 ? getString(R.string.route_unreachable) : getString(R.string.route_latency, Math.round(ms / 10.0) * 10));
            state.setTextColor(getColor(ms != null && ms < 0 ? R.color.danger : R.color.muted));
            row.setContentDescription(Ui.routeName(this, host) + ", " + host + (text.isEmpty() ? "" : ", " + text) + ", " + state.getText());
        }
        boolean blocked = current == null || latency.containsKey(current) && !reachable(current);
        open.setText(current == null ? getString(R.string.open_site) : getString(R.string.routes_open, Ui.routeName(this, current)));
        open.setEnabled(current != null && reachable(current));
        // S2 has one primary action: retry. Keep only the version row in its footer.
        boolean failure = findViewById(R.id.failure).getVisibility() == View.VISIBLE;
        open.setVisibility(failure ? View.GONE : View.VISIBLE);
        findViewById(R.id.pick_working).setVisibility(blocked && current != null && !failure ? View.VISIBLE : View.GONE);
    }
    private void tap(String host) {
        if (latency.get(host) == null) return; // Still checking; its row says so.
        if (!reachable(host)) { View s = rows.get(host).findViewById(R.id.row_status); if (Ui.animations()) { s.setAlpha(0.2f); s.animate().alpha(1f).setDuration(400); } return; }
        if (host.equals(store.current()) || store.visited(host)) { pick(host); return; }
        confirm(host);
    }
    /** S3a: a route this phone has not opened needs its own sign-in, so say so first. */
    private void confirm(String host) {
        Dialog sheet = new Dialog(this);
        sheet.requestWindowFeature(Window.FEATURE_NO_TITLE);
        sheet.setContentView(R.layout.switch_sheet);
        ((TextView) sheet.findViewById(R.id.sheet_title)).setText(getString(R.string.switch_title, Ui.routeName(this, host)));
        sheet.findViewById(R.id.sheet_confirm).setOnClickListener(v -> { sheet.dismiss(); pick(host); });
        sheet.findViewById(R.id.sheet_cancel).setOnClickListener(v -> sheet.dismiss());
        sheet.setCanceledOnTouchOutside(true);
        Window w = sheet.getWindow();
        w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        w.setGravity(Gravity.BOTTOM);
        sheet.show();
    }
    /** A route chosen by hand is kept even when it later fails: automatic selection turns off. */
    private void pick(String host) {
        store.setFixed(true); auto.setChecked(false);
        choose(host);
    }
    private void choose(String host) {
        if (host == null) return;
        store.opened(host, false);
        setResult(RESULT_OK, new Intent().putExtra(HOST, host)); finish();
    }
    @Override protected void onDestroy() { if (probes != null) probes.shutdownNow(); main.removeCallbacksAndMessages(null); super.onDestroy(); }
}
