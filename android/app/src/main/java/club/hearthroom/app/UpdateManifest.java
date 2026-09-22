package club.hearthroom.app;

import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;
import java.util.Locale;

/** Untrusted release data is bounded and restricted to this one distribution channel. */
public final class UpdateManifest {
    public final int versionCode;
    public final String versionName, downloadUrl, sha256, json;
    public final long size;
    private final JSONObject releaseNotes;
    private UpdateManifest(JSONObject o, String raw) throws Exception {
        if (o.getInt("schemaVersion") != 1 || !"stable".equals(o.getString("channel")) || !"club.hearthroom.app".equals(o.getString("packageId"))) throw new IllegalArgumentException();
        Object code=o.get("versionCode"), bytes=o.get("size");
        if (!(code instanceof Integer || code instanceof Long) || !(bytes instanceof Integer || bytes instanceof Long)) throw new IllegalArgumentException();
        long value=o.getLong("versionCode");
        if (value<1 || value>2100000000) throw new IllegalArgumentException();
        versionCode=(int)value; size=o.getLong("size");
        if (size<1 || size>100000000) throw new IllegalArgumentException();
        versionName=o.getString("versionName");
        if (!versionName.matches("[0-9]+\\.[0-9]+\\.[0-9]+")) throw new IllegalArgumentException();
        downloadUrl=o.getString("downloadUrl");
        if (!"https://downloads.hearthroom.club/latest.apk".equals(downloadUrl)) throw new IllegalArgumentException();
        sha256=o.getString("sha256"); if (!sha256.matches("[0-9a-f]{64}")) throw new IllegalArgumentException();
        releaseNotes=o.getJSONObject("releaseNotes");
        if (releaseNotes.optString("en").trim().isEmpty()) throw new IllegalArgumentException();
        for (String key : new String[]{"en","zh-Hant","zh-Hans","ja","ko"}) if (releaseNotes.optString(key).length()>12000) throw new IllegalArgumentException();
        json=raw;
    }
    public static UpdateManifest parse(String raw) {
        if (raw==null || raw.length()>65536) throw new IllegalArgumentException("Invalid release manifest");
        try { return new UpdateManifest(new JSONObject(raw),raw); }
        catch (Exception e) { throw new IllegalArgumentException("Invalid release manifest",e); }
    }
    public boolean isNewerThan(long installed) { return versionCode>installed; }
    public String notes(String languageTag) {
        Locale locale=Locale.forLanguageTag(languageTag);
        String key=locale.getLanguage();
        if (key.equals("zh")) key=(locale.getScript().equals("Hant") || locale.getCountry().equals("TW") || locale.getCountry().equals("HK") || locale.getCountry().equals("MO"))?"zh-Hant":"zh-Hans";
        return releaseNotes.optString(key,releaseNotes.optString("en"));
    }
    public boolean matches(File file) throws Exception {
        if (!file.isFile() || file.length()!=size) return false;
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(FileInputStream in=new FileInputStream(file)) { byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1) digest.update(buffer,0,n); }
        StringBuilder hex=new StringBuilder(); for(byte b:digest.digest()) hex.append(String.format(Locale.ROOT,"%02x",b&255));
        return sha256.equals(hex.toString());
    }
}
