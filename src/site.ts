/**
 * 站台的主機身分。
 *
 * 一個站只該有一個正本網址。`HOST` 是那一個；其餘進得來的主機一律 301 過去，
 * 兩個都服務等於把排名、分享數、快取全部切成兩半。
 *
 * 別名分兩類，機制一樣、壽命不同：
 * - `www` 這種永久別名，一直留著。
 * - 搬家前用過的舊網域，留到報表裡的 `host_redirect` 降到零再拔。
 *
 * 搬家的順序不能顛倒：先讓新網域跟舊網域並存、確認新家真的通了（憑證、頁面、API、
 * 分享預覽、靜態資源），才把舊主機填進 `ALIAS_HOSTS`。倒過來做的話，新家萬一沒掛上
 * （DNS 衝突、憑證還沒簽），舊家的 API 就轉向一個連不通的地方，等於把還在服務的站台
 * 弄掛。這是 2026-09-05 實際踩過的坑。
 */
export const HOST = "hearthroom.club";

export const ALIAS_HOSTS: readonly string[] = [
  // 永久別名
  "www.hearthroom.club",
  // 搬家前的家（2026-09-05 起只做轉址）。等 host_redirect 降到零，
  // 連同 wrangler.toml 的那條路由與 johnny.moe 上的 DNS 記錄一起拔掉。
  "community.johnny.moe",
];

/** 這個主機是不是我們自己（含別名與搬家前的）。用來判斷 referer 算不算站外來源。 */
export const isSelfHost = (host: string): boolean => host === HOST || ALIAS_HOSTS.includes(host);

/** 這一頁的正本網址。永遠指向 `HOST`，不跟著請求進來的主機走。 */
export const canonicalUrl = (url: URL): string => `https://${HOST}${url.pathname}`;
