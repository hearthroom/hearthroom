/**
 * 假上游的「我的預設」與預設綁定（給本機走查用）。形狀照 Harbor 的預設契約
 * （docs/studio/tasks/2026-10-29-preset-library/backend-p1-contract.md §9）：
 * 相容判定用很粗的規則模擬——非系統身分、插進歷史中間、白名單外的巨集標「不支援」；
 * 對話記錄之前用了 {{lastUserMessage}} 標「需調整」。真正的判定在 Harbor，這裡只為了看畫面。
 *
 * /__presets?scenario=<名稱> 切情境（再送一次不帶 scenario 就回到預設）；/__presets/reset 清空。
 *   empty     清單是空的（不自動放範例）
 *   full      額度 50／50，其中 2 份封存
 *   busy      畫布套用回 409 operation_active（對話正在回覆）
 *   scope     所有預設請求回 403 insufficient_scope（舊登入沒同意過）
 *   expired   匯入的 selection／confirm 回 410 preset_preview_expired
 *   conflict  下一次存新版本回 409 preset_revision_conflict（別處先存了）
 *   unavailable  綁定 GET 回 state=unavailable（選用的版本讀不到）
 *   toolModel    回覆偏好的工具回覆狀態回 model_unsupported（目前模型不支援）
 *   toolMode     回覆偏好的工具回覆狀態回 mode_unsupported（Agent／世界模式）
 *   libraryEmpty 預設庫是空的（熱門與全部預設都沒有）
 *   applyConflict 下一次「套用到某張卡」回 409 preset_revision_conflict（別處剛改過；前端會重讀再送一次）
 * 在畫布套用到某張卡，那個預設的 bindingCount（正在用它的卡數）就是 1，列表就只能封存。
 *
 * 分享（P2，docs/studio/tasks/2026-10-29-preset-library/p2-share-backend-contract.md §4、§10、§11）：
 * 預設庫是另一批「別的作者」公開的預設（記憶體裡），熱度＝3 × 近 7 天使用人數＋喜愛數；
 * /preset-library/hot 有熱度的不足 12 份時用最新公開的補滿並標 fresh。模型篩選認 series:／model:／general／all。
 * 帶 roleId 讀寫的卡片綁定照卡分開存（預設庫的「套用到某張卡」）；畫布與回覆偏好照舊看最近存的那一份。
 * 「套用到某張卡」（mode=preset）會把那份記進「喜愛與用過」的用過。
 */
import crypto from "node:crypto";

const MARKERS = new Set(["charDescription", "charPersonality", "scenario", "personaDescription", "dialogueExamples", "worldInfoBefore", "worldInfoAfter", "chatHistory"]);
const KNOWN_FIELDS = new Set(["prompts", "prompt_order", "temperature", "top_p", "top_k", "top_a", "min_p", "frequency_penalty", "presence_penalty", "repetition_penalty", "seed", "openai_max_tokens", "reasoning_effort", "verbosity", "version", "type", "data"]);
const MACROS = /\{\{(?!char\}\}|user\}\}|lastUserMessage\}\}|trim\}\}|\/\/)[^}]*\}\}/;

const presets = new Map();
const revisions = new Map();
const previews = new Map();
const receipts = new Map();
let scenario = "";
// 自訂預設只套用到整張卡（owner 2026-10-30）：只有一份卡層綁定，這段對話讀到的也是它
let cardBinding = { mode: "card_default", presetId: null, revisionId: null, bindingVersion: 0, state: "ready" };
/** 帶 roleId 讀寫的卡片綁定照卡分開存；沒存過的卡是 card_default。cardBinding 仍是畫布與回覆偏好看的那一份（最近存的） */
const cardBindings = new Map();
const bindingOf = (roleId) => (roleId ? cardBindings.get(roleId) ?? { mode: "card_default", presetId: null, revisionId: null, bindingVersion: 0, state: "ready" } : cardBinding);
// 套用時由預設決定的項目（上游的 presetLocked）
const PRESET_LOCKED = ["agency", "style", "perspective", "pace", "sandboxLevel", "jailbreak"];
let responseRevision = 0;
const responseOverrides = {};

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function orderOf(doc) {
  const st = doc.st;
  if (st.data && st.type) return st.data.prompt_order ?? [];
  return (st.prompt_order ?? []).find((p) => p.character_id === doc.selection.profileId)?.order ?? [];
}
function promptsOf(doc) { return (doc.st.data && doc.st.type ? doc.st.data.prompts : doc.st.prompts) ?? []; }

