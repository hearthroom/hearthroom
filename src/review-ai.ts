import { applyBatchMarks, authorProfiles, deviceSignals } from "./review-profile";
import { weeklyLimitAt } from "./quota";
import { submissionHistory, type SubmissionRow } from "./review";
import { HttpError } from "./types";

/**
 * AI 審卡影子模式（任務 2026-11-23-ai-card-review）。
 *
 * 審卡員是一個 AI 審核帳號（reviewers＋review_agents），由 Agent 員工透過 CLI 操作：讀卡、寫建議、打審核標記。
 * 建議只記錄，絕不改送審狀態；它不能蓋章、不受理、冷凍（那些路由對 AI 帳號一律 403）。
 *
 * 雙盲：AI 讀卡時拿不到這張單的人工決定、審核章、不受理狀態與說明；審核員要自己做完決定才看得到 AI 的建議。
 * 試跑：近 7 天已定案的單也能讀（phase=backfill），同樣不帶人工決定，報表才能拿它和人工比。
 */

export const AI_VERDICTS = ["pass", "reject", "handoff"] as const;
export type AiVerdict = (typeof AI_VERDICTS)[number];
/** 作者看得到的駁回理由裡，AI 能判的那幾個（分級與字數門檻不給 AI 判）。代碼與 shared/review-reasons.ts 同步。 */
export const AI_REASONS = ["opening.no_reply_hook", "opening.no_focused_event", "opening.exposition_only", "opening.too_short", "opening.unedited_generated", "character.setting_thin", "character.copied_verbatim"] as const;
/** 審核標記：只給審核與數據，作者看不到 */
export const AI_FLAGS = ["ai_unedited", "copied_text", "mass_produced"] as const;
export const AI_HANDOFF_CAUSES = ["unsure", "refusal", "invalid_output", "timeout", "error", "too_large"] as const;
export const AI_FEEDBACK = ["ai_right", "ai_wrong", "both_ok"] as const;
/** 已定案的單，送審後多久內還能讓 AI 讀（試跑用） */
export const AI_BACKFILL_WINDOW_MS = 7 * 86_400_000;

const LIMITS = { setting: 12_000, text: 4_000, opening: 6_000, page: 3_000, alternates: 3, alternate: 3_000, prologue: 6, entries: 20, entry: 300, note: 400, index: 40, rules: 20 };

interface RuleInput { name?: unknown; find?: unknown; replace?: unknown; enabled?: unknown }

/**
 * 作者寫的顯示規則要在 Worker 裡執行，正規表示式沒有逾時：只跑看起來安全的規則，免得一張卡的災難性回溯拖垮請求。
 * 跳過：太長的樣式或替換、巢狀量詞（(a+)+ 之類）、反向參照、前後瞻。最多 20 條、只量開場前 2,000 字、每條後輸出截在 12,000 字。
 * 漏網的最壞情況是審卡員讀這一張卡失敗（AI 記成交人），不影響玩家或審核員。
 */
