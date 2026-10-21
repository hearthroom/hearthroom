package club.hearthroom.app;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.*;

/**
 * The official website domains ("routes"). Only the built-in domains can ever be opened as the
 * app: TWA validation, the WebView allowlist and sign-in origins are registered per domain, and a
 * tampered remote list must not be able to send players to a look-alike site. The remote
 * routes.json may only reorder, disable or annotate them (design §5.1).
 */
final class Routes {
    /** Preference order; a route's number (線路一…四) is its index here and never follows remote order. */
    static final List<String> HOSTS = List.of("sukisuki.ai", "hearthroom.club", "sukisuki.chat", "sukisuki.pro");
    /** Existing installs only ever used this one; their sign-in lives there. */
    static final String LEGACY = "hearthroom.club";
    static final int MAX_BYTES = 16384;
    static final Routes BUILT_IN = new Routes(HOSTS, Set.of(), Map.of());

    private final List<String> order;
    private final Set<String> disabled;
    private final Map<String, JSONObject> notes;
    private Routes(List<String> order, Set<String> disabled, Map<String, JSONObject> notes) {
        this.order = List.copyOf(order); this.disabled = Set.copyOf(disabled); this.notes = Map.copyOf(notes);
    }
    List<String> order() { return order; }
    Set<String> disabled() { return disabled; }
    List<String> enabled() { List<String> out = new ArrayList<>(); for (String h : order) if (!disabled.contains(h)) out.add(h); return out; }
    String note(String host, String languageTag) { JSONObject n = notes.get(host); return n == null ? "" : Locales.pick(n, languageTag); }

    static int number(String host) { return HOSTS.indexOf(host) + 1; }
    static boolean isRoute(String host) { return host != null && HOSTS.contains(host); }

    /** Any malformed, unknown or unusable list is discarded whole; callers keep the last good one. */
    static Routes parse(String raw) {
        if (raw == null || raw.length() > MAX_BYTES) throw new IllegalArgumentException("Invalid route list");
        try {
            JSONObject o = new JSONObject(raw);
            if (o.getInt("schemaVersion") != 1) throw new IllegalArgumentException();
            JSONArray routes = o.getJSONArray("routes");
            List<String> order = new ArrayList<>(); Set<String> disabled = new HashSet<>(); Map<String, JSONObject> notes = new HashMap<>();
            for (int i = 0; i < routes.length(); i++) {
                JSONObject r = routes.getJSONObject(i);
                String host = r.getString("host");
                if (!isRoute(host) || order.contains(host)) throw new IllegalArgumentException();
                order.add(host);
                if (r.has("disabled")) { if (!(r.get("disabled") instanceof Boolean)) throw new IllegalArgumentException(); if (r.getBoolean("disabled")) disabled.add(host); }
                if (r.has("note")) {
                    JSONObject note = r.getJSONObject("note");
                    for (Iterator<String> keys = note.keys(); keys.hasNext();) if (note.getString(keys.next()).length() > 40) throw new IllegalArgumentException();
                    notes.put(host, note);
                }
            }
            for (String host : HOSTS) if (!order.contains(host)) order.add(host);
            if (disabled.size() == HOSTS.size()) throw new IllegalArgumentException();
            return new Routes(order, disabled, notes);
        } catch (Exception e) { throw new IllegalArgumentException("Invalid route list", e); }
    }

    /** Upgrades from the single-domain app keep their existing sign-in instead of landing on a new domain. */
    static String initialCurrent(String stored, boolean upgraded) {
        if (isRoute(stored)) return stored;
        return upgraded ? LEGACY : null;
    }

    /** One R2 bucket behind every family's download host; the current family is tried first. */
    static List<String> downloadHosts(String current) {
        List<String> out = new ArrayList<>();
        if (isRoute(current)) out.add("downloads." + current);
        for (String host : HOSTS) if (!host.equals(current)) out.add("downloads." + host);
        return out;
    }
}
