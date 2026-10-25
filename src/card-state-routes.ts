import { Hono, type Context } from "hono";
import { auditStmt } from "./audit";
import { add, hasPlayed, leaderboard, readState, resetKey, resolveCardState, vote, SHARED_KEY_RE, type CardState } from "./card-state";
import { providerOf, requireMember, saveMemberId, type Member } from "./members";
import { bumpOp } from "./ops-metrics";
import { saveScope } from "./saves";
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

/** 讀取不必登入；帶了 token 就認人（回 mine）。 */
async function optionalMember(c: Ctx): Promise<Member | null> {
  return bearerOf(c) ? requireMember(c) : null;
}

async function stateFor(c: Ctx, member: Member | null): Promise<CardState> {
  return resolveCardState(c.env, c.req.param("roleId")!, { provider: providerOf(c), member, bearer: bearerOf(c), draft: c.req.query("draft") === "1" });
}

async function limited(binding: RateLimit | undefined, key: string): Promise<boolean> {
  if (!binding) return false;
  try { return !(await binding.limit({ key })).success; } catch { return false; }
}

const keyParam = (c: Ctx) => {
  const key = c.req.param("key") ?? "";
  if (!SHARED_KEY_RE.test(key)) throw new HttpError(400, "not_declared");
  return key;
};

cardStateRoutes.get("/v1/cards/:roleId/state", async (c) => {
  const member = await optionalMember(c);
  const state = await stateFor(c, member);
  if (!state.enabled) return c.json({ enabled: false, items: {} }, 200, NO_STORE);
  const keys = (c.req.query("keys") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const memberId = member ? await saveMemberId(c.env.DB, member) : null;
  return c.json({ enabled: true, items: await readState(c.env, state, keys, memberId, Date.now()) }, 200, NO_STORE);
});

cardStateRoutes.get("/v1/cards/:roleId/state/:key/leaderboard", async (c) => {
  const member = await optionalMember(c);
  const state = await stateFor(c, member);
  if (!state.enabled) throw new HttpError(403, "shared_disabled");
  const memberId = member ? await saveMemberId(c.env.DB, member) : null;
  return c.json(await leaderboard(c.env, state, keyParam(c), Number(c.req.query("limit") ?? 10), memberId, Date.now()), 200, NO_STORE);
});

/** 寫入的共同關卡：開關、資格、限流；任一關沒過都記一筆指標。 */
async function writeGate(c: Ctx, op: "vote" | "add"): Promise<{ state: CardState; memberId: string }> {
  const member = await requireMember(c);
  const state = await stateFor(c, member);
  if (!state.enabled) { await bumpOp(c.env.DB, "card_state", op, "disabled"); throw new HttpError(403, "shared_disabled"); }
  const memberId = await saveMemberId(c.env.DB, member);
  const scope = await saveScope(c.env.DB, c.req.param("roleId")!);
  if (!(await hasPlayed(c.env, state, [member.id, memberId], scope.ids))) { await bumpOp(c.env.DB, "card_state", op, "ineligible"); throw new HttpError(403, "not_eligible"); }
  if ((await limited(c.env.CARD_STATE_MEMBER_LIMIT, memberId)) || (await limited(c.env.CARD_STATE_CARD_LIMIT, String(state.cardId)))) {
    await bumpOp(c.env.DB, "card_state", op, "limited");
    throw new HttpError(429, "rate_limited");
  }
  return { state, memberId };
}

async function counted<T>(c: Ctx, op: "vote" | "add", run: () => Promise<T>): Promise<T> {
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
  const ns = body?.ns === "draft" ? "draft" : "live";
  const now = Date.now();
  await resetKey(c.env, state.cardId, ns, key);
  await auditStmt(c.env.DB, { subjectKind: "card_state", subjectId: String(state.cardId), actorMemberId: member.id, actorKind: "human", action: "reset", after: { key, ns }, operationId: crypto.randomUUID(), now }).run();
  await bumpOp(c.env.DB, "card_state", "reset", "ok");
  return c.json({ ok: true }, 200, NO_STORE);
});

cardStateRoutes.post("/v1/me/cards/:roleId/shared-state/draft/clear", async (c) => {
  const { state } = await authorState(c);
  await resetKey(c.env, state.cardId, "draft", null);
  await bumpOp(c.env.DB, "card_state", "draft_clear", "ok");
  return c.json({ ok: true }, 200, NO_STORE);
});
