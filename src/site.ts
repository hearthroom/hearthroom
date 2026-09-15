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
  // 搬家前的舊主機已於 2026-09-06 連同路由一起拔掉；本站只掛自己的網域。
];

/**
 * 卡片 App 的網域（play.<HOST>）：每張卡各自是一個可安裝的 App，範圍只有 /<roleId>/。
 * 為什麼要另一個網域：Android 判「已安裝」看的是這一頁在不在某個已裝 App 的範圍內，站台 App 的
 * 範圍是整站，所以卡片在主站上永遠裝不成第二個 App（owner 2026-09-15 手機實測）。這個網域上沒有任何
 * App 的範圍是根目錄，卡與卡之間的範圍也不重疊。play.localhost 給本機開發用（瀏覽器把 *.localhost
 * 解到本機）。
 */
export const PLAY_HOST = `play.${HOST}`;
export const isPlayHost = (host: string): boolean => host.replace(/:\d+$/, "") === PLAY_HOST || host.replace(/:\d+$/, "") === "play.localhost";

/** 這個主機是不是我們自己（含別名、搬家前的、卡片 App 網域）。用來判斷 referer 算不算站外來源。 */
export const isSelfHost = (host: string): boolean => host === HOST || ALIAS_HOSTS.includes(host) || isSandboxSubdomain(host) || isPlayHost(host);

/** 沙箱卡的殼子網域（c<roleId>.<HOST>）：算自己人，不算站外來源。判式跟 src/sandbox.ts 同一條。 */
const SANDBOX_SUBDOMAIN_RE = new RegExp(`^c[a-z0-9-]+\\.${HOST.replace(/\./g, "\\.")}$`, "i");
export const isSandboxSubdomain = (host: string): boolean => SANDBOX_SUBDOMAIN_RE.test(host);

/** 這一頁的正本網址。永遠指向 `HOST`，不跟著請求進來的主機走。 */
export const canonicalUrl = (url: URL): string => `https://${HOST}${url.pathname}`;
