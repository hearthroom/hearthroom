/**
 * 新版沙箱卡的殼：每張卡一個子網域 `c<roleId>.hearthroom.club`，同一個 Worker 出殼頁。
 *
 * 為什麼要子網域：作者的腳本跑在殼裡，殼跟主站不同源，作者碰不到主站的 cookie、storage
 * 與登入態；每張卡又各自一個源，卡與卡之間的 localStorage 也互不相見。殼本身不發任何請求，
 * 訊息與規則由主站的頁面用 postMessage 餵進去（上游 docs/sandbox-chat-page.md）。
 *
 * 路由：wrangler.toml 的 `*.hearthroom.club/*` 加一筆萬用 DNS（`* AAAA 100::` 代理）；
 * `run_worker_first` 列了 `/sandbox/*`，殼頁與它的 js/css 才會先進 Worker——這裡要補
 * CSP 與 frame-ancestors 標頭，資源層直接出的話沒有這些標頭。其餘路徑在沙箱子網域上一律 404，
 * 不讓主站的 SPA 在別的源上多一個鏡像。
 *
 * 殼的檔案由 build:stage 從上游的 dist-sandbox/ 複製到 web/public/sandbox/（scripts/copy-sandbox.mjs），
 * 所以資源層裡的路徑是 /sandbox/index.html、/sandbox/sandbox.js、/sandbox/sandbox.css。
 */
import { SANDBOX_HOST_RE, SANDBOX_PARENT_ORIGINS } from "../shared/site-hosts";
export { SANDBOX_HOST_RE } from "../shared/site-hosts";
import type { Env } from "./types";

export const SANDBOX_PATH = "/sandbox/";

export function isSandboxHost(host: string): boolean {
  return SANDBOX_HOST_RE.test(host);
}

export function sandboxRoleIdOf(host: string): string | null {
  const m = SANDBOX_HOST_RE.exec(host);
  return m ? m[1]! : null;
}

/**
 * 殼頁的 CSP：殼自己只連自己（connect-src 'self'）、只能被主站嵌（frame-ancestors）；作者外鏈腳本與樣式走 https:。
 * frame-src 放行同源／srcdoc／blob：前端區塊協議（上游 common/frontend-block）把圍欄裡的整份 HTML 文件掛成各自的
 * iframe；作者自己寫的 <iframe> 標籤仍被淨化層剝掉。跟上游 src/sandbox/index.html 的 meta 同一份。
 * worker-src 放行 blob：作者正則規則在殼裡改到背景執行緒跑，執行緒程式內嵌在 sandbox.js 裡以 blob 啟動；
 * blob 執行緒沿用這份 CSP，連線仍只到自己。
 */
export const SANDBOX_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self' about: blob:",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  // 卡片 App 網域（play.<HOST>）也會嵌殼：同一份對話頁在那裡跑
  `frame-ancestors ${SANDBOX_PARENT_ORIGINS.join(" ")}`,
].join("; ");

// 殼頁向資源層要的是 /sandbox/（目錄），不是 /sandbox/index.html：資源層預設會把後者 3xx 到前者，
// 拿到的就不是 200。js/css 直接要檔名。
const FILES: Record<string, string> = {
  "": "",
  "index.html": "",
  "sandbox.js": "sandbox.js",
  "sandbox.css": "sandbox.css",
};

/**
 * 沙箱子網域上的請求：/sandbox/ 底下三個檔從資源層拿、補標頭；其餘 404。
 * 回 null 表示這不是沙箱子網域，交給後面的路由。
 */
export async function serveSandbox(c: { req: { url: string; header: (name: string) => string | undefined; method: string }; env: Env }): Promise<Response | null> {
  const url = new URL(c.req.url);
  if (!isSandboxHost(url.host)) return null;
  if (!url.pathname.startsWith(SANDBOX_PATH)) return new Response("not found", { status: 404 });
  const rest = url.pathname.slice(SANDBOX_PATH.length);
  const file = FILES[rest];
  if (file === undefined) return new Response("not found", { status: 404 });
  const isPage = file === "";
  const asset = await c.env.ASSETS.fetch(new Request(new URL(`${SANDBOX_PATH}${file}`, url).toString()));
  // 資源層配了 SPA 回退：殼沒建進去時拿到的是主站的 index.html。那份不能當殼出去。
  const html = (asset.headers.get("content-type") ?? "").includes("text/html");
  if (!asset.ok || (!isPage && html) || (isPage && !(await peekIsSandboxShell(asset.clone())))) {
    return new Response("sandbox shell not built", { status: 503 });
  }
  const headers = new Headers(asset.headers);
  headers.set("Content-Security-Policy", SANDBOX_CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  // 三個檔都 no-cache（每次重新驗證）：檔名沒有雜湊，部署後若邊緣還抓著舊的 js，新的宿主就會配到舊殼。
  // 保留資源層的 ETag，重新驗證多半是 304，不會每次重抓整包。
  headers.set("Cache-Control", "no-cache");
  headers.delete("last-modified");
  // Validate the actual shell first. Forwarding a conditional request could hide a
  // missing shell behind the SPA fallback's 304, where there is no body to inspect.
  const etag = headers.get("etag");
  const condition = c.req.header("If-None-Match");
  const safeMethod = c.req.method === "GET" || c.req.method === "HEAD";
  const tags = condition?.match(/(?:W\/)?"[^"\r\n]*"|\*/g) ?? [];
  if (safeMethod && etag && tags.some(tag => tag === "*" || tag.replace(/^W\//, "") === etag.replace(/^W\//, ""))) {
    await asset.body?.cancel();
    headers.delete("content-length");
    return new Response(null, { status: 304, headers });
  }
  return new Response(c.req.method === "HEAD" ? null : asset.body, { status: 200, headers });
}

async function peekIsSandboxShell(res: Response): Promise<boolean> {
  const text = await res.text();
  return text.includes("<title>chat sandbox</title>");
}
