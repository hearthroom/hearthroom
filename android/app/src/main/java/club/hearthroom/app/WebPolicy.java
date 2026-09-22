package club.hearthroom.app;

import java.net.URI;
import java.util.Set;

final class WebPolicy {
    static final String HOME = "https://hearthroom.club/";
    // Functional floor: dynamic viewport units and color-mix used by the website.
    // This is not a claim that an old Chromium version receives security updates.
    static final int MIN_WEBVIEW_MAJOR = 111;
    static final int MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
    private static final Set<String> SITES = Set.of("hearthroom.club", "sukisuki.ai", "sukisuki.chat");
    static String launchUrl(String url) {
        return isHttps(url) && "hearthroom.club".equals(URI.create(url).getHost()) ? url : HOME;
    }
    static boolean isSite(String url) { return isHttps(url) && SITES.contains(URI.create(url).getHost()); }
    static boolean isHttps(String url) {
        try {
            URI uri = URI.create(url);
            return "https".equals(uri.getScheme()) && uri.getHost() != null && uri.getRawUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception e) { return false; }
    }
    static boolean supportsVersion(String version) {
        try { return Integer.parseInt(version.split("\\.")[0]) >= MIN_WEBVIEW_MAJOR; }
        catch (Exception e) { return false; }
    }
    static boolean canDownload(String source, String url) {
        if (!isSite(source) || url == null) return false;
        if (isHttps(url)) return true;
        if (!url.startsWith("blob:")) return false;
        String inner = url.substring(5);
        return isHttps(inner) && URI.create(source).getHost().equals(URI.create(inner).getHost());
    }
}
