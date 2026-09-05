/**
 * 站台的主機身分，以及搬家用的那一個開關。
 *
 * 搬家分兩步，順序不能顛倒：
 *
 *   1. 新網域先跟舊網域並存。確認新家真的通了（憑證簽好、路由掛上、頁面打得開）。
 *   2. 把舊主機填進 LEGACY_HOSTS。這一步同時打開兩件事：舊網域整條路徑 301 到新家，
 *      以及 canonical 一律指向新家。
 *
 * 倒過來做會出事：新家萬一沒掛上（DNS 衝突、憑證還沒簽），舊家的 API 就轉向一個連不通的
 * 地方，等於把還在服務的站台弄掛，而 canonical 還會告訴搜尋引擎「正本在那個死掉的網域」。
 * 這是實際踩過的坑，不是假想。
 */
export const HOST = "hearthroom.club";

/**
 * 搬家前用過的主機。**填進來就等於宣告搬家完成**，見上面的兩步。
 *
 * 2026-09-05 切過去：新家已驗過（憑證、頁面、API、分享預覽、靜態資源、404 全綠），
 * 這時候才填。等報表裡的 legacy_redirect 降到零，再把這裡連同 wrangler.toml 的那條路由一起拔掉。
 */
export const LEGACY_HOSTS: readonly string[] = ["community.johnny.moe"];

/** 搬家有沒有切過去。切過去之後 canonical 才改口，之前照請求進來的網域走。 */
export const MIGRATED = LEGACY_HOSTS.length > 0;

/** 這個主機是不是我們自己（含搬家前的）。用來判斷 referer 算不算站外來源。 */
export const isSelfHost = (host: string): boolean => host === HOST || LEGACY_HOSTS.includes(host);

/** 這一頁的正本網址。搬家切過去之後永遠指向新家，不跟著請求的網域走。 */
export const canonicalUrl = (url: URL): string =>
  MIGRATED ? `https://${HOST}${url.pathname}` : url.origin + url.pathname;
