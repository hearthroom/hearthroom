import { MAX_OPENING_MARKUP, openingMarkup, openingPreviewDocument, openingRules, type OpeningRule } from "./review-opening";
import { applyBatchMarks, authorProfiles, deviceSignals } from "./review-profile";
import { weeklyLimitAt, weeklyUsageForMember } from "./quota";
import { internalTermsIn } from "./author-note-guard";
import { submissionHistory, type SubmissionRow } from "./review";
import { HttpError } from "./types";

/**
 * AI 審卡影子模式（任務 2026-11-23-ai-card-review）。
 *
 * 審卡員是一個 AI 審核帳號（reviewers＋review_agents），由 Agent 員工透過 CLI 操作：讀卡、寫建議、打審核標記。
 * 建議本身不改送審狀態；它不能蓋章、不受理、冷凍（那些路由對 AI 帳號一律 403）。
 * 例外是 AI 快速通道（review-fast-track.ts）：已上架卡的更新、分級不變、AI 判通過且沒有標記時，由系統身分照一般核准蓋章。
 *
 * AI 讀卡時拿不到這張單的人工決定、審核章、不受理狀態與說明。審核員這邊是 AI 為主（owner 2026-11-24）：待審單一進審核頁就看得到 AI 的建議。
 * 試跑：近 7 天已定案的單也能讀（phase=backfill），同樣不帶人工決定，報表才能拿它和人工比。
 */

export const AI_VERDICTS = ["pass", "reject", "handoff"] as const;
export type AiVerdict = (typeof AI_VERDICTS)[number];
/** 作者看得到的駁回理由裡，AI 能判的那幾個（分級與字數門檻不給 AI 判）。代碼與 shared/review-reasons.ts 同步。 */
export const AI_REASONS = ["opening.no_reply_hook", "opening.no_focused_event", "opening.exposition_only", "opening.too_short", "opening.unedited_generated", "character.setting_thin", "character.copied_verbatim", "decline.burst_similar", "decline.not_ready"] as const;
/** 審核標記：只給審核與數據，作者看不到 */
export const AI_FLAGS = ["ai_unedited", "copied_text", "mass_produced"] as const;
export const AI_HANDOFF_CAUSES = ["unsure", "refusal", "invalid_output", "timeout", "error", "too_large"] as const;
const QUALITY_HANDOFF_NOTES = {
  quality_evidence: "現有資料不足以判斷這張卡的玩法是否經過設計，請人工比對。",
  suspected_template: "疑似套用相同模板，請人工比對作者的其他卡片。",
  update_diff_unavailable: "讀不到可比較的前版差異，請人工確認這次更新是否讓品質下降。",
} as const;
export const AI_HANDOFF_REASONS = Object.keys(QUALITY_HANDOFF_NOTES) as (keyof typeof QUALITY_HANDOFF_NOTES)[];
export const UNSURE_REASON_ERROR = "review_unsure_reason_required";
export const AI_FEEDBACK = ["ai_right", "ai_wrong", "both_ok"] as const;
/** 已定案的單，送審後多久內還能讓 AI 讀（試跑用） */
export const AI_BACKFILL_WINDOW_MS = 7 * 86_400_000;

const LIMITS = { setting: 12_000, text: 4_000, opening: 6_000, alternates: 3, alternate: 3_000, prologue: 6, entries: 20, entry: 300, note: 400, authorNote: 1500, index: 40, rules: 20 };

const NAME_MAX = 40;

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

/**
 * 只讀：審卡員查作者的其他卡時要打開更早的單，所以已定案（通過、駁回）的單超過 7 天也讀得到（closed），內容讀不到才 404。
 * 寫建議仍照 aiPhaseOf 的 7 天窗；被取代、撤回的單讀也不給。
 */
export function aiReadPhase(s: Pick<SubmissionRow, "status" | "submitted_at">, now: number): "shadow" | "backfill" | "closed" {
  if (s.status === "approved" || s.status === "rejected") return now - s.submitted_at <= AI_BACKFILL_WINDOW_MS ? "backfill" : "closed";
  return aiPhaseOf(s, now);
}

