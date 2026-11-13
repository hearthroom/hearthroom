/**
 * 假的卡片工坊（擴充）端點，掛在 mock-upstream（:8899）上，給本機開發與 QA 走查用。
 * 形狀照 docs studio/tasks/2026-11-13-card-workshop/interface-web.md；那份改了這裡跟著改。
 *
 * Provider 那一半（/open/v1/workshop/*、/open/v1/player/role-settings/save）照常由網頁打 8899。
 * 本站那一半（/v1/cards/:id/workshop、/v1/workshops…、/v1/me/workshops…、/v1/me/workshop-cards）要讓 vite 轉過來：
 *
 *   HEARTHROOM_WORKSHOP_MOCK=http://127.0.0.1:8899 npm run dev:web
 *
 * 任何卡都有同一組五個假擴充（卡號不同、內容一樣）。/__workshop?scenario=<名稱> 切情境，/__workshop/reset 清空：
 *   (空)        一般玩家、工坊開放、五個擴充
 *   owner       看的人是原作者（列表含被打回／隱藏的、可管理）
 *   empty       開放中、還沒有任何擴充
 *   owner-empty 原作者看自己的卡、還沒有擴充
 *   closed      原作者暫停新增、還有既存
 *   no-tab      暫停且擴充歸零（卡片頁不顯示工坊分頁）
 *   error       工坊列表回 500
 *   big         原卡常駐很大（開始對話會放不下）
 */
const now = Date.now();
const DAY = 86400e3;
const TIERS = [{ tier: 1, tokens: 16000 }, { tier: 2, tokens: 32000 }, { tier: 3, tokens: 64000 }, { tier: 4, tokens: 128000 }];
const cover = (n) => `http://127.0.0.1:8899/img/${n}.png`;

const SEED = [
  { id: "w1", name: "雪夜篇：燈塔守望者", summary: "冬季限定的新篇章，燈塔與失蹤的船。", kinds: ["lore", "opening"], joinCount: 1820, version: 3, residentChars: 620, adult: false, author: "霧港", lore: 14, rules: 0, openings: 2 },
  { id: "w2", name: "航海日誌介面", summary: "把對話變成手寫航海日誌，附天氣與航向。", kinds: ["display"], joinCount: 960, version: 5, residentChars: 0, adult: false, author: "Kai", lore: 0, rules: 4, openings: 0 },
  { id: "w3", name: "港口商會擴充設定", summary: "商會、行會與十二位新角色。", kinds: ["lore"], joinCount: 412, version: 1, residentChars: 1480, adult: false, author: "鹽與帆", lore: 22, rules: 0, openings: 0 },
  { id: "w4", name: "霧鐘音效標記", summary: "在關鍵句加上霧鐘的音效標記。", kinds: ["display", "lore"], joinCount: 133, version: 2, residentChars: 240, adult: false, author: "Kai", lore: 3, rules: 2, openings: 0 },
  { id: "w5", name: "夜航（限制級）", summary: "成人向的夜航支線。", kinds: ["lore", "opening", "display"], joinCount: 77, version: 1, residentChars: 900, adult: true, author: "匿名水手", lore: 9, rules: 1, openings: 1 },
];
const VERSIONS = { w1: [[3, "新增 3 條世界書條目，修正日誌介面在手機上的換行。"], [2, "加入霧鐘音效標記規則。"], [1, "首次上架。"]] };

let scenario = "";
let ownerStates = new Map(); // id → { state, reason, appeal }
let selections = new Map(); // roleId → { revision, items: [{workshopId, enabled}] }
let contextTier = new Map(); // roleId → tier
let drafts = new Map();
let mine = null;
let allowNew = true; let policyRevision = 1;
let comments = new Map();
let seq = 100;

function reset() {
  scenario = ""; ownerStates = new Map([["w4", { state: "returned", reason: "介面規則會蓋掉原卡的狀態列，請改成只在日誌區塊顯示。", appeal: null }]]);
  selections = new Map(); contextTier = new Map(); drafts = new Map(); comments = new Map(); allowNew = true; policyRevision = 1; mine = null;
}
reset();

