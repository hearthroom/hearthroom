/**
 * 卡片共用狀態與分享回流的宿主那一半（舞台的 StageHost.shared）：全服投票、共鬥計數器、排行榜，
 * 以及朋友從平台短碼連結回答、分享者看結果。設計：docs/studio/tasks/2026-10-25-card-share-context/design.md §7。
 *
 * 舞台已經驗過參數、補上 roleId；這裡只認「現在這一局」（lib/play-share 的 PlayShareInput）：
 *   - roleId 不是這一局的卡就不打 Worker（舞台換卡的途中，舊卡片的請求不能落到新卡）；
 *   - token、供應商、作者試玩（?draft=1）都照這一局的值，短碼留在這裡，卡片看不到；
 *   - Worker 的小寫錯誤碼翻成舞台的大寫碼（common/shared-state 的 SHARED_ERROR_CODES），其他一律 NETWORK。
 */
import { COMMUNITY_API } from "./config";
import { currentPlayShare, playCardUrl, type PlayShareDeps, type PlayShareInput } from "./play-share";

type SharedCode = "SHARED_DISABLED" | "NOT_DECLARED" | "OPTION_INVALID" | "NOT_ELIGIBLE" | "RATE_LIMITED" | "LIMIT_REACHED" | "HOST_DENIED" | "UNAUTHORIZED" | "INVALID_ARGS" | "NETWORK" | "SHARE_CONTEXT_INVALID";

const WORKER_CODES: Record<string, SharedCode> = {
  shared_disabled: "SHARED_DISABLED",
  not_declared: "NOT_DECLARED",
  option_invalid: "OPTION_INVALID",
  delta_invalid: "INVALID_ARGS",
  not_eligible: "NOT_ELIGIBLE",
  // 回答自己的分享連結：對卡片來說就是「這個人不能回答」
  own_token: "NOT_ELIGIBLE",
  rate_limited: "RATE_LIMITED",
  limit_reached: "LIMIT_REACHED",
  goal_reached: "LIMIT_REACHED",
  context_invalid: "SHARE_CONTEXT_INVALID",
};

const sharedError = (code: SharedCode, data?: Record<string, unknown>) => Object.assign(new Error(code), { code }, data ? { data } : {});

/** Worker 的回應 → 舞台的錯誤。LIMIT_REACHED 帶 reason：goal（已達標）或 limit（改票次數、每人上限、今天的短碼數）。 */
export function sharedErrorOf(status: number, error: string) {
  if (status === 401) return sharedError("UNAUTHORIZED");
  const code = WORKER_CODES[error];
  if (!code) return sharedError(status === 404 ? "HOST_DENIED" : "NETWORK");
  if (code === "LIMIT_REACHED") return sharedError(code, { reason: error === "goal_reached" ? "goal" : "limit" });
  return sharedError(code);
}

function playFor(roleId: string): PlayShareInput {
  const s = currentPlayShare();
  if (!s || s.roleId !== roleId) throw sharedError("HOST_DENIED");
  return s;
}

async function call(s: PlayShareInput, path: string, init: { method?: "GET" | "POST"; body?: unknown; auth: "optional" | "required"; query?: Record<string, string> }): Promise<unknown> {
  let token: string | null = null;
  try { token = s.token ? await s.token() : null; } catch { token = null; }
  if (init.auth === "required" && !token) throw sharedError("UNAUTHORIZED");
  const q = new URLSearchParams(init.query ?? {});
  if (s.draft) q.set("draft", "1");
  const url = `${COMMUNITY_API}/cards/${encodeURIComponent(s.roleId)}${path}${q.size ? `?${q}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        ...(s.provider ? { "X-Provider": s.provider } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    throw sharedError("NETWORK");
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw sharedErrorOf(res.status, typeof body?.error === "string" ? body.error : "");
  if (!body) throw sharedError("NETWORK");
  return body;
}

/** 舞台的 StageHost.shared。 */
export function playSharedHost(deps: PlayShareDeps) {
  return {
    async read(roleId: string, keys: string[]) {
      const s = playFor(roleId);
      const body = (await call(s, "/state", { auth: "optional", query: { keys: keys.join(",") } })) as { enabled?: boolean; items?: unknown };
      if (!body.enabled) throw sharedError("SHARED_DISABLED");
      return body.items ?? {};
    },
    vote(roleId: string, key: string, option: string) {
      return call(playFor(roleId), `/state/${encodeURIComponent(key)}/vote`, { method: "POST", auth: "required", body: { option } });
    },
    add(roleId: string, key: string, delta: number) {
      return call(playFor(roleId), `/state/${encodeURIComponent(key)}/add`, { method: "POST", auth: "required", body: { delta } });
    },
    leaderboard(roleId: string, key: string, limit: number) {
      return call(playFor(roleId), `/state/${encodeURIComponent(key)}/leaderboard`, { auth: "optional", query: { limit: String(limit) } });
    },
    async tallyLink(roleId: string, context: string, pollKey: string) {
      const s = playFor(roleId);
      const card = playCardUrl(s, deps.links);
      if (!card) throw sharedError("HOST_DENIED");
      const body = (await call(s, "/share-tokens", { method: "POST", auth: "required", body: { context, poll: pollKey } })) as { token?: unknown };
      if (typeof body.token !== "string") throw sharedError("NETWORK");
      // 換到這一刻的推薦碼（產生短碼的途中可能剛到）
      const url = new URL(playCardUrl(s, deps.links));
      url.searchParams.set("share", body.token);
      return url.href;
    },
    async respond(roleId: string, option: string) {
      const s = playFor(roleId);
      if (!s.enabled || !s.poll) throw sharedError("HOST_DENIED");
      await call(s, `/share-tokens/${encodeURIComponent(s.poll.token)}/respond`, { method: "POST", auth: "required", body: { option } });
      return { ok: true };
    },
    results(roleId: string) {
      return call(playFor(roleId), "/share-tokens", { auth: "required" });
    },
  };
}