// 回覆工具格式的合成示例：形狀照上游，字是假的（真的定義由上游給）
const REPLY_TOOL = { name: "submit_reply", description: "Submit the complete reply. Text outside this tool is discarded.", parameters: { type: "object", properties: { body: { type: "string", description: "The complete reply text, keeping its formatting and line breaks." } }, required: ["body"] }, example: { name: "submit_reply", arguments: { body: "(示範正文)" } } };

// 跟上游一樣只看酒館 SPreset 擴充功能：有啟用的工具綁定只提示；擴充功能的工具與程式都不執行
function extensionFlags(st) {
  const sp = (st.data && st.type ? st.data.extensions : st.extensions)?.SPreset ?? {};
  const tools = Object.values(sp.ToolBindings ?? {}).some((b) => b && b.enabled);
  const scripts = !!(sp.OutputPreprocessing?.enabled || sp.FinalRequestProcessing?.enabled || sp.ChatSquash?.squashed_post_script_enable);
  return { tools, scripts };
}

export function analyze(doc) {
  const order = orderOf(doc);
  const history = order.findIndex((o) => o.identifier === "chatHistory");
  const entries = order.map((o, i) => {
    const p = promptsOf(doc).find((x) => x.identifier === o.identifier) ?? {};
    // 跟上游一樣：實際啟用＝來源開著而且沒有列為不採用
    const base = { identifier: o.identifier, level: "full", enabled: o.enabled !== false && !(doc.selection.excludedEntryIds ?? []).includes(o.identifier), frameworkOwned: false, reasonCodes: [], availableAdaptationIds: [], inertSettings: [] };
    if (MARKERS.has(o.identifier)) return { ...base, level: "partial", frameworkOwned: true, targetSlot: "F", reasonCodes: ["framework_owned"] };
    const inert = ["injection_order", "injection_depth", "injection_trigger", "forbid_overrides"].filter((k) => p[k] !== undefined && !(k === "injection_depth" && p.injection_position !== 1));
    const before = history < 0 || i < history;
    // 跟上游 preset-p1.2 一樣：user／assistant 角色照原位置；插進對話記錄的依深度自動放到最近的穩定位置，不用玩家確認
    if (MACROS.test(p.content ?? "")) return { ...base, level: "unsupported", uiStatus: "unsupported", reasonCodes: ["macro_not_supported"], inertSettings: inert };
    if (p.injection_position === 1) {
      const after = (p.injection_depth ?? 4) <= 4;
      return { ...base, level: "partial", targetSlot: after ? "S" : "P", uiStatus: "relocated", reasonCodes: [after ? "relocated_after_history" : "relocated_before_history"], inertSettings: inert };
    }
    if (before && (p.content ?? "").includes("{{lastUserMessage}}")) return { ...base, level: "partial", targetSlot: "S", uiStatus: "relocated", reasonCodes: ["dynamic_after_history"], inertSettings: inert };
    return { ...base, targetSlot: before ? "P" : "S", inertSettings: inert };
  });
  const ext = extensionFlags(doc.st);
  const fields = Object.keys(doc.st).filter((k) => !KNOWN_FIELDS.has(k)).map((k) => ({ path: k, status: "unsupported", reason: "source_only", uiStatus: "unsupported",
    reasonCodes: ["source_only", ...(k === "extensions" && ext.tools ? ["external_tools_not_executed"] : []), ...(k === "extensions" && ext.scripts ? ["external_scripts_not_executed"] : [])], inertSettings: [k] }));
  return { compilerVersion: "mock-p1.3", entries, fields, reviewRequired: entries.some((e) => e.uiStatus === "unsupported"), toolReply: { enabled: !!doc.selection.toolReply, externalToolBindingsDetected: ext.tools, tool: REPLY_TOOL } };
}

/**
 * 跟 Harbor 的 ValidateNative 一樣嚴：本站寫的預設只收這幾個欄位，多一個就 422。
 * 本機先擋，免得畫面在假上游存得進去、正式站卻存不進去（2026-10-29 正式站 422 的教訓）。
 */
