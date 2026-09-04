import { createI18n } from "vue-i18n";
import zhHant from "../locales/zh-Hant.json";
import { SITE } from "./site";
import type { Zone } from "./types";

/**
 * 多語系。
 *
 * 翻譯放在 src/locales/*.json，一個語言一個檔——翻譯者不是開發者，要求他改 .ts、
 * 看懂型別錯誤才能貢獻，會篩掉絕大多數本來願意幫忙的人。JSON 是 Weblate／Crowdin
 * 這類翻譯平台原生支援的格式，可以直接接上去。
 *
 * **不完整的翻譯照樣上線。** 缺的 key 沿回退鏈找，永遠不會露出 raw key。
 * 完成度是 scripts/i18n-coverage.mjs 報出來的數字，不是合併的門檻——把它做成門檻
 * 等於要求貢獻者一次翻完一百多條，否則什麼都交不了。
 *
 * 新增一個語言 = 丟一個 json 進 locales/ 並在 LOCALES 加一行，不必動其他程式碼。
 */

export const SOURCE_LOCALE = "zh-Hant";

export interface LocaleDef {
  /** BCP 47 標籤，也是網址前綴與 <html lang>。 */
  code: string;
  /** 這個語言自己的名字，給語言選單用——不翻譯，各語言的使用者都認得自己的。 */
  label: string;
  dir?: "ltr" | "rtl";
}

export const LOCALES: LocaleDef[] = [
  { code: "zh-Hant", label: "繁體中文" },
  { code: "zh-Hans", label: "简体中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
];

export const LOCALE_CODES = LOCALES.map((l) => l.code);

/**
 * 回退鏈按語言親緣度排，不是一律退回英文：
 * 簡體缺字先看繁體（幾乎都看得懂），比丟一句英文好得多。
 */
const FALLBACK: Record<string, string[]> = {
  "zh-Hans": ["zh-Hant", "en"],
  "zh-Hant": ["en"],
  ja: ["en", "zh-Hant"],
  ko: ["en", "zh-Hant"],
  default: ["en", "zh-Hant"],
};

export const i18n = createI18n({
  legacy: false,
  locale: SOURCE_LOCALE,
  fallbackLocale: FALLBACK,
  // 缺 key 在開發時要吵，正式環境安靜地走回退鏈就好。
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
  messages: { [SOURCE_LOCALE]: zhHant },
});

const loaded = new Set([SOURCE_LOCALE]);

/** 按需載入。加二十個語言也不會撐大首屏 bundle。 */
export async function loadLocale(code: string): Promise<void> {
  if (loaded.has(code) || !LOCALE_CODES.includes(code)) return;
  const messages = (await import(`../locales/${code}.json`)).default;
  i18n.global.setLocaleMessage(code, messages);
  loaded.add(code);
}

/** 切語言時把回退鏈上的語言也載進來，否則缺 key 會退到一份還沒下載的訊息。 */
export async function applyLocale(code: string): Promise<void> {
  const chain = [code, ...(FALLBACK[code] ?? FALLBACK.default)];
  await Promise.all(chain.map(loadLocale));
  i18n.global.locale.value = code as never;

  const def = LOCALES.find((l) => l.code === code);
  document.documentElement.lang = code;
  document.documentElement.dir = def?.dir ?? "ltr";
}

/**
 * hreflang：告訴搜尋引擎同一頁有哪些語言版本。
 *
 * 少了它，各語言的網址會被當成互相重複的內容而只收錄一個——語言進網址的意義
 * 有一半在這裡。x-default 指向不帶前綴的預設語言。
 */
export function updateHreflang(bareePath: string): void {
  const head = document.head;
  head.querySelectorAll("link[data-hreflang]").forEach((el) => el.remove());
  const add = (hreflang: string, path: string) => {
    const link = document.createElement("link");
    link.rel = "alternate";
    link.hreflang = hreflang;
    link.href = new URL(path, location.origin).toString();
    link.dataset.hreflang = "1";
    head.appendChild(link);
  };
  for (const l of LOCALES) {
    add(l.code, l.code === SOURCE_LOCALE ? bareePath : `/${l.code}${bareePath === "/" ? "" : bareePath}`);
  }
  add("x-default", bareePath);
}

/** 從瀏覽器偏好挑一個支援的語言。先比完整標籤，再比主語言。 */
export function detectLocale(): string {
  for (const pref of navigator.languages ?? []) {
    const exact = LOCALE_CODES.find((c) => c.toLowerCase() === pref.toLowerCase());
    if (exact) return exact;
    // zh-TW / zh-HK → zh-Hant；zh-CN / zh-SG → zh-Hans
    const lower = pref.toLowerCase();
    if (lower.startsWith("zh")) return /(tw|hk|mo|hant)/.test(lower) ? "zh-Hant" : "zh-Hans";
    const base = LOCALE_CODES.find((c) => c.split("-")[0] === lower.split("-")[0]);
    if (base) return base;
  }
  return SOURCE_LOCALE;
}

/**
 * 語區：榜單按卡片的語言分開列。名字用該語言自己寫，跟 LOCALES 一樣不翻譯。
 * 簡繁體併成一區——同一批讀者兩種都看得懂，拆開只會讓每區都更空。
 */
export const ZONES: { code: Zone; label: string }[] = [
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
];

export const isZone = (v: unknown): v is Zone => ZONES.some((z) => z.code === v);

/** 介面語言對應的預設語區：看日文介面的人，先看到日文卡。 */
export const defaultZone = (uiLocale: string): Zone => contentLang(uiLocale) as Zone;

/** 語區的顯示名。不分語言的卡沒有自己的語言名，那個才需要翻譯。 */
export function zoneLabel(zone: string): string {
  return ZONES.find((z) => z.code === zone)?.label ?? i18n.global.t("zone.all");
}

/**
 * 卡片內容只有四個語言槽（上游的繁簡是程式轉換的，沒有各自的資料），
 * 所以 UI 的五種語言映射到內容的四種。這個不對齊會讓人困惑，寫在這裡。
 */
export function contentLang(uiLocale: string): string {
  return uiLocale.startsWith("zh") ? "zh" : uiLocale;
}

/** 瀏覽器分頁標題。站名是專有名詞不翻譯，其餘的翻。 */
export function pageTitle(part?: string): string {
  return part ? `${part} · ${SITE.name}` : `${SITE.name} · ${i18n.global.t("site.tagline")}`;
}
