/**
 * 假上游的長期指令與指令組（給本機走查用）。形狀照 Harbor 的契約
 * （docs/studio/tasks/2026-10-31-long-term-instructions.md「API（定案）」）：
 * 一份＝名稱＋條目串；套用是抄進存檔；換一組＝取代；卡片選擇以 roleId 當卡片身分（上游用作品身分）。
 * 本機只有一條對話（conv-1），新存檔自動帶上的那一步在上游，這裡不模擬。
 *
 * /__directives?scenario=<名稱> 切情境；/__directives/reset 清空。
 *   full   指令組已滿 20 組
 *   down   指令組讀取回 500（看載入失敗那一行）
 */
import crypto from "node:crypto";

const MAX_SETS = 20, MAX_ITEMS = 10, MAX_LEN = 200, MAX_TITLE = 40;
let presets = [];
const cardChoice = new Map(); // roleId → presetId（'' ＝不自動帶上）
let directives = []; // 這條對話可見的條目
let scenario = "";
// 本機的卡片身分：最近一次讀指令組時帶的 roleId（上游從對話自己查得到是哪張卡）
let lastRole = "";

const now = () => new Date().toISOString();
const sid = () => "d-" + crypto.randomBytes(4).toString("hex");
const cardCount = (id) => [...cardChoice.values()].filter((v) => v === id).length;
const body = (p) => ({ presetId: p.presetId, title: p.title, items: p.items, cardCount: cardCount(p.presetId), lastUpdateTime: p.updatedAt });
const list = () => directives.map((d) => ({ sourceId: d.sourceId, text: d.text, type: "manual", origin: d.origin || "manual", turn: 0, status: "active" }));

function validItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return { error: "DIRECTIVE_PRESET_ITEMS_INVALID", errorCode: "DIRECTIVE_PRESET_ITEMS_INVALID", maxCount: MAX_ITEMS };
  for (const [i, raw] of items.entries()) {
    const t = String(raw ?? "").trim();
    if (!t) return { error: "DIRECTIVE_EMPTY", detail: { index: i } };
    if ([...t].length > MAX_LEN) return { error: "DIRECTIVE_TOO_LONG", detail: { index: i } };
    if (/[<>]/.test(t)) return { error: "DIRECTIVE_INVALID_CHARS", detail: { index: i } };
  }
  return null;
}
function insert(title, items) {
  const p = { presetId: crypto.randomUUID(), title, items: items.map((x) => String(x).trim()), updatedAt: now() };
  presets.unshift(p);
  return p;
}

