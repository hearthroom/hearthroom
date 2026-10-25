/**
 * 卡片的共用狀態（sdk.shared）：全服投票、共鬥計數器與每卡排行榜。
 *
 * 作者在 rules.json 宣告 key 與規則（Provider 作者資產的 sharedState，公開卡隨卡片送審）；
 * 這裡只收宣告過的 key 與選項，存數字與選項 ID，不存玩家寫的任何文字。
 * 設計：docs/studio/tasks/2026-10-25-card-share-context/design.md §7（monorepo docs）。
 *
 * 誰寫進哪裡（ns）：
 *   - 測試帳號 → test：QA 走得完整條路，但不上榜、不算進正式數字（owner 2026-10-25 E3、E6）
 *   - 作者試玩（?mode=source）或「僅自己」的卡 → draft：作者測試灌的數字不混進正式數字
 *   - 還沒有卡片列的新卡（沒送審、沒設過能見度的私卡，CLI 試玩卡）只給作者本人，一樣寫 draft／test
 *   - 其他 → live
 * 寫入資格（E3）：登入、而且在這張卡（任一版）開過對話——member_conversations 本站就有，不必問 Provider。
 * owner 允許卡片拿這些數字解鎖卡內內容（E5），所以不另加帳齡或裝置限制；防線是資格、每人上限與限流。
 */
import { ensureCardNumber, getPublicCard, type CardRow } from "./cards";
import { hostGateway } from "./hosting";
import type { Member } from "./members";
import type { ProviderId } from "./providers";
import { upstream } from "./upstream";
import { currentCardAccess } from "./work-read";
import { HttpError, type Env } from "./types";

export const SHARED_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export { localDay };
export const LEADERBOARD_MAX = 50;
const DAY_MS = 86_400_000;
/** 換期的時區：UTC+8，跟創作季同一個慣例。 */
const PERIOD_OFFSET_MS = 8 * 3_600_000;

export type Ns = "live" | "draft" | "test";

export interface SharedPoll { options: string[]; share?: boolean }
export interface SharedCounter { goal?: number; maxStep: number; perMember: number; period?: "none" | "day" | "week" }
export interface SharedDecl { polls: Record<string, SharedPoll>; counters: Record<string, SharedCounter> }

/** Provider 已經驗過；這裡再防一次形狀，壞的 key 直接當沒宣告。 */
export function parseDecl(raw: unknown): SharedDecl {
  // 沒有原型的物件：key 寫成 constructor、toString 這類名字時，查不到 Object.prototype 上的東西
  const out: SharedDecl = { polls: Object.create(null), counters: Object.create(null) };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as { polls?: Record<string, unknown>; counters?: Record<string, unknown> };
  const own = (o: unknown) => (o && typeof o === "object" ? Object.entries(o as Record<string, unknown>) : []);
  for (const [key, p] of own(r.polls)) {
    const options = (p as SharedPoll | null)?.options;
    if (SHARED_KEY_RE.test(key) && Array.isArray(options) && options.every((o) => typeof o === "string" && SHARED_KEY_RE.test(o))) {
      out.polls[key] = { options: [...new Set(options)], share: (p as SharedPoll).share === true };
    }
  }
  for (const [key, cRaw] of own(r.counters)) {
    const c = cRaw as Partial<SharedCounter> | null;
    if (!SHARED_KEY_RE.test(key) || !c || !Number.isInteger(c.maxStep) || !Number.isInteger(c.perMember) || c.maxStep! < 1 || c.perMember! < 1) continue;
    out.counters[key] = { maxStep: c.maxStep!, perMember: c.perMember!, goal: Number.isInteger(c.goal) && c.goal! > 0 ? c.goal : undefined, period: c.period === "day" || c.period === "week" ? c.period : "none" };
  }
  return out;
}

