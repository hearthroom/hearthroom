package club.hearthroom.app;

import java.util.*;

/**
 * Chooses the route for one launch from probe results (design §2.3–2.4). Times are milliseconds
 * since the probes started. The current route is where the player is signed in, so it is kept
 * even when another route is faster; switching changes sign-in and is never silent.
 */
final class RoutePlanner {
    /** Cold connections to the preferred-ingress domains measured 3.5–3.7 s. Every probe ends by now, so
     *  "nothing reachable" is known at this point, inside the design's 6 s ceiling. */
    static final long PROBE_TIMEOUT = 5000;
    /** After the first success, wait this long for a route earlier in preference order. */
    static final long PREFERENCE_WINDOW = 600;
    /** UI timings that belong to the same budget: the waiting screen, its slower wording, the switch notice. */
    static final long SHOW_WAITING = 800, SLOW = 3000, SWITCH_NOTICE = 1500;

    enum Kind { WAIT, OPEN, CHOOSE, UNREACHABLE }
    static final class Decision {
        final Kind kind; final String host; final boolean switched;
        Decision(Kind kind, String host, boolean switched) { this.kind = kind; this.host = host; this.switched = switched; }
    }
    private static final Decision WAITING = new Decision(Kind.WAIT, null, false);

    private final List<String> enabled;
    private final String current, link;
    private final boolean fixed;
    private final Map<String, Long> ok = new HashMap<>(), failed = new HashMap<>();
    private Decision decided;

    RoutePlanner(List<String> enabled, String current, boolean fixed) { this(enabled, current, fixed, null); }
    /** A followed link tries its own domain first, then the signed-in route; neither counts as switching. */
    RoutePlanner(List<String> enabled, String current, boolean fixed, String link) {
        this.enabled = List.copyOf(enabled); this.current = current; this.fixed = fixed;
        this.link = link == null || link.equals(current) ? null : link;
    }
    void result(String host, boolean reachable, long at) {
        if (ok.containsKey(host) || failed.containsKey(host)) return;
        (reachable && at < PROBE_TIMEOUT ? ok : failed).put(host, at);
    }
    private boolean pending(String host, long now) { return !ok.containsKey(host) && !failed.containsKey(host) && now < PROBE_TIMEOUT; }

    Decision decide(long now) {
        if (decided == null) { Decision d = evaluate(now); if (d.kind != Kind.WAIT) decided = d; return d; }
        return decided;
    }
    private Decision evaluate(long now) {
        if (link != null && enabled.contains(link)) {
            if (ok.containsKey(link)) return new Decision(Kind.OPEN, link, false);
            if (pending(link, now)) return WAITING;
        }
        boolean usable = current != null && enabled.contains(current);
        if (usable && ok.containsKey(current)) return new Decision(Kind.OPEN, current, false);
        if (usable && pending(current, now)) return WAITING;
        if (current != null && fixed) return new Decision(Kind.CHOOSE, null, false);
        String best = null; long firstSuccess = Long.MAX_VALUE; boolean earlierPending = false, anyPending = false;
        for (String host : enabled) {
            if (host.equals(current) || host.equals(link)) continue;
            if (ok.containsKey(host)) { if (best == null) best = host; firstSuccess = Math.min(firstSuccess, ok.get(host)); }
            else if (pending(host, now)) { anyPending = true; if (best == null) earlierPending = true; }
        }
        if (best != null && (!earlierPending || now >= firstSuccess + PREFERENCE_WINDOW)) return new Decision(Kind.OPEN, best, current != null);
        if (best == null && !anyPending) return new Decision(Kind.UNREACHABLE, null, false);
        return WAITING;
    }
}