const RULE_GUARD = { rules: 20, find: 200, replace: 1_000, input: 2_000, output: 12_000 };
const UNSAFE_PATTERN = /\([^)]*[+*{][^)]*\)[+*{?]|\\[1-9]|\\k<|\(\?<?[=!]/;
function safeRules(rules: RuleInput[]): { re: RegExp; replace: string }[] {
  const out: { re: RegExp; replace: string }[] = [];
  for (const r of rules) {
    if (out.length >= RULE_GUARD.rules) break;
    if (r.enabled === false || typeof r.find !== "string" || !r.find.trim() || r.find.length > RULE_GUARD.find) continue;
    const replace = typeof r.replace === "string" ? r.replace : "";
    if (replace.length > RULE_GUARD.replace || UNSAFE_PATTERN.test(r.find)) continue;
    try { out.push({ re: new RegExp(r.find, "g"), replace }); } catch { /* 作者的規則寫錯，略過 */ }
  }
  return out;
}

/** 顯示規則在一段文字裡命中幾次 */
function ruleHits(rules: { re: RegExp }[], text: string): number {
  const input = text.slice(0, RULE_GUARD.input);
  return rules.reduce((n, r) => n + (input.match(r.re) ?? []).length, 0);
}

/** 套用顯示規則後玩家大致看到的字：照規則替換，再去掉標籤與樣式 */
function renderedText(rules: { re: RegExp; replace: string }[], text: string): string {
  let out = text.slice(0, RULE_GUARD.input);
  for (const r of rules) out = out.replace(r.re, r.replace).slice(0, RULE_GUARD.output);
  return pageText(out);
}

const NAME_MAX = 40;

/** 開場網頁（作者資產的 openingPage）只取玩家看得到的字：去掉 script／style 與標籤，留下選項等文字。 */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|button|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

const text = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(text) : []);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…[截斷]` : s);
const per1k = (count: number, chars: number) => (chars ? Math.round((count / chars) * 10_000) / 10 : 0);

/** 這張單 AI 讀不讀得到：待審都行；已定案只在送審 7 天內；被取代、撤回的不給。 */
export function aiPhaseOf(s: Pick<SubmissionRow, "status" | "submitted_at">, now: number): "shadow" | "backfill" {
  if (s.status === "pending") return "shadow";
  if ((s.status === "approved" || s.status === "rejected") && now - s.submitted_at <= AI_BACKFILL_WINDOW_MS) return "backfill";
  throw new HttpError(410, "review_ai_window_closed");
}

/** 送給 AI 的卡片內容：只有判斷用心程度需要的文字，長文截斷；統計數字用全文算。 */
/** applyRules：只有審卡員讀卡時才執行作者的顯示規則（其他路由不需要，也不冒效能風險） */
export function aiCardInput(settings: Record<string, unknown>, meta: { tags: string[]; fandom: string }, opts: { applyRules?: boolean } = {}) {
  const doc = (settings.document ?? {}) as Record<string, unknown>;
  const greetings = (settings.greetings ?? {}) as Record<string, unknown>;
  const asset = (settings.authorAsset ?? {}) as Record<string, unknown>;
  const page = pageText(text(asset.openingPage));
  const books = Array.isArray(settings.worldbooks) ? settings.worldbooks : settings.worldbook ? [settings.worldbook] : [];
  type Entry = { name?: unknown; content?: unknown; isEnabled?: unknown; isConstant?: unknown; keywords?: unknown };
  const allEntries = (books as { entries?: Entry[] }[]).flatMap((b) => (Array.isArray(b?.entries) ? b.entries : []));
  const entries = allEntries
    .filter((e) => e.isEnabled !== false)
    .map((e) => ({ name: text(e.name), content: text(e.content), constant: e.isConstant === true, keywords: list(e.keywords).length }));
  const setting = text(doc.roleDetailDesc);
  const welcome = text(greetings.welcome);
  const rules = (Array.isArray(asset.rules) ? asset.rules : []) as RuleInput[];
  const activeRules = rules.filter((r) => r.enabled !== false && typeof r.find === "string" && r.find.trim());
  const runnable = opts.applyRules ? safeRules(activeRules) : [];
  const cardText = setting + welcome + list(greetings.alternates).join("");
  const welcomeHits = opts.applyRules ? ruleHits(runnable, welcome) : null;
  const alternates = list(greetings.alternates);
  const prologue = list(greetings.prologue);
  const scanned = setting + welcome;
  const tail = welcome.slice(-200);
  return {
    card: {
      name: text(doc.roleName),
      summary: clip(text(doc.roleDesc), LIMITS.text),
      tags: meta.tags,
      originalWork: meta.fandom ? meta.fandom : null,
      userName: text(doc.userName),
      setting: clip(setting, LIMITS.setting),
      speech: clip(text(doc.roleSpeech), LIMITS.text),
      instructions: clip(text(doc.customInstructions), LIMITS.text),
      examples: clip(text(doc.talkExample), LIMITS.text),
      openings: {
        // 開場網頁：玩家進卡先看到的互動頁（選項、按鈕的字）。mode=page 時它就是開場，welcome 可能是空的
        mode: text(asset.openingMode) || (asset.cardFormat === "fengyue" ? "page" : "greeting"),
        page: clip(page, LIMITS.page),
        welcome: clip(welcome, LIMITS.opening),
        alternates: alternates.slice(0, LIMITS.alternates).map((a) => clip(a, LIMITS.alternate)),
        // 開場選項：玩家點了會填進輸入框的預設回覆（編輯器的「開場選項」欄位）
        prologue: prologue.slice(0, LIMITS.prologue).map((a) => clip(a, LIMITS.alternate)),
        // 開場白有被顯示規則替換的標記時，玩家看到的是替換後的版面：這是套用規則後的純文字近似
        welcomeRendered: welcomeHits ? clip(renderedText(runnable, welcome), LIMITS.opening) : null,
      },
      // 世界書：設定可以寫在世界書裡（常駐條目每輪都在，召回條目依關鍵字帶入）。index 是全部條目的目錄（不含內文）
      lorebook: {
        entryCount: entries.length,
        constantCount: entries.filter((e) => e.constant).length,
        recallCount: entries.filter((e) => !e.constant).length,
        index: entries.slice(0, LIMITS.index).map((e) => ({ name: e.name.slice(0, NAME_MAX), chars: e.content.length, constant: e.constant, keywords: e.keywords, mentionedInCard: !!e.name && cardText.includes(e.name) })),
        entries: entries.slice(0, LIMITS.entries).map((e) => ({ name: e.name, content: clip(e.content, LIMITS.entry) })),
      },
      // 顯示規則（正規表示式）：把對話與開場裡的標記換成版面（狀態欄、面板、按鈕）。只給名稱與長度，不給原文
      rules: {
        count: rules.length,
        enabled: activeRules.length,
        list: activeRules.slice(0, LIMITS.rules).map((r) => ({ name: text(r.name).slice(0, NAME_MAX), findChars: text(r.find).length, replaceChars: text(r.replace).length })),
        hasCardCss: !!text(asset.cardCss),
      },
    },
    stats: {
      settingChars: setting.length,
      openingChars: welcome.length,
      alternateCount: alternates.length,
      lorebookEntries: entries.length,
      lorebookChars: entries.reduce((n, e) => n + e.content.length, 0),
      ellipsisPer1k: per1k((scanned.match(/…+|\.{3,}/g) ?? []).length, scanned.length),
      dashPer1k: per1k((scanned.match(/—+|──+/g) ?? []).length, scanned.length),
      openingQuestion: /[?？]|\[choices\]|(^|\n)\s*(?:[1-9１-９][.、．)]|[A-DＡ-Ｄ][.、．)])/.test(tail),
      openingPageChars: page.length,
      openingOptions: prologue.length,
      // 開場白（含備選）被顯示規則命中的次數：多代表開場靠規則換成版面呈現
      openingRuleHits: welcomeHits === null ? null : welcomeHits + list(greetings.alternates).slice(0, LIMITS.alternates).reduce((n, a) => n + ruleHits(runnable, a), 0),
      lorebookConstantChars: entries.filter((e) => e.constant).reduce((n, e) => n + e.content.length, 0),
      openingChoices: /\[choices\]|(^|\n)\s*(?:[1-9１-９][.、．)]|[A-DＡ-Ｄ][.、．)])\s*\S/.test(welcome),
    },
  };
}

/** AI 讀卡時看得到的送審資訊：跟審核頁同一層，但不帶這張單的人工決定、審核章、不受理與說明。 */
export async function aiSubmissionMeta(db: D1Database, s: SubmissionRow, now: number) {
  const [history, version] = await Promise.all([
    submissionHistory(db, s.id),
    db.prepare("SELECT member_id, source_role_id, json_extract(public_role,'$.tags') AS tags, json_extract(public_role,'$.fandom') AS fandom FROM hosting_versions WHERE submission_id=?")
      .bind(s.id).first<{ member_id: string; source_role_id: string; tags: string | null; fandom: string | null }>(),
  ]);
  // 作者標記（新人／穩定／頭部、疑似批量）只給待審單：它是「現在」算的，已定案的單會把這張單自己的結果算進去。
  // 作者行為訊號一律算到送審那一刻為止（送審頻率、額度用滿、過去通過數、帳號年齡、同裝置帳號數），已定案的單也不洩漏結果。
  let author: Record<string, unknown> | null = null;
  if (version?.member_id) {
    let tier: string | null = null, batchSuspected: boolean | null = null;
    if (s.status === "pending") {
      const profiles = await authorProfiles(db, [version.member_id], now);
      await applyBatchMarks(db, profiles, now);
      const p = profiles.get(version.member_id);
      if (p) {
        const device = await db.prepare("SELECT device_hash FROM review_submission_devices WHERE submission_id=?").bind(s.id).first<{ device_hash: string }>();
        const signal = device ? (await deviceSignals(db, [device.device_hash], now)).get(device.device_hash) : undefined;
        tier = p.tier;
        batchSuspected = p.manual.batch ? p.batchSuspected : !!signal?.suspected;
      }
    }
    author = { tier, batchSuspected, ...(await authorSignals(db, version.member_id, version.source_role_id, s.submitted_at)) };
  }
  let tags: string[] = [];
  try { tags = version?.tags ? (JSON.parse(version.tags) as string[]) : []; } catch { tags = []; }
  return {
    submission: {
      id: s.id, cardId: String(s.card_id), kind: s.kind, reopen: !!s.reopen_of, submittedAt: s.submitted_at,
      rating: s.rating, attempt: history.attempt, previous: history.previous ? { status: history.previous.status } : null,
    },
    author,
    meta: { tags, fandom: version?.fandom ?? "" },
  };
}

const WEEK = 7 * 86_400_000;

/**
 * 作者行為訊號，算到送審那一刻為止（不含這張單之後發生的事）。只給數量，不給帳號或裝置識別碼。
 * - submissions7d：送審前 7 天這位作者送了幾次審（含這次）
 * - registrations7d／quotaFull：送審前 7 天登記了幾張卡、是否用滿每週額度
 * - priorApproved：送審前過審過幾次（新人判斷）
 * - accountAgeDays：帳號建立到送審幾天
 * - deviceAccounts：登記這張卡的裝置上有幾個帳號（同一支手機綁多個帳號）
 */
async function authorSignals(db: D1Database, memberId: string, sourceRoleId: string, at: number) {
  // 先取作者在各供應商的公開 ID，再用 (provider, author_num_id, registered_at) 索引數登記；免費額度不算禮包登記
  const ids = await db.prepare("SELECT provider, external_id FROM member_identities WHERE member_id=?").bind(memberId).all<{ provider: string; external_id: string }>();
  const byProvider = JSON.stringify(ids.results.map((r) => [r.provider, Number(r.external_id)]));
  const row = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM review_submissions s2 JOIN hosting_versions v2 ON v2.submission_id=s2.id WHERE v2.member_id=?1 AND s2.submitted_at>?3-${WEEK} AND s2.submitted_at<=?3) AS submissions7d,
      (SELECT COUNT(*) FROM json_each(?4) p JOIN card_registrations r ON r.provider=json_extract(p.value,'$[0]') AND r.author_num_id=json_extract(p.value,'$[1]')
        WHERE r.registered_at>?3-${WEEK} AND r.registered_at<=?3 AND r.pack_id IS NULL) AS registrations7d,
      (SELECT COUNT(*) FROM review_submissions s3 JOIN hosting_versions v3 ON v3.submission_id=s3.id WHERE v3.member_id=?1 AND s3.status='approved' AND s3.decided_at<?3) AS priorApproved,
      (SELECT created_at FROM members WHERE id=?1) AS createdAt,
      (SELECT COUNT(DISTINCT d.member_id) FROM reward_devices d WHERE d.first_seen<=?3 AND d.device_hash=(
        SELECT r2.device_hash FROM json_each(?4) p2 JOIN card_registrations r2 ON r2.provider=json_extract(p2.value,'$[0]')
        WHERE r2.source_role_id=?2 AND r2.device_hash IS NOT NULL AND r2.registered_at<=?3 ORDER BY r2.registered_at DESC LIMIT 1)) AS deviceAccounts`)
    .bind(memberId, sourceRoleId, at, byProvider).first<{ submissions7d: number; registrations7d: number; priorApproved: number; createdAt: number | null; deviceAccounts: number }>();
  const limit = await weeklyLimitAt(db, at);
  return {
    submissions7d: row?.submissions7d ?? 0,
    registrations7d: row?.registrations7d ?? 0,
    quotaFull: (row?.registrations7d ?? 0) >= limit,
    priorApproved: row?.priorApproved ?? 0,
    accountAgeDays: row?.createdAt ? Math.max(0, Math.floor((at - row.createdAt) / 86_400_000)) : null,
    deviceAccounts: row?.deviceAccounts || null,
  };
}