/** 計數器的期別：'' 不分期；日 D2026-10-25；週 W<那週一的日期>（週一開始，UTC+8）。 */
export function periodOf(period: SharedCounter["period"], now: number, back = 0): string {
  if (!period || period === "none") return "";
  const local = now + PERIOD_OFFSET_MS;
  if (period === "day") return `D${new Date(local - back * DAY_MS).toISOString().slice(0, 10)}`;
  const day = new Date(local).getUTCDay();
  const monday = local - ((day + 6) % 7) * DAY_MS - back * 7 * DAY_MS;
  return `W${new Date(monday).toISOString().slice(0, 10)}`;
}

/** UTC+8 的日期，給「每天改票 10 次」計數用。 */
const localDay = (now: number) => new Date(now + PERIOD_OFFSET_MS).toISOString().slice(0, 10);

export interface CardState {
  card: CardRow;
  cardId: number;
  ns: Ns;
  decl: SharedDecl;
  /** Provider 讀不到宣告：讀取當成沒宣告，寫入回可重試的 503（不是 not_declared）。 */
  declUnavailable: boolean;
  enabled: boolean;
  isAuthor: boolean;
  /** 還沒有卡片列（只有作者讀得到的新卡、CLI 試玩卡）：不發分享短碼，朋友本來就打不開。 */
  unregistered?: boolean;
}

/** 宣告的邊緣快取：每次讀寫都問 Provider 太貴（遊客讀取也會打到）。作者改宣告後最多晚這麼久生效。 */
export const DECL_CACHE_SECONDS = 60;
const declCacheKey = (provider: ProviderId, roleId: string) => `https://card-state.internal/decl/${provider}/${encodeURIComponent(roleId)}`;

/** 匿名讀得到的宣告（公開與有連結的卡）走快取；草稿要帶作者的 token，不快取。讀不到回 null。 */
async function declarationOf(env: Env, roleId: string, provider: ProviderId, bearer?: string): Promise<SharedDecl | null> {
  if (bearer) return upstream.fetchSharedState(env, roleId, provider, bearer).then(parseDecl, () => null);
  const cache = typeof caches === "undefined" ? null : caches.default;
  const key = declCacheKey(provider, roleId);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return parseDecl(await hit.json().catch(() => ({})));
  let raw: unknown;
  try { raw = await upstream.fetchSharedState(env, roleId, provider); } catch { return null; }
  await cache?.put(key, new Response(JSON.stringify(raw ?? {}), { headers: { "Cache-Control": `max-age=${DECL_CACHE_SECONDS}`, "Content-Type": "application/json" } })).catch(() => undefined);
  return parseDecl(raw);
}

/**
 * 作者身分（這個帳號是不是這張卡的作者）的快取：作者不會變，每次讀寫都問 Harbor 太貴。
 * 「不是作者」也短暫記住：別人對這種卡的每次讀寫不必都打一次 Harbor（只會拿到 404）。
 */
export const OWN_CARD_CACHE_SECONDS = 300;
export const NOT_OWN_CARD_CACHE_SECONDS = 60;
const ownCacheKey = (provider: ProviderId, roleId: string, externalId: number) => `https://card-state.internal/own/${provider}/${encodeURIComponent(roleId)}/${externalId}`;

/**
 * 還沒有卡片列的卡（新建的私卡：沒送審、沒設過能見度；CLI 推的試玩卡）。社群站沒有它的列，
 * 只能用請求者自己的 token 讀 Harbor 的 role 確認他是作者；不是作者、讀不到一律當沒有這張卡。
 * 鍵用這個 roleId 自己的卡號：之後送審或設能見度時 upsertCard 也用同一個號碼當 cards.id，作者的試玩數字接得上。
 * 不照 works 對應到別的來源：那可能是別人（或已登記）的卡號，作者在這裡的歸零與暫停會動到那張卡。
 * 草稿轉移凍結中發不出卡號：當作沒有這張卡（404），不是 500。
 */
