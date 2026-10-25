import { Hono, type Context } from "hono";
import { auditStmt } from "./audit";
import { add, hasPlayed, leaderboard, readState, resetStmts, resolveCardState, vote, SHARED_KEY_RE, type CardState } from "./card-state";
import { providerOf, requireMember, saveMemberId, type Member } from "./members";
import { mintToken, ownerResults, tokenFor } from "./card-share-tokens";
import { bumpOp } from "./ops-metrics";
import { HttpError, type Env } from "./types";

/**
 * 卡片共用狀態的路由（邏輯在 card-state.ts）。:roleId 是玩家正在玩的那個 roleId，跟存檔一樣由舞台代卡片送；
 * ?draft=1 是作者草稿試玩，只有作者本人才生效。
 *
 * 錯誤碼（舞台照抄成 SDK 的錯誤）：shared_disabled（平台或作者關了）、not_declared、option_invalid、
 * delta_invalid、not_eligible（沒玩過這張卡）、rate_limited、limit_reached（改票次數或每人上限）、goal_reached。
 */
export const cardStateRoutes = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;

const NO_STORE = { "Cache-Control": "private, no-store" };
const bearerOf = (c: Ctx) => c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1] ?? null;

/**
 * 讀取不必登入；帶了 token 就認人（回 mine）。token 過期或被拒就當遊客——朋友點開分享連結時登入剛好過期，
 * 不能因此拿不到情境碼。
 */
async function optionalMember(c: Ctx): Promise<Member | null> {
  if (!bearerOf(c)) return null;
  try { return await requireMember(c); } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}

async function stateFor(c: Ctx, member: Member | null): Promise<CardState> {
  return resolveCardState(c.env, c.req.param("roleId")!, { provider: providerOf(c), member, bearer: bearerOf(c), draft: c.req.query("draft") === "1" });
}

async function limited(binding: RateLimit | undefined, key: string): Promise<boolean> {
  if (!binding) return false;
  try { return !(await binding.limit({ key })).success; } catch { return false; }
}

/** 讀取的限流（遊客也算）：以連線 IP 為鍵，打滿回 rate_limited，不碰 D1 與 Provider。 */
async function readGate(c: Ctx): Promise<void> {
  const ip = c.req.header("cf-connecting-ip") ?? "";
  if (ip && (await limited(c.env.CARD_STATE_READ_LIMIT, ip))) throw new HttpError(429, "rate_limited");
}

const keyParam = (c: Ctx) => {
  const key = c.req.param("key") ?? "";
  if (!SHARED_KEY_RE.test(key)) throw new HttpError(400, "not_declared");
  return key;
};