function openingContext(settings: Record<string, unknown>) {
  const doc = (settings.document ?? {}) as Record<string, unknown>;
  const greetings = (settings.greetings ?? {}) as Record<string, unknown>;
  const asset = (settings.authorAsset ?? {}) as Record<string, unknown>;
  const pageHtml = typeof asset.openingPage === "string" ? asset.openingPage : "";
  const mode = text(asset.openingMode) || (asset.cardFormat === "fengyue" ? "page" : "greeting");
  const rawRules = Array.isArray(settings.reviewDisplayRules) ? settings.reviewDisplayRules : asset.rules;
  const rules = (Array.isArray(rawRules) ? rawRules : []).filter((r): r is OpeningRule => !!r && typeof r === "object");
  const activeRules = rules.filter((r) => r.enabled !== false && typeof r.find === "string" && r.find.trim());
  return { doc, greetings, asset, pageHtml, mode, rules, activeRules, welcome: text(greetings.welcome),
    alternates: list(greetings.alternates), names: { char: text(doc.roleName), user: text(doc.userName) } };
}

export function aiOpeningText(settings: Record<string, unknown>, surface: string, offset: number, preview = false) {
  const ctx = openingContext(settings);
  const selected = surface === "primary" ? (ctx.mode === "page" && ctx.pageHtml ? "page" : "welcome") : surface;
  const raw = selected === "page" ? ctx.pageHtml : selected === "welcome" ? ctx.welcome : ctx.alternates[Number(selected.slice(10)) - 1];
  if (raw === undefined || (selected === "page" && !raw)) return { state: "missing" } as const;
  const view = selected === "page" ? openingMarkup(raw, MAX_OPENING_MARKUP) : openingRules(ctx.activeRules, MAX_OPENING_MARKUP, preview)(raw, ctx.names);
  const coverage = "coverage" in view ? view.coverage : view.dynamic || view.inputClipped ? "partial" : "complete";
  if (preview) return { state: "ready", surface: selected, coverage, previewKind: "offline_static",
    previewHtml: "previewHtml" in view ? view.previewHtml : openingPreviewDocument(raw) } as const;
  // Cap the response independently of the projection. Resume at a Unicode boundary.
  const end = Math.min(offset + 8_000, view.text.length);
  const boundary = /[\uD800-\uDBFF]/u.test(view.text[end - 1] ?? "") && end < view.text.length ? end - 1 : end;
  return { state: "ready", surface: selected, coverage, structure: view.structure, observations: view.observations,
    ruleHits: "hits" in view ? view.hits : 0, offset, text: view.text.slice(offset, boundary),
    nextOffset: boundary < view.text.length ? boundary : null } as const;
}