async function unregisteredOwnCard(env: Env, roleId: string, provider: ProviderId, member: Member, bearer: string): Promise<CardRow | null> {
  const cache = typeof caches === "undefined" ? null : caches.default;
  const key = ownCacheKey(provider, roleId, member.externalId);
  const hit = await cache?.match(key).catch(() => undefined);
  let own = hit ? ((await hit.json().catch(() => null)) as { roleId: string | null } | null) : null;
  if (!own) {
    const role = await hostGateway.read(env, bearer, roleId, provider).catch(() => null);
    own = { roleId: role && role.authorNumId === member.externalId ? role.roleId : null };
    const seconds = own.roleId ? OWN_CARD_CACHE_SECONDS : NOT_OWN_CARD_CACHE_SECONDS;
    await cache?.put(key, new Response(JSON.stringify(own), { headers: { "Cache-Control": `max-age=${seconds}`, "Content-Type": "application/json" } })).catch(() => undefined);
  }
  if (!own.roleId) return null;
  const num = await ensureCardNumber(env.DB, provider, own.roleId).catch(() => null);
  if (num === null) return null;
  return { id: String(num), provider, source_role_id: own.roleId, author_num_id: member.externalId } as CardRow;
}

export interface ResolveOptions {
  provider: ProviderId;
  member?: Member | null;
  bearer?: string | null;
  /** 作者的草稿試玩（?mode=source）：只有作者本人才算數。 */
  draft?: boolean;
}

/**
 * 玩家正在玩的 roleId → 這張卡、寫進哪個 ns、宣告了什麼、開沒開。
 * 公開卡用核准版的宣告，有連結的卡用最新存檔；草稿與私卡（只有作者）用原稿。
 * 別人打不開的卡一律 404，不透露有沒有這張卡。
 */
export async function resolveCardState(env: Env, roleId: string, opts: ResolveOptions): Promise<CardState> {
  // 查卡失敗（D1 暫時出錯）照舊 404，不走下面「沒有卡片列」的退路：不然已登記卡的作者會被悄悄寫進另一份
  const found = await getPublicCard(env.DB, roleId, opts.provider).then((row) => ({ row }), () => null);
  if (!found) throw new HttpError(404, "card not found");
  const card = found.row;
  if (!card) {
    // 平台總開關關著：不問 Harbor、不發卡號，跟已登記的卡一樣回「沒開」
    if (env.CARD_STATE_ENABLED !== "true") return { card: { id: "0", provider: opts.provider, source_role_id: roleId } as CardRow, cardId: 0, ns: "live", decl: parseDecl({}), declUnavailable: false, enabled: false, isAuthor: false, unregistered: true };
    const own = opts.member && opts.bearer ? await unregisteredOwnCard(env, roleId, opts.provider, opts.member, opts.bearer) : null;
    if (!own) throw new HttpError(404, "card not found");
    const decl = await declarationOf(env, own.source_role_id, opts.provider, opts.bearer ?? undefined);
    const controls = await env.DB.prepare("SELECT author_off, platform_off FROM card_state_controls WHERE card_id = ?").bind(Number(own.id)).first<{ author_off: number; platform_off: number }>();
    return {
      card: own, cardId: Number(own.id), ns: opts.member!.accountClass === "test" ? "test" : "draft", decl: decl ?? parseDecl({}), declUnavailable: decl === null,
      enabled: env.CARD_STATE_ENABLED === "true" && !controls?.author_off && !controls?.platform_off, isAuthor: true, unregistered: true,
    };
  }
  if (card.provider !== opts.provider) throw new HttpError(404, "card not found");
  const access = await currentCardAccess(env, card);
  const isAuthor = !!opts.member && opts.member.provider === card.provider && opts.member.externalId === card.author_num_id;
  // 別人打不開的卡（私卡、停權），任何人（含測試帳號）都是 404；作者自己的私卡寫進 draft
  if (!access.reachable && !isAuthor) throw new HttpError(404, "card not found");
  let ns: Ns = "live";
  if (opts.member?.accountClass === "test") ns = "test";
  else if (isAuthor && (opts.draft || !access.reachable)) ns = "draft";
  const draftRead = isAuthor && (opts.draft || !access.reachable);
  const declRole = draftRead ? card.source_role_id : access.shareRoleId || card.source_role_id;
  const fetched = await declarationOf(env, declRole, opts.provider, draftRead ? opts.bearer ?? undefined : undefined);
  const decl = fetched ?? parseDecl({});
  const controls = await env.DB.prepare("SELECT author_off, platform_off FROM card_state_controls WHERE card_id = ?").bind(Number(card.id)).first<{ author_off: number; platform_off: number }>();
  const enabled = env.CARD_STATE_ENABLED === "true" && !controls?.author_off && !controls?.platform_off;
  return { card, cardId: Number(card.id), ns, decl, declUnavailable: fetched === null, enabled, isAuthor };
}