cardStateRoutes.get("/v1/cards/:roleId/state", async (c) => {
  await readGate(c);
  const member = await optionalMember(c);
  const state = await stateFor(c, member);
  if (!state.enabled) return c.json({ enabled: false, items: {} }, 200, NO_STORE);
  const keys = (c.req.query("keys") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const memberId = member ? await saveMemberId(c.env.DB, member) : null;
  return c.json({ enabled: true, items: await readState(c.env, state, keys, memberId, Date.now()) }, 200, NO_STORE);
});

cardStateRoutes.get("/v1/cards/:roleId/state/:key/leaderboard", async (c) => {
  await readGate(c);
  const member = await optionalMember(c);
  const state = await stateFor(c, member);
  if (!state.enabled) throw new HttpError(403, "shared_disabled");
  const memberId = member ? await saveMemberId(c.env.DB, member) : null;
  return c.json(await leaderboard(c.env, state, keyParam(c), Number(c.req.query("limit") ?? 10), memberId, Date.now()), 200, NO_STORE);
});

type WriteOp = "vote" | "add" | "share_mint" | "share_respond";

/** 寫入的共同關卡：開關、資格、限流；任一關沒過都記一筆指標。 */
async function writeGate(c: Ctx, op: WriteOp): Promise<{ state: CardState; memberId: string }> {
  const member = await requireMember(c);
  const memberId = await saveMemberId(c.env.DB, member);
  // 每位會員的限流排在讀卡與宣告之前：打滿的人不會再讓 Worker 去問 Provider
  if (await limited(c.env.CARD_STATE_MEMBER_LIMIT, memberId)) { await bumpOp(c.env.DB, "card_state", op, "limited"); throw new HttpError(429, "rate_limited"); }
  const state = await stateFor(c, member);
  if (!state.enabled) { await bumpOp(c.env.DB, "card_state", op, "disabled"); throw new HttpError(403, "shared_disabled"); }
  if (await limited(c.env.CARD_STATE_CARD_LIMIT, String(state.cardId))) { await bumpOp(c.env.DB, "card_state", op, "limited"); throw new HttpError(429, "rate_limited"); }
  if (state.declUnavailable) { await bumpOp(c.env.DB, "card_state", op, "error"); throw new HttpError(503, "declaration_unavailable"); }
  let played: boolean;
  try { played = await hasPlayed(c.env, state, memberId, c.req.param("roleId")!, bearerOf(c)!, providerOf(c), Date.now()); } catch (err) { await bumpOp(c.env.DB, "card_state", op, "error"); throw err; }
  if (!played) { await bumpOp(c.env.DB, "card_state", op, "ineligible"); throw new HttpError(403, "not_eligible"); }
  return { state, memberId };
}

async function counted<T>(c: Ctx, op: WriteOp, run: () => Promise<T>): Promise<T> {
  try {
    const out = await run();
    await bumpOp(c.env.DB, "card_state", op, "ok");
    return out;
  } catch (err) {
    const outcome = err instanceof HttpError ? (err.status === 429 || err.message === "goal_reached" ? "limited" : err.status === 400 ? "invalid" : "denied") : "error";
    await bumpOp(c.env.DB, "card_state", op, outcome);
    throw err;
  }
}

cardStateRoutes.post("/v1/cards/:roleId/state/:key/vote", async (c) => {
  const { state, memberId } = await writeGate(c, "vote");
  const body = (await c.req.json().catch(() => null)) as { option?: unknown } | null;
  const key = keyParam(c);
  const out = await counted(c, "vote", () => vote(c.env, state, key, typeof body?.option === "string" ? body.option : "", memberId, Date.now()));
  return c.json(out, 200, NO_STORE);
});

cardStateRoutes.post("/v1/cards/:roleId/state/:key/add", async (c) => {
  const { state, memberId } = await writeGate(c, "add");
  const body = (await c.req.json().catch(() => null)) as { delta?: unknown } | null;
  const key = keyParam(c);
  const out = await counted(c, "add", () => add(c.env, state, key, typeof body?.delta === "number" ? body.delta : NaN, memberId, Date.now()));
  return c.json(out, 200, NO_STORE);
});

/** 作者本人的設定（CLI card state、之後的編輯頁開關）：不是作者一律 404，不透露有沒有這張卡。 */
async function authorState(c: Ctx): Promise<{ member: Member; state: CardState }> {
  const member = await requireMember(c);
  const state = await resolveCardState(c.env, c.req.param("roleId")!, { provider: providerOf(c), member, bearer: bearerOf(c), draft: true });
  if (!state.isAuthor) throw new HttpError(404, "card not found");
  return { member, state };
}

cardStateRoutes.get("/v1/me/cards/:roleId/shared-state", async (c) => {
  const { state } = await authorState(c);
  // 讀不到宣告不能回空設定：編輯頁會把「沒宣告」當成整塊不顯示，作者就看不到讀取失敗
  if (state.declUnavailable) throw new HttpError(503, "declaration_unavailable");
  const controls = await c.env.DB.prepare("SELECT author_off, platform_off FROM card_state_controls WHERE card_id = ?").bind(state.cardId).first<{ author_off: number; platform_off: number }>();
  const keys = [...Object.keys(state.decl.polls), ...Object.keys(state.decl.counters)];
  const live = { ...state, ns: "live" as const };
  return c.json({
    platformEnabled: c.env.CARD_STATE_ENABLED === "true",
    authorOff: !!controls?.author_off,
    platformOff: !!controls?.platform_off,
    declaration: state.decl,
    live: await readState(c.env, live, keys, null, Date.now()),
    draft: await readState(c.env, state, keys, null, Date.now()),
  }, 200, NO_STORE);
});

cardStateRoutes.put("/v1/me/cards/:roleId/shared-state", async (c) => {
  const { member, state } = await authorState(c);
  const body = (await c.req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") throw new HttpError(400, "enabled_required");
  const now = Date.now(), off = body.enabled ? 0 : 1;
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO card_state_controls (card_id, author_off, platform_off, updated_at) VALUES (?, ?, 0, ?)
      ON CONFLICT (card_id) DO UPDATE SET author_off = excluded.author_off, updated_at = excluded.updated_at`).bind(state.cardId, off, now),
    auditStmt(c.env.DB, { subjectKind: "card_state", subjectId: String(state.cardId), actorMemberId: member.id, actorKind: "human", action: body.enabled ? "author_on" : "author_off", operationId: crypto.randomUUID(), now }),
  ]);
  await bumpOp(c.env.DB, "card_state", "author_toggle", "ok");
  return c.json({ authorOff: !!off }, 200, NO_STORE);
});

cardStateRoutes.post("/v1/me/cards/:roleId/shared-state/:key/reset", async (c) => {
  const { member, state } = await authorState(c);
  const key = keyParam(c);
  const body = (await c.req.json().catch(() => ({}))) as { ns?: unknown };
  // 作者自己那一份：一般作者是 draft，測試帳號作者是 test（跟設定頁顯示的「草稿」同一份）
  const ns = body?.ns === "draft" ? state.ns : "live";
  const now = Date.now();
  await c.env.DB.batch([
    ...resetStmts(c.env, state.cardId, ns, key),
    auditStmt(c.env.DB, { subjectKind: "card_state", subjectId: String(state.cardId), actorMemberId: member.id, actorKind: "human", action: "reset", after: { key, ns }, operationId: crypto.randomUUID(), now }),
  ]);
  await bumpOp(c.env.DB, "card_state", "reset", "ok");
  return c.json({ ok: true }, 200, NO_STORE);
});

cardStateRoutes.post("/v1/me/cards/:roleId/shared-state/draft/clear", async (c) => {
  const { member, state } = await authorState(c);
  await c.env.DB.batch([
    ...resetStmts(c.env, state.cardId, state.ns, null),
    auditStmt(c.env.DB, { subjectKind: "card_state", subjectId: String(state.cardId), actorMemberId: member.id, actorKind: "human", action: "draft_clear", operationId: crypto.randomUUID(), now: Date.now() }),
  ]);
  await bumpOp(c.env.DB, "card_state", "draft_clear", "ok");
  return c.json({ ok: true }, 200, NO_STORE);
});

/**
 * 分享回流（原語 2，src/card-share-tokens.ts）。產生短碼與回應都走寫入的共同關卡（開關、玩過、限流）；
 * 解短碼不必登入，開關關著也照樣把情境碼送到（原語 1 不受影響），只是不給投票。
 */
const tokenParam = (c: Ctx) => {
  const token = c.req.param("token") ?? "";
  if (!/^~[A-Z0-9]{8}$/.test(token)) throw new HttpError(404, "token not found");
  return token;
};

cardStateRoutes.post("/v1/cards/:roleId/share-tokens", async (c) => {
  const { state, memberId } = await writeGate(c, "share_mint");
  const body = (await c.req.json().catch(() => null)) as { context?: unknown; poll?: unknown } | null;
  const context = typeof body?.context === "string" ? body.context : "";
  const poll = typeof body?.poll === "string" ? body.poll : "";
  if (!SHARED_KEY_RE.test(context)) { await bumpOp(c.env.DB, "card_state", "share_mint", "invalid"); throw new HttpError(400, "context_invalid"); }
  const out = await counted(c, "share_mint", () => mintToken(c.env, state, memberId, context, poll, Date.now()));
  return c.json(out, 200, NO_STORE);
});

cardStateRoutes.get("/v1/cards/:roleId/share-tokens", async (c) => {
  const member = await requireMember(c);
  const state = await stateFor(c, member);
  if (!state.enabled) throw new HttpError(403, "shared_disabled");
  return c.json({ items: await ownerResults(c.env, state, await saveMemberId(c.env.DB, member), Date.now()) }, 200, NO_STORE);
});

cardStateRoutes.get("/v1/cards/:roleId/share-tokens/:token", async (c) => {
  await readGate(c);
  const member = await optionalMember(c);
  const state = await stateFor(c, member);
  const row = await tokenFor(c.env, state.cardId, tokenParam(c), Date.now());
  if (!row) throw new HttpError(404, "token not found");
  const poll = row.poll_key in state.decl.polls ? state.decl.polls[row.poll_key] : undefined;
  const respondable = state.enabled && row.ns === state.ns && !!poll?.share;
  return c.json({ context: row.context, poll: respondable ? { key: row.poll_key, options: poll!.options } : null }, 200, NO_STORE);
});

cardStateRoutes.post("/v1/cards/:roleId/share-tokens/:token/respond", async (c) => {
  const { state, memberId } = await writeGate(c, "share_respond");
  const row = await tokenFor(c.env, state.cardId, tokenParam(c), Date.now());
  if (!row) throw new HttpError(404, "token not found");
  // 分享者不能替自己的連結灌回應；回應寫在回應者自己的 ns（測試帳號回應正式連結不會算進去）
  if (row.owner_member_id === memberId) { await bumpOp(c.env.DB, "card_state", "share_respond", "denied"); throw new HttpError(403, "own_token"); }
  if (row.ns !== state.ns) { await bumpOp(c.env.DB, "card_state", "share_respond", "ineligible"); throw new HttpError(403, "not_eligible"); }
  const poll = row.poll_key in state.decl.polls ? state.decl.polls[row.poll_key] : undefined;
  if (!poll?.share) { await bumpOp(c.env.DB, "card_state", "share_respond", "invalid"); throw new HttpError(400, "not_declared"); }
  const body = (await c.req.json().catch(() => null)) as { option?: unknown } | null;
  const out = await counted(c, "share_respond", () => vote(c.env, state, row.poll_key, typeof body?.option === "string" ? body.option : "", memberId, Date.now(), `share:${row.token}`));
  return c.json(out, 200, NO_STORE);
});
