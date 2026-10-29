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
 * 在畫布套用到某個預設，那個預設的 bindingCount 會加一，列表就只能封存。
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
let conversationBinding = { mode: "card_default", presetId: null, revisionId: null, bindingVersion: 0, state: "ready" };
let cardBinding = { mode: "card_default", presetId: null, revisionId: null, bindingVersion: 0, state: "ready" };
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
    if (p.role && p.role !== "system") return { ...base, level: "unsupported", uiStatus: "unsupported", reasonCodes: ["message_role_not_supported"], inertSettings: inert };
    if (p.injection_position === 1) return { ...base, level: "unsupported", uiStatus: "unsupported", reasonCodes: ["history_injection_not_supported"], inertSettings: inert };
    if (MACROS.test(p.content ?? "")) return { ...base, level: "unsupported", uiStatus: "unsupported", reasonCodes: ["macro_not_supported"], inertSettings: inert };
    if (before && (p.content ?? "").includes("{{lastUserMessage}}")) {
      const adaptationId = `${o.identifier}:move_to_suffix`;
      if (doc.selection.acceptedAdaptationIds?.includes(adaptationId)) return { ...base, level: "partial", targetSlot: "S", reasonCodes: [], availableAdaptationIds: [adaptationId], adaptationId, inertSettings: inert };
      return { ...base, level: "partial", targetSlot: "S", uiStatus: "needs_adjustment", reasonCodes: ["move_to_suffix"], availableAdaptationIds: [adaptationId], adaptationId, inertSettings: inert };
    }
    return { ...base, targetSlot: before ? "P" : "S", inertSettings: inert };
  });
  const fields = Object.keys(doc.st).filter((k) => !KNOWN_FIELDS.has(k)).map((k) => ({ path: k, status: "unsupported", reason: "source_only", uiStatus: "unsupported", reasonCodes: ["source_only"], inertSettings: [k] }));
  return { compilerVersion: "mock-p1", entries, fields, reviewRequired: entries.some((e) => e.uiStatus) };
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
  return { ...p, allowedActions: p.bindingCount > 0 ? ["archive"] : ["delete"], recommendedModels: head?.recommendedModels ?? [] };
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
  if (path === "/__presets/reset") { presets.clear(); revisions.clear(); previews.clear(); receipts.clear(); return json(res, 200, { ok: true }), true; }
  if (scenario === "scope" && (path.startsWith("/open/v1/preset") || path.includes("/preset"))) return json(res, 403, { error: "insufficient_scope", required_scope: "preset.read" }), true;
  if (m === "GET" && path === "/open/v1/presets") {
    if (scenario !== "empty") seedPresets();
    return json(res, 200, { items: [...presets.values()].map(summary), nextCursor: "", quota: scenario === "full" ? { used: 50, limit: 50, archived: 2 } : quota() }), true;
  }
  if (m === "POST" && path === "/open/v1/presets/analyze") return json(res, 200, { compatibility: analyze(body.document) }), true;
  if (m === "POST" && path === "/open/v1/presets") {
    const bad = validateNative(body.document);
    if (bad) return json(res, 422, { error: "preset_invalid", reason: bad }), true;
    return json(res, 201, idempotent(req, null, () => create(body.title, body.document, body.recommendedModels))), true;
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
  if (m === "GET" && path === "/open/v1/conversation/preset") return json(res, 200, scenario === "unavailable" && conversationBinding.mode === "revision" ? { ...bindingBody(conversationBinding), state: "unavailable" } : bindingBody(conversationBinding)), true;
  if (m === "GET" && path === "/open/v1/player/preset-default") return json(res, 200, bindingBody(cardBinding)), true;
  if (m === "POST" && (path === "/open/v1/conversation/preset/apply" || path === "/open/v1/player/preset-default/save")) {
    if (scenario === "busy" && path.includes("conversation")) return json(res, 409, { error: "preset_conflict", reason: "operation_active" }), true;
    const card = path.includes("player");
    const cur = card ? cardBinding : conversationBinding;
    if ((card ? body.expectedVersion : body.expectedBindingVersion) !== cur.bindingVersion) return json(res, 409, { error: "preset_conflict", reason: "preset_revision_conflict" }), true;
    const rev = body.revisionId ? revisions.get(body.revisionId) : null;
    const next = rev ? { mode: "revision", presetId: rev.presetId, revisionId: rev.revisionId, bindingVersion: cur.bindingVersion + 1, state: "ready" } : { mode: "card_default", presetId: null, revisionId: null, bindingVersion: cur.bindingVersion + 1, state: "ready" };
    if (card) cardBinding = next; else conversationBinding = next;
    if (rev) presets.get(rev.presetId).bindingCount += 1;
    return json(res, 200, { ...bindingBody(next), cacheEffect: "prefix_rebuild_once", effectiveFrom: "next_admitted_operation" }), true;
  }
  if (path === "/open/v1/conversation/response-settings" || path === "/open/v1/conversation/response-settings/save") {
    const locked = conversationBinding.mode === "revision";
    if (m === "POST") {
      if (locked && ["style", "customStyle", "styleNote"].some((k) => k in (body.patch ?? {}))) return json(res, 409, { error: "preset_style_locked" }), true;
      if (body.expectedRevision !== responseRevision) return json(res, 409, { error: "conflict" }), true;
      for (const [k, v] of Object.entries(body.patch ?? {})) { if (v === null) delete responseOverrides[k]; else responseOverrides[k] = v; }
      responseRevision++;
    }
    const effective = { agency: "coauthor", style: "card", perspective: "card", length: "auto", pace: "natural", streaming: "on", ...responseOverrides };
    return json(res, 200, { conversationId: url.searchParams.get("conversationId") ?? body.conversationId, scope: "conversation", schemaVersion: 1, revision: responseRevision, overrides: { ...responseOverrides }, effective, styleSource: locked ? "preset" : "card_default", styleLocked: locked }), true;
  }
  return false;
}
