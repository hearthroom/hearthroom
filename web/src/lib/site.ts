import { PRIMARY_HOST, siteRootOf, isCardAppHost } from '../../../shared/site-hosts';
/* i18n-ignore：這個檔只留專有名詞。各語言都用同一個名字，不進翻譯檔。 */

/**
 * 站台身分。
 *
 * 這是個獨立的開源專案，透過公開 API 讀取角色卡資料，就像任何第三方客戶端一樣。
 * 名稱因此是自己的，不借用資料來源的品牌。
 *
 * Hearthroom：有壁爐的那間屋子。角色卡社群一向愛用「客棧、酒館」當比喻——來這裡不是
 * 為了看資料庫，是為了挑一個想坐下來聊的人。
 *
 * 標語與描述不在這裡——那些是使用者讀得到的文案，住在 locales/。
 */
export const SITE = {
  name: "Hearthroom",
  /** OAuth 授權頁上顯示給使用者的應用名稱。 */
  clientName: "Hearthroom",
  /** 原始碼位置。頁尾的 GitHub 連結與授權連結都從這裡長出來；留空就整個頁尾不顯示。 */
  repoUrl: "https://github.com/hearthroom/hearthroom",
  /** 授權條款名稱與檔案位置；條款本文就在倉庫裡。 */
  license: "AGPL-3.0",
  /** 站台的正本主機。 */
  host: PRIMARY_HOST,
  /**
   * 卡片 App 的網域：每張卡各自是一個可安裝的 App，範圍只有 /<roleId>/。Android 判「已安裝」看的是
   * 這一頁在不在某個已裝 App 的範圍內，站台 App 的範圍是整站，所以卡片在主站上永遠裝不成第二個 App；
   * 這個網域上沒有範圍是根目錄的 App。Worker 那邊的對應在 src/site.ts。
   */
  playHost: `play.${PRIMARY_HOST}`,
} as const;

/** 現在是不是跑在卡片 App 網域上（本機開發用 play.localhost，瀏覽器把 *.localhost 解到本機）。 */
export const isPlayHost = (hostname: string = location.hostname): boolean =>
  isCardAppHost(hostname) || hostname === "play.localhost";

/** 一張卡在卡片 App 網域上的網址。結尾的斜線是 App 範圍的邊界，不能少。 */
export function playAppUrl(roleId: string, locale: string, opts: { install?: boolean; provider?: string } = {}): string {
  const origin = isPlayHost() ? location.origin : `https://play.${siteRootOf(location.hostname) ?? PRIMARY_HOST}`;
  const q = new URLSearchParams({ lang: locale });
  if (opts.install) q.set("install", "1");
  if (opts.provider) q.set("provider", opts.provider);
  return `${origin}/${encodeURIComponent(roleId)}/?${q}`;
}

/** Return from an installed card to the community in the same domain family. */
export const communityHost = (hostname: string = location.hostname): string => siteRootOf(hostname) ?? PRIMARY_HOST;