const owner = () => scenario.startsWith("owner");
const isClosed = () => scenario === "closed" || scenario === "no-tab" || !allowNew;
const seeded = () => (scenario === "empty" || scenario === "owner-empty" || scenario === "no-tab") ? [] : SEED;
const ownerOf = (id) => ownerStates.get(id) ?? { state: "visible", reason: null, appeal: null };
function summary(w, cardId, viewerIsOwner, joined) {
  const o = ownerOf(w.id);
  return {
    id: w.id, cardId, name: w.name, summary: w.summary, coverUrl: cover(Number(w.id.slice(1)) * 7),
    author: { handle: w.author === "匿名水手" ? null : `h-${w.id}`, name: w.author }, joinCount: w.joinCount, version: w.version,
    updatedAt: now - Number(w.id.slice(1)) * 3 * DAY, kinds: w.kinds, rating: w.adult ? "R" : "G", adult: w.adult, joined,
    ...(viewerIsOwner ? { ownerState: o.state, ownerReason: o.reason, appeal: o.appeal } : {}),
  };
}
function selectionOf(roleId) {
  if (!selections.has(roleId)) selections.set(roleId, { revision: 1, items: [] });
  return selections.get(roleId);
}
function selectionView(roleId) {
  const s = selectionOf(roleId);
  return { revision: s.revision, items: s.items.map((i) => { const w = SEED.find((x) => x.id === i.workshopId) ?? draftAsSeed(i.workshopId); return { workshopId: i.workshopId, enabled: i.enabled, name: w?.name ?? i.workshopId, coverUrl: cover(Number(String(i.workshopId).replace(/\D/g, "") || 1) * 7), kinds: w?.kinds ?? [], residentChars: w?.residentChars ?? 0, availability: i.removed ? "removed" : "open" }; }) };
}
const draftAsSeed = (id) => { const d = drafts.get(id); return d ? { id, name: d.name, kinds: [], residentChars: 0 } : null; };
// 本機的卡片頁只知道卡號、加入清單以 roleId 存：任何一張卡加入過就算「已加入」（只有一張卡在玩時足夠）
const joinedIds = () => new Set([...selections.values()].flatMap((s) => s.items.map((i) => i.workshopId)));
function usage(roleId) {
  const base = scenario === "big" ? 40000 : 3800;
  const s = selectionView(roleId);
  const items = s.items.filter((i) => i.enabled && i.availability !== "removed").map((i) => ({ workshopId: i.workshopId, constantChars: i.residentChars }));
  const extra = items.reduce((n, i) => n + i.constantChars, 0);
  const total = base + extra;
  const tier = contextTier.get(roleId) ?? 2;
  const current = TIERS.find((t) => t.tier === tier) ?? TIERS[1];
  const rec = TIERS.find((t) => total <= t.tokens * 0.35) ?? null;
  return {
    baseConstantChars: base, enabledWorkshopConstantChars: extra, totalConstantChars: total, items,
    currentContextTier: current.tier, currentContextTokens: current.tokens,
    recommendedContextTier: rec?.tier ?? null, recommendedContextTokens: rec?.tokens ?? null,
    currentTierSufficient: !!rec && current.tier >= rec.tier, requestFits: total <= current.tokens * 0.8,
    highestAvailableTokens: TIERS.at(-1).tokens, recommendationReason: rec ? "ok" : "no_fitting_recommendation",
  };
}
function mineItems() {
  if (mine) return mine;
  const base = (id, name, status, extra = {}) => ({ ...summary({ ...SEED[0], id, name }, "c-demo", false, false), card: { id: "c-demo", num: 100001, name: "霧港燈塔", roleId: "role-demo" }, status, rejectNote: null, ownerState: "visible", ownerReason: null, appeal: null, ...extra });
  mine = [
    base("m1", "雪夜篇：燈塔守望者", "live"),
    base("m2", "航海日誌介面", "live_changed"),
    base("m3", "港口商會擴充設定", "pending", { version: 0 }),
    base("m4", "暗潮支線", "rejected", { version: 0, rejectNote: "介面規則的內容超出分級，請調整後再送審。" }),
    base("m5", "霧鐘音效標記", "live", { ownerState: "returned", ownerReason: "介面規則會蓋掉原卡的狀態列，請改成只在日誌區塊顯示。" }),
    base("m6", "夜航", "live", { ownerState: "hidden", ownerReason: "跟主線劇情衝突，先不開放新玩家加入。", appeal: "pending" }),
    base("m7", "新的草稿", "draft", { version: 0, coverUrl: "" }),
  ];
  return mine;
}
function emptyDraft(id, roleId) {
  return {
    workshopId: id, revision: 1, card: { roleId, cardId: "c-demo", num: 100001, name: "霧港燈塔", ownerIsMe: owner() },
    name: "", summary: "", readme: "", coverUrl: "", rating: null, ratingAnswers: null, worldbook: [],
    rules: { version: 1, rules: [], statusbar: "", lowered: false }, opening: { mode: "greeting", welcome: "", alternates: [], prologue: [], openingPage: "" },
    updateNote: "", published: null, changedSincePublish: false,
  };
}
function draftFor(id) {
  if (drafts.has(id)) return drafts.get(id);
  const m = mineItems().find((x) => x.id === id);
  const d = emptyDraft(id, "role-demo");
  if (m) Object.assign(d, { name: m.name, summary: m.summary, coverUrl: m.coverUrl, rating: "G", published: m.version ? { version: m.version } : null, changedSincePublish: m.status === "live_changed", worldbook: [{ name: "燈塔", content: "燈塔在港口北側，冬天會亮整夜。", keywords: ["燈塔"], secondaryKeywords: [], isEnabled: true, isConstant: true }] });
  drafts.set(id, d);
  return d;
}

