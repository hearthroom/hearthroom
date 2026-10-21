package club.hearthroom.app;

import org.json.JSONObject;
import java.util.Locale;

final class Locales {
    /** Five-language text published by us (release notes, route notes); English is the fallback. */
    static String pick(JSONObject text, String languageTag) {
        Locale locale=Locale.forLanguageTag(languageTag);
        String key=locale.getLanguage();
        if (key.equals("zh")) key=(locale.getScript().equals("Hant") || locale.getCountry().equals("TW") || locale.getCountry().equals("HK") || locale.getCountry().equals("MO"))?"zh-Hant":"zh-Hans";
        return text.optString(key,text.optString("en"));
    }
}