export interface SuggestionInput {
  criteriaVersion: string; model: string; verdict: AiVerdict | null; reasons: string[]; flags: string[];
  confidence: number | null; note: string; handoffCause: string | null;
  inputTokens: number | null; outputTokens: number | null; costUsd: number | null; latencyMs: number | null;
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T => typeof v === "string" && (allowed as readonly string[]).includes(v);
const bad = (field: string): never => { throw new HttpError(400, "invalid_arguments", undefined, { field }); };
const codes = (v: unknown, allowed: readonly string[], field: string): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => !oneOf(x, allowed))) bad(field);
  return [...new Set(v as string[])];
};
const count = (v: unknown, field: string, max = 10_000_000): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) bad(field);
  return v as number;
};

/** 建議的伺服器端規則：代碼只收清單內的；不通過至少一個理由或標記；交人一定有原因。 */
export function parseSuggestion(body: Record<string, unknown>, opts: { tagsOnly?: boolean } = {}): SuggestionInput {
  const criteriaVersion = body.criteriaVersion;
  if (typeof criteriaVersion !== "string" || !/^v\d{1,4}$/.test(criteriaVersion)) bad("criteriaVersion");
  const model = body.model;
  if (typeof model !== "string" || !/^[\w./:@-]{1,100}$/.test(model)) bad("model");
  const flags = codes(body.flags, AI_FLAGS, "flags");
  if (opts.tagsOnly) {
    return { criteriaVersion: criteriaVersion as string, model: model as string, verdict: null, reasons: [], flags, confidence: null, note: "", handoffCause: null, inputTokens: null, outputTokens: null, costUsd: null, latencyMs: null };
  }
  if (!oneOf(body.verdict, AI_VERDICTS)) bad("verdict");
  const verdict = body.verdict as AiVerdict;
  const reasons = codes(body.reasons, AI_REASONS, "reasons");
  if (verdict === "reject" && reasons.length + flags.length === 0) bad("reasons");
  if (verdict === "pass" && reasons.length) bad("reasons");
  let handoffCause: string | null = null;
  if (verdict === "handoff") {
    if (body.handoffCause !== undefined && !oneOf(body.handoffCause, AI_HANDOFF_CAUSES)) bad("handoffCause");
    handoffCause = (body.handoffCause as string | undefined) ?? "unsure";
  } else if (body.handoffCause !== undefined && body.handoffCause !== null) bad("handoffCause");
  const confidence = count(body.confidence, "confidence", 1);
  const note = body.note === undefined || body.note === null ? "" : body.note;
  if (typeof note !== "string" || note.length > LIMITS.note) bad("note");
  return {
    criteriaVersion: criteriaVersion as string, model: model as string, verdict, reasons, flags, confidence, note: (note as string).trim(), handoffCause,
    inputTokens: count(body.inputTokens, "inputTokens"), outputTokens: count(body.outputTokens, "outputTokens"),
    costUsd: count(body.costUsd, "costUsd", 100), latencyMs: count(body.latencyMs, "latencyMs", 86_400_000),
  };
}