/** 跟 server 的 executableMacros 一樣：只認 {{char}}、{{user}}、{{lastUserMessage}}，字一模一樣、括號成對 */
export function nativeMacrosValid(text) {
  let s = text;
  for (;;) {
    const i = s.indexOf("{{");
    if (i < 0) return !s.includes("}}");
    if (s.slice(0, i).includes("}}")) return false;
    const j = s.indexOf("}}", i + 2);
    if (j < 0 || !["char", "user", "lastUserMessage"].includes(s.slice(i + 2, j))) return false;
    s = s.slice(j + 2);
  }
}

export function validateNative(doc) {
  const st = doc.st ?? {};
  if ("data" in st) return "preset_native_pack_invalid";
  for (const k of Object.keys(st)) if (!["prompts", "prompt_order", "temperature", "top_p"].includes(k)) return "preset_native_field_unsupported";
  for (const [k, max] of [["temperature", 2], ["top_p", 1]]) if (k in st && (typeof st[k] !== "number" || st[k] < 0 || st[k] > max)) return "preset_native_field_unsupported";
  for (const p of st.prompts ?? []) {
    for (const k of Object.keys(p)) if (!["identifier", "name", "role", "content", "marker", "injection_position"].includes(k)) return "preset_native_field_unsupported";
    const framework = MARKERS.has(p.identifier);
    if (!!p.marker !== framework || (p.injection_position ?? 0) !== 0) return "preset_native_entry_unsupported";
    if (framework ? (p.content || (p.role && p.role !== "system")) : p.role !== "system") return "preset_native_entry_unsupported";
    if (!framework && !nativeMacrosValid(p.content ?? "")) return "preset_native_entry_unsupported";
  }
  for (const prof of st.prompt_order ?? []) {
    for (const k of Object.keys(prof)) if (k !== "character_id" && k !== "order") return "preset_native_field_unsupported";
    for (const e of prof.order ?? []) for (const k of Object.keys(e)) if (k !== "identifier" && k !== "enabled") return "preset_native_field_unsupported";
  }
  return "";
}

function summary(p) {
  const head = revisions.get(p.headRevisionId);
  return { visibility: "private", publishedAt: null, attribution: "", removed: false, ...p, allowedActions: p.bindingCount > 0 ? ["archive"] : ["delete"], recommendedModels: head?.recommendedModels ?? [] };
}
function addRevision(preset, title, document, recommendedModels) {
  const revisionId = uuid();
  const version = (preset.version ?? 0) + 1;
  revisions.set(revisionId, { revisionId, presetId: preset.id, version, document, sourceKind: preset.sourceKind, compilerVersion: "mock-p1", contentHash: crypto.createHash("sha256").update(JSON.stringify(document)).digest("hex"), recommendedModels: recommendedModels ?? [], createdAt: now(), title });
  Object.assign(preset, { title, headRevisionId: revisionId, version, updatedAt: now() });
  return { presetId: preset.id, revisionId, version };
}
function create(title, document, recommendedModels, sourceKind = "native") {
  const preset = { id: uuid(), title, version: 0, sourceKind, archived: false, bindingCount: 0, createdAt: now(), updatedAt: now() };
  presets.set(preset.id, preset);
  return addRevision(preset, title, document, recommendedModels);
}
const quota = () => ({ used: presets.size, limit: 50, archived: [...presets.values()].filter((p) => p.archived).length });
function idempotent(req, key, fn) {
  const k = req.headers["idempotency-key"];
  if (k && receipts.has(k)) return receipts.get(k);
  const out = fn();
  if (k) receipts.set(k, out);
  return out;
}
const bindingBody = (b) => b.mode === "revision" ? { ...b, presetTitle: presets.get(b.presetId)?.title, version: revisions.get(b.revisionId)?.version } : b;

