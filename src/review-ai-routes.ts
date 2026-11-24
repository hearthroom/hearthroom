import { Hono, type Context } from "hono";
import { requireReviewer, reviewerRole } from "./members";
import { bumpOp } from "./ops-metrics";
import { getSubmission, type SubmissionRow } from "./review";
import { LATEST_FEEDBACK, currentCriteria, setCurrentCriteria, revealEventStatement, AI_FEEDBACK, AI_FLAGS, AI_HANDOFF_CAUSES, AI_REASONS, AI_VERDICTS, aiCardInput, aiPhaseOf, aiReport, aiSubmissionMeta, AI_BACKFILL_WINDOW_MS, canReveal, parseSuggestion, recordFeedback, saveSuggestion, suggestionsOf } from "./review-ai";
import { loadSnapshot } from "./review-snapshot";
import { originalityReport } from "./originality";
import { diffView } from "./review-diff-store";
import { AI_NOTE_TYPES } from "./review-two-stage";
import { aiNotes, arbitrate, arbitrationStats, disagreementSides, listDisagreements, referenceCandidates, type Direction } from "./review-ai-arbitration";
import { reviewAgentByKey } from "./review-agent-key";
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

/**
 * 審卡員只認固定金鑰對應的專用身分（REVIEW_AGENT_CONFIG）。其他 AI 審核帳號（例如留言審核）不能讀卡片私有設定。
 * 沒帶金鑰：已登入的審核員回 403，未登入回 401。
 */
async function requireAgent(c: Ctx): Promise<{ id: string }> {
  const key = c.req.header("X-Review-Agent-Key");
  if (key !== undefined) return { id: await reviewAgentByKey(c.env, key, c.req.header("Origin")) };
  await requireReviewer(c, { allowAgent: true });
  throw new HttpError(403, "review_agent_only");
}

async function requireHuman(c: Ctx) {
  const member = await requireReviewer(c);
  return { member, role: await reviewerRole(c.env.DB, member.id) };
}

type Op = "queue" | "read" | "suggest" | "tag" | "reveal" | "feedback" | "report" | "arbitration_list" | "arbitration_read" | "arbitrate" | "references" | "notes";
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
  const limit = Math.min(Math.max(Math.floor(Number(c.req.query("limit") ?? 50)) || 50, 1), 200);
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
    ...aiCardInput(settings, meta, { applyRules: true }),
    update: await aiUpdateDiff(c.env, s),
    originality: await aiOriginality(c.env.DB, s, settings),
    allowed: { verdicts: AI_VERDICTS, reasons: AI_REASONS, flags: AI_FLAGS, handoffCauses: AI_HANDOFF_CAUSES },
  }, 200, NO_STORE);
}));

/**
 * 設定查重（owner 2026-11-24：AI 看不到查重，83% 重複的卡被放過）。跟審核頁同一份計算，只給數字：
 * 整體重複率、比這張早的卡裡最高的重複率、重複來源張數。不帶其他卡的編號或名稱；作者自己的其他卡不算。
 */
async function aiOriginality(db: D1Database, s: SubmissionRow, settings: Record<string, unknown>) {
  const report = await originalityReport(db, s, settings as Record<string, any>, "zh-Hant").catch(() => null);
  if (!report || !report.available) return { available: false };
  const earlier = report.sources.filter((x) => x.earlier);
  return {
    available: true,
    similarity: Math.round(report.similarity * 100) / 100,
    earlierMax: earlier.length ? Math.round(Math.max(...earlier.map((x) => x.similarity)) * 100) / 100 : 0,
    sources: report.sources.length,
  };
}

/**
 * 更新與重送：跟審核頁同一份差異（基準＝上次過審版，重送時是上次被駁回版）。給 AI 的只取欄位前後各 1,500 字。
 * 新卡、沒有基準、讀不到都照實回狀態，不擋讀卡。
 */
async function aiUpdateDiff(env: Env, s: SubmissionRow) {
  // 新卡被駁回後重送也有差異（基準＝上次被駁回版），所以不看 kind，照差異表有沒有這張單
  const view = await diffView(env, s.id).catch(() => ({ state: "unreadable" as const }));
  if (view.state === "missing") return null;
  if (view.state !== "ready") return { state: view.state };
  const clipText = (t: string) => (t.length > 1500 ? `${t.slice(0, 1500)}…[截斷]` : t);
  return {
    state: view.state, baseKind: view.baseKind, summary: view.diff.summary,
    fields: view.diff.fields.map((f) => ({ key: f.key, before: clipText(f.before), after: clipText(f.after) })),
    lorebook: { added: view.diff.worldbook.added.length, removed: view.diff.worldbook.removed.length, modified: view.diff.worldbook.modified.length },
  };
}

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
  if (suggestions.some((x) => x.verdict !== null)) await revealEventStatement(c.env.DB, { submissionId: s.id, cardId: Number(s.card_id), memberId: member.id, now: Date.now() }).run();
  const mine = await c.env.DB.prepare(`SELECT e.ai_suggestion_id AS suggestionId, e.source AS value, e.at FROM review_events e WHERE ${LATEST_FEEDBACK} AND e.submission_id=? AND e.actor_member_id=?`)
    .bind(s.id, member.id).all<{ suggestionId: string; value: string }>();
  // current：目前判準版本；畫面只拿這一版的建議跟審核員比（沒有就是 AI 尚未用目前判準審完）
  return c.json({ suggestions, current: await currentCriteria(c.env.DB), myFeedback: mine.results }, 200, NO_STORE);
}));

