import { apiBaseOf, DEFAULT_PROVIDER, type ProviderId } from "./providers";
import { readForReview, readSealedForReview } from "./review-snapshot";
import { searchForm } from "./search-text";
import { type Env, HttpError, type Localized } from "./types";

/**
 * 上游開放 API 的客戶端。
 *
 * 這個服務對上游做三類事：
 *   1. 轉發作者自己的 token：問「你是誰」、送審時讀一次他自己的整份設定——用完即棄，不落庫
 *   2. 同步時以匿名身分讀卡片的公開資訊——不需要任何憑證
 *
 * 沒有私有介面，也沒有任何站方持有的金鑰：這裡打的每一條路都是公開契約，任何第三方站台
 * 都能照樣接，任何人都能 fork 一份自己架。
 */

// 位址依供應商挑：同一支程式對兩家說同一套公開契約，只是各自的家在不同網域。
const apiUrl = (env: Env, provider: ProviderId, path: string) => `${apiBaseOf(env, provider)}${path}`;

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
async function fetchMe(env: Env, bearer: string, provider: ProviderId = DEFAULT_PROVIDER): Promise<{ accountNumId: number; nickName?: string; avatar?: string }> {
  const res = await fetch(apiUrl(env, provider, "/open/v1/me"), {
    headers: { Authorization: `Bearer ${bearer}`, "User-Agent": UA },
  });
  const body = await readJson(res, "identity");
  const accountNumId = Number(body.accountNumId);
  if (!Number.isSafeInteger(accountNumId) || accountNumId <= 0) {
    throw new HttpError(401, "upstream returned no public account id");
  }
  return { accountNumId, ...(typeof body.avatar === "string" ? {avatar: body.avatar} : {}), ...(typeof body.nickName === "string" ? {nickName: body.nickName} : {}) };
}

/** 語區：榜單按這個分開列。all 是來源標成「不分語言」的卡，每區都出現。 */
export type Zone = "zh" | "en" | "ja" | "ko";
export const ZONES: readonly Zone[] = ["zh", "en", "ja", "ko"];

/**
 * 來源的語言標記 → 語區。簡繁體併成 zh；沒標或標了不認得的值一律當 all，
 * 讓它在每一區都看得到——一張放錯區的卡，比一張從所有榜單消失的卡好處理。
 */
export function zoneOf(language: unknown): Zone | "all" {
  const l = str(language).toLowerCase();
  if (l.startsWith("zh")) return "zh";
  if (l === "en" || l === "ja" || l === "ko") return l;
  return "all";
}

export interface UpstreamRole {
  roleId: string;
  zone: Zone | "all";
  authorNumId: number;
  authorName: string;
  authorAvatar: string;
  names: Localized;
  summaries: Localized;
  avatarUrl: string | null;
  backgroundUrl: string | null;
  slug: string | null;
  tags: string[];
  /** 開場白。公開的（訪客在角色頁就看得到），只進搜尋索引，不另存欄位。 */
  welcome: string;
  /** 原作：本站自己的欄位（上游沒有），作者送審時宣告。同步時從卡上帶回來，索引才不會把它洗掉。 */
  fandom?: string;
  /** 原作在索引裡的字：對到 Wikidata 的作品是所有語言的名字與別名；自由文字就是它自己 */
  fandomSearch?: string;
  talkNum: number;
  followNum: number;
  /**
   * 上游記的建卡來源。本站建的卡是 "hearthroom"（建卡時自報、上游白名單認可）；
   * 作者在主站建的是 manual／空字串。只有本站建的能登記上榜、能出現在「我的卡片」。
   */
  creationMethod: string;
  /**
   * 供應商的內容版本（Harbor role.content_hash）。封存版的雜湊照抄送審當下的草稿，
   * 所以讀過審的封存版拿到的就是「過審那一版」的版本——跟草稿現在的比，看得出作者改了沒送審。
   */
  contentHash?: string;
}

/** 本站在上游登記的來源名。建卡時送出、讀回時比對，兩邊要同一個字。 */
export const CREATION_METHOD = "hearthroom";

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
  // 標籤的形狀不只一種：純字串、{tagName}、{text,type} 都見過。認得的都收，認不得的丟。
  const tagsRaw = raw.roleTag;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw
        .map((t) => (typeof t === "string" ? t : str((t as Record<string, unknown>)?.text) || str((t as Record<string, unknown>)?.tagName)))
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  return {
    roleId: str(raw.characterRoleId),
    zone: zoneOf(raw.language),
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
    avatarUrl: str(raw.roleBackground) || str(raw.roleAvatar) || null,
    backgroundUrl: str(raw.roleBackground) || str(raw.roleAvatar) || null,
    slug: str(raw.slug) || null,
    tags: tags.slice(0, 20),
    welcome: str(raw.roleWelcome),
    talkNum: num(raw.talkNum),
    followNum: num(raw.followNum),
    creationMethod: str(raw.creationMethod),
    ...(str(raw.contentHash) ? { contentHash: str(raw.contentHash) } : {}),
  };
}