/** 寫建議：同一審卡員、同一判準版本、同一張單只留一筆。只打標記時保留已下的結論。 */
export async function saveSuggestion(db: D1Database, input: SuggestionInput & { submissionId: string; cardId: number; agentId: string; phase: "shadow" | "backfill"; now: number }, opts: { tagsOnly?: boolean } = {}) {
  const id = crypto.randomUUID();
  const cols = "id,submission_id,card_id,agent_member_id,criteria_version,model,verdict,reasons,flags,confidence,handoff_cause,note,phase,input_tokens,output_tokens,cost_usd,latency_ms,created_at,updated_at";
  const update = opts.tagsOnly
    ? "flags=excluded.flags,model=excluded.model,updated_at=excluded.updated_at"
    : "model=excluded.model,verdict=excluded.verdict,reasons=excluded.reasons,flags=excluded.flags,confidence=excluded.confidence,handoff_cause=excluded.handoff_cause,note=excluded.note,phase=excluded.phase,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,cost_usd=excluded.cost_usd,latency_ms=excluded.latency_ms,updated_at=excluded.updated_at";
  const row = await db.prepare(`INSERT INTO review_ai_suggestions (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(submission_id,agent_member_id,criteria_version) DO UPDATE SET ${update} RETURNING id, verdict, phase`)
    .bind(id, input.submissionId, input.cardId, input.agentId, input.criteriaVersion, input.model, input.verdict, JSON.stringify(input.reasons), JSON.stringify(input.flags),
      input.confidence, input.handoffCause, input.note, input.phase, input.inputTokens, input.outputTokens, input.costUsd, input.latencyMs, input.now, input.now)
    .first<{ id: string; verdict: string | null; phase: string }>();
  return row!;
}