/** 覆核：揭曉後對某筆建議表態，寫成審核事件（每人每筆一次，第一次為準）。 */
reviewAiRoutes.post("/v1/review/:id/ai-feedback", (c) => counted(c, "feedback", async () => {
  const { member, role } = await requireHuman(c);
  const s = await getSubmission(c.env.DB, c.req.param("id"));
  const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const operationId = operationOf(body.operationId);
  if (typeof body.value !== "string" || !(AI_FEEDBACK as readonly string[]).includes(body.value)) throw new HttpError(400, "invalid_arguments", undefined, { field: "value" });
  if (!(await canReveal(c.env.DB, s, member.id, role))) throw new HttpError(403, "ai_hidden_until_decided");
  const suggestion = await c.env.DB.prepare("SELECT id FROM review_ai_suggestions WHERE id=? AND submission_id=? AND verdict IS NOT NULL").bind(body.suggestionId ?? "", s.id).first<{ id: string }>();
  if (!suggestion) throw new HttpError(404, "suggestion_not_found");
  const out = await recordFeedback(c.env.DB, { submissionId: s.id, cardId: Number(s.card_id), suggestionId: suggestion.id, memberId: member.id, value: body.value, operationId, now: Date.now() });
  return c.json(out, 200, NO_STORE);
}));

/** 人工 vs AI 對照報表（管理員）：預設近 7 天送審的單，依判準版本分組。 */
async function requireManager(c: Ctx) {
  const { member, role } = await requireHuman(c);
  if (role !== "manager" && role !== "owner") throw new HttpError(403, "review_manager_required");
  return member;
}

reviewAiRoutes.get("/v1/review-ai/report", (c) => counted(c, "report", async () => {
  await requireManager(c);
  const now = Date.now();
  const to = Number(c.req.query("to") ?? now);
  const from = Number(c.req.query("from") ?? to - 7 * 86_400_000);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 120 * 86_400_000) throw new HttpError(400, "invalid_arguments", undefined, { field: "from" });
  const criteria = c.req.query("criteria") ?? null;
  if (criteria !== null && !/^v\d{1,4}$/.test(criteria)) throw new HttpError(400, "invalid_arguments", undefined, { field: "criteria" });
  const [versions, arbitration] = await Promise.all([aiReport(c.env.DB, { from, to, criteria }), arbitrationStats(c.env.DB, { from, to, criteria })]);
  return c.json({ from, to, versions: versions.map((v) => ({ ...v, arbitration: arbitration[v.criteriaVersion] ?? null })) }, 200, NO_STORE);
}));

const criteriaOf = (c: Ctx) => {
  const v = c.req.query("criteria") ?? null;
  if (v !== null && !/^v\d{1,4}$/.test(v)) throw new HttpError(400, "invalid_arguments", undefined, { field: "criteria" });
  return v;
};

/**
 * 分歧清單（審核員都能用，owner 2026-11-24「能審卡的人都能給 AI 打標」）：只列人工與 AI 結論相反、已定案的單；
 * 不列自己寫的卡。預設待仲裁。報表與參考範例匯出仍限管理員。
 */
reviewAiRoutes.get("/v1/review-ai/disagreements", (c) => counted(c, "arbitration_list", async () => {
  const { member } = await requireHuman(c);
  const state = c.req.query("state") ?? "open";
  if (state !== "open" && state !== "done" && state !== "all") throw new HttpError(400, "invalid_arguments", undefined, { field: "state" });
  const direction = c.req.query("direction") ?? null;
  if (direction !== null && direction !== "ai_stricter" && direction !== "human_stricter") throw new HttpError(400, "invalid_arguments", undefined, { field: "direction" });
  const reason = c.req.query("reason") ?? null;
  if (reason !== null && !/^[a-z_]+(\.[a-z_]+)?$/.test(reason)) throw new HttpError(400, "invalid_arguments", undefined, { field: "reason" });
  const limit = Math.min(Math.max(Math.floor(Number(c.req.query("limit") ?? 20)) || 20, 1), 50);
  const offset = Math.max(Math.floor(Number(c.req.query("offset") ?? 0)) || 0, 0);
  // 沒指定判準版本就看目前版本；criteria=all 看全部
  const asked = c.req.query("criteria");
  const criteria = asked === "all" ? null : asked === undefined ? await currentCriteria(c.env.DB) : criteriaOf(c);
  return c.json({ ...(await listDisagreements(c.env.DB, { state, criteria, direction: direction as Direction | null, reason, limit, offset, viewer: member.id })), criteria }, 200, NO_STORE);
}));