/** 查過有玩過之後多久不再問 Harbor（design §7.6）。 */
export const ELIGIBILITY_TTL_MS = 30 * DAY_MS;

/**
 * 寫入資格（E3、§7.6 B）：在這張卡開過對話。第一次寫入時用玩家自己的 token 向 Harbor 查這張卡的對話存檔
 * （roleId 是他正在玩的那一版，Harbor 連同同一作品的其他版本一起列），查到就記 30 天。
 * 本站的 member_conversations 是遊玩頁回報的、伺服器不驗證，不能當資格。作者本人寫自己的卡不需要。
 * Harbor 問不到 → 503 eligibility_unavailable（可重試），不當成「沒玩過」。
 */
export async function hasPlayed(env: Env, state: CardState, memberId: string, roleId: string, bearer: string, provider: ProviderId, now: number): Promise<boolean> {
  // 作者本人寫自己的卡（草稿試玩，或測試帳號作者寫進 test）不必查
  if (state.ns === "draft" || state.isAuthor) return true;
  const cached = await env.DB.prepare("SELECT checked_at FROM card_state_eligibility WHERE card_id = ? AND member_id = ?").bind(state.cardId, memberId).first<{ checked_at: number }>();
  if (cached && now - cached.checked_at < ELIGIBILITY_TTL_MS) return true;
  let count: number;
  try { count = await upstream.fetchArchiveCount(env, bearer, roleId, provider); } catch { throw new HttpError(503, "eligibility_unavailable"); }
  if (count <= 0) return false;
  await env.DB.prepare(`INSERT INTO card_state_eligibility (card_id, member_id, checked_at) VALUES (?, ?, ?)
    ON CONFLICT (card_id, member_id) DO UPDATE SET checked_at = excluded.checked_at`).bind(state.cardId, memberId, now).run();
  return true;
}

export type PollView = { kind: "poll"; counts: Record<string, number>; total: number; mine?: string | null };
export type CounterView = { kind: "counter"; total: number; goal?: number; reachedAt?: number | null; previous?: number; mine?: number };