export interface MyRole {
  roleId: string;
  zone: Zone | "all";
  name: string;
  summary: string;
  avatarUrl: string | null;
  /** Portrait artwork for the author workspace; landscape remains a stage-only choice. */
  backgroundUrl?: string | null;
  visibility: string;
  talkNum: number;
  /** 草稿現在的內容版本；供應商沒回就沒有（見 UpstreamRole.contentHash）。只在本站比對用，不送到前端。 */
  contentHash?: string;
}

export interface MyRolePage {
  items: MyRole[];
  total: number;
  hasNext: boolean;
}

/**
 * 呼叫者自己的角色卡，一次一頁。
 *
 * 上游回的是整個角色物件（四語文案、給模型看的詳細設定、輸出契約⋯⋯），一頁 100 筆
 * 是好幾百 KB。這裡只取畫面真的會用到的欄位再往下傳——省的是使用者的下載流量，
 * 不是我們的。
 */
export async function fetchMyRoles(
  env: Env,
  bearer: string,
  page: number,
  pageSize: number,
  provider: ProviderId = DEFAULT_PROVIDER,
  q = "",
): Promise<MyRolePage> {
  // q：卡名或簡介的關鍵字，由供應商比對（繁簡互通）；空字串不過濾
  const search = q ? `&q=${encodeURIComponent(q)}` : "";
  const res = await fetch(
    // 只要本站建的那一組：作者在主站建的卡不進這裡，也登記不上榜。
    apiUrl(env, provider, `/open/v1/role/mine?pageNum=${page}&pageSize=${pageSize}&creationMethod=${CREATION_METHOD}${search}`),
    { headers: { Authorization: `Bearer ${bearer}`, language: "zh-Hans", "User-Agent": UA } },
  );
  const body = await readJson(res, "role list");
  const rows = Array.isArray(body.roleList) ? (body.roleList as Record<string, unknown>[]) : [];
  return {
    items: rows
      .map((r) => ({
        roleId: str(r.characterRoleId),
        zone: zoneOf(r.language),
        name: str(r.roleName),
        summary: str(r.roleDesc),
        avatarUrl: str(r.roleBackground) || str(r.roleAvatar) || null,
        backgroundUrl: str(r.roleBackground) || str(r.roleAvatar) || null,
        visibility: str(r.roleVisibility),
        talkNum: num(r.talkNum),
        ...(str(r.contentHash) ? { contentHash: str(r.contentHash) } : {}),
      }))
      .filter((r) => r.roleId),
    total: num(body.total),
    hasNext: Boolean(body.hasNextPage),
  };
}

/**
 * 作者這幾張卡草稿現在的內容版本，用作者自己的 token 逐張讀詳情（私人草稿匿名讀不到）。
 *
 * 只有「我的卡片」的「已提交」那組用：那組的清單從本站的庫出、不經上游清單，拿不到版本，
 * 而呼叫端只替已發布、記得過審版本的卡問——一頁最多幾張，並行問完。讀不到的那張就不回，
 * 清單上不標（不猜）。
 */
async function fetchContentHashes(env: Env, bearer: string, roleIds: string[], provider: ProviderId = DEFAULT_PROVIDER): Promise<Map<string, string>> {
  const found = await Promise.all(roleIds.map(async (roleId) => {
    try {
      const res = await fetch(apiUrl(env, provider, `/open/v1/role/detail?roleId=${encodeURIComponent(roleId)}`), {
        headers: { Authorization: `Bearer ${bearer}`, language: "zh-Hans", "User-Agent": UA },
      });
      const hash = str((await readJson(res, "role")).contentHash);
      return hash ? ([roleId, hash] as const) : null;
    } catch {
      return null;
    }
  }));
  return new Map(found.filter((entry): entry is readonly [string, string] => !!entry));
}

/**
 * Harbor 的卡片處理函式親口說「沒有這張卡」：404 加上 `{"error":"role_not_found"}`。
 *
 * 跟一般的 404 分開，是因為邊緣、反向代理或部署中的路由也會回裸 404——那是上游出狀況，不是卡被刪了。
 * 對其他呼叫端它仍然就是一個 404（HttpError 的子類），只有同步拿它決定下榜。
 */
export class RoleGone extends HttpError {
  constructor() {
    super(404, "role not found");
  }
}

/** 匿名讀一張卡。同步跑在排程裡，那時沒有使用者在線，手上不會有任何人的 token。 */
async function fetchRole(env: Env, roleId: string, provider: ProviderId = DEFAULT_PROVIDER): Promise<UpstreamRole> {
  const res = await fetch(apiUrl(env, provider, `/open/v1/role/detail?roleId=${encodeURIComponent(roleId)}`), {
    headers: { language: "zh-Hans", "User-Agent": UA },
  });
  if (res.status === 404 && (await res.clone().json().catch(() => null) as { error?: unknown } | null)?.error === "role_not_found") {
    throw new RoleGone();
  }
  // 主站對不存在（或已刪除）的卡回 400 {"error":"record not found"}，不是 404；同一支處理
  // 函式連資料庫出錯也回 400。只認這一句當「找不到」，其餘 400 仍算上游故障——
  // 否則已刪除的卡會被說成「主機暫時無法使用」（2026-09-23 社群回報的卡片連結）。
  if (res.status === 400 && (await res.clone().json().catch(() => null) as { error?: unknown } | null)?.error === "record not found") {
    throw new HttpError(404, "role not found");
  }
  const role = projectRole(await readJson(res, "role"));
  if (!role.roleId) throw new HttpError(404, "role not found");
  return role;
}

