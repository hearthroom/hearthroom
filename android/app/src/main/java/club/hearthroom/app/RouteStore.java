package club.hearthroom.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import java.util.HashSet;
import java.util.Set;

/** App-private launch state (not backed up). No player identifiers: only which official routes this phone used. */
final class RouteStore {
    private final SharedPreferences prefs;
    private final Context context;
    RouteStore(Context context) { this.context = context.getApplicationContext(); prefs = this.context.getSharedPreferences("routes", Context.MODE_PRIVATE); }

    /** The route last actually opened. Upgrades from the single-domain app start on its domain, already signed in. */
    String current() {
        String stored = prefs.getString("current", null), current = Routes.initialCurrent(stored, upgraded());
        if (current != null && !current.equals(stored)) { prefs.edit().putString("current", current).apply(); visit(current); }
        return current;
    }
    private boolean upgraded() {
        try { PackageInfo p = context.getPackageManager().getPackageInfo(context.getPackageName(), 0); return p.firstInstallTime != p.lastUpdateTime; }
        catch (Exception e) { return false; }
    }
    boolean fixed() { return prefs.getBoolean("fixed", false); }
    void setFixed(boolean fixed) { prefs.edit().putBoolean("fixed", fixed).apply(); }
    /** Opening a route makes it current. An automatic switch stays marked until the route changes again. */
    void opened(String host, boolean automatic) {
        SharedPreferences.Editor edit = prefs.edit().putString("current", host);
        if (automatic) edit.putString("switched", host); else if (!host.equals(prefs.getString("current", null))) edit.remove("switched");
        edit.apply(); visit(host);
    }
    String autoSwitched() { return prefs.getString("switched", null); }
    boolean visited(String host) { return prefs.getStringSet("visited", Set.of()).contains(host); }
    void visit(String host) { Set<String> v = new HashSet<>(prefs.getStringSet("visited", Set.of())); if (v.add(host)) prefs.edit().putStringSet("visited", v).apply(); }

    /** The last valid remote list, or the built-in one. */
    Routes routes() {
        try { String raw = prefs.getString("routes", null); return raw == null ? Routes.BUILT_IN : Routes.parse(raw); }
        catch (IllegalArgumentException e) { return Routes.BUILT_IN; }
    }
    void saveRoutes(String raw) { prefs.edit().putString("routes", raw).apply(); }
    UpdateManifest knownRelease() {
        try { String raw = prefs.getString("release", null); return raw == null ? null : UpdateManifest.parse(raw); }
        catch (IllegalArgumentException e) { return null; }
    }
    void saveRelease(String raw) { prefs.edit().putString("release", raw).apply(); }
    void defer(int versionCode, long now) { prefs.edit().putInt("deferred", versionCode).putLong("deferredAt", now).apply(); }
    int deferred() { return prefs.getInt("deferred", 0); }
    long deferredAt() { return prefs.getLong("deferredAt", 0); }
    long lastBackground() { return prefs.getLong("background", 0); }
    void backgroundDone(long now) { prefs.edit().putLong("background", now).apply(); }
}