/** 讀一組 key：投票回各選項票數（只算還宣告著的選項），計數器回這一期與上一期的總數。 */
export async function readState(env: Env, state: CardState, keys: string[], memberId: string | null, now: number): Promise<Record<string, PollView | CounterView>> {
  const out: Record<string, PollView | CounterView> = {};
  const wanted = [...new Set(keys)].filter((k) => k in state.decl.polls || k in state.decl.counters).slice(0, 16);
  for (const key of wanted) {
    const poll = key in state.decl.polls ? state.decl.polls[key] : undefined;
    if (poll) {
      const rows = await env.DB.prepare("SELECT option, value FROM card_state_totals WHERE card_id=? AND ns=? AND scope='global' AND key=? AND period=''")
        .bind(state.cardId, state.ns, key).all<{ option: string; value: number }>();
      const counts: Record<string, number> = Object.fromEntries(poll.options.map((o) => [o, 0]));
      for (const r of rows.results) if (r.option in counts) counts[r.option] = Math.max(0, r.value);
      const view: PollView = { kind: "poll", counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
      if (memberId) {
        const mine = await env.DB.prepare("SELECT option FROM card_state_members WHERE card_id=? AND ns=? AND scope='global' AND key=? AND period='' AND member_id=?")
          .bind(state.cardId, state.ns, key, memberId).first<{ option: string }>();
        view.mine = mine && poll.options.includes(mine.option) ? mine.option : null;
      }
      out[key] = view;
      continue;
    }
    const counter = state.decl.counters[key]!;
    const period = periodOf(counter.period, now), previous = periodOf(counter.period, now, 1);
    const rows = await env.DB.prepare("SELECT period, value, reached_at FROM card_state_totals WHERE card_id=? AND ns=? AND scope='global' AND key=? AND option='' AND period IN (?, ?)")
      .bind(state.cardId, state.ns, key, period, previous).all<{ period: string; value: number; reached_at: number | null }>();
    const cur = rows.results.find((r) => r.period === period);
    const view: CounterView = { kind: "counter", total: cur?.value ?? 0 };
    if (counter.goal) { view.goal = counter.goal; view.reachedAt = cur?.reached_at ?? null; }
    if (period) view.previous = rows.results.find((r) => r.period === previous)?.value ?? 0;
    if (memberId) {
      const mine = await env.DB.prepare("SELECT value FROM card_state_members WHERE card_id=? AND ns=? AND scope='global' AND key=? AND period=? AND member_id=?")
        .bind(state.cardId, state.ns, key, period, memberId).first<{ value: number }>();
      view.mine = mine?.value ?? 0;
    }
    out[key] = view;
  }
  return out;
}

/** 一位會員每天在同一個投票最多改這麼多次。 */
export const VOTE_CHANGES_PER_DAY = 10;

/**
 * 投票：一人一票、可以改。個人那一列與兩個選項的總數在同一個 batch 裡改，總數只認這一次寫入的 rev，
 * 重送同一票不重算、並發的另一筆不會讓總數跑掉。
 */
export async function vote(env: Env, state: CardState, key: string, option: string, memberId: string, now: number, scope = "global"): Promise<{ mine: string }> {
  const poll = key in state.decl.polls ? state.decl.polls[key] : undefined;
  if (!poll) throw new HttpError(400, "not_declared");
  if (!poll.options.includes(option)) throw new HttpError(400, "option_invalid");
  const prev = await env.DB.prepare("SELECT option, changes, changes_day FROM card_state_members WHERE card_id=? AND ns=? AND scope=? AND key=? AND period='' AND member_id=?")
    .bind(state.cardId, state.ns, scope, key, memberId).first<{ option: string; changes: number; changes_day: string }>();
  if (prev?.option === option) return { mine: option };
  const day = localDay(now);
  if (prev && prev.changes_day === day && prev.changes >= VOTE_CHANGES_PER_DAY) throw new HttpError(429, "limit_reached");
  const rev = crypto.randomUUID();
  const pk = [state.cardId, state.ns, scope, key, ""] as const;
  const applied = `(SELECT 1 FROM card_state_members WHERE card_id=? AND ns=? AND scope=? AND key=? AND period=? AND member_id=? AND rev=?)`;
  const appliedArgs = [...pk, memberId, rev];
  const stmts = [
    // 只有讀到的那一票還在時才換（WHERE option IS ?）：並發的兩票只有一筆成立
    prev
      ? env.DB.prepare(`UPDATE card_state_members SET previous=option, option=?, rev=?, changes=CASE WHEN changes_day=? THEN changes+1 ELSE 1 END, changes_day=?, updated_at=?
          WHERE card_id=? AND ns=? AND scope=? AND key=? AND period=? AND member_id=? AND option=?`).bind(option, rev, day, day, now, ...pk, memberId, prev.option)
      : env.DB.prepare(`INSERT OR IGNORE INTO card_state_members (card_id, ns, scope, key, period, member_id, option, value, changes, changes_day, rev, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`).bind(...pk, memberId, option, day, rev, now),
    env.DB.prepare(`INSERT INTO card_state_totals (card_id, ns, scope, key, period, option, value, updated_at) SELECT ?, ?, ?, ?, ?, ?, 1, ? WHERE EXISTS ${applied}
        ON CONFLICT (card_id, ns, scope, key, period, option) DO UPDATE SET value = value + 1, updated_at = excluded.updated_at`).bind(...pk, option, now, ...appliedArgs),
  ];
  if (prev) {
    stmts.push(env.DB.prepare(`UPDATE card_state_totals SET value = MAX(0, value - 1), updated_at = ? WHERE card_id=? AND ns=? AND scope=? AND key=? AND period=? AND option=? AND EXISTS ${applied}`)
      .bind(now, ...pk, prev.option, ...appliedArgs));
  }
  await env.DB.batch(stmts);
  const now2 = await env.DB.prepare("SELECT option FROM card_state_members WHERE card_id=? AND ns=? AND scope=? AND key=? AND period='' AND member_id=?")
    .bind(state.cardId, state.ns, scope, key, memberId).first<{ option: string }>();
  return { mine: now2?.option ?? option };
}

/**
 * 計數器：加一個 1..maxStep 的整數。每人每期最多 perMember，超過的部分不算（加滿了回 limit_reached）；
 * 有目標的達標後不再增加，記下達標時刻。實際加了多少在 SQL 裡算（last_delta），總數只加這一筆的量。
 */
export async function add(env: Env, state: CardState, key: string, delta: number, memberId: string, now: number): Promise<{ total: number; mine: number; reachedAt: number | null }> {
  const counter = key in state.decl.counters ? state.decl.counters[key] : undefined;
  if (!counter) throw new HttpError(400, "not_declared");
  if (!Number.isInteger(delta) || delta < 1 || delta > counter.maxStep) throw new HttpError(400, "delta_invalid");
  const period = periodOf(counter.period, now);
  const pk = [state.cardId, state.ns, "global", key, period] as const;
  const total = await env.DB.prepare("SELECT value, reached_at FROM card_state_totals WHERE card_id=? AND ns=? AND scope=? AND key=? AND period=? AND option=''")
    .bind(...pk).first<{ value: number; reached_at: number | null }>();
  if (counter.goal && total?.reached_at) throw new HttpError(409, "goal_reached");
  const rev = crypto.randomUUID();
  const goal = counter.goal ?? Number.MAX_SAFE_INTEGER;
  const mineSql = `(SELECT last_delta FROM card_state_members WHERE card_id=? AND ns=? AND scope=? AND key=? AND period=? AND member_id=? AND rev=?)`;
  const mineArgs = [...pk, memberId, rev];
  const results = await env.DB.batch([
    // SQLite 的 UPDATE SET 一律用舊值計算：last_delta 與 value 用的是同一個「還剩多少額度」
    env.DB.prepare(`INSERT INTO card_state_members (card_id, ns, scope, key, period, member_id, value, last_delta, rev, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, MIN(?, ?), MIN(?, ?), ?, ?)
        ON CONFLICT (card_id, ns, scope, key, period, member_id) DO UPDATE SET
          last_delta = MAX(0, MIN(?, ? - value)), value = value + MAX(0, MIN(?, ? - value)), rev = excluded.rev,
          updated_at = CASE WHEN MIN(?, ? - value) > 0 THEN excluded.updated_at ELSE updated_at END`)
      .bind(...pk, memberId, delta, counter.perMember, delta, counter.perMember, rev, now, delta, counter.perMember, delta, counter.perMember, delta, counter.perMember),
    env.DB.prepare(`INSERT INTO card_state_totals (card_id, ns, scope, key, period, option, value, reached_at, updated_at)
        SELECT ?, ?, ?, ?, ?, '', MIN(?, d), CASE WHEN d >= ? THEN ? END, ? FROM (SELECT ${mineSql} AS d) WHERE d > 0
        ON CONFLICT (card_id, ns, scope, key, period, option) DO UPDATE SET
          reached_at = COALESCE(reached_at, CASE WHEN value + excluded.value >= ? THEN excluded.updated_at END),
          value = MIN(?, value + excluded.value), updated_at = excluded.updated_at`)
      .bind(...pk, goal, goal, now, now, ...mineArgs, goal, goal),
    env.DB.prepare(`SELECT last_delta, value FROM card_state_members WHERE card_id=? AND ns=? AND scope=? AND key=? AND period=? AND member_id=?`).bind(...pk, memberId),
    env.DB.prepare(`SELECT value, reached_at FROM card_state_totals WHERE card_id=? AND ns=? AND scope=? AND key=? AND period=? AND option=''`).bind(...pk),
  ]);
  const mine = (results[2]!.results[0] ?? { last_delta: 0, value: 0 }) as { last_delta: number; value: number };
  const after = (results[3]!.results[0] ?? { value: 0, reached_at: null }) as { value: number; reached_at: number | null };
  if (mine.last_delta === 0) throw new HttpError(429, "limit_reached");
  return { total: after.value, mine: mine.value, reachedAt: after.reached_at };
}

export interface LeaderboardRow { rank: number; name: string | null; value: number }

/**
 * 每卡排行榜（E6）：計數器這一期貢獻最多的人。對外只有名次、公開暱稱（跟留言區同一個 display_name：
 * 沒設暱稱的人，登入時就被填成他的公開代號 handle；極少數還是空的回 null）與貢獻值，不給帳號或會員 ID。同分時先到的人在前。
 * 測試帳號在 test ns，本來就不在正式榜上；名單另外只收一般帳號（account_class），雙重保險。
 */
export async function leaderboard(env: Env, state: CardState, key: string, limit: number, memberId: string | null, now: number): Promise<{ items: LeaderboardRow[]; mine?: { rank: number; value: number } }> {
  const counter = key in state.decl.counters ? state.decl.counters[key] : undefined;
  if (!counter) throw new HttpError(400, "not_declared");
  const period = periodOf(counter.period, now);
  const n = Math.min(Math.max(1, Math.floor(limit) || 10), LEADERBOARD_MAX);
  const rows = await env.DB.prepare(`SELECT m.display_name AS name, s.value FROM card_state_members s JOIN members m ON m.id = s.member_id
      WHERE s.card_id=? AND s.ns=? AND s.scope='global' AND s.key=? AND s.period=? AND s.value > 0 AND m.account_class = 'normal'
      ORDER BY s.value DESC, s.updated_at ASC LIMIT ?`).bind(state.cardId, state.ns, key, period, n).all<{ name: string | null; value: number }>();
  const items = rows.results.map((r, i) => ({ rank: i + 1, name: r.name ?? null, value: r.value }));
  if (!memberId) return { items };
  const mine = await env.DB.prepare("SELECT value, updated_at FROM card_state_members WHERE card_id=? AND ns=? AND scope='global' AND key=? AND period=? AND member_id=?")
    .bind(state.cardId, state.ns, key, period, memberId).first<{ value: number; updated_at: number }>();
  if (!mine || mine.value <= 0) return { items };
  const ahead = await env.DB.prepare(`SELECT COUNT(*) AS n FROM card_state_members s JOIN members m ON m.id = s.member_id
      WHERE s.card_id=? AND s.ns=? AND s.scope='global' AND s.key=? AND s.period=? AND m.account_class = 'normal'
        AND (s.value > ? OR (s.value = ? AND s.updated_at < ?))`).bind(state.cardId, state.ns, key, period, mine.value, mine.value, mine.updated_at).first<{ n: number }>();
  return { items, mine: { rank: (ahead?.n ?? 0) + 1, value: mine.value } };
}

/** 作者重設一個 key（全部期別）或清空整個 draft。 */
export function resetStmts(env: Env, cardId: number, ns: Ns, key: string | null): D1PreparedStatement[] {
  const where = key === null ? "card_id=? AND ns=?" : "card_id=? AND ns=? AND key=?";
  const args = key === null ? [cardId, ns] : [cardId, ns, key];
  const tokens = key === null ? "card_id=? AND ns=?" : "card_id=? AND ns=? AND poll_key=?";
  return [
    env.DB.prepare(`DELETE FROM card_state_members WHERE ${where}`).bind(...args),
    env.DB.prepare(`DELETE FROM card_state_totals WHERE ${where}`).bind(...args),
    // 分享回流的快照也一起清，不然重設後當天還看得到舊人數
    env.DB.prepare(`DELETE FROM card_share_snapshots WHERE token IN (SELECT token FROM card_share_tokens WHERE ${tokens})`).bind(...args),
  ];
}
