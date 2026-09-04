import { type Env, HttpError, type Localized } from "./types";

/**
 * 上游開放 API 的客戶端。
 *
 * 這個服務對上游只做兩件事，沒有第三件：
 *   1. 登記時轉發作者自己的 token 問「你是誰」——唯一需要憑證的呼叫，用完即棄，不落庫
 *   2. 同步時以匿名身分讀卡片的公開資訊——不需要任何憑證
 *
 * 沒有服務帳號、沒有特殊金鑰、沒有私有介面：這裡拿到的 API 存取範圍，跟任何第三方
 * 客戶端拿到的一模一樣。所以任何人都能 fork 一份自己架。
 */

const apiUrl = (env: Env, path: string) => `${env.LUNATALK_API_BASE}${path}`;

/**
 * 明確表明身分。上游擋在 CDN 的 bot 防護後面，沒有 User-Agent 的自動請求容易被
 * 攔成挑戰頁；而排程同步被擋掉不會報錯，只會讓榜單悄悄停在登記當下的快照——
 * 那種失效要很久才會被發現。順帶讓對方看得出這些流量是誰發的。
 */
const UA = "Personae/0.1 (open-source role-card community client)";

async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  if (res.status === 401 || res.status === 403) throw new HttpError(401, `upstream rejected the token`);
  if (res.status === 404) throw new HttpError(404, `${what} not found`);
  if (!res.ok) throw new HttpError(502, `upstream ${what} failed with ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * 呼叫者的公開身分。
 *
 * 轉發的是使用者自己授權給本站的 token，權限範圍不超過他本來就給出去的那些；
 * 它只在這一個呼叫裡出現，不寫日誌、不進 D1、不進 KV。
 */
async function fetchMe(env: Env, bearer: string): Promise<{ accountNumId: number }> {
  const res = await fetch(apiUrl(env, "/open/v1/me"), {
    headers: { Authorization: `Bearer ${bearer}`, "User-Agent": UA },
  });
  const body = await readJson(res, "identity");
  const accountNumId = Number(body.accountNumId);
  if (!Number.isSafeInteger(accountNumId) || accountNumId <= 0) {
    throw new HttpError(401, "upstream returned no public account id");
  }
  return { accountNumId };
}

export interface UpstreamRole {
  roleId: string;
  authorNumId: number;
  authorName: string;
  authorAvatar: string;
  names: Localized;
  summaries: Localized;
  avatarUrl: string | null;
  backgroundUrl: string | null;
  slug: string | null;
  tags: string[];
  talkNum: number;
  followNum: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

/**
 * 白名單取欄位，不照抄整個回應。
 *
 * 上游的角色詳情回傳的欄位遠多於一個榜單需要的，其中有些（例如作者寫給模型看的
 * 詳細設定）本來就不該出現在公開榜單上。逐個列出要什麼，上游將來加欄位也不會
 * 悄悄流進這裡——這是本站對使用者資料的最小蒐集原則，不是對上游的不信任。
 */
export function projectRole(raw: Record<string, unknown>): UpstreamRole {
  const tagsRaw = raw.roleTag;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) => (typeof t === "string" ? t : str((t as Record<string, unknown>)?.tagName))).filter(Boolean)
    : [];

  return {
    roleId: str(raw.characterRoleId),
    authorNumId: num(raw.accountNumId),
    authorName: str(raw.authorName),
    authorAvatar: str(raw.authorAvatar),
    names: {
      zh: str(raw.roleName),
      en: str(raw.roleNameEn),
      ja: str(raw.roleNameJa),
      ko: str(raw.roleNameKo),
    },
    summaries: {
      zh: str(raw.roleDesc),
      en: str(raw.roleDescEn),
      ja: str(raw.roleDescJa),
      ko: str(raw.roleDescKo),
    },
    avatarUrl: str(raw.roleAvatar) || null,
    backgroundUrl: str(raw.roleBackground) || null,
    slug: str(raw.slug) || null,
    tags: tags.slice(0, 20),
    talkNum: num(raw.talkNum),
    followNum: num(raw.followNum),
  };
}

/** 匿名讀一張卡。同步跑在排程裡，那時沒有使用者在線，手上不會有任何人的 token。 */
async function fetchRole(env: Env, roleId: string): Promise<UpstreamRole> {
  const res = await fetch(apiUrl(env, `/open/v1/role/detail?roleId=${encodeURIComponent(roleId)}`), {
    headers: { language: "zh-Hans", "User-Agent": UA },
  });
  const role = projectRole(await readJson(res, "role"));
  if (!role.roleId) throw new HttpError(404, "role not found");
  return role;
}

/** 餵給 FTS 的一團字：四語名稱 + 四語簡介 + 標籤，一個索引覆蓋所有語言。 */
export function buildSearchText(role: UpstreamRole): string {
  return [...Object.values(role.names), ...Object.values(role.summaries), ...role.tags]
    .filter(Boolean)
    .join(" ");
}

/**
 * 上游呼叫透過這個物件轉發，測試可以整包換掉。
 *
 * 用注入而不是攔截網路層：換掉的是「跟上游的契約」這個邊界本身，測試因此讀得懂，
 * 也不綁在測試框架某個版本的 undici 內部。上游呼叫的 HTTP 形狀（路徑、標頭、
 * 錯誤碼對應）由 upstream.test.ts 直接測這兩個函式。
 */
export const upstream = { fetchMe, fetchRole };
export type Upstream = typeof upstream;
