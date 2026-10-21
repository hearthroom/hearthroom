package club.hearthroom.app;

import android.content.Context;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Release and route-list checks that never hold up opening the site. Results are stored and used
 * at the next launch, because a TWA leaves the app no screen to show them on afterwards.
 */
final class Background {
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private static volatile boolean running;
    static void refresh(Context context, boolean force) {
        RouteStore store = new RouteStore(context);
        if (running || !force && !UpdatePolicy.due(store.lastBackground(), System.currentTimeMillis())) return;
        running = true;
        WORKER.execute(() -> {
            try {
                UpdateClient client = new UpdateClient(Routes.downloadHosts(store.current()));
                boolean any = false;
                try { store.saveRelease(client.check().json); any = true; } catch (Exception ignored) { /* Try again next launch. */ }
                try { store.saveRoutes(client.routes().json()); any = true; } catch (Exception ignored) { /* Keep the last good list. */ }
                if (any) store.backgroundDone(System.currentTimeMillis());
            } finally { running = false; }
        });
    }
}
