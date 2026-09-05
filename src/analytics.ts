import type { Env } from "./types";

/**
 * 埋点。
 *
 * 分工：**Cloudflare Web Analytics 管「有多少人来」**（页面浏览、访客、来源、Core Web Vitals），
 * 这里只管**「他们做了什么」**。两边不重复建设，也就不用为对方的口径打补丁。
 *
 * 为什么不在这里数页面浏览：前端是 SPA，站内跳转由 vue-router 接管，连一次 HTTP 请求都不产生；
 * 而 wrangler.toml 的 run_worker_first 只列了卡片页与作者页，首页和搜索页的文件请求根本不进 Worker。
 * 真正的行为信号是 API 调用本身——看榜单就会打 /v1/cards，看卡片就会打 /v1/cards/:id。
 *
 * 一个请求只发一个数据点：中间件先建一份空的，handler 往里填它才知道的东西（结果数、排序键、
 * 卡片 id），中间件在 next() 之后补上路由、状态、耗时、快取命中，然后发出去。这样既不会重复
 * 计数，也拿得到只有 handler 手上才有的语义。
 *
 * 失败一律吞掉：埋点是可选的可观测性，绝不能让业务请求跟着 500。绑定没配（分叉的人多半不会配）
 * 就静默跳过。
 */

/** 一个数据点。欄位顺序就是 blob 的顺序，改动要同步 README 的报表章节与既有查询。 */
export interface EventFields {
  /** 事件名。也是 AE 的采样键：采样按 index 值分桶，所以低频事件不会被高频的淹掉。 */
  event: string;
  /** 从哪个页面来的。SPA 的同源 fetch 带的 Referer 是当前页自己，问不出来源，所以前端显式送 X-From。 */
  from?: string;
  /** 路由模板（Hono 的 routePath），不是真实 URL——搜寻词在 query 里。 */
  route?: string;
  locale?: string;
  /** 搜寻页那个「目前语言／全部语言」开关。语区本身是介面语言推导出来的，不是独立维度。 */
  zoneScope?: string;
  country?: string;
  /** 外部来源的网域，只有 HTML 首次载入才有值——分享链接的归因就靠它。 */
  refHost?: string;
  sortKey?: string;
  tag?: string;
  /** 搜寻原词，已过形态过滤。 */
  term?: string;
  /** 这个事件是关于哪张卡／哪位作者的。 */
  subject?: string;
  outcome?: string;
  cache?: string;
  /** 事件专属的小分类（分享走了哪条路、错误类型）。合法值在 README 穷举。 */
  detail?: string;
  /** server / beacon / bot */
  client?: string;
  durationMs?: number;
  resultCount?: number;
  offset?: number;
  status?: number;
}

/** blob 的顺序。查询时 blob1..blob15 就照这个数。 */
const BLOBS: (keyof EventFields)[] = [
  "event", "from", "route", "locale", "zoneScope", "country", "refHost",
  "sortKey", "tag", "term", "subject", "outcome", "cache", "detail", "client",
];
const DOUBLES: (keyof EventFields)[] = ["durationMs", "resultCount", "offset", "status"];

/** 单个 blob 的长度上限。AE 限制是一个数据点所有 blob 合计 5120 字节，逐个截断就不可能超。 */
const MAX_BLOB = 128;

const str = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX_BLOB) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * 发一个数据点。
 *
 * writeDataPoint 会立刻返回、由 runtime 在背景写，不占 CPU 时间预算；再包一层 waitUntil 是因为
 * 官方只说了「不用 await」，没说 invocation 结束后背景任务保证跑完，包一层的代价接近零。
 */
export function emit(env: Env, ctx: { waitUntil(p: Promise<unknown>): void } | undefined, fields: EventFields): void {
  try {
    if (env.ANALYTICS_ENABLED === "false") return;
    const dataset = env.EVENTS;
    if (!dataset) return; // 分叉没配绑定：静默跳过，这不是错误
    const point = {
      indexes: [str(fields.event)],
      blobs: BLOBS.map((k) => str(fields[k])),
      doubles: DOUBLES.map((k) => num(fields[k])),
    };
    const write = () => dataset.writeDataPoint(point);
    if (ctx) ctx.waitUntil(Promise.resolve().then(write));
    else write();
  } catch {
    // 绑定异常、配额异常都不该拖垮请求
  }
}

