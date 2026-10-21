package club.hearthroom.app;

import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.lang.reflect.Field;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Controls only the network edges (route probes, release check) while the real Activities,
 * lifecycle and preferences run. Screenshots are written when the runner gets -e screens <prefix>.
 */
final class Fixtures implements Application.ActivityLifecycleCallbacks {
    final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    final Context context = instrumentation.getTargetContext();
    final Probe probe = new Probe();
    final Releases client = new Releases();
    private final Application application = (Application) context.getApplicationContext();
    volatile Activity launcher, routes;

    /** Per-route answer: delay in ms, and whether it is reachable. Unlisted routes never answer. */
    static final class Probe extends RouteProbe {
        final Map<String, long[]> answers = new ConcurrentHashMap<>();
        void answer(String host, long delay, boolean ok) { answers.put(host, new long[]{delay, ok ? 1 : 0}); }
        @Override long probe(String host) {
            long[] a = answers.get(host);
            if (a == null) { SystemClock.sleep(RoutePlanner.PROBE_TIMEOUT + 200); return -1; }
            SystemClock.sleep(a[0]);
            return a[1] == 1 ? Math.max(1, a[0]) : -1;
        }
    }
    /** The release check never answers unless released, so a test proves the launch does not wait for it. */
    static final class Releases extends UpdateClient {
        final CountDownLatch release = new CountDownLatch(1);
        volatile UpdateManifest manifest;
        final java.util.concurrent.atomic.AtomicInteger checks = new java.util.concurrent.atomic.AtomicInteger();
        Releases() { super(Routes.downloadHosts(null)); }
        @Override UpdateManifest check() throws IOException {
            checks.incrementAndGet();
            try { if (!release.await(30, TimeUnit.SECONDS)) throw new IOException("Fixture timed out"); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IOException("Cancelled fixture", e); }
            if (manifest == null) throw new IOException("Controlled failure");
            return manifest;
        }
        @Override Routes routes() throws IOException { throw new IOException("Not served"); }
    }
    static String manifest(long versionCode) {
        return "{\"schemaVersion\":1,\"channel\":\"stable\",\"packageId\":\"club.hearthroom.app\",\"versionCode\":" + versionCode + ",\"versionName\":\"1.0.99\",\"downloadUrl\":\"https://downloads.hearthroom.club/latest.apk\",\"sha256\":\"" + "0".repeat(64) + "\",\"size\":1,\"releaseNotes\":{\"en\":\"Opening the app no longer waits for the update check.\",\"zh-Hant\":\"開啟 App 不再等待檢查更新。\"}}";
    }

    Fixtures start(String current, boolean fixed) {
        // Background refresh is due-gated; mark it done so no live request runs during a test.
        context.getSharedPreferences("routes", Context.MODE_PRIVATE).edit().clear()
            .putString("current", current).putBoolean("fixed", fixed).putLong("background", System.currentTimeMillis()).commit();
        application.registerActivityLifecycleCallbacks(this);
        return this;
    }
    void stop() {
        client.release.countDown();
        instrumentation.runOnMainSync(() -> { for (Activity a : new Activity[]{routes, launcher}) if (a != null) a.finish(); });
        application.unregisterActivityLifecycleCallbacks(this);
    }
    RouteStore store() { return new RouteStore(context); }
    private static void set(Object target, String name, Object value) {
        try { Field f = target.getClass().getDeclaredField(name); f.setAccessible(true); f.set(target, value); }
        catch (Exception e) { throw new AssertionError(e); }
    }
    @Override public void onActivityPreCreated(Activity activity, Bundle state) {
        if (activity instanceof MainActivity) { set(activity, "probe", probe); set(activity, "client", client); launcher = activity; }
        if (activity instanceof RoutesActivity) { set(activity, "probe", probe); routes = activity; }
    }
    void waitFor(String what, java.util.function.BooleanSupplier condition, long ms) {
        long until = SystemClock.uptimeMillis() + ms;
        while (SystemClock.uptimeMillis() < until) {
            boolean[] ok = {false};
            instrumentation.runOnMainSync(() -> ok[0] = condition.getAsBoolean());
            if (ok[0]) return;
            SystemClock.sleep(50);
        }
        throw new AssertionError("Timed out waiting for " + what);
    }
    /** Evidence for visual review; a no-op unless the run asks for screenshots. */
    void screen(String name) {
        String prefix = InstrumentationRegistry.getArguments().getString("screens");
        if (prefix == null) return;
        instrumentation.waitForIdleSync(); SystemClock.sleep(400);
        Bitmap shot = instrumentation.getUiAutomation().takeScreenshot();
        File dir = context.getExternalFilesDir("screens");
        try (FileOutputStream out = new FileOutputStream(new File(dir, prefix + "-" + name + ".png"))) { shot.compress(Bitmap.CompressFormat.PNG, 100, out); }
        catch (IOException e) { throw new AssertionError(e); }
    }
    public void onActivityCreated(Activity a, Bundle b) {}
    public void onActivityStarted(Activity a) {}
    public void onActivityResumed(Activity a) {}
    public void onActivityPaused(Activity a) {}
    public void onActivityStopped(Activity a) {}
    public void onActivitySaveInstanceState(Activity a, Bundle b) {}
    public void onActivityDestroyed(Activity a) {}
}