export interface SuggestionView {
  id: string; criteriaVersion: string; model: string; verdict: AiVerdict | null; reasons: string[]; flags: string[];
  confidence: number | null; handoffCause: string | null; note: string; phase: string; at: number;
}

export async function suggestionsOf(db: D1Database, submissionId: string): Promise<SuggestionView[]> {
  const rows = await db.prepare("SELECT * FROM review_ai_suggestions WHERE submission_id=? ORDER BY updated_at DESC").bind(submissionId).all<Record<string, any>>();
  return rows.results.map((r) => ({
    id: r.id, criteriaVersion: r.criteria_version, model: r.model, verdict: r.verdict, reasons: JSON.parse(r.reasons), flags: JSON.parse(r.flags),
    confidence: r.confidence, handoffCause: r.handoff_cause, note: r.note, phase: r.phase, at: r.updated_at,
  }));
}

/**
 * 審核員看得到 AI 建議嗎：自己蓋過章、自己不受理而且還在不受理中，或已定案時是管理員。其他一律等自己決定完。
 * 不受理被復原之後就不再揭曉；萬一先看了再復原、再蓋章，那一章由 TAINTED 排除在對照報表之外。
 */
export async function canReveal(db: D1Database, s: Pick<SubmissionRow, "id" | "status">, memberId: string, role: string | null): Promise<boolean> {
  const mine = await db.prepare(`SELECT EXISTS(SELECT 1 FROM review_stamps WHERE submission_id=?1 AND member_id=?2)
    OR EXISTS(SELECT 1 FROM review_drops WHERE submission_id=?1 AND actor_member_id=?2 AND restored_at IS NULL) AS ok`).bind(s.id, memberId).first<{ ok: number }>();
  if (mine?.ok) return true;
  return s.status !== "pending" && (role === "manager" || role === "owner");
}

