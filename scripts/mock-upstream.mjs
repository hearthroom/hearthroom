/**
 * 假的上游（api.lunatalk.ai 的替身），只給本機開發建卡編輯器用。
 *
 * 建卡頁在 OAuth 後面，本機沒辦法走真的登入；這支腳本把編輯器會打到的上游端點全部用記憶體
 * 頂起來，前端只要把 VITE_LUNATALK_API_BASE 指過來、再往 localStorage 塞一組假 token：
 *
 *   node scripts/mock-upstream.mjs                      # :8899
 *   VITE_LUNATALK_API_BASE=http://127.0.0.1:8899 npm run dev:web
 *   localStorage.setItem("hearthroom.oauth.access", JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 3600e3 }))
 *
 * 任何 Bearer token 都算登入。資料只在記憶體，重啟就沒。/__log 看收到的請求，/__reset 清空，
 * /fixtures/<檔名> 提供 FIXTURES_DIR 底下的檔案（放幾張酒館卡進去就能在瀏覽器裡測匯入）。
 * 回應形狀照 web/src/lib/api.ts 讀的那樣寫，改了 api.ts 記得同步。
 */
import http from "node:http";
import fs from "node:fs";
import pathMod from "node:path";
const CARDS = process.env.FIXTURES_DIR || new URL("./fixtures/", import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8899);
const images = new Map(); const folders = new Map(); let imgSeq = 1;
const roles = new Map(); const regex = new Map(); const books = new Map(); const bindings = new Map(); const entries = new Map();
let seq = 1; const id = (p) => `${p}-${seq++}`;
const log = [];
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://x`); const path = url.pathname; const m = req.method; let mm;
  if (m === "OPTIONS") return json(res, 204, {});
  const raw = await readBody(req); let body = {}; try { body = raw.length && !path.includes("/image/upload") ? JSON.parse(raw.toString()) : {}; } catch {}
  log.push({ m, path, body }); if (path !== "/__log") console.log(m, path, JSON.stringify(body).slice(0, 160));
  if (path === "/__log") return json(res, 200, log);
  if (path.startsWith("/fixtures/")) { const f = pathMod.join(CARDS, path.slice(10)); if (!fs.existsSync(f)) return json(res, 404, {}); res.writeHead(200, { "content-type": f.endsWith(".png") ? "image/png" : "application/json", "access-control-allow-origin": "*" }); return res.end(fs.readFileSync(f)); }
  if (path === "/__reset") { roles.clear(); regex.clear(); books.clear(); bindings.clear(); entries.clear(); log.length = 0; return json(res, 200, { ok: true }); }
  // 圖片本體是公開網址，<img> 不會帶 Bearer：放在鑑權前面
  if (path.startsWith("/img/")) { const n = parseInt(path.slice(5), 10); if (!path.endsWith(".png")) { res.writeHead(200, { "content-type": "application/octet-stream", "access-control-allow-origin": "*" }); return res.end(Buffer.alloc(16)); } res.writeHead(200, { "content-type": "image/svg+xml", "access-control-allow-origin": "*" }); return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768"><rect width="100%" height="100%" fill="hsl(${(n * 47) % 360} 60% 70%)"/><text x="50%" y="50%" font-size="64" text-anchor="middle" fill="#fff">${n}</text></svg>`); }
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return json(res, 401, { error: "unauthorized", message: "A valid bearer token is required." });
  if (path === "/open/v1/me") return json(res, 200, { accountNumId: 424242, nickName: "測試作者", avatar: "" });
  if (path === "/open/v1/tag/canonical") return json(res, 200, { language: url.searchParams.get("language"), dimensions: [
    { dimension: "genre", tags: [{ slug: "romance", name: "戀愛", dimension: "genre", visibility: "public" }, { slug: "mystery", name: "推理", dimension: "genre", visibility: "public" }, { slug: "fantasy", name: "西幻", dimension: "genre", visibility: "public" }] },
    { dimension: "setting", tags: [{ slug: "campus", name: "校園", dimension: "setting", visibility: "public" }, { slug: "frontier", name: "邊境", dimension: "setting", visibility: "public" }] },
  ] });
  // 作者資產（正則規則 + 功能欄）：形狀照 server 的 authorAssetResponse
  if (m === "GET" && path === "/open/v1/role/author-asset") { const a = regex.get(url.searchParams.get("roleId")); return json(res, 200, a ?? { rules: [], mountTrigger: "", mountLayer: "", pageMode: "classic", status: "none", version: 0 }); }
  if (m === "PUT" && (mm = path.match(/^\/open\/v1\/role\/([^/]+)\/author-asset$/))) { const cur = regex.get(mm[1]); const have = cur ? cur.version : 0; if ((body.version ?? 0) !== have) return json(res, 409, { error: "version_conflict" }); if (!["under", "over", "cover", ""].includes(body.mountLayer ?? "")) return json(res, 400, { error: "validate_reject" }); const a = { rules: body.rules ?? [], mountTrigger: body.mountTrigger ?? "", mountLayer: body.mountLayer || "over", pageMode: body.pageMode || "classic", status: "passed", version: have + 1 }; regex.set(mm[1], a); return json(res, 200, a); }
  // ── 舞台（Moonstage）在本機也能開：模型清單讀 fixtures/models.json（從正式站抓一份裁過的），其餘給最小形狀 ──
  if (path === "/open/v1/models") { const f = pathMod.join(CARDS, "models.json"); return fs.existsSync(f) ? (res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }), res.end(fs.readFileSync(f))) : json(res, 200, []); }
  if (path === "/open/v1/player/role-settings") return json(res, 200, { roleId: url.searchParams.get("roleId"), context: 1, selectModel: "kiro-claude-sonnet-4-5-ripple", selectModelName: "kiro-claude-sonnet-4-5-ripple", thinkingDepth: "", userName: "", userSex: "", userDefine: "", sandboxLevel: "", autoCompactEnabled: true, permanentMemory: false, multiPassEnabled: false, showAll: false, backgroundUrl: "" });
  if (m === "POST" && path === "/open/v1/player/role-settings/save") return json(res, 200, { ok: true });
  if (path === "/open/v1/player/agent-mode") return json(res, 200, { roleId: url.searchParams.get("roleId"), runtimeEnabled: true, modelSupported: false, multiPassEnabled: false, costWarning: false });
  if (path === "/open/v1/role/author-asset/serve") return json(res, 200, { rules: [], mountTrigger: "", mountLayer: "", pageMode: "classic", status: "none", version: 0, variants: {} });
  if (m === "POST" && path === "/open/v1/conversation/start") { const r = roles.get(body.roleId) || {}; return json(res, 200, { conversationId: "conv-1", defaultRelay: r.roleWelcome || "你好，這是本機假上游的開場白。", isNew: true, roleInfo: { roleId: r.roleId, roleName: r.roleName, roleAvatar: r.roleAvatar || "" }, historyConversation: null }); }
  if (path === "/open/v1/conversation/messages") return json(res, 200, { list: [], hasMore: false });
  if (path === "/open/v1/conversation/archives") return json(res, 200, { archives: [{ conversationId: "conv-1", title: "", lastMessage: "開場白", messageCount: 1, isCurrent: true, createTime: "2026-09-06T08:49:57Z", lastUpdateTime: "2026-09-06T08:49:57Z" }], count: 1, limit: 20 });
  if (path === "/open/v1/conversation/directives") return json(res, 200, { list: [], max: 10 });
  if (path === "/open/v1/conversation/notepad") return json(res, 200, { content: "", maxLength: 10000 });
  if (path === "/open/v1/notepad/templates") return json(res, 200, { list: [], maxCount: 50, maxLength: 10000, maxTitle: 40 });
  if (path === "/open/v1/conversation/ws-ticket") return json(res, 200, { ticket: "t-1", expiresIn: 60 });
  if (path.startsWith("/open/v1/conversation/memory")) return json(res, 200, { atoms: [] });
  if (path === "/open/v1/role/multiPassPreference" || path === "/open/v1/player/multi-pass") return json(res, 200, {});
  if (path === "/open/v1/me/wallet") return json(res, 200, { score: 999596, tempScore: 0, plans: [{ tier: "member", expiresAt: Date.now() + 86400e3 * 30 }] });
  if (m === "POST" && path === "/open/v1/role") { const roleId = id("role"); roles.set(roleId, { roleId, roleName: body.roleName, language: body.language, visibility: "private" }); return json(res, 200, { roleId }); }
  if (m === "POST" && (mm = path.match(/^\/open\/v1\/role\/([^/]+)\/document$/))) { Object.assign(roles.get(mm[1]) ?? roles.set(mm[1], {}).get(mm[1]), body.fields ?? body); return json(res, 200, { ok: true }); }
  if (m === "PATCH" && (mm = path.match(/^\/open\/v1\/role\/([^/]+)\/welcome$/))) { const r = roles.get(mm[1]); Object.assign(r, { roleWelcome: body.roleWelcome, roleWelcomeAlternates: body.alternates, rolePrologue: body.prologue }); return json(res, 200, { ok: true }); }
  if (m === "POST" && (mm = path.match(/^\/open\/v1\/role\/([^/]+)\/publish$/))) return json(res, 200, { status: "pending" });
  if (path === "/open/v1/role/detail") { const r = roles.get(url.searchParams.get("roleId")); return r ? json(res, 200, { ...r, talkExample: JSON.stringify(r.talkExample ?? []) }) : json(res, 404, { error: "not_found" }); }
  if (path === "/open/v1/role/validate") return json(res, 200, { status: "ok", blockers: [], warnings: [], tokenBudget: { limits: { roleDescMaxChars: 300, roleDetailDescMaxChars: 6000, roleWelcomeMaxChars: 2000, roleOutputContractMaxChars: 2000, jailbreakMaxChars: 1200 } } });
  if (path === "/open/v1/image/upload") { const imageId = imgSeq++; const text = raw.toString("latin1"); const folderIds = [...text.matchAll(/name="folderIds"\r\n\r\n([^\r]+)/g)].map((x) => x[1]); const fname = (text.match(/filename="([^"]*)"/) || [])[1] || "a.png"; const ext = (fname.match(/\.([a-z0-9]+)$/i) || [, "png"])[1].toLowerCase(); const kind = /^(mp4|webm)$/.test(ext) ? "video" : /^(mp3|wav|ogg)$/.test(ext) ? "audio" : /^(woff2?|ttf|otf)$/.test(ext) ? "font" : "image"; const url = `http://127.0.0.1:${PORT}/img/${imageId}.${ext}`; images.set(imageId, { id: imageId, imageUrl: url, kind, mimeType: "", byteSize: raw.length, moderationState: kind === "image" ? "pending" : "unreviewed", pixelWidth: kind === "image" ? 512 : 0, pixelHeight: kind === "image" ? 768 : 0, createTime: new Date().toISOString(), folders: new Set(folderIds) }); return json(res, 200, { data: { imageId, imageUrl: url, kind, byteSize: raw.length, moderationState: "pending" } }); }
  // ── 素材圖庫：記憶體裡的圖與資料夾，形狀照 server 的 creatorImageOK({code, data}) ──
  if (path === "/open/v1/image/list") { const scope = url.searchParams.get("scope") || "all"; const fid = url.searchParams.get("folderId"); const kind = url.searchParams.get("kind") || "image"; let all = [...images.values()].sort((a, b) => b.id - a.id); if (kind !== "all") all = all.filter((i) => i.kind === kind); const usedBytes = [...images.values()].reduce((n, i) => n + i.byteSize, 0); if (scope === "unfiled") all = all.filter((i) => !i.folders.size); if (scope === "folder") all = all.filter((i) => i.folders.has(fid)); const n = Number(url.searchParams.get("pageNum") || 1), sz = Number(url.searchParams.get("pageSize") || 50); return json(res, 200, { code: 0, data: { total: all.length, quota: 10000, usedBytes, byteQuota: 500 << 20, imageList: all.slice((n - 1) * sz, n * sz).map(({ folders: _f, ...i }) => i) } }); }
  if (path === "/open/v1/image/folder/list") return json(res, 200, { code: 0, data: { folders: [...folders.values()].map((f) => ({ ...f, imageCount: [...images.values()].filter((i) => i.folders.has(f.folderId)).length })) } });
  if (m === "POST" && path === "/open/v1/image/folder/create") { if ([...folders.values()].some((f) => f.name === body.name)) return json(res, 400, { error: "duplicate_name" }); const folderId = id("folder"); folders.set(folderId, { folderId, name: body.name, sortOrder: folders.size }); return json(res, 200, { code: 0, data: { folderId, name: body.name } }); }
  if (m === "POST" && path === "/open/v1/image/folder/rename") { const f = folders.get(body.folderId); if (!f) return json(res, 404, { error: "not_found" }); f.name = body.name; return json(res, 200, { code: 0, data: {} }); }
  if (m === "POST" && path === "/open/v1/image/folder/delete") { folders.delete(body.folderId); for (const i of images.values()) i.folders.delete(body.folderId); return json(res, 200, { code: 0, data: {} }); }
  if (m === "POST" && path === "/open/v1/image/folder/addItems") { for (const iid of body.imageIds ?? []) images.get(iid)?.folders.add(body.folderId); return json(res, 200, { code: 0, data: {} }); }
  if (m === "POST" && path === "/open/v1/image/folder/removeItems") { for (const iid of body.imageIds ?? []) images.get(iid)?.folders.delete(body.folderId); return json(res, 200, { code: 0, data: {} }); }
  if (m === "POST" && path === "/open/v1/image/delete") { if ((body.imageIds ?? []).includes(1)) return json(res, 400, { error: "image_in_use", imageUrls: [] }); for (const iid of body.imageIds ?? []) images.delete(iid); return json(res, 200, { code: 0, data: {} }); }
  if (path === "/open/v1/worldbook/bindings") { const ids = bindings.get(url.searchParams.get("roleId")) ?? []; return json(res, 200, { bindings: ids.map((b) => books.get(b)) }); }
  if (path === "/open/v1/worldbook/mine") return json(res, 200, { worldbooks: [...books.values()] });
  if (m === "POST" && path === "/open/v1/worldbook") { const worldbookId = id("wb"); books.set(worldbookId, { worldbookId, name: body.name, language: body.language }); entries.set(worldbookId, []); return json(res, 200, { worldbookId }); }
  if (m === "POST" && (mm = path.match(/^\/open\/v1\/worldbook\/([^/]+)\/document$/))) {
    const list = entries.get(mm[1]) ?? entries.set(mm[1], []).get(mm[1]);
    for (const op of body.entries ?? []) { if (op.op === "create") list.push({ ...op, entryId: id("e"), op: undefined }); else if (op.op === "update") Object.assign(list.find((e) => e.entryId === op.entryId) ?? {}, op, { op: undefined }); else if (op.op === "delete") { const i = list.findIndex((e) => e.entryId === op.entryId); if (i >= 0) list.splice(i, 1); } }
    if (body.binding?.roleId) bindings.set(body.binding.roleId, [...(bindings.get(body.binding.roleId) ?? []), mm[1]]);
    return json(res, 200, { ok: true });
  }
  if (path === "/open/v1/worldbook/entry/list") return json(res, 200, { list: (entries.get(url.searchParams.get("worldbookId")) ?? []).map((e, i) => ({ ...e, keywords: JSON.stringify(e.keywords ?? []), secondaryKeywords: JSON.stringify(e.secondaryKeywords ?? []), activationCount: i * 3 })) });
  json(res, 404, { error: "not_found", path });
}).listen(PORT, () => console.log("mock upstream on", PORT));
