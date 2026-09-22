package club.hearthroom.app;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class UpdateManifestTest {
    private JSONObject valid() throws Exception {
        return new JSONObject().put("schemaVersion", 1).put("channel", "stable")
            .put("packageId", "club.hearthroom.app").put("versionCode", 2).put("versionName", "0.1.2")
            .put("downloadUrl", "https://downloads.hearthroom.club/latest.apk")
            .put("sha256", "ab".repeat(32)).put("size", 1234)
            .put("releaseNotes", new JSONObject().put("en", "Improved updates.").put("zh-Hant", "改善更新流程。"));
    }
    private void rejected(JSONObject json) {
        assertThrows(IllegalArgumentException.class, () -> UpdateManifest.parse(json.toString()));
    }
    @Test public void onlyNewerVersionsAreOffered() throws Exception {
        UpdateManifest update = UpdateManifest.parse(valid().toString());
        assertTrue(update.isNewerThan(1)); assertFalse(update.isNewerThan(2)); assertFalse(update.isNewerThan(3));
    }
    @Test public void localizedNotesHaveEnglishFallback() throws Exception {
        UpdateManifest update = UpdateManifest.parse(valid().toString());
        assertEquals("改善更新流程。", update.notes("zh-TW"));
        assertEquals("Improved updates.", update.notes("fr"));
    }
    @Test public void rejectsOtherOriginsPathsAndPackages() throws Exception {
        for (String url : new String[]{"http://downloads.hearthroom.club/latest.apk", "https://evil.test/latest.apk", "https://downloads.hearthroom.club@evil.test/latest.apk", "https://downloads.hearthroom.club/other.apk", "https://downloads.hearthroom.club/latest.apk?x=1"}) rejected(valid().put("downloadUrl",url));
        rejected(valid().put("packageId", "other.app")); rejected(valid().put("channel", "beta"));
    }
    @Test public void rejectsMalformedOrUnboundedPayloads() throws Exception {
        rejected(valid().put("sha256", "bad")); rejected(valid().put("size", 0));
        rejected(valid().put("size", 100_000_001)); rejected(valid().put("versionCode", -1));
        rejected(valid().put("versionCode", 1.5)); rejected(valid().put("schemaVersion", 2));
        rejected(valid().put("releaseNotes", new JSONObject()));
    }
    @Test public void hashesAndSizesMustMatchBeforeInstall() throws Exception {
        byte[] bytes="apk fixture".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String hash=java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
        UpdateManifest update=UpdateManifest.parse(valid().put("sha256",hash).put("size",bytes.length).toString());
        java.io.File file=java.io.File.createTempFile("update-test", ".apk");
        try {
            java.nio.file.Files.write(file.toPath(),bytes); assertTrue(update.matches(file));
            java.nio.file.Files.write(file.toPath(),"wrong".getBytes(java.nio.charset.StandardCharsets.UTF_8)); assertFalse(update.matches(file));
        } finally { file.delete(); }
    }
}