// ── 預設庫（別的作者公開的預設）──
const DECLARATION = "preset-publish-2026-10-30";
const SERIES = { "Gemini 4": "Gemini", "Gemini 4 Flash": "Gemini", "DeepSeek V4": "DeepSeek", "DeepSeek V4 Pro": "DeepSeek", "Claude Opus": "Claude", "Claude Sonnet": "Claude" };
const library = new Map();
const shelf = new Map(); // presetId → { favoritedAt, lastAppliedAt }
const reports = new Set();
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
function seedLibrary() {
  if (library.size || scenario === "libraryEmpty") return;
  const doc = (lines) => ({ schemaVersion: "hearthroom.st-preset.v1", st: { temperature: 0.9, top_p: 0.95,
    prompts: [...lines.map(([identifier, name, content]) => ({ identifier, name, role: "system", content })), { identifier: "chatHistory", name: "Chat History", marker: true }],
    prompt_order: [{ character_id: 100001, order: [...lines.map(([identifier]) => ({ identifier, enabled: true })), { identifier: "chatHistory", enabled: true }] }] },
    selection: { profileId: 100001, excludedEntryIds: [], acceptedAdaptationIds: [], excludedFields: [] } });
  const rows = [
    ["慢熱日常", "小麥", ["model:Gemini 4"], 342, 58, 30],
    ["電影感長篇", "Aster", ["model:DeepSeek V4", "series:Gemini"], 215, 41, 25],
    ["長篇冒險（酒館匯入）", "林夜", ["model:Gemini 4"], 128, 17, 20],
    ["簡潔對話體", "阿澈", [], 61, 9, 18],
    ["古風章回", "青蓮", ["model:Gemini 4"], 0, 0, 2],
    ["夜讀筆記", "墨痕", ["series:Claude"], 0, 0, 1],
    ["推理現場", "", ["model:Claude Opus"], 0, 3, 6],
  ];
  rows.forEach(([title, authorName, recommendedModels, usesLast7d, favoriteCount, age], i) => {
    const presetId = `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    library.set(presetId, { presetId, title, authorName, authorNumId: 4000 + i, authorAvatar: "", attribution: i === 1 ? "改寫自 Aster 的酒館預設" : "", recommendedModels, usesLast7d, favoriteCount,
      publishedAt: daysAgo(age), updatedAt: daysAgo(Math.max(0, age - 1)), listed: true, mine: false,
      document: doc([["main", "主敘事規則", "用鏡頭的方式寫場景：先交代整體環境，再帶到人物與細節。"], ["style", "文風細節", "旁白用第三人稱，台詞自然口語。"], ["end", "收尾處理", "每次回覆結尾留一個可以接話的地方。"]]) });
  });
}
const heatOf = (x) => 3 * x.usesLast7d + x.favoriteCount;
function libraryItem(x, extra = {}) {
  const { document: _d, ...rest } = x;
  const mark = shelf.get(x.presetId);
  return { ...rest, enabledEntryCount: orderOf(x.document).filter((o) => o.enabled !== false && o.identifier !== "chatHistory").length, heat: heatOf(x), fresh: false,
    favorited: !!mark?.favoritedAt, lastAppliedAt: mark?.lastAppliedAt ?? null, ...extra };
}
function modelHit(x, model) {
  if (!model || model === "all") return true;
  if (model === "general") return !x.recommendedModels.length;
  if (x.recommendedModels.includes(model)) return true;
  if (model.startsWith("series:")) return x.recommendedModels.some((v) => v.startsWith("model:") && SERIES[v.slice(6)] === model.slice(7));
  if (model.startsWith("model:")) return x.recommendedModels.includes(`series:${SERIES[model.slice(6)]}`);
  return false;
}
const byNew = (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.presetId.localeCompare(b.presetId);
const byHot = (a, b) => heatOf(b) - heatOf(a) || byNew(a, b);

export function seedPresets() {
  if (presets.size) return;
  const doc = { schemaVersion: "hearthroom.st-preset.v1", st: {
    temperature: 0.9, extensions: { regex_scripts: [] },
    prompts: [
      { identifier: "main", name: "主要指示", role: "system", content: "用第三人稱細膩描寫，對話與動作交錯。", system_prompt: true },
      { identifier: "charDescription", name: "Char Description", marker: true },
      { identifier: "worldInfoBefore", name: "World Info (before)", marker: true },
      { identifier: "turn", name: "回應玩家", role: "system", content: "先回應：{{lastUserMessage}}", injection_order: 100 },
      { identifier: "chatHistory", name: "Chat History", marker: true },
      { identifier: "dice", name: "擲骰", role: "system", content: "{{roll:d20}}" },
      { identifier: "jailbreak", name: "收尾提醒", role: "system", content: "保持角色口吻。" },
    ],
    prompt_order: [{ character_id: 100001, order: ["main", "charDescription", "worldInfoBefore", "turn", "chatHistory", "dice", "jailbreak"].map((identifier) => ({ identifier, enabled: identifier !== "dice" })) }],
  }, selection: { profileId: 100001, excludedEntryIds: [], acceptedAdaptationIds: [], excludedFields: [] } };
  create("細膩第三人稱", doc, [], "imported");
  const p = [...presets.values()][0];
  addRevision(p, p.title, doc, []);
}

export async function handlePresets({ m, path, url, body, raw, req, json, res }) {
  let mm;
  if (path === "/__presets") { scenario = url.searchParams.get("scenario") ?? ""; return json(res, 200, { scenario }), true; }
  if (path === "/__presets/reset") { presets.clear(); revisions.clear(); previews.clear(); receipts.clear(); library.clear(); shelf.clear(); reports.clear(); cardBindings.clear(); return json(res, 200, { ok: true }), true; }
  if (scenario === "scope" && (path.startsWith("/open/v1/preset") || path.includes("/preset"))) return json(res, 403, { error: "insufficient_scope", required_scope: "preset.read" }), true;
  if (m === "GET" && path === "/open/v1/presets") {
    if (scenario !== "empty") seedPresets();
    return json(res, 200, { items: [...presets.values()].map(summary), nextCursor: "", quota: scenario === "full" ? { used: 50, limit: 50, archived: 2 } : quota(), declarationVersion: DECLARATION }), true;
  }
  if (m === "POST" && path === "/open/v1/presets/analyze") return json(res, 200, { compatibility: analyze(body.document) }), true;
  if (m === "POST" && path === "/open/v1/presets") {
    const bad = validateNative(body.document);
    if (bad) return json(res, 422, { error: "preset_invalid", reason: bad }), true;
    return json(res, 201, idempotent(req, null, () => create(body.title, body.document, body.recommendedModels))), true;
  }
  // ── 分享：公開／改回私人（自己的預設）──
  if (m === "POST" && (mm = path.match(/^\/open\/v1\/presets\/([^/]+)\/(publish|unpublish)$/))) {
    const p = presets.get(mm[1]); if (!p) return json(res, 404, { error: "not_found" }), true;
    if (body.expectedVersion !== p.version) return json(res, 409, { error: "preset_conflict", reason: "preset_revision_conflict" }), true;
    if (mm[2] === "publish") {
      if (p.removed) return json(res, 409, { error: "preset_conflict", reason: "preset_removed" }), true;
      if (body.declaration !== DECLARATION) return json(res, 409, { error: "preset_conflict", reason: "preset_declaration_changed" }), true;
      Object.assign(p, { visibility: "public", publishedAt: p.publishedAt ?? now(), attribution: body.attribution ?? "" });
      if (body.recommendedModels) revisions.get(p.headRevisionId).recommendedModels = body.recommendedModels;
    } else p.visibility = "private";
    return json(res, 200, { presetId: p.id, revisionId: p.headRevisionId, version: p.version }), true;
  }
  // ── 分享：預設庫、熱門、詳情、喜愛、檢舉、喜愛與用過 ──
  if (m === "GET" && path === "/open/v1/preset-library/hot") {
    seedLibrary();
    const model = url.searchParams.get("model") || "all";
    const pool = [...library.values()].filter((x) => x.listed && modelHit(x, model));
    const hot = pool.filter((x) => heatOf(x) > 0).sort(byHot).slice(0, 12);
    const fill = hot.length < 12 ? pool.filter((x) => heatOf(x) === 0).sort(byNew).slice(0, 12 - hot.length) : [];
    return json(res, 200, { items: [...hot.map((x) => libraryItem(x)), ...fill.map((x) => libraryItem(x, { fresh: true }))] }), true;
  }
  if (m === "GET" && path === "/open/v1/preset-library") {
    seedLibrary();
    const model = url.searchParams.get("model") || "all";
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const offset = Number(url.searchParams.get("offset") || 0), limit = Math.min(50, Number(url.searchParams.get("limit") || 20));
    let rows = [...library.values()].filter((x) => x.listed && modelHit(x, model) && (!q || x.title.toLowerCase().includes(q) || x.authorName.toLowerCase().includes(q)));
    rows = rows.sort(url.searchParams.get("sort") === "new" ? byNew : byHot);
    return json(res, 200, { items: rows.slice(offset, offset + limit).map((x) => libraryItem(x)) }), true;
  }
  if (m === "GET" && path === "/open/v1/preset-shelf") {
    seedLibrary();
    const rows = [...shelf].map(([id, mark]) => ({ x: library.get(id), mark })).filter((r) => r.x);
    const fav = rows.filter((r) => r.mark.favoritedAt).sort((a, b) => b.mark.favoritedAt.localeCompare(a.mark.favoritedAt));
    const used = rows.filter((r) => !r.mark.favoritedAt && r.mark.lastAppliedAt).sort((a, b) => b.mark.lastAppliedAt.localeCompare(a.mark.lastAppliedAt));
    return json(res, 200, { items: [...fav, ...used].map((r) => libraryItem(r.x)) }), true;
  }
  if ((mm = path.match(/^\/open\/v1\/preset-library\/([^/]+)(?:\/(favorite|report))?$/))) {
    seedLibrary();
    const x = library.get(mm[1]); if (!x) return json(res, 404, { error: "not_found" }), true;
    if (m === "POST" && mm[2] === "favorite") {
      const mark = shelf.get(x.presetId) ?? {};
      if (body.favorite) { if (!mark.favoritedAt) x.favoriteCount++; mark.favoritedAt = now(); }
      else if (mark.favoritedAt) { x.favoriteCount--; delete mark.favoritedAt; }
      if (mark.favoritedAt || mark.lastAppliedAt) shelf.set(x.presetId, mark); else shelf.delete(x.presetId);
      return json(res, 200, { favorited: !!body.favorite }), true;
    }
    if (m === "POST" && mm[2] === "report") { reports.add(x.presetId); return json(res, 200, { reported: true }), true; }
    if (m === "GET" && !mm[2]) return json(res, 200, { item: libraryItem(x), revision: { revisionId: `${x.presetId}-r`, presetId: x.presetId, version: 1, document: x.document, sourceKind: "native", compilerVersion: "mock-p1", contentHash: "mock", recommendedModels: x.recommendedModels, createdAt: x.updatedAt },
      compatibility: analyze(x.document), parameters: { temperature: x.document.st.temperature, top_p: x.document.st.top_p }, reportedByMe: reports.has(x.presetId) }), true;
  }
  if (m === "GET" && (mm = path.match(/^\/open\/v1\/presets\/([^/]+)$/))) {
    const p = presets.get(mm[1]); if (!p) return json(res, 404, { error: "not_found" }), true;
    const revs = [...revisions.values()].filter((r) => r.presetId === p.id).sort((a, b) => b.version - a.version)
      .map((r) => ({ revisionId: r.revisionId, version: r.version, title: r.title, createdAt: r.createdAt, enabledEntryCount: orderOf(r.document).filter((o) => o.enabled !== false).length }));
    return json(res, 200, { ...summary(p), revisions: revs }), true;
  }
  if (m === "GET" && (mm = path.match(/^\/open\/v1\/presets\/([^/]+)\/revisions\/([^/]+)(\/export)?$/))) {
    const r = revisions.get(mm[2]); if (!r || r.presetId !== mm[1]) return json(res, 404, { error: "not_found" }), true;
    if (mm[3]) { res.writeHead(200, { "content-type": "application/json", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(presets.get(mm[1]).title)}.json`, "access-control-allow-origin": "*", "access-control-expose-headers": "Content-Disposition" }); res.end(JSON.stringify(r.document.st, null, 2)); return true; }
    const { title: _t, ...revision } = r;
    return json(res, 200, { revision, compatibility: analyze(r.document) }), true;
  }
  if (m === "POST" && (mm = path.match(/^\/open\/v1\/presets\/([^/]+)\/(revisions|delete|archive|copy)$/))) {
    const p = presets.get(mm[1]); if (!p) return json(res, 404, { error: "not_found" }), true;
    if (mm[2] === "copy") { const head = revisions.get(p.headRevisionId); return json(res, 201, idempotent(req, null, () => create(body.title, structuredClone(head.document), head.recommendedModels, p.sourceKind))), true; }
    if (scenario === "conflict" && mm[2] === "revisions") { scenario = ""; p.version++; return json(res, 409, { error: "preset_conflict", reason: "preset_revision_conflict" }), true; }
    if (body.expectedVersion !== p.version) return json(res, 409, { error: "preset_conflict", reason: "preset_revision_conflict" }), true;
    if (mm[2] === "revisions") {
      const bad = p.sourceKind === "native" ? validateNative(body.document) : "";
      if (bad) return json(res, 422, { error: "preset_invalid", reason: bad }), true;
      if (analyze(body.document).entries.some((e) => e.enabled && e.uiStatus === "unsupported")) return json(res, 422, { error: "preset_invalid", reason: "preset_adjustment_required" }), true;
      return json(res, 201, idempotent(req, null, () => addRevision(p, body.title, body.document, body.recommendedModels))), true;
    }
    if (mm[2] === "delete" && p.bindingCount === 0) { presets.delete(p.id); return json(res, 200, { presetId: p.id, revisionId: p.headRevisionId, version: p.version, disposition: "deleted" }), true; }
    p.archived = true;
    return json(res, 200, { presetId: p.id, revisionId: p.headRevisionId, version: p.version, disposition: "archived" }), true;
  }
  if (m === "POST" && path === "/open/v1/preset-imports/preview") {
    const text = raw.toString("utf8");
    const file = text.match(/name="file"[^\r\n]*\r\n(?:[^\r\n]+\r\n)*\r\n([\s\S]*?)\r\n--/)?.[1] ?? "";
    const profile = text.match(/name="profileId"\r\n\r\n([^\r]+)/)?.[1];
    let st; try { st = JSON.parse(file); } catch { return json(res, 422, { error: "preset_invalid", reason: "preset_invalid_json" }), true; }
    const profiles = st.data && st.type ? [0] : (st.prompt_order ?? []).map((p) => p.character_id);
    if (profiles.length > 1 && profile === undefined) return json(res, 400, { error: "preset_profile_required", reason: "profile_required", preset_profiles: profiles }), true;
    const document = { schemaVersion: "hearthroom.st-preset.v1", st, selection: { profileId: profile !== undefined ? Number(profile) : profiles[0] ?? 0, excludedEntryIds: [], acceptedAdaptationIds: [], excludedFields: [] } };
    const previewId = uuid();
    const preview = { previewId, version: 1, expiresAt: new Date(Date.now() + 15 * 60e3).toISOString(), sourceHash: "mock", selectionDigest: uuid(), document, report: analyze(document) };
    previews.set(previewId, preview);
    return json(res, 201, preview), true;
  }
  if (m === "POST" && (mm = path.match(/^\/open\/v1\/preset-imports\/([^/]+)\/(selection|confirm)$/))) {
    const p = previews.get(mm[1]); if (!p || scenario === "expired") return json(res, 410, { error: "preset_preview_expired" }), true;
    if (body.expectedPreviewVersion !== p.version) return json(res, 409, { error: "preset_conflict", reason: "preset_revision_conflict" }), true;
    if (mm[2] === "selection") { Object.assign(p, { version: p.version + 1, selectionDigest: uuid(), document: { ...p.document, selection: body.selection } }); p.report = analyze(p.document); return json(res, 200, p), true; }
    return json(res, 201, idempotent(req, null, () => create(body.title, p.document, body.recommendedModels, "imported"))), true;
  }
  // ── 綁定（畫布） ──
  const cardBody = (b = cardBinding) => scenario === "unavailable" && b.mode === "revision" ? { ...bindingBody(b), state: "unavailable" } : bindingBody(b);
  if (m === "GET" && (path === "/open/v1/conversation/preset" || path === "/open/v1/player/preset-default")) return json(res, 200, { ...cardBody(bindingOf(url.searchParams.get("roleId"))), scope: "card" }), true;
  // 舊的「只這段對話／只新存檔」寫法：上游拒收，請舊畫面重新載入
  if (m === "POST" && path === "/open/v1/conversation/preset/apply") return json(res, 409, { error: "preset_conflict", reason: "preset_scope_changed" }), true;
  if (m === "POST" && path === "/open/v1/player/preset-default/save") {
    if (body.scope !== "card") return json(res, 409, { error: "preset_conflict", reason: "preset_scope_changed" }), true;
    if (scenario === "busy") return json(res, 409, { error: "preset_conflict", reason: "operation_active" }), true;
    const cur = bindingOf(body.roleId);
    if (scenario === "applyConflict") { scenario = ""; cardBindings.set(body.roleId ?? "", { ...cur, bindingVersion: cur.bindingVersion + 1 }); return json(res, 409, { error: "preset_conflict", reason: "preset_revision_conflict" }), true; }
    if (body.expectedVersion !== cur.bindingVersion) return json(res, 409, { error: "preset_conflict", reason: "preset_revision_conflict" }), true;
    const rev = body.revisionId ? revisions.get(body.revisionId) : null;
    // 跟著作者走（mode=preset）：自己的預設或預設庫裡的都收；套用預設庫的會記進「喜愛與用過」的用過
    const target = body.mode === "preset" && body.presetId ? (presets.get(body.presetId) ?? library.get(body.presetId)) : null;
    if (body.mode === "preset" && !target) return json(res, 404, { error: "not_found" }), true;
    if (cur.presetId && presets.get(cur.presetId)) presets.get(cur.presetId).bindingCount = 0;
    const next = target ? { mode: "preset", presetId: body.presetId, revisionId: null, presetTitle: target.title, bindingVersion: cur.bindingVersion + 1, state: "ready" }
      : rev ? { mode: "revision", presetId: rev.presetId, revisionId: rev.revisionId, bindingVersion: cur.bindingVersion + 1, state: "ready" }
      : { mode: "card_default", presetId: null, revisionId: null, bindingVersion: cur.bindingVersion + 1, state: "ready" };
    if (body.roleId) cardBindings.set(body.roleId, next);
    cardBinding = next;
    if (rev) presets.get(rev.presetId).bindingCount = 1;
    if (target && presets.has(body.presetId)) presets.get(body.presetId).bindingCount = 1;
    if (target && library.has(body.presetId)) shelf.set(body.presetId, { ...shelf.get(body.presetId), lastAppliedAt: now() });
    return json(res, 200, { ...bindingBody(next), scope: "card", cacheEffect: "prefix_may_rebuild", effectiveFrom: "next_admitted_operation" }), true;
  }
  if (path === "/open/v1/conversation/response-settings" || path === "/open/v1/conversation/response-settings/save") {
    const locked = cardBinding.mode === "revision";
    const presetLocked = locked ? PRESET_LOCKED : [];
    if (m === "POST") {
      const lockedKeys = presetLocked.flatMap((k) => [k, `${k}Note`, ...(k === "style" ? ["customStyle"] : [])]);
      if (lockedKeys.some((k) => k in (body.patch ?? {}))) return json(res, 409, { error: "preset_style_locked" }), true;
      if (body.expectedRevision !== responseRevision) return json(res, 409, { error: "conflict" }), true;
      for (const [k, v] of Object.entries(body.patch ?? {})) { if (v === null) delete responseOverrides[k]; else responseOverrides[k] = v; }
      responseRevision++;
    }
    // 工具回覆：綁定的版本打開了才算；只有 active 時有效設定的串流是關，玩家自己的設定不動
    const bound = locked ? revisions.get(cardBinding.revisionId) : null;
    const enabled = !!bound?.document?.selection?.toolReply;
    const status = !locked ? "off" : !bound ? "unavailable" : !enabled ? "off" : scenario === "toolModel" ? "model_unsupported" : scenario === "toolMode" ? "mode_unsupported" : "active";
    const effective = { agency: "coauthor", style: "card", perspective: "card", length: "auto", pace: "natural", streaming: "on", ...responseOverrides, ...(status === "active" ? { streaming: "off" } : {}) };
    return json(res, 200, { conversationId: url.searchParams.get("conversationId") ?? body.conversationId, scope: "conversation", schemaVersion: 1, revision: responseRevision, overrides: { ...responseOverrides }, effective, styleSource: locked ? "preset" : "card_default", styleLocked: locked, presetLocked,
      toolReply: { enabled: status === "unavailable" ? false : enabled, effective: status === "active", status } }), true;
  }
  return false;
}