export async function handleDirectives({ m, path, url, body: b, json, res }) {
  if (path === "/__directives/reset") { presets = []; cardChoice.clear(); directives = []; scenario = ""; return json(res, 200, { ok: true }), true; }
  if (path === "/__directives") { scenario = url.searchParams.get("scenario") || ""; if (scenario === "full") { presets = []; for (let i = 0; i < MAX_SETS; i++) insert(`指令組 ${i + 1}`, ["短段落"]); } return json(res, 200, { scenario }), true; }

  if (m === "GET" && path === "/open/v1/conversation/directives") {
    const roleId = url.searchParams.get("roleId") || lastRole;
    const chosen = cardChoice.has(roleId);
    return json(res, 200, { list: list(), maxCount: 10, maxLength: MAX_LEN, cardPresetId: cardChoice.get(roleId) || "", cardPresetChosen: chosen, suggestSavePreset: !chosen && directives.length > 0 }), true;
  }
  if (m === "POST" && path === "/open/v1/conversation/directive/add") {
    const t = String(b.text ?? "").trim();
    if (!t) return json(res, 400, { error: "DIRECTIVE_EMPTY" }), true;
    if (directives.length >= 10) return json(res, 400, { error: "DIRECTIVE_LIMIT_REACHED" }), true;
    directives.push({ sourceId: sid(), text: t, origin: "manual" });
    return json(res, 200, { success: "ok", list: list() }), true;
  }
  if (m === "POST" && path === "/open/v1/conversation/directive/update") {
    const d = directives.find((x) => x.sourceId === b.sourceId);
    if (!d) return json(res, 400, { error: "DIRECTIVE_NOT_FOUND" }), true;
    d.text = String(b.text ?? "").trim(); d.origin = "manual";
    return json(res, 200, { success: "ok", list: list() }), true;
  }
  if (m === "POST" && path === "/open/v1/conversation/directive/delete") {
    const n = directives.length; directives = directives.filter((x) => x.sourceId !== b.sourceId);
    if (directives.length === n) return json(res, 400, { error: "DIRECTIVE_NOT_FOUND" }), true;
    return json(res, 200, { success: "ok", list: list() }), true;
  }
  if (m === "POST" && path === "/open/v1/conversation/directive/apply-preset") {
    const p = presets.find((x) => x.presetId === b.presetId);
    if (!p) return json(res, 400, { error: "DIRECTIVE_PRESET_NOT_FOUND" }), true;
    directives = p.items.map((text) => ({ sourceId: sid(), text, origin: "manual" }));
    return json(res, 200, { success: "ok", list: list() }), true;
  }
  if (m === "POST" && path === "/open/v1/conversation/directive/save-as-preset") {
    if (presets.length >= MAX_SETS) return json(res, 400, { error: "DIRECTIVE_PRESET_LIMIT_REACHED", errorCode: "DIRECTIVE_PRESET_LIMIT_REACHED", maxCount: MAX_SETS }), true;
    const title = [...String(b.title ?? "").trim()].slice(0, MAX_TITLE).join("");
    if (!title) return json(res, 400, { error: "DIRECTIVE_PRESET_TITLE_INVALID", errorCode: "DIRECTIVE_PRESET_TITLE_INVALID", maxTitle: MAX_TITLE }), true;
    const bad = validItems(directives.map((d) => d.text)); if (bad) return json(res, 400, bad), true;
    const p = insert(title, directives.map((d) => d.text));
    if (b.bindCard && lastRole) cardChoice.set(lastRole, p.presetId);
    return json(res, 200, { success: "ok", preset: body(p) }), true;
  }

  if (m === "GET" && path === "/open/v1/player/directive-presets") {
    if (scenario === "down") return json(res, 500, { error: "server_error" }), true;
    const out = { list: presets.map(body), maxCount: MAX_SETS, maxItems: MAX_ITEMS, maxLength: MAX_LEN, maxTitle: MAX_TITLE };
    const roleId = url.searchParams.get("roleId");
    if (roleId) { lastRole = roleId; out.cardPresetId = cardChoice.get(roleId) || ""; out.cardPresetChosen = cardChoice.has(roleId); }
    return json(res, 200, out), true;
  }
  if (m === "POST" && path === "/open/v1/player/directive-preset/save") {
    const title = String(b.title ?? "").trim();
    if (!title || [...title].length > MAX_TITLE) return json(res, 400, { error: "DIRECTIVE_PRESET_TITLE_INVALID", errorCode: "DIRECTIVE_PRESET_TITLE_INVALID", maxTitle: MAX_TITLE }), true;
    const bad = validItems(b.items); if (bad) return json(res, 400, bad), true;
    if (b.presetId) {
      const p = presets.find((x) => x.presetId === b.presetId);
      if (!p) return json(res, 400, { error: "DIRECTIVE_PRESET_NOT_FOUND" }), true;
      Object.assign(p, { title, items: b.items.map((x) => String(x).trim()), updatedAt: now() });
      presets = [p, ...presets.filter((x) => x !== p)];
      return json(res, 200, { success: "ok", preset: body(p) }), true;
    }
    if (presets.length >= MAX_SETS) return json(res, 400, { error: "DIRECTIVE_PRESET_LIMIT_REACHED", errorCode: "DIRECTIVE_PRESET_LIMIT_REACHED", maxCount: MAX_SETS }), true;
    return json(res, 200, { success: "ok", preset: body(insert(title, b.items)) }), true;
  }
  if (m === "POST" && path === "/open/v1/player/directive-preset/delete") {
    const n = presets.length; presets = presets.filter((x) => x.presetId !== b.presetId);
    if (presets.length === n) return json(res, 400, { error: "DIRECTIVE_PRESET_NOT_FOUND" }), true;
    for (const [k, v] of cardChoice) if (v === b.presetId) cardChoice.set(k, "");
    return json(res, 200, { success: "ok" }), true;
  }
  if (m === "POST" && path === "/open/v1/player/card-directive/save") {
    if (b.presetId && !presets.some((x) => x.presetId === b.presetId)) return json(res, 400, { error: "DIRECTIVE_PRESET_NOT_FOUND" }), true;
    cardChoice.set(String(b.roleId), String(b.presetId || ""));
    return json(res, 200, { success: "ok", cardPresetId: String(b.presetId || "") }), true;
  }
  return false;
}