/** 送給 AI 的卡片內容：長文截斷；統計數字用全文算。只有審卡員讀卡才套用顯示規則。 */
export function aiCardInput(settings: Record<string, unknown>, meta: { tags: string[]; fandom: string }, opts: { applyRules?: boolean; includeObservations?: boolean } = {}) {
  const { doc, greetings, asset, pageHtml, mode, rules, activeRules, welcome, alternates, names } = openingContext(settings);
  const page = openingMarkup(pageHtml);
  const books = Array.isArray(settings.worldbooks) ? settings.worldbooks : settings.worldbook ? [settings.worldbook] : [];
  type Entry = { name?: unknown; content?: unknown; isEnabled?: unknown; isConstant?: unknown; keywords?: unknown };
  const allEntries = (books as { entries?: Entry[] }[]).flatMap((b) => (Array.isArray(b?.entries) ? b.entries : []));
  const entries = allEntries
    .filter((e) => e.isEnabled !== false)
    .map((e) => ({ name: text(e.name), content: text(e.content), constant: e.isConstant === true, keywords: list(e.keywords).length }));
  const setting = text(doc.roleDetailDesc);
  const render = opts.applyRules ? openingRules(activeRules) : null;
  const welcomeView = render?.(welcome, names);
  const alternateViews = render ? alternates.slice(0, LIMITS.alternates).map((a) => render(a, names)) : [];
  const cardText = setting + welcome + alternates.join("");
  const prologue = list(greetings.prologue);
  const presentation = (view: typeof welcomeView) => view ? {
    source: view.hits ? "display_rules" : "greeting", text: view.text, coverage: view.coverage,
    structure: view.structure, ruleHits: view.hits, skippedRules: view.skipped,
  } : null;
  const scanned = setting + welcome;
  const tail = welcome.slice(-200);
  const pageCoverage = page.dynamic || page.clipped ? "partial" : "complete";
  const pagePrimary = mode === "page" && !!pageHtml;
  const observations = opts.includeObservations ? {
    hasDisplayRules: activeRules.some((r) => r.promptOnly !== true && (!Array.isArray(r.targets) || r.targets.includes("ai"))),
    hasOpeningPage: !!pageHtml,
    settingTranscriptPattern: /(?:^|\n)\s*(?:user|human|使用者|用戶|用户)\s*[:：]/i.test(setting)
      && /(?:^|\n)\s*(?:assistant|chatgpt|助手|助理)\s*[:：]/i.test(setting),
    primary: pagePrimary ? { source: "page", coverage: pageCoverage, ...page.observations }
      : welcomeView ? { source: welcomeView.hits ? "display_rules" : "greeting", coverage: welcomeView.coverage, ...welcomeView.observations } : null,
  } : undefined;
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
        mode,
        page: page.text,
        welcome: clip(welcome, LIMITS.opening),
        alternates: alternates.slice(0, LIMITS.alternates).map((a) => clip(a, LIMITS.alternate)),
        // 開場選項：玩家點了會填進輸入框的預設回覆（編輯器的「開場選項」欄位）
        prologue: prologue.slice(0, LIMITS.prologue).map((a) => clip(a, LIMITS.alternate)),
        // 開場白有被顯示規則替換的標記時，玩家看到的是替換後的版面：這是套用規則後的純文字近似
        welcomeRendered: welcomeView?.hits ? welcomeView.text : null,
        alternatesRendered: alternateViews.map((view) => view.hits ? view.text : null),
        presentation: {
          welcome: presentation(welcomeView),
          alternates: alternateViews.map(presentation),
          page: pageHtml ? {
            text: page.text, coverage: pageCoverage,
            structure: page.structure,
          } : null,
        },
        ...(observations ? { observations } : {}),
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
      openingPageChars: page.chars,
      // 開場網頁的結構：原始 HTML 大小、元素數、可點的元素（按鈕、連結、分頁）、有沒有腳本。
      // 頁面內容靠腳本畫出來時，上面的純文字可能只剩「載入中」，這時看結構判斷用不用心
      openingPageHtmlChars: pageHtml.length,
      openingPageElements: (pageHtml.match(/<[a-zA-Z][^>]*>/g) ?? []).length,
      openingPageInteractive: (pageHtml.match(/<(button|a|select|input)\b|onclick=|data-tab|role="tab"/gi) ?? []).length,
      openingPageScript: /<script\b/i.test(pageHtml),
      // 開場白裡直接寫的 HTML（會被渲染成版面）的標籤數
      openingHtmlTags: (welcome.match(/<[a-zA-Z][^>]*>/g) ?? []).length,
      openingOptions: prologue.length,
      // 開場白（含備選）被顯示規則命中的次數：多代表開場靠規則換成版面呈現
      openingRuleHits: welcomeView ? welcomeView.hits + alternateViews.reduce((n, view) => n + view.hits, 0) : null,
      lorebookConstantChars: entries.filter((e) => e.constant).reduce((n, e) => n + e.content.length, 0),
      openingChoices: /\[choices\]|(^|\n)\s*(?:[1-9１-９][.、．)]|[A-DＡ-Ｄ][.、．)])\s*\S/.test(welcome),
    },
  };
}