/** 單筆分歧：卡片（與 AI 讀到的同一份封存內容；讀不到就說明）、人工、AI、歷次仲裁。審核員名字只給管理員。 */
reviewAiRoutes.get("/v1/review-ai/disagreements/:id", (c) => counted(c, "arbitration_read", async () => {
  const { member, role } = await requireHuman(c);
  const sides = await disagreementSides(c.env.DB, c.req.param("id"), { viewer: member.id, names: role === "manager" || role === "owner" });
  const s = await getSubmission(c.env.DB, sides.submission.id);
  let card: ReturnType<typeof aiCardInput> | null = null;
  try {
    const { meta } = await aiSubmissionMeta(c.env.DB, s, Date.now());
    card = aiCardInput(await readContent(c.env, s), meta);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
  }
  return c.json({ ...sides, content: card ? { state: "ready", ...card } : { state: "unavailable" }, update: await aiUpdateDiff(c.env, s) }, 200, NO_STORE);
}));

/** 仲裁：人對／AI 對／都說得通／都不對，選填備註，可勾加入參考範例。不改原決定、不通知作者。 */
reviewAiRoutes.post("/v1/review-ai/disagreements/:id/arbitration", (c) => counted(c, "arbitrate", async () => {
  const { member } = await requireHuman(c);
  const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const operationId = operationOf(body.operationId);
  const out = await arbitrate(c.env.DB, { suggestionId: c.req.param("id"), memberId: member.id, value: body.value, addToReference: body.addToReference, note: body.note, noteTypes: body.noteTypes, operationId, now: Date.now() });
  return c.json(out, 200, NO_STORE);
}));

/**
 * 參考範例草稿（管理員）：被勾進參考範例的分歧，組成下一版 references 的草稿形狀。
 * 節錄只取開場與設定前 600 字，不含帳號、卡號；why 留空給 PM 寫。讀不到內容的那幾筆照實列在 skipped。
 */
reviewAiRoutes.get("/v1/review-ai/reference-candidates", (c) => counted(c, "references", async () => {
  await requireManager(c);
  const limit = Math.min(Math.max(Math.floor(Number(c.req.query("limit") ?? 30)) || 30, 1), 30);
  const candidates = await referenceCandidates(c.env.DB, criteriaOf(c), limit);
  const items: unknown[] = [];
  let skipped = 0;
  for (const cand of candidates) {
    try {
      const s = await getSubmission(c.env.DB, cand.submissionId);
      const { meta } = await aiSubmissionMeta(c.env.DB, s, Date.now());
      const input = aiCardInput(await readContent(c.env, s), meta);
      const opening = input.card.openings.welcome || input.card.openings.alternates[0] || input.card.openings.page;
      items.push({
        id: `c${items.length + 1}`, verdict: cand.verdict, reasons: cand.reasons, flags: cand.flags, why: "",
        originalWork: !!input.card.originalWork, tags: input.card.tags,
        excerpt: { opening: opening.slice(0, 600), setting: input.card.setting.slice(0, 600) },
        source: { criteriaVersion: cand.criteriaVersion, arbitration: cand.arbitration },
      });
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      skipped++;
    }
  }
  return c.json({ items, skipped }, 200, NO_STORE);
}));

/** 給 AI 的說明全文（管理員）：可依原因類型篩，預設近 30 天，最多 200 筆。判準調整用。 */
reviewAiRoutes.get("/v1/review-ai/notes", (c) => counted(c, "notes", async () => {
  await requireManager(c);
  const to = Number(c.req.query("to") ?? Date.now());
  const from = Number(c.req.query("from") ?? to - 30 * 86_400_000);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 120 * 86_400_000) throw new HttpError(400, "invalid_arguments", undefined, { field: "from" });
  const type = c.req.query("type") ?? null;
  if (type !== null && !(AI_NOTE_TYPES as readonly string[]).includes(type)) throw new HttpError(400, "invalid_arguments", undefined, { field: "type" });
  const limit = Math.min(Math.max(Math.floor(Number(c.req.query("limit") ?? 100)) || 100, 1), 200);
  return c.json({ from, to, items: await aiNotes(c.env.DB, { from, to, type, limit }) }, 200, NO_STORE);
}));

/** 目前判準版本：審卡員換版時設（金鑰），管理員也能設。揭曉、兩段式定案、仲裁預設都只看這一版。 */
reviewAiRoutes.get("/v1/review-ai/criteria", async (c) => {
  const key = c.req.header("X-Review-Agent-Key");
  if (key !== undefined) await reviewAgentByKey(c.env, key, c.req.header("Origin")); else await requireHuman(c);
  return c.json({ current: await currentCriteria(c.env.DB) }, 200, NO_STORE);
});
reviewAiRoutes.put("/v1/review-ai/criteria", async (c) => {
  const key = c.req.header("X-Review-Agent-Key");
  const memberId = key !== undefined ? await reviewAgentByKey(c.env, key, c.req.header("Origin")) : (await requireManager(c)).id;
  const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { version?: unknown };
  if (typeof body.version !== "string") throw new HttpError(400, "invalid_arguments", undefined, { field: "version" });
  await setCurrentCriteria(c.env.DB, body.version, memberId, Date.now());
  return c.json({ current: body.version }, 200, NO_STORE);
});