/** 揭曉留一筆事件（每人每單一次）：用來找出「看過 AI 判斷之後才蓋章」的決定 */
export function revealEventStatement(db: D1Database, input: { submissionId: string; cardId: number; memberId: string; now: number }) {
  return db.prepare(`INSERT OR IGNORE INTO review_events(event_key,spec_version,submission_id,card_id,at,action,actor_kind,actor_member_id)
    VALUES (?,1,?,?,?,'ai_reveal','reviewer',?)`).bind(`aireveal:${input.submissionId}:${input.memberId}`, input.submissionId, input.cardId, input.now, input.memberId);
}

/** 這張單的人工決定是不是在看過 AI 判斷之後才做的（不受理→看→復原→蓋章，或再不受理一次）：這種單不進人機對照 */
export const TAINTED = `EXISTS(SELECT 1 FROM review_events rv WHERE rv.action='ai_reveal' AND rv.submission_id=s.id AND (
  EXISTS(SELECT 1 FROM review_stamps st WHERE st.submission_id=rv.submission_id AND st.member_id=rv.actor_member_id AND st.created_at>rv.at)
  OR EXISTS(SELECT 1 FROM review_drops dr WHERE dr.submission_id=rv.submission_id AND dr.actor_member_id=rv.actor_member_id AND dr.created_at>rv.at AND dr.restored_at IS NULL)))`;

