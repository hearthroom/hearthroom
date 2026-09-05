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
const roles = new Map(); const books = new Map(); const bindings = new Map(); const entries = new Map();
let seq = 1; const id = (p) => `${p}-${seq++}`;
const log = [];
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://x`); const path = url.pathname; const m = req.method;
  if (m === "OPTIONS") return json(res, 204, {});
  const raw = await readBody(req); let body = {}; try { body = raw.length && !path.includes("/image/upload") ? JSON.parse(raw.toString()) : {}; } catch {}
  log.push({ m, path, body }); if (path !== "/__log") console.log(m, path, JSON.stringify(body).slice(0, 160));
  if (path === "/__log") return json(res, 200, log);
  if (path.startsWith("/fixtures/")) { const f = pathMod.join(CARDS, path.slice(10)); if (!fs.existsSync(f)) return json(res, 404, {}); res.writeHead(200, { "content-type": f.endsWith(".png") ? "image/png" : "application/json", "access-control-allow-origin": "*" }); return res.end(fs.readFileSync(f)); }
  if (path === "/__reset") { roles.clear(); books.clear(); bindings.clear(); entries.clear(); log.length = 0; return json(res, 200, { ok: true }); }
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return json(res, 401, { error: "unauthorized", message: "A valid bearer token is required." });
  if (path === "/open/v1/me") return json(res, 200, { accountNumId: 424242, nickName: "測試作者", avatar: "" });
  if (path === "/open/v1/tag/canonical") return json(res, 200, { language: url.searchParams.get("language"), dimensions: [
    { dimension: "genre", tags: [{ slug: "romance", name: "戀愛", dimension: "genre", visibility: "public" }, { slug: "mystery", name: "推理", dimension: "genre", visibility: "public" }, { slug: "fantasy", name: "西幻", dimension: "genre", visibility: "public" }] },
    { dimension: "setting", tags: [{ slug: "campus", name: "校園", dimension: "setting", visibility: "public" }, { slug: "frontier", name: "邊境", dimension: "setting", visibility: "public" }] },
  ] });
  if (path === "/open/v1/me/wallet") return json(res, 200, { score: 999596, tempScore: 0, plans: [{ tier: "member", expiresAt: Date.now() + 86400e3 * 30 }] });
  if (m === "POST" && path === "/open/v1/role") { const roleId = id("role"); roles.set(roleId, { roleId, roleName: body.roleName, language: body.language, visibility: "private" }); return json(res, 200, { roleId }); }
  let mm;
  if (m === "POST" && (mm = path.match(/^\/open\/v1\/role\/([^/]+)\/document$/))) { Object.assign(roles.get(mm[1]) ?? roles.set(mm[1], {}).get(mm[1]), body.fields ?? body); return json(res, 200, { ok: true }); }
  if (m === "PATCH" && (mm = path.match(/^\/open\/v1\/role\/([^/]+)\/welcome$/))) { const r = roles.get(mm[1]); Object.assign(r, { roleWelcome: body.roleWelcome, roleWelcomeAlternates: body.alternates, rolePrologue: body.prologue }); return json(res, 200, { ok: true }); }
  if (m === "POST" && (mm = path.match(/^\/open\/v1\/role\/([^/]+)\/publish$/))) return json(res, 200, { status: "pending" });
  if (path === "/open/v1/role/detail") { const r = roles.get(url.searchParams.get("roleId")); return r ? json(res, 200, { ...r, talkExample: JSON.stringify(r.talkExample ?? []) }) : json(res, 404, { error: "not_found" }); }
  if (path === "/open/v1/role/validate") return json(res, 200, { status: "ok", blockers: [], warnings: [], tokenBudget: { limits: { roleDescMaxChars: 300, roleDetailDescMaxChars: 6000, roleWelcomeMaxChars: 2000, roleOutputContractMaxChars: 2000, jailbreakMaxChars: 1200 } } });
  if (path === "/open/v1/image/upload") return json(res, 200, { data: { imageUrl: `http://127.0.0.1:${PORT}/img/${id("img")}.png` } });
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
  if (path.startsWith("/img/")) { res.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" }); return res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")); }
  json(res, 404, { error: "not_found", path });
}).listen(PORT, () => console.log("mock upstream on", PORT));