export async function handleWorkshop({ m, path, url, body, req, json, res }) {
  const signedIn = (req.headers.authorization || "").startsWith("Bearer ");
  let mm;
  if (path === "/__workshop") { scenario = url.searchParams.get("scenario") ?? ""; mine = null; if (scenario === "closed" || scenario === "no-tab") allowNew = false; else allowNew = true; return json(res, 200, { scenario }), true; }
  if (path === "/__workshop/reset") { reset(); return json(res, 200, { ok: true }), true; }

  // ---- 本站 ----
  if (m === "GET" && (mm = path.match(/^\/v1\/cards\/([^/]+)\/workshop$/))) {
    if (scenario === "error") return json(res, 500, { error: "internal" }), true;
    const cardId = decodeURIComponent(mm[1]);
    const sort = url.searchParams.get("sort") === "new" ? "new" : "hot";
    const viewerIsOwner = owner() && signedIn;
    let list = seeded().filter((w) => viewerIsOwner || ownerOf(w.id).state === "visible");
    list = [...list].sort((a, b) => sort === "hot" ? b.joinCount - a.joinCount : a.id < b.id ? 1 : -1);
    const joined = joinedIds();
    const items = list.map((w) => summary(w, cardId, viewerIsOwner, joined.has(w.id)));
    const tabVisible = !(scenario === "no-tab");
    return json(res, 200, { tabVisible, allowNew: !isClosed(), viewerIsOwner, total: items.length, page: 1, hasMore: false, items }), true;
  }
  if (m === "GET" && path === "/v1/workshops") {
    const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
    return json(res, 200, { items: SEED.filter((w) => ids.includes(w.id)).map((w) => summary(w, "", false, true)) }), true;
  }
  if ((mm = path.match(/^\/v1\/workshops\/([^/]+)\/comments(?:\/([^/]+)\/replies)?$/))) {
    const id = mm[1]; const list = comments.get(id) ?? [];
    if (m === "POST") { const c = { commentId: `wc-${seq++}`, content: body.content, createTime: Date.now(), userName: "測試玩家", likeCount: 0, liked: false, replyCount: 0, mine: true }; list.unshift(c); comments.set(id, list); return json(res, 200, { commentId: c.commentId, status: "visible" }), true; }
    if (mm[2]) return json(res, 200, { total: 0, replies: [] }), true;
    return json(res, 200, { total: list.length, comments: list, isRoleCreator: false }), true;
  }
  if (m === "GET" && (mm = path.match(/^\/v1\/workshops\/([^/]+)\/versions$/))) {
    const w = SEED.find((x) => x.id === mm[1]);
    const v = VERSIONS[mm[1]] ?? (w ? Array.from({ length: w.version }, (_, i) => [w.version - i, i === w.version - 1 ? "首次上架。" : "修正錯字。"]) : []);
    return json(res, 200, { items: v.map(([version, note], i) => ({ version, note, publishedAt: now - (i + 1) * 9 * DAY })), hasMore: false }), true;
  }
  if (m === "GET" && (mm = path.match(/^\/v1\/workshops\/([^/]+)$/))) {
    const w = SEED.find((x) => x.id === mm[1]);
    if (!w) return json(res, 404, { error: "not_found" }), true;
    const joined = [...selections.values()].some((s) => s.items.some((i) => i.workshopId === w.id));
    const o = ownerOf(w.id);
    const availability = joined ? "open" : o.state !== "visible" ? "hidden" : "open";
    return json(res, 200, {
      ...summary(w, "c-demo", false, joined), readme: `## ${w.name}\n\n${w.summary}\n\n- 新增地點：北港燈塔\n- 新增角色：守塔人`,
      commentCount: (comments.get(w.id) ?? []).length,
      card: { id: "c-demo", num: 100001, name: "霧港燈塔", avatarUrl: cover(3), roleId: "role-100001", provider: "harbor" },
      contents: { loreCount: w.lore, ruleCount: w.rules, openingCount: w.openings }, residentChars: w.residentChars, availability,
    }), true;
  }
  if (path.startsWith("/v1/me/workshop") && !signedIn) return json(res, 401, { error: "unauthorized" }), true;
  if (m === "GET" && path === "/v1/me/workshops") return json(res, 200, { items: scenario === "empty" ? [] : mineItems() }), true;
  if (m === "GET" && path === "/v1/me/workshop-cards") {
    const q = (url.searchParams.get("q") ?? "").trim();
    const items = [
      { cardId: "c-demo", num: 100001, name: "霧港燈塔", avatarUrl: cover(3), author: { name: "霧港" }, roleId: "role-demo", allowNew: true },
      { cardId: "c-2", num: 100002, name: "星砂旅店", avatarUrl: cover(5), author: { name: "Kai" }, roleId: "role-2", allowNew: true },
      { cardId: "c-3", num: 100003, name: "封閉的圖書館", avatarUrl: cover(9), author: { name: "鹽與帆" }, roleId: "role-3", allowNew: false },
    ].filter((c) => !q || c.name.includes(q) || String(c.num).includes(q));
    return json(res, 200, { items }), true;
  }
  if (m === "POST" && (mm = path.match(/^\/v1\/me\/workshops\/([^/]+)\/(submit|withdraw)$/))) {
    const item = mineItems().find((x) => x.id === mm[1]);
    const d = drafts.get(mm[1]);
    if (mm[2] === "submit") {
      if (d && !d.coverUrl) return json(res, 400, { error: "cover_required" }), true;
      const next = item?.version ? "live_pending" : "pending";
      if (item) { item.status = next; if (item.ownerState === "returned") item.ownerState = "returned"; }
      return json(res, 200, { status: next }), true;
    }
    if (item) item.status = item.version ? "live_changed" : "draft";
    return json(res, 200, { status: item?.status ?? "draft" }), true;
  }

  // ---- Provider ----
  if (!path.startsWith("/open/v1/workshop") && path !== "/open/v1/player/role-settings/save") return false;
  if (!signedIn) return json(res, 401, { error: "unauthorized" }), true;
  const roleId = url.searchParams.get("roleId") ?? body.roleId ?? "";
  if (path === "/open/v1/player/role-settings/save") { if (body.context) contextTier.set(roleId, Number(body.context)); return json(res, 200, { ok: true }), true; }
  if (path === "/open/v1/workshop/selection") return json(res, 200, selectionView(roleId)), true;
  if (path === "/open/v1/workshop/install") {
    const w = SEED.find((x) => x.id === body.workshopId);
    if (!w) return json(res, 404, { error: "workshop_unavailable" }), true;
    const s = selectionOf(roleId);
    if (!s.items.some((i) => i.workshopId === w.id)) { s.items.push({ workshopId: w.id, enabled: true }); s.revision++; }
    return json(res, 200, selectionView(roleId)), true;
  }
  if (path === "/open/v1/workshop/uninstall") { const s = selectionOf(roleId); s.items = s.items.filter((i) => i.workshopId !== body.workshopId); s.revision++; return json(res, 200, selectionView(roleId)), true; }
  if (path === "/open/v1/workshop/selection/save") {
    const s = selectionOf(roleId);
    if (body.expectedRevision !== s.revision) return json(res, 409, { error: "selection_stale" }), true;
    s.items = body.items.map((i) => ({ ...s.items.find((x) => x.workshopId === i.workshopId), workshopId: i.workshopId, enabled: !!i.enabled })); s.revision++;
    return json(res, 200, selectionView(roleId)), true;
  }
  if (path === "/open/v1/workshop/usage-summary") return json(res, 200, usage(roleId)), true;
  if (path === "/open/v1/workshop/policy" || path === "/open/v1/workshop/policy/save") {
    if (path.endsWith("/save")) { allowNew = !!body.allowNew; policyRevision++; }
    const items = (scenario === "no-tab" || scenario === "owner-empty") ? [] : SEED.map((w) => summary(w, "c-demo", true, false));
    return json(res, 200, { allowNew, revision: policyRevision, items }), true;
  }
  if (path === "/open/v1/workshop/owner-action") {
    const o = { ...ownerOf(body.workshopId) };
    if (body.action !== "restore" && !String(body.reason ?? "").trim()) return json(res, 400, { error: "invalid_argument" }), true;
    if (body.action === "return") Object.assign(o, { state: "returned", reason: body.reason });
    else if (body.action === "hide") Object.assign(o, { state: "hidden", reason: body.reason });
    else Object.assign(o, { state: "visible", reason: null });
    ownerStates.set(body.workshopId, o);
    return json(res, 200, { ownerState: o.state, ownerReason: o.reason }), true;
  }
  if (path === "/open/v1/workshop/appeal") { const item = mineItems().find((x) => x.id === body.workshopId); if (item) item.appeal = "pending"; return json(res, 200, { appeal: "pending" }), true; }
  if (path === "/open/v1/workshop/create") {
    if (isClosed()) return json(res, 403, { error: "workshop_closed" }), true;
    const id = `m${seq++}`; drafts.set(id, emptyDraft(id, body.roleId));
    mineItems().unshift({ ...summary({ ...SEED[0], id, name: "" }, "c-demo", false, false), coverUrl: "", version: 0, card: { id: "c-demo", num: 100001, name: "霧港燈塔", roleId: body.roleId }, status: "draft", rejectNote: null, ownerState: "visible", ownerReason: null, appeal: null });
    return json(res, 200, { workshopId: id }), true;
  }
  if (path === "/open/v1/workshop/draft") return json(res, 200, draftFor(url.searchParams.get("workshopId"))), true;
  if (path === "/open/v1/workshop/draft/save") {
    const d = draftFor(body.workshopId);
    if (body.expectedRevision !== d.revision) return json(res, 409, { error: "draft_stale" }), true;
    const { workshopId, expectedRevision, idempotencyKey, ...fields } = body;
    Object.assign(d, fields, { revision: d.revision + 1, changedSincePublish: !!d.published });
    const item = mineItems().find((x) => x.id === workshopId);
    if (item) { item.name = d.name; item.coverUrl = d.coverUrl; if (item.status === "live") item.status = "live_changed"; }
    const chars = d.worldbook.filter((e) => e.isEnabled && e.isConstant).reduce((n, e) => n + Array.from(e.content ?? "").length, 0);
    return json(res, 200, { revision: d.revision, errors: chars > 1500 ? [{ code: "constant_char_limit", actual: chars, max: 1500, unit: "unicode_code_points" }] : [] }), true;
  }
  if (path === "/open/v1/workshop/delete") { drafts.delete(body.workshopId); mine = mineItems().filter((x) => x.id !== body.workshopId); return json(res, 200, { ok: true }), true; }
  return json(res, 404, { error: "not_found" }), true;
}
