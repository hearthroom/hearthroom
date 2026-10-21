package club.hearthroom.app;

/** When a release found in the background is shown, and how often the background work runs. */
final class UpdatePolicy {
    static final long LATER = 3 * 86_400_000L, BACKGROUND_INTERVAL = 6 * 3_600_000L;
    static boolean prompt(long available, long installed, long deferred, long deferredAt, long now) {
        if (available <= installed) return false;
        return available != deferred || now - deferredAt >= LATER || now < deferredAt;
    }
    static boolean due(long last, long now) { return now - last >= BACKGROUND_INTERVAL || now < last; }
}