/** AI 讀卡時看得到的送審資訊：跟審核頁同一層，但不帶這張單的人工決定、審核章、不受理與說明。 */
export async function aiSubmissionMeta(db: D1Database, s: SubmissionRow, now: number) {
  const [history, version, live] = await Promise.all([
    submissionHistory(db, s.id),
    db.prepare("SELECT member_id, source_role_id, json_extract(public_role,'$.tags') AS tags, json_extract(public_role,'$.fandom') AS fandom FROM hosting_versions WHERE submission_id=?")
      .bind(s.id).first<{ member_id: string; source_role_id: string; tags: string | null; fandom: string | null }>(),
    // 送審當下這張卡已經上架了嗎（之前有通過、送審前已定案的版本）：已上架卡的更新照「沒有往壞了改就放行」判（owner 2026-11-24）
    db.prepare("SELECT 1 AS yes FROM review_submissions p WHERE p.card_id=? AND p.id<>? AND p.status='approved' AND p.decided_at<? LIMIT 1")
      .bind(s.card_id, s.id, s.submitted_at).first<{ yes: number }>(),
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
      published: !!live,
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
export async function authorSignals(db: D1Database, memberId: string, sourceRoleId: string, at: number) {
  // 先取作者在各供應商的公開 ID，再用 (provider, author_num_id, registered_at) 索引數登記；免費額度不算禮包登記
  const ids = await db.prepare("SELECT provider, external_id FROM member_identities WHERE member_id=?").bind(memberId).all<{ provider: string; external_id: string }>();
  const byProvider = JSON.stringify(ids.results.map((r) => [r.provider, Number(r.external_id)]));
  const [row, recent] = await Promise.all([
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM json_each(?4) p JOIN card_registrations r ON r.provider=json_extract(p.value,'$[0]') AND r.author_num_id=json_extract(p.value,'$[1]')
        WHERE r.registered_at>?3-${WEEK} AND r.registered_at<=?3 AND r.pack_id IS NULL) AS registrations7d,
      (SELECT COUNT(*) FROM review_submissions s3 JOIN hosting_versions v3 ON v3.submission_id=s3.id WHERE v3.member_id=?1 AND s3.status='approved' AND s3.decided_at<?3) AS priorApproved,
      (SELECT created_at FROM members WHERE id=?1) AS createdAt,
      (SELECT COUNT(DISTINCT d.member_id) FROM reward_devices d WHERE d.first_seen<=?3 AND d.device_hash=(
        SELECT r2.device_hash FROM json_each(?4) p2 JOIN card_registrations r2 ON r2.provider=json_extract(p2.value,'$[0]')
        WHERE r2.source_role_id=?2 AND r2.device_hash IS NOT NULL AND r2.registered_at<=?3 ORDER BY r2.registered_at DESC LIMIT 1)) AS deviceAccounts`)
      .bind(memberId, sourceRoleId, at, byProvider).first<{ registrations7d: number; priorApproved: number; createdAt: number | null; deviceAccounts: number }>(),
    // 送審前 7 天這位作者每一次送審「還沒上架的卡」（新卡與未上架重送，含這次）：節奏與字數。看得出「一晚送六張長卡」。
    // 已上架卡的更新不算（owner 2026-11-24：更新已上線的卡不是量產）
    db.prepare(`SELECT s2.submitted_at AS at, s2.review_length_total AS chars,
        (s2.status='pending' OR s2.decided_at>?2) AND s2.status<>'superseded' AS waiting
      FROM review_submissions s2 JOIN hosting_versions v2 ON v2.submission_id=s2.id
      WHERE v2.member_id=?1 AND s2.submitted_at>?2-${WEEK} AND s2.submitted_at<=?2 AND NOT EXISTS (SELECT 1 FROM review_submissions p0 WHERE p0.card_id=s2.card_id AND p0.id<>s2.id AND p0.status='approved' AND p0.decided_at<s2.submitted_at) ORDER BY s2.submitted_at DESC LIMIT 60`)
      .bind(memberId, at).all<{ at: number; chars: number | null; waiting: number }>(),
  ]);
  const limit = await weeklyLimitAt(db, at);
  const times = recent.results.map((r) => r.at);
  const gaps = times.slice(0, -1).map((t, i) => (t - times[i + 1]!) / 3_600_000).sort((a, b) => a - b);
  return {
    submissions7d: recent.results.length,
    submissions24h: recent.results.filter((r) => r.at > at - 86_400_000).length,
    // 送審當下這位作者同時還有幾張在等審（含這張）
    pendingAtSubmit: recent.results.filter((r) => r.waiting).length,
    registrations7d: row?.registrations7d ?? 0,
    weeklyLimit: limit,
    quotaFull: (row?.registrations7d ?? 0) >= limit,
    // 近 7 天相鄰兩次送審的間隔中位數（小時）、這張距上一張（分鐘）
    medianGapHours: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]! * 10) / 10 : null,
    minutesSincePrevious: times.length > 1 ? Math.round((times[0]! - times[1]!) / 60_000) : null,
    // 近幾次送審的有效字數（新的在前）
    recentChars: recent.results.slice(0, 8).map((r) => r.chars),
    priorApproved: row?.priorApproved ?? 0,
    accountAgeDays: row?.createdAt ? Math.max(0, Math.floor((at - row.createdAt) / 86_400_000)) : null,
    deviceAccounts: row?.deviceAccounts || null,
  };
}

/**
 * 審核頁的「作者行為」（只給審核員，owner 2026-11-24）：本週用了多少送審額度、近 7 天與 24 小時送了幾張還沒上架的卡（已上架卡的更新不算）、
 * 平均多久送一張、這張距上一張多久、近期每張的字數。看得出「一個晚上送六張長卡」這種批量產卡。
 * 只回數字與狀態，不回帳號或裝置識別碼；作者標記沿用審核頁的作者側寫。
 */
/** 作者行為異常的門檻（PM 2026-11-24 定，之後可調）：只提示，不自動判定 */
export const ACTIVITY_THRESHOLDS = {
  burst: { windowMs: 12 * 3_600_000, count: 3, chars: 1500 },
  quickGap: { minutes: 30, chars: 1000 },
  device: { warn: 3, heavy: 5 },
} as const;

export async function authorActivity(db: D1Database, submissionId: string, now: number) {
  // 改判單（0152）待審時版本列還在原本那張駁回單上；作者行為看的是原本那一次送審
  const v = await db.prepare("SELECT member_id, source_role_id FROM hosting_versions WHERE submission_id IN (?1, (SELECT flip_of FROM review_submissions WHERE id=?1)) LIMIT 1").bind(submissionId).first<{ member_id: string; source_role_id: string }>();
  if (!v) return null;
  const [usage, limit, list, signals] = await Promise.all([
    weeklyUsageForMember(db, v.member_id, now),
    weeklyLimitAt(db, now),
    db.prepare(`SELECT s2.id, s2.card_id AS card, s2.submitted_at AS at, s2.review_length_total AS chars, s2.status, s2.kind
      FROM review_submissions s2 JOIN hosting_versions v2 ON v2.submission_id=s2.id
      WHERE v2.member_id=? AND s2.submitted_at>? AND NOT EXISTS (SELECT 1 FROM review_submissions p0 WHERE p0.card_id=s2.card_id AND p0.id<>s2.id AND p0.status='approved' AND p0.decided_at<s2.submitted_at) ORDER BY s2.submitted_at DESC LIMIT 60`).bind(v.member_id, now - WEEK)
      .all<{ id: string; card: number; at: number; chars: number | null; status: string; kind: string }>(),
    authorSignals(db, v.member_id, v.source_role_id, now),
  ]);
  const self = await db.prepare("SELECT s.flip_of, COALESCE((SELECT o.submitted_at FROM review_submissions o WHERE o.id=s.flip_of), s.submitted_at) AS submitted_at FROM review_submissions s WHERE s.id=?").bind(submissionId).first<{ flip_of: string | null; submitted_at: number }>();
  // 同一張卡改字重送不算「另一張」：間隔看上一張「別的卡」，一晚多張數的是不同的卡（改判單算它改判的那一次）
  const selfCard = list.results.find((r) => r.id === submissionId || (!!self?.flip_of && r.id === self.flip_of))?.card;
  const before = list.results.filter((r) => r.at < (self?.submitted_at ?? now) && r.card !== selfCard);
  const times = list.results.map((r) => r.at);
  const gaps = times.slice(0, -1).map((t, i) => t - times[i + 1]!);
  const T = ACTIVITY_THRESHOLDS;
  // 一晚多張長卡：任一個 12 小時窗口裡，字數夠長的送審有幾張（取最多的那個窗口）
  const long = list.results.filter((r) => (r.chars ?? 0) >= T.burst.chars);
  const burst = long.reduce((max, x) => Math.max(max, new Set(long.filter((u) => u.at <= x.at && u.at > x.at - T.burst.windowMs).map((u) => u.card)).size), 0);
  const minutesSincePrevious = self && before.length ? Math.round((self.submitted_at - before[0]!.at) / 60_000) : null;
  const thisChars = list.results.find((r) => r.id === submissionId)?.chars ?? null;
  const used = usage.effectiveFreeWorks.size;
  const anomalies = [
    ...(burst >= T.burst.count ? [{ code: "burst_long", value: burst }] : []),
    ...(limit > 0 && used >= limit ? [{ code: "quota_full", value: used }] : []),
    ...(minutesSincePrevious !== null && minutesSincePrevious < T.quickGap.minutes && (thisChars ?? 0) >= T.quickGap.chars ? [{ code: "quick_gap", value: minutesSincePrevious }] : []),
    ...((signals.deviceAccounts ?? 0) >= T.device.warn ? [{ code: (signals.deviceAccounts ?? 0) >= T.device.heavy ? "device_heavy" : "device", value: signals.deviceAccounts }] : []),
  ];
  return {
    anomalies,
    weekly: { used: usage.effectiveFreeWorks.size, limit, deviceShared: usage.deviceShared },
    submissions7d: list.results.length,
    submissions24h: list.results.filter((r) => r.at > now - 86_400_000).length,
    pendingNow: list.results.filter((r) => r.status === "pending").length,
    avgGapHours: gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length / 3_600_000) * 10) / 10 : null,
    minutesSincePrevious,
    recent: list.results.map((r) => ({ at: r.at, chars: r.chars, status: r.status, kind: r.kind, current: r.id === submissionId })),
    deviceAccounts: signals.deviceAccounts,
    priorApproved: signals.priorApproved,
    accountAgeDays: signals.accountAgeDays,
  };
}

export interface SuggestionInput {
  criteriaVersion: string; model: string; verdict: AiVerdict | null; reasons: string[]; flags: string[];
  /** 這次有沒有帶 flags：沒帶就保留已存的標記 */
  flagsGiven?: boolean;
  confidence: number | null; note: string; handoffCause: string | null;
  /** 給作者的詳細說明草稿：只寫卡片本身，不帶作者行為、額度、裝置、分數 */
  authorNote: string;
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
  // 沒帶 flags＝不動已存的審核標記（例如先用 tags 打過）；明寫 [] 才清掉
  const flagsGiven = body.flags !== undefined && body.flags !== null;
  if (opts.tagsOnly) {
    return { criteriaVersion: criteriaVersion as string, model: model as string, verdict: null, reasons: [], flags, flagsGiven: true, confidence: null, note: "", handoffCause: null, authorNote: "", inputTokens: null, outputTokens: null, costUsd: null, latencyMs: null };
  }
  if (!oneOf(body.verdict, AI_VERDICTS)) bad("verdict");
  const verdict = body.verdict as AiVerdict;
  let handoffCause: string | null = null;
  if (verdict === "handoff") {
    if (body.handoffCause !== undefined && !oneOf(body.handoffCause, AI_HANDOFF_CAUSES)) bad("handoffCause");
    handoffCause = (body.handoffCause as string | undefined) ?? "unsure";
  } else if (body.handoffCause !== undefined && body.handoffCause !== null) bad("handoffCause");
  let unsureReason: keyof typeof QUALITY_HANDOFF_NOTES | null = null;
  if (handoffCause === "unsure") {
    const selected = Array.isArray(body.reasons) && body.reasons.length === 1 ? body.reasons[0] : null;
    if (!oneOf(selected, AI_HANDOFF_REASONS)) {
      throw new HttpError(400, UNSURE_REASON_ERROR, {
        field: "reasons",
        hint: "請依卡片的用心程度及量產跡象判定 pass 或 reject。若仍需要人工比對，從讀卡結果的交人工理由中選一項。",
      });
    }
    unsureReason = selected;
  }
  const reasons = unsureReason ? [unsureReason] : codes(body.reasons, AI_REASONS, "reasons");
  if (verdict === "reject" && reasons.length + flags.length === 0) bad("reasons");
  if (verdict === "pass" && reasons.length) bad("reasons");
  const confidence = count(body.confidence, "confidence", 1);
  const note = body.note === undefined || body.note === null ? "" : body.note;
  if (typeof note !== "string" || note.length > LIMITS.note) bad("note");
  const authorNote = body.authorNote === undefined || body.authorNote === null ? "" : body.authorNote;
  if (typeof authorNote !== "string" || authorNote.length > LIMITS.authorNote) bad("authorNote");
  // AI 為主（owner 2026-11-24）：審核員預設照 AI 定案，駁回時給作者的說明就是 AI 寫的，所以每張駁回都要依實際情況寫
  if (verdict === "reject" && !(authorNote as string).trim()) throw new HttpError(400, "author_note_required", undefined, {
    field: "authorNote",
    hint: "Every reject needs authorNote: the explanation shown to the card's author. Say briefly why public cards are quality-reviewed, then point to what in this card needs work and how to improve it, in the card's language. Keep internal signals in note.",
  });
  const hits = internalTermsIn(authorNote as string);
  if (hits.length) throw new HttpError(400, "author_note_internal", undefined, {
    field: "authorNote", terms: hits,
    hint: "authorNote is shown to the card's author. Describe only the card itself (opening, setting, lorebook, writing) and how to improve it. Keep submission quota, pace, devices, accounts and scores in note, which only reviewers see.",
  });
  return {
    criteriaVersion: criteriaVersion as string, model: model as string, verdict, reasons, flags, flagsGiven, confidence,
    note: unsureReason ? QUALITY_HANDOFF_NOTES[unsureReason] : (note as string).trim(),
    handoffCause, authorNote: (authorNote as string).trim(),
    inputTokens: count(body.inputTokens, "inputTokens"), outputTokens: count(body.outputTokens, "outputTokens"),
    costUsd: count(body.costUsd, "costUsd", 100), latencyMs: count(body.latencyMs, "latencyMs", 86_400_000),
  };
}

/** 寫建議：同一審卡員、同一判準版本、同一張單只留一筆。只打標記時保留已下的結論。 */
export async function saveSuggestion(db: D1Database, input: SuggestionInput & { submissionId: string; cardId: number; agentId: string; phase: "shadow" | "backfill"; now: number }, opts: { tagsOnly?: boolean } = {}) {
  const id = crypto.randomUUID();
  const cols = "id,submission_id,card_id,agent_member_id,criteria_version,model,verdict,reasons,flags,confidence,handoff_cause,note,author_note,phase,input_tokens,output_tokens,cost_usd,latency_ms,created_at,updated_at";
  const update = opts.tagsOnly
    // 只打標記不動 updated_at：updated_at 代表結論何時改過（揭曉後「用 AI 的」靠它認出 AI 重判）
    ? "flags=excluded.flags,model=excluded.model"
    : `model=excluded.model,verdict=excluded.verdict,reasons=excluded.reasons,flags=${input.flagsGiven === false ? "review_ai_suggestions.flags" : "excluded.flags"},confidence=excluded.confidence,handoff_cause=excluded.handoff_cause,note=excluded.note,author_note=excluded.author_note,phase=excluded.phase,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,cost_usd=excluded.cost_usd,latency_ms=excluded.latency_ms,updated_at=excluded.updated_at`;
  const row = await db.prepare(`INSERT INTO review_ai_suggestions (${cols}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(submission_id,agent_member_id,criteria_version) DO UPDATE SET ${update} RETURNING id, verdict, phase, updated_at`)
    .bind(id, input.submissionId, input.cardId, input.agentId, input.criteriaVersion, input.model, input.verdict, JSON.stringify(input.reasons), JSON.stringify(input.flags),
      input.confidence, input.handoffCause, input.note, input.authorNote, input.phase, input.inputTokens, input.outputTokens, input.costUsd, input.latencyMs, input.now, input.now)
    .first<{ id: string; verdict: string | null; phase: string; updated_at: number }>();
  return row!;
}

const CRITERIA_KEY = "review_ai_criteria";

/**
 * 目前的判準版本：揭曉、兩段式定案、仲裁預設都只看這一版的建議（換版時舊版建議不再拿來對照）。
 * 由審卡員（換版時）或管理員設定；沒設定就取近 7 天審卡員用過的最新版本。
 */
export async function currentCriteria(db: D1Database): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM community_settings WHERE key=?").bind(CRITERIA_KEY).first<{ value: string }>();
  if (row) { try { return JSON.parse(row.value) as string; } catch { /* 壞值當沒設 */ } }
  const recent = await db.prepare("SELECT criteria_version AS v FROM review_ai_suggestions WHERE updated_at > ? GROUP BY criteria_version").bind(Date.now() - 7 * 86_400_000).all<{ v: string }>();
  return recent.results.map((r) => r.v).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))[0] ?? null;
}

export async function setCurrentCriteria(db: D1Database, version: string, memberId: string, now: number): Promise<void> {
  if (!/^v\d{1,4}$/.test(version)) throw new HttpError(400, "invalid_arguments", undefined, { field: "version" });
  await db.prepare("INSERT INTO community_settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at")
    .bind(CRITERIA_KEY, JSON.stringify(version), memberId, now).run();
}

export interface SuggestionView {
  id: string; criteriaVersion: string; model: string; verdict: AiVerdict | null; reasons: string[]; flags: string[];
  confidence: number | null; handoffCause: string | null; note: string; authorNote: string; phase: string; at: number;
}

export async function suggestionsOf(db: D1Database, submissionId: string): Promise<SuggestionView[]> {
  const rows = await db.prepare("SELECT * FROM review_ai_suggestions WHERE submission_id=? ORDER BY updated_at DESC").bind(submissionId).all<Record<string, any>>();
  return rows.results.map((r) => ({
    id: r.id, criteriaVersion: r.criteria_version, model: r.model, verdict: r.verdict, reasons: JSON.parse(r.reasons), flags: JSON.parse(r.flags),
    confidence: r.confidence, handoffCause: r.handoff_cause, note: r.note, authorNote: r.author_note ?? "", phase: r.phase, at: r.updated_at,
  }));
}

/**
 * 審核員看得到 AI 建議嗎（AI 為主，owner 2026-11-24）：待審單任何審核員一進審核頁就看得到；
 * 已定案的單只給蓋過章的人、自己不受理而且還在不受理中的人，以及管理員。
 */
export async function canReveal(db: D1Database, s: Pick<SubmissionRow, "id" | "status">, memberId: string, role: string | null): Promise<boolean> {
  if (s.status === "pending") return true;
  const mine = await db.prepare(`SELECT EXISTS(SELECT 1 FROM review_stamps WHERE submission_id=?1 AND member_id=?2)
    OR EXISTS(SELECT 1 FROM review_drops WHERE submission_id=?1 AND actor_member_id=?2 AND restored_at IS NULL) AS ok`).bind(s.id, memberId).first<{ ok: number }>();
  if (mine?.ok) return true;
  return role === "manager" || role === "owner";
}

/** 每位審核員對每筆建議最後一次覆核（雙盲時代的揭曉覆核，已不再寫入；報表與仲裁頁照列歷史資料） */
export const LATEST_FEEDBACK = `e.action='ai_feedback' AND e.id=(SELECT f.id FROM review_events f WHERE f.action='ai_feedback'
  AND f.ai_suggestion_id=e.ai_suggestion_id AND f.actor_member_id=e.actor_member_id ORDER BY f.at DESC, f.id DESC LIMIT 1)`;

/** 人工 vs AI 的對照：只算人已做完決定（通過、駁回、不受理中）且 AI 下了結論的單。依判準版本分組。 */
export async function aiReport(db: D1Database, input: { from: number; to: number; criteria?: string | null }) {
  const rows = await db.prepare(`SELECT a.criteria_version AS v, a.phase, a.verdict, a.reasons AS ai_reasons, a.flags, a.handoff_cause, a.latency_ms, a.cost_usd,
      s.status, s.reject_reasons,
      EXISTS(SELECT 1 FROM review_drops d WHERE d.submission_id=s.id AND d.restored_at IS NULL) AS dropped,
      (SELECT e.final_source FROM review_events e WHERE e.submission_id=s.id AND e.final_source IS NOT NULL ORDER BY e.at DESC LIMIT 1) AS final_source,
      (SELECT e.ai_note_types FROM review_events e WHERE e.submission_id=s.id AND e.final_source IS NOT NULL ORDER BY e.at DESC LIMIT 1) AS final_note_types
    FROM review_ai_suggestions a JOIN review_submissions s ON s.id=a.submission_id
    WHERE a.verdict IS NOT NULL AND s.submitted_at>=? AND s.submitted_at<? AND (?3 IS NULL OR a.criteria_version=?3)
      AND (s.status IN ('approved','rejected') OR EXISTS(SELECT 1 FROM review_drops d WHERE d.submission_id=s.id AND d.restored_at IS NULL))`)
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
    // 人那邊＝最後的定案（AI 為主：審核員看過 AI 再定案是正常流程）
    const human = r.dropped ? "dropped" : r.status;
    if (r.final_source) {
      g.finalSource[r.final_source] = (g.finalSource[r.final_source] ?? 0) + 1;
      // AI 為主（owner 2026-11-24）的主指標：改了 AI 的比例＝modified／(ai＋modified)；審核員標「AI 判斷不準確」的筆數
      if (r.final_note_types && (JSON.parse(r.final_note_types) as string[]).includes("ai_inaccurate")) g.inaccurate++;
    }
    // AI 快速通道核准的單不是人的判斷：不進人機對照（否則等於 AI 跟自己比）
    if (r.final_source === "ai_fast_track") continue;
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
      // 定案來源（ai 照 AI／modified 改了 AI／human_no_ai 無 AI 對照／ai_fast_track AI 快速通道自動核准；歷史資料另有 blind＝舊雙盲「用我的」）
      finalSource: g.finalSource,
      inaccurate: g.inaccurate,
      costUsd: Math.round(g.costUsd * 10_000) / 10_000,
    };
  });
}

function emptyGroup() {
  const cell = () => ({ pass: 0, reject: 0, handoff: 0 });
  return {
    total: 0, ai: cell(), latencySum: 0, latencyN: 0, costUsd: 0, inaccurate: 0, finalSource: {} as Record<string, number>,
    matrix: { approved: cell(), rejected: cell(), dropped: cell() },
    handoffCauses: {} as Record<string, number>, flags: {} as Record<string, number>,
    reasonAgreement: {} as Record<string, { human: number; ai: number; both: number }>,
    feedback: { ai_right: 0, ai_wrong: 0, both_ok: 0 },
  };
}
