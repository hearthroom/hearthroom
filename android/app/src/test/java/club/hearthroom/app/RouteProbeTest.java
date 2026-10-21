package club.hearthroom.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class RouteProbeTest {
    private static final String STATEMENT = "[{\"relation\":[\"delegate_permission/common.handle_all_urls\"],\"target\":{\"namespace\":\"android_app\",\"package_name\":\"club.hearthroom.app\",\"sha256_cert_fingerprints\":[\"AF:43\"]}}]";
    @Test public void onlyOurOwnAssetLinksCountAsReachable() {
        assertTrue(RouteProbe.valid(200, STATEMENT));
        assertFalse("Captive portals answer 200 too", RouteProbe.valid(200, "<html>Sign in to Wi-Fi</html>"));
        assertFalse(RouteProbe.valid(200, STATEMENT.replace("club.hearthroom.app", "club.hearthroom.app.evil")));
        assertFalse(RouteProbe.valid(200, "[{\"target\":{\"namespace\":\"web\",\"site\":\"club.hearthroom.app\"}}]"));
        assertFalse(RouteProbe.valid(302, STATEMENT));
        assertFalse(RouteProbe.valid(503, STATEMENT));
        assertFalse(RouteProbe.valid(200, null));
        assertFalse(RouteProbe.valid(200, "{}"));
    }
}
