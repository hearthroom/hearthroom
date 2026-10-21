package club.hearthroom.app;

import org.junit.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import static org.junit.Assert.*;

public class UpdateClientTest {
    private static final byte[] APK = "apk fixture".getBytes(StandardCharsets.UTF_8);
    private static String manifest() throws Exception {
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(APK));
        return "{\"schemaVersion\":1,\"channel\":\"stable\",\"packageId\":\"club.hearthroom.app\",\"versionCode\":5,\"versionName\":\"1.0.5\","
            + "\"downloadUrl\":\"https://downloads.hearthroom.club/latest.apk\",\"sha256\":\"" + hash + "\",\"size\":" + APK.length + ",\"releaseNotes\":{\"en\":\"Notes\"}}";
    }
    /** Serves fixed bodies per URL; any other URL behaves like a blocked host. */
    private static final class Fixture extends UpdateClient {
        final Map<String, byte[]> bodies = new HashMap<>();
        final List<String> requested = new ArrayList<>();
        Fixture(List<String> hosts) { super(hosts); }
        @Override InputStream open(String url) throws IOException {
            requested.add(url);
            byte[] body = bodies.get(url);
            if (body == null) throw new IOException("Blocked");
            return new ByteArrayInputStream(body);
        }
    }
    @Test public void manifestAndApkComeFromTheFirstReachableDownloadHost() throws Exception {
        Fixture client = new Fixture(Routes.downloadHosts("sukisuki.ai"));
        client.bodies.put("https://downloads.sukisuki.chat/latest.json", manifest().getBytes(StandardCharsets.UTF_8));
        client.bodies.put("https://downloads.sukisuki.chat/latest.apk", APK);
        UpdateManifest update = client.check();
        assertEquals(List.of("https://downloads.sukisuki.ai/latest.json", "https://downloads.hearthroom.club/latest.json", "https://downloads.sukisuki.chat/latest.json"), client.requested);
        File dir = java.nio.file.Files.createTempDirectory("update-test").toFile();
        try {
            client.requested.clear();
            File apk = client.download(update, dir, percent -> {});
            assertTrue(update.matches(apk));
            assertEquals("The manifest names .club, but the APK must come from the host that answered", "https://downloads.sukisuki.chat/latest.apk", client.requested.get(0));
        } finally { for (File f : dir.listFiles()) f.delete(); dir.delete(); }
    }
    @Test public void allHostsBlockedIsOneFailure() {
        Fixture client = new Fixture(Routes.downloadHosts(null));
        assertThrows(IOException.class, client::check);
        assertEquals(4, client.requested.size());
    }
    @Test public void routeListIsReadFromTheSameHosts() throws Exception {
        Fixture client = new Fixture(Routes.downloadHosts("hearthroom.club"));
        client.bodies.put("https://downloads.sukisuki.ai/routes.json", "{\"schemaVersion\":1,\"routes\":[{\"host\":\"sukisuki.pro\"}]}".getBytes(StandardCharsets.UTF_8));
        assertEquals("sukisuki.pro", client.routes().order().get(0));
        assertEquals("https://downloads.hearthroom.club/routes.json", client.requested.get(0));
    }
}
