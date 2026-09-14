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
import { HOST } from "./site";
import type { Env } from "./types";

export const SANDBOX_HOST_RE = new RegExp(`^c([a-z0-9-]+)\\.${HOST.replace(/\./g, "\\.")}$`, "i");
export const SANDBOX_PATH = "/sandbox/";

export function isSandboxHost(host: string): boolean {
  return SANDBOX_HOST_RE.test(host);
}

export function sandboxRoleIdOf(host: string): string | null {
  const m = SANDBOX_HOST_RE.exec(host);
  return m ? m[1]! : null;
}

/** 殼頁的 CSP：殼自己只連自己（connect-src 'self'）、只能被主站嵌（frame-ancestors）；作者外鏈腳本走 https:。 */
export const SANDBOX_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  `frame-ancestors https://${HOST} https://www.${HOST}`,
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
export async function serveSandbox(c: { req: { url: string }; env: Env }): Promise<Response | null> {
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
  headers.set("Cache-Control", isPage ? "no-cache" : "public, max-age=600");
  headers.delete("etag");
  headers.delete("last-modified");
  return new Response(asset.body, { status: 200, headers });
}

async function peekIsSandboxShell(res: Response): Promise<boolean> {
  const text = await res.text();
  return text.includes("<title>chat sandbox</title>");
}