/**
 * 餵給 FTS 的一團字：四語名稱 + 四語簡介 + 標籤 + 開場白，一個索引覆蓋所有語言。
 * 開場白截在四千字：它是搜尋的線索，不是要被整段索引的正文。
 */
/**
 * 搜尋索引分三欄：名稱是「這張卡叫什麼」，簡介、標籤、作者名是「它是什麼、誰寫的」，開場白是「它說了什麼」。
 * 分開存，相關度才能把名字命中的卡排在簡介提到的前面、再排在只有開場白提到的前面——不分的話
 * 一張熱門卡的開場白隨便提到一個詞就蓋過名字就是那個詞的卡。三欄都先正規化（見 searchForm），查詢端也一樣。
 * 作者名用的是同步時上游給的名字：有人在找作者時，角色卡分頁就直接出他的卡，不必切到使用者分頁。
 */
export function buildSearchName(role: UpstreamRole): string {
  return searchForm([...Object.values(role.names), role.fandom ?? "", role.fandomSearch ?? ""].filter(Boolean).join(" "));
}

export function buildSearchText(role: UpstreamRole): string {
  return searchForm([...Object.values(role.summaries), ...role.tags, role.authorName].filter(Boolean).join(" "));
}

export function buildSearchBody(role: UpstreamRole): string {
  return searchForm(role.welcome.slice(0, 4000));
}

/**
 * 上游呼叫透過這個物件轉發，測試可以整包換掉。
 *
 * 用注入而不是攔截網路層：換掉的是「跟上游的契約」這個邊界本身，測試因此讀得懂，
 * 也不綁在測試框架某個版本的 undici 內部。上游呼叫的 HTTP 形狀（路徑、標頭、
 * 錯誤碼對應）由 upstream.test.ts 直接測這兩個函式。
 */
/**
 * 呼叫者在供應商那邊能不能代表本站（本站這個應用的 owner／admin）標精選，以及配額用量。
 * 老版本的供應商沒有這條路（404）就當「不能」——畫面上只是少一個開關。
 */
async function fetchCommunityStatus(env: Env, bearer: string, provider: ProviderId = DEFAULT_PROVIDER): Promise<CommunityStatus | null> {
  const res = await fetch(apiUrl(env, provider, "/open/v1/me/community"), {
    headers: { Authorization: `Bearer ${bearer}`, "User-Agent": UA },
  });
  if (res.status === 404) return null;
  const body = await readJson(res, "community status");
  const featured = (body.featured ?? {}) as Record<string, unknown>;
  return {
    admin: body.communityAdmin === true,
    featuredUsed: Number(featured.used ?? 0) || 0,
    featuredQuota: Number(featured.quota ?? 0) || 0,
  };
}

export interface CommunityStatus {
  admin: boolean;
  featuredUsed: number;
  featuredQuota: number;
}

/**
 * 把一張卡在供應商那邊標成精選（或取消）。用的是呼叫者自己的令牌：供應商那邊會再驗一次
 * 他是不是本站應用的管理員、卡是不是公開且過審、配額夠不夠。回應碼直接翻成本站的錯誤，
 * 畫面才說得出「你不是社群代表」還是「精選名額用完了」。
 */
async function setFeatured(env: Env, bearer: string, roleId: string, featured: boolean, provider: ProviderId = DEFAULT_PROVIDER): Promise<void> {
  const res = await fetch(apiUrl(env, provider, `/open/v1/roles/${encodeURIComponent(roleId)}/rebate-tier`), {
    method: "PUT",
    headers: { Authorization: `Bearer ${bearer}`, "User-Agent": UA, "Content-Type": "application/json" },
    body: JSON.stringify({ tier: featured ? "featured" : "normal" }),
  });
  if (res.status === 204) return;
  if (res.status === 401) throw new HttpError(401, "upstream rejected the token");
  if (res.status === 403) throw new HttpError(403, "not_community_admin");
  if (res.status === 404) throw new HttpError(404, "role not found");
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { code?: unknown };
    throw new HttpError(409, body.code === "quota_exceeded" ? "featured_quota_exceeded" : "card_not_eligible");
  }
  throw new HttpError(502, `upstream featured failed with ${res.status}`);
}


export const upstream = { fetchMe, fetchRole, fetchMyRoles, fetchContentHashes, readForReview, readSealedForReview, fetchCommunityStatus, setFeatured };
export type Upstream = typeof upstream;
