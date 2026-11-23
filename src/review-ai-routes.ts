import { Hono, type Context } from "hono";
import { isReviewAgent, requireReviewer, reviewerRole } from "./members";
import { bumpOp } from "./ops-metrics";
import { getSubmission, type SubmissionRow } from "./review";
import { AI_FEEDBACK, AI_FLAGS, AI_HANDOFF_CAUSES, AI_REASONS, AI_VERDICTS, aiCardInput, aiPhaseOf, aiReport, aiSubmissionMeta, AI_BACKFILL_WINDOW_MS, canReveal, parseSuggestion, recordFeedback, saveSuggestion, suggestionsOf } from "./review-ai";
import { loadSnapshot } from "./review-snapshot";
import { operationOf } from "./moderation";
import { HttpError, type Env } from "./types";
import type { ProviderId } from "./providers";
import { upstream } from "./upstream";

/**
 * AI 審卡影子模式的路由。審卡員（AI 審核帳號）用 /v1/review-ai/*；審核員看揭曉、寫覆核用 /v1/review/:id/ai*。
 * 規則與雙盲說明在 review-ai.ts。
 */
export const reviewAiRoutes = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;
const NO_STORE = { "Cache-Control": "private, no-store" };

async function requireAgent(c: Ctx) {
  const member = await requireReviewer(c, { allowAgent: true });
  if (!(await isReviewAgent(c.env.DB, member.id))) throw new HttpError(403, "review_agent_only");
  return member;
}

async function requireHuman(c: Ctx) {
  const member = await requireReviewer(c);
  return { member, role: await reviewerRole(c.env.DB, member.id) };
}

type Op = "queue" | "read" | "suggest" | "tag" | "reveal" | "feedback" | "report";
async function counted<T>(c: Ctx, op: Op, run: () => Promise<T>): Promise<T> {
  try {
    const out = await run();
    await bumpOp(c.env.DB, "review_ai", op, "success");
    return out;
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    await bumpOp(c.env.DB, "review_ai", op, status === 401 || status === 403 ? "denied" : status === 502 || status === 503 ? "unavailable" : status < 500 ? "rejected" : "error");
    throw error;
  }
}

/**
 * 審卡員的佇列：待審（pending）或近 7 天送審、還在待審或已定案的（recent，試跑用）。
 * 只回單號與送審資訊，不回狀態、審核章、不受理；unshadowed=1 只列這個審卡員還沒下結論的（可指定判準版本）。
 */
