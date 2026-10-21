package club.hearthroom.app;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * A route is reachable when it serves our own Digital Asset Links file. A plain 200 is not enough:
 * hijacked DNS and Wi-Fi sign-in pages answer 200 as well. The file is small and already required
 * on every route for TWA verification.
 */
class RouteProbe {
    static final String PACKAGE = "club.hearthroom.app";
    static boolean valid(int status, String body) {
        if (status != 200 || body == null) return false;
        try {
            JSONArray statements = new JSONArray(body);
            for (int i = 0; i < statements.length(); i++) {
                JSONObject target = statements.getJSONObject(i).optJSONObject("target");
                if (target != null && "android_app".equals(target.optString("namespace")) && PACKAGE.equals(target.optString("package_name"))) return true;
            }
        } catch (Exception ignored) { /* Not our statement file. */ }
        return false;
    }
    /** Blocking; callers run each route on its own thread. Returns elapsed milliseconds, or -1 when unreachable. */
    long probe(String host) {
        long start = System.nanoTime();
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("https://" + host + "/.well-known/assetlinks.json").openConnection();
            c.setConnectTimeout((int) RoutePlanner.PROBE_TIMEOUT); c.setReadTimeout((int) RoutePlanner.PROBE_TIMEOUT);
            c.setInstanceFollowRedirects(false); c.setUseCaches(false);
            c.setRequestProperty("Cache-Control", "no-cache");
            c.setRequestProperty("User-Agent", "Hearthroom-Android/" + BuildConfig.VERSION_NAME);
            int status = c.getResponseCode();
            if (status != 200) return -1;
            try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096]; int n;
                while ((n = in.read(buffer)) != -1) { if (out.size() + n > 65536) return -1; out.write(buffer, 0, n); }
                return valid(status, out.toString(StandardCharsets.UTF_8.name())) ? (System.nanoTime() - start) / 1_000_000 : -1;
            }
        } catch (Exception e) { return -1; }
        finally { if (c != null) c.disconnect(); }
    }
}
