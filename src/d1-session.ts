import type { Env } from "./types";

/**
 * D1 讀取複寫：每個請求開一個工作階段，讀取就近走複本，寫入照樣回主庫。
 *
 * 為什麼要：主庫在美西（WNAM），Worker 在使用者最近的節點跑。台灣進來的請求每查一次 D1
 * 就橫渡一次太平洋（約 200 ms），開卡前 session → token → cards → platforms 一串實測 5 s 多
 * （2026-09-26）。複本在亞洲就近，只讀查詢不必過海。
 *
 * 一致性：
 * - 同一個工作階段內是先後一致的：寫過之後的讀取一定看得到那筆寫入（D1 保證）。
 * - 跨請求靠 bookmark：寫入類請求回應時把 bookmark 放進 cookie，同一個瀏覽器的下一個請求
 *   帶著它開工作階段，複本追到那個點之前不會回答——自己剛寫的東西自己一定讀得到。
 * - 別的裝置剛寫的東西，複本可能晚幾秒才看到。
 *
 * 哪些請求從主庫開始（first-primary）：
 * - 寫入類方法（POST/PUT/PATCH/DELETE）：很多是「先讀檢查、再寫」，舊讀會讓檢查失準。
 *   例外是 /v1/auth/session 與 /v1/auth/token：兩支都是開卡必經、查詢最多的，而且只讀為主；
 *   token 換發前自己會先確認手上那份是最新的（見 account-auth.ts delegatedAccess）。
 * - /auth/*（登入回呼）與 /internal/*（伺服器對伺服器，沒有 cookie 可帶 bookmark）。
 *
 * 資料庫沒開讀取複寫時，工作階段的查詢全部照舊走主庫，行為與改動前相同。
 */
export const BOOKMARK_COOKIE = "hr_d1b";
/** 複本延遲通常在秒級；bookmark 只需要撐到複本追上，留寬一點。 */
const BOOKMARK_MAX_AGE = 300;
// D1 的 bookmark 是十六進位欄位以連字號串起來。格式不對的就不拿去開工作階段。
const BOOKMARK_RE = /^[0-9a-f]+(?:-[0-9a-f]+){1,15}$/i;
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const READ_MOSTLY_POSTS = new Set(["/v1/auth/session", "/v1/auth/token"]);

export function startsAtPrimary(method: string, path: string): boolean {
  if (path.startsWith("/auth/") || path.startsWith("/internal/")) return true;
  if (READ_METHODS.has(method)) return false;
  return !(method === "POST" && READ_MOSTLY_POSTS.has(path));
}

/** 寫入類請求與登入回呼的回應要帶回 bookmark，讓下一個請求讀得到這次寫的東西。 */
function returnsBookmark(method: string, path: string): boolean {
  return !READ_METHODS.has(method) || path.startsWith("/auth/");
}

function bookmarkFrom(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== BOOKMARK_COOKIE) continue;
    const value = rest.join("=");
    return BOOKMARK_RE.test(value) && value.length <= 512 ? value : null;
  }
  return null;
}

function openSession(db: D1Database, constraint: string): D1DatabaseSession {
  try {
    return db.withSession(constraint);
  } catch {
    // bookmark 被拒（格式對但不是這個資料庫的、或已過期）：退回不限制，照常服務。
    return db.withSession("first-unconstrained");
  }
}

export function withD1Session(request: Request, env: Env): { env: Env; finish(response: Response): Response } {
  // 沒有工作階段 API 的 D1（舊的本機模擬器、自架分叉包的一層 DB）就照舊直接用。
  if (typeof env.DB?.withSession !== "function") return { env, finish: (response) => response };
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const constraint = startsAtPrimary(method, url.pathname)
    ? "first-primary"
    : (bookmarkFrom(request) ?? "first-unconstrained");
  const session = openSession(env.DB, constraint);
  // 工作階段只有 prepare／batch／getBookmark；這個 repo 從不對 DB 呼叫其他方法，所以直接頂替。
  const scoped = { ...env, DB: session as unknown as D1Database } as Env;
  return {
    env: scoped,
    finish(response) {
      if (!returnsBookmark(method, url.pathname) || response.status === 101) return response;
      const bookmark = session.getBookmark();
      if (!bookmark || !BOOKMARK_RE.test(bookmark)) return response;
      const out = new Response(response.body, response);
      out.headers.append("Set-Cookie", `${BOOKMARK_COOKIE}=${bookmark}; Path=/; Max-Age=${BOOKMARK_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
      return out;
    },
  };
}