/** 揭曉後的覆核：可以改選，每次一筆審核事件（同一個 operationId 重送不多記），統計取每位審核員對每筆建議最後一次。 */
export async function recordFeedback(db: D1Database, input: { submissionId: string; cardId: number; suggestionId: string; memberId: string; value: string; operationId: string; now: number }) {
  await db.prepare(`INSERT OR IGNORE INTO review_events(event_key,spec_version,submission_id,card_id,at,action,actor_kind,actor_member_id,source,ai_suggestion_id)
    VALUES (?,1,?,?,?,'ai_feedback','reviewer',?,?,?)`)
    .bind(`aifb:${input.suggestionId}:${input.memberId}:${input.operationId}`, input.submissionId, input.cardId, input.now, input.memberId, input.value, input.suggestionId).run();
  return { value: input.value };
}

/** 每位審核員對每筆建議最後一次覆核（揭曉與報表共用） */
export const LATEST_FEEDBACK = `e.action='ai_feedback' AND e.id=(SELECT f.id FROM review_events f WHERE f.action='ai_feedback'
  AND f.ai_suggestion_id=e.ai_suggestion_id AND f.actor_member_id=e.actor_member_id ORDER BY f.at DESC, f.id DESC LIMIT 1)`;

/** 人工 vs AI 的對照：只算人已做完決定（通過、駁回、不受理中）且 AI 下了結論的單。依判準版本分組。 */
export async function aiReport(db: D1Database, input: { from: number; to: number; criteria?: string | null }) {
  const rows = await db.prepare(`SELECT a.criteria_version AS v, a.phase, a.verdict, a.reasons AS ai_reasons, a.flags, a.handoff_cause, a.latency_ms, a.cost_usd,
      s.status, s.reject_reasons,
      EXISTS(SELECT 1 FROM review_drops d WHERE d.submission_id=s.id AND d.restored_at IS NULL) AS dropped
    FROM review_ai_suggestions a JOIN review_submissions s ON s.id=a.submission_id
    WHERE a.verdict IS NOT NULL AND s.submitted_at>=? AND s.submitted_at<? AND (?3 IS NULL OR a.criteria_version=?3)
      AND (s.status IN ('approved','rejected') OR EXISTS(SELECT 1 FROM review_drops d WHERE d.submission_id=s.id AND d.restored_at IS NULL))
      AND NOT ${TAINTED}`)
    .bind(input.from, input.to, input.criteria ?? null).all<Record<string, any>>();
  const feedback = await db.prepare(`SELECT a.criteria_version AS v, e.source AS value, COUNT(*) AS n FROM review_events e JOIN review_ai_suggestions a ON a.id=e.ai_suggestion_id
    JOIN review_submissions s ON s.id=a.submission_id
    WHERE ${LATEST_FEEDBACK} AND s.submitted_at>=? AND s.submitted_at<? AND (?3 IS NULL OR a.criteria_version=?3) GROUP BY a.criteria_version, e.source`)
    .bind(input.from, input.to, input.criteria ?? null).all<{ v: string; value: string; n: number }>();
  const versions = new Map<string, ReturnType<typeof emptyGroup>>();
  for (const r of rows.results) {
    const g = versions.get(r.v) ?? versions.set(r.v, emptyGroup()).get(r.v)!;
    g.total++;
    g.ai[r.verdict as AiVerdict]++;
    if (r.handoff_cause) g.handoffCauses[r.handoff_cause] = (g.handoffCauses[r.handoff_cause] ?? 0) + 1;
    if (typeof r.latency_ms === "number") { g.latencySum += r.latency_ms; g.latencyN++; }
    if (typeof r.cost_usd === "number") g.costUsd += r.cost_usd;
    for (const f of JSON.parse(r.flags) as string[]) g.flags[f] = (g.flags[f] ?? 0) + 1;
    // 只算人已經做完決定的單：還在待審的不進報表，否則管理員能把時間窗縮到一張待審卡，提前看到 AI 的判斷
    const human = r.dropped ? "dropped" : r.status;
    g.matrix[human as keyof typeof g.matrix][r.verdict as AiVerdict]++;
    if (human === "rejected") {
      const humanReasons = new Set<string>(JSON.parse(r.reject_reasons ?? "[]"));
      const aiReasons = new Set<string>(JSON.parse(r.ai_reasons));
      for (const code of AI_REASONS) {
        const h = humanReasons.has(code), a = aiReasons.has(code);
        if (!h && !a) continue;
        const c = (g.reasonAgreement[code] ??= { human: 0, ai: 0, both: 0 });
        if (h) c.human++;
        if (a) c.ai++;
        if (h && a) c.both++;
      }
    }
  }
  for (const f of feedback.results) {
    const g = versions.get(f.v) ?? versions.set(f.v, emptyGroup()).get(f.v)!;
    g.feedback[f.value as (typeof AI_FEEDBACK)[number]] = f.n;
  }
  return [...versions.entries()].map(([version, g]) => {
    const m = g.matrix;
    const agreed = m.approved.pass + m.rejected.reject;
    const comparable = agreed + m.approved.reject + m.rejected.pass;
    return {
      criteriaVersion: version,
      total: g.total,
      ai: g.ai,
      matrix: m,
      // 不算交人與還沒人工定案的：人與 AI 都下了通過／不通過結論的單裡，兩邊一樣的比例
      agreement: comparable ? agreed / comparable : null,
      comparable,
      // 人過 AI 不過＝AI 比較嚴（冤枉作者的風險）；人不過 AI 過＝人比較嚴
      aiStricter: m.approved.reject,
      humanStricter: m.rejected.pass,
      handoffRate: g.total ? g.ai.handoff / g.total : null,
      refusalRate: g.total ? (g.handoffCauses.refusal ?? 0) / g.total : null,
      handoffCauses: g.handoffCauses,
      reasonAgreement: g.reasonAgreement,
      flags: g.flags,
      feedback: g.feedback,
      avgLatencyMs: g.latencyN ? Math.round(g.latencySum / g.latencyN) : null,
      costUsd: Math.round(g.costUsd * 10_000) / 10_000,
    };
  });
}

function emptyGroup() {
  const cell = () => ({ pass: 0, reject: 0, handoff: 0 });
  return {
    total: 0, ai: cell(), latencySum: 0, latencyN: 0, costUsd: 0,
    matrix: { approved: cell(), rejected: cell(), dropped: cell() },
    handoffCauses: {} as Record<string, number>, flags: {} as Record<string, number>,
    reasonAgreement: {} as Record<string, { human: number; ai: number; both: number }>,
    feedback: { ai_right: 0, ai_wrong: 0, both_ok: 0 },
  };
}
