import type { RouteLocationNormalizedLoaded } from "vue-router";
import { SOURCE_LOCALE } from "@/lib/i18n";
import { localeOf, withLocale } from "@/router";

/**
 * 換語言就是換網址：同一頁換上另一個語言前綴，連結可以分享，上一頁也回得去。
 * 頁首的語言選單與使用者設定的「外觀與語言」共用這一份。
 * 部落格文章另外帶 articleLang，讓文章跟著換成那個語言的版本。
 */
export function localeSwitchTarget(route: RouteLocationNormalizedLoaded, code: string) {
  const current = localeOf(route);
  const bare = current === SOURCE_LOCALE ? route.path : route.path.replace(`/${current}`, "") || "/";
  const query = { ...route.query };
  if (/^\/blog\/(?!g\/|p\/)[^/]+\/[^/]+\/?$/.test(bare) && !query.preview) query.articleLang = code;
  else delete query.articleLang;
  return { path: withLocale(bare, code), query };
}