/**
 * 搜寻词的形态过滤。
 *
 * 搜寻框里什么都可能被打进去。这里挡掉「一看就不是搜寻词」的那几类——误贴的邮箱、网址、
 * 电话或订单号——剩下的才留原词。频次门槛放在报表侧而不是这里：零结果查询的价值全部在长尾，
 * 只出现过一次的词才是内容缺口，在采集端就按频次砍等于把要找的东西先扔掉。
 */
export function shapeTerm(raw: string | undefined): string {
  const q = (raw ?? "").trim();
  if (!q) return "";
  if (q.includes("@") || q.includes("://")) return "";
  if (/\d{9,}/.test(q)) return "";
  return q.slice(0, 64);
}

/** 只留站外来源的网域。站内跳转的 referer 是自己，对归因没有意义。 */
export function refHostOf(referer: string | undefined, selfHost: string): string {
  if (!referer) return "";
  try {
    const host = new URL(referer).host;
    return host && host !== selfHost ? host : "";
  } catch {
    return "";
  }
}

/**
 * 是不是机器人。抓取器不跑 JS，所以真人行为其实已经被 beacon 那条路天然筛过一遍；
 * 这里只是让服务端事件也能在报表里把爬虫扣掉。关键字比对就够，不值得引一个 UA 解析库。
 */
const BOT = /bot|crawler|spider|crawling|facebookexternalhit|slurp|bingpreview|discordbot|telegrambot|whatsapp|twitterbot|linkedinbot|embedly|quora link preview|preview|scrape|curl|wget|python-requests|headless/i;
export const clientKind = (ua: string | undefined): "bot" | "server" => (ua && BOT.test(ua) ? "bot" : "server");

/** 前端送来的来源标记。白名单挡住随手塞进来的任意字串。 */
const SURFACES = new Set(["board", "search", "card", "author", "mine", "create", "wallet", "direct", "404"]);
export const surfaceOf = (raw: string | undefined) => (raw && SURFACES.has(raw) ? raw : "direct");

/**
 * beacon 收得下的事件。白名单之外一律丢弃而不是记成 unknown——这是全站唯一不需要登入就能写入的
 * 端点，任何来路不明的值都不该在报表里占一行。
 *
 * 为什么这些非得走 beacon：评论、建立／编辑卡片、钱包都是直接打上游的跨域请求，本站的 Worker
 * 完全看不到；外观与语言切换更是连一次请求都不产生。服务端那条路记不到它们。
 */
export const BEACON_EVENTS = new Set([
  // 转化与分享
  "cta", "share",
  // 帐号
  "login_start", "login_done", "login_fail", "logout",
  // 评论（互动的核心，全部打上游）
  "comment_tab", "comment_post", "comment_like", "comment_delete",
  // 作者供给侧（建立与编辑都打上游）
  "card_create", "card_edit",
  // 钱包与变现
  "wallet_view", "topup_click",
  // 偏好（纯客户端，没有请求）
  "appearance", "locale_switch",
  // 其他
  "page_404", "error",
]);

/** beacon 事件的 detail 小分类。同样白名单，避免自由字串进 blob。 */
export const BEACON_DETAILS = new Set([
  "share_web", "share_clipboard", "share_manual", "share_abort",
  "api_error", "js_error", "unhandled_rejection",
  "oauth_denied", "oauth_state", "oauth_exchange", "oauth_other",
  "comment_root", "comment_reply", "like_on", "like_off",
  // 外观分两类，实际选了哪一个放 subject——不然每加一套主题都要回来改白名单，忘了就静默变空
  "mode", "theme",
]);

/**
 * beacon 送来的 subject。roleId 是 UUID、主题是小写词、语言像 zh-Hant，都落在这个字元集里。
 * 收窄成这一套是为了让这个无鉴权端点不可能把任意字串塞进报表。
 */
export const safeSubject = (raw: unknown): string =>
  typeof raw === "string" ? raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) : "";

/** Hono context 上挂的那份 pending event。 */
export type Pending = Partial<EventFields>;

/** handler 往 pending event 里填自己才知道的东西。 */
export function note(c: { get(key: "ev"): Pending | undefined }, fields: Pending): void {
  Object.assign(c.get("ev") ?? {}, fields);
}