reviewAiRoutes.get("/v1/review-ai/queue", (c) => counted(c, "queue", async () => {
  const agent = await requireAgent(c);
  const scope = c.req.query("scope") ?? "pending";
  if (scope !== "pending" && scope !== "recent") throw new HttpError(400, "invalid_arguments", undefined, { field: "scope" });
  const criteria = c.req.query("criteria") ?? null;
  if (criteria !== null && !/^v\d{1,4}$/.test(criteria)) throw new HttpError(400, "invalid_arguments", undefined, { field: "criteria" });
  const unshadowed = c.req.query("unshadowed") === "1" || c.req.query("unshadowed") === "true";
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 200);
  const now = Date.now();
  const where = `FROM review_submissions s
    WHERE (s.status='pending' OR (?1='recent' AND s.status IN ('approved','rejected')))
      AND (?1='pending' OR s.submitted_at>=?2)
      AND (?3=0 OR NOT EXISTS (SELECT 1 FROM review_ai_suggestions a WHERE a.submission_id=s.id AND a.agent_member_id=?4 AND a.verdict IS NOT NULL AND (?5 IS NULL OR a.criteria_version=?5)))`;
  const args = [scope, now - AI_BACKFILL_WINDOW_MS, unshadowed ? 1 : 0, agent.id, criteria];
  if (c.req.query("count") === "1" || c.req.query("count") === "true") {
    const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n ${where}`).bind(...args).first<{ n: number }>();
    return c.json({ count: row?.n ?? 0 }, 200, NO_STORE);
  }
  const rows = await c.env.DB.prepare(`SELECT s.id, s.card_id, s.kind, s.reopen_of, s.submitted_at, s.rating ${where} ORDER BY s.submitted_at ASC LIMIT ${limit}`)
    .bind(...args).all<{ id: string; card_id: number; kind: string; reopen_of: string | null; submitted_at: number; rating: string | null }>();
  return c.json({
    items: rows.results.map((r) => ({ id: r.id, cardId: String(r.card_id), kind: r.kind, reopen: !!r.reopen_of, submittedAt: r.submitted_at, rating: r.rating })),
  }, 200, NO_STORE);
}));

/** 讀卡：送審時封存的那一版（不領取、不影響審核員）。附判斷用的統計數字與可用代碼。 */
reviewAiRoutes.get("/v1/review-ai/submissions/:id", (c) => counted(c, "read", async () => {
  await requireAgent(c);
  const now = Date.now();
  const s = await getSubmission(c.env.DB, c.req.param("id"));
  const phase = aiPhaseOf(s, now);
  const settings = await readContent(c.env, s);
  const { submission, author, meta } = await aiSubmissionMeta(c.env.DB, s, now);
  return c.json({
    submission: { ...submission, phase },
    author,
    ...aiCardInput(settings, meta),
    allowed: { verdicts: AI_VERDICTS, reasons: AI_REASONS, flags: AI_FLAGS, handoffCauses: AI_HANDOFF_CAUSES },
  }, 200, NO_STORE);
}));

async function readContent(env: Env, s: SubmissionRow): Promise<Record<string, unknown>> {
  if (s.status === "pending") {
    const snap = await loadSnapshot(env.DB, s.id);
    if (snap && !snap.slim && !snap.partial) return snap;
  }
  try {
    return await upstream.readSealedForReview(env, s.source_role_id, s.provider as ProviderId);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throw new HttpError(404, "content_unavailable");
    throw error;
  }
}

/** 寫建議（覆蓋同版本的上一筆）。只記錄，不改送審狀態。 */
reviewAiRoutes.put("/v1/review-ai/submissions/:id/suggestion", (c) => counted(c, "suggest", async () => write(c, false)));
/** 只打審核標記（不下結論）；已下的結論保留。 */
reviewAiRoutes.put("/v1/review-ai/submissions/:id/tags", (c) => counted(c, "tag", async () => write(c, true)));

async function write(c: Ctx, tagsOnly: boolean) {
  const agent = await requireAgent(c);
  const now = Date.now();
  const s = await getSubmission(c.env.DB, c.req.param("id")!);
  const phase = aiPhaseOf(s, now);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") throw new HttpError(400, "invalid_arguments");
  const input = parseSuggestion(body, { tagsOnly });
  const row = await saveSuggestion(c.env.DB, { ...input, submissionId: s.id, cardId: Number(s.card_id), agentId: agent.id, phase, now }, { tagsOnly });
  if (!tagsOnly && input.verdict) await bumpOp(c.env.DB, "review_ai_verdict", input.verdict, phase);
  return c.json({ id: row.id, verdict: row.verdict, phase: row.phase, criteriaVersion: input.criteriaVersion }, 200, NO_STORE);
}

/** 揭曉：審核員自己做完決定後才看得到 AI 的建議（雙盲）。 */
reviewAiRoutes.get("/v1/review/:id/ai", (c) => counted(c, "reveal", async () => {
  const { member, role } = await requireHuman(c);
  const s = await getSubmission(c.env.DB, c.req.param("id"));
  if (!(await canReveal(c.env.DB, s, member.id, role))) throw new HttpError(403, "ai_hidden_until_decided");
  const suggestions = await suggestionsOf(c.env.DB, s.id);
  const mine = await c.env.DB.prepare("SELECT ai_suggestion_id AS suggestionId, source AS value FROM review_events WHERE action='ai_feedback' AND submission_id=? AND actor_member_id=?")
    .bind(s.id, member.id).all<{ suggestionId: string; value: string }>();
  return c.json({ suggestions, myFeedback: mine.results }, 200, NO_STORE);
}));

/** 覆核：揭曉後對某筆建議表態，寫成審核事件（每人每筆一次，第一次為準）。 */
reviewAiRoutes.post("/v1/review/:id/ai-feedback", (c) => counted(c, "feedback", async () => {
  const { member, role } = await requireHuman(c);
  const s = await getSubmission(c.env.DB, c.req.param("id"));
  const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  operationOf(body.operationId);
  if (typeof body.value !== "string" || !(AI_FEEDBACK as readonly string[]).includes(body.value)) throw new HttpError(400, "invalid_arguments", undefined, { field: "value" });
  if (!(await canReveal(c.env.DB, s, member.id, role))) throw new HttpError(403, "ai_hidden_until_decided");
  const suggestion = await c.env.DB.prepare("SELECT id FROM review_ai_suggestions WHERE id=? AND submission_id=? AND verdict IS NOT NULL").bind(body.suggestionId ?? "", s.id).first<{ id: string }>();
  if (!suggestion) throw new HttpError(404, "suggestion_not_found");
  const out = await recordFeedback(c.env.DB, { submissionId: s.id, cardId: Number(s.card_id), suggestionId: suggestion.id, memberId: member.id, value: body.value, now: Date.now() });
  return c.json(out, 200, NO_STORE);
}));

/** 人工 vs AI 對照報表（管理員）：預設近 7 天送審的單，依判準版本分組。 */
reviewAiRoutes.get("/v1/review-ai/report", (c) => counted(c, "report", async () => {
  const { role } = await requireHuman(c);
  if (role !== "manager" && role !== "owner") throw new HttpError(403, "review_manager_required");
  const now = Date.now();
  const to = Number(c.req.query("to") ?? now);
  const from = Number(c.req.query("from") ?? to - 7 * 86_400_000);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 120 * 86_400_000) throw new HttpError(400, "invalid_arguments", undefined, { field: "from" });
  const criteria = c.req.query("criteria") ?? null;
  if (criteria !== null && !/^v\d{1,4}$/.test(criteria)) throw new HttpError(400, "invalid_arguments", undefined, { field: "criteria" });
  return c.json({ from, to, versions: await aiReport(c.env.DB, { from, to, criteria }) }, 200, NO_STORE);
}));
