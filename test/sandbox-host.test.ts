/**
 * 沙箱子網域（c<roleId>.hearthroom.club）：只出殼頁與它的 js/css、補 CSP 與 frame-ancestors；其餘 404。
 * 殼沒建進資源層（拿到主站的 index.html）時回 503，不讓主站的頁冒充殼。
 */
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { envWithAssets } from "./helpers";
import { isSandboxHost, sandboxRoleIdOf } from "../src/sandbox";
import { isSelfHost } from "../src/site";

const SHELL = "<!doctype html><html><head><title>chat sandbox</title></head><body><div id=\"app\"></div></body></html>";
// 真資源層對 /sandbox/index.html 回 3xx 到 /sandbox/，所以殼頁只掛在目錄路徑上；index.html 路徑故意給 302，
// Worker 若走錯路徑就會拿到非 200 而 503。
const testEnv = envWithAssets({
  "/sandbox/index.html": new Response(null, { status: 302, headers: { location: "/sandbox/" } }),
  "/sandbox/": new Response(SHELL, { headers: { "content-type": "text/html; charset=utf-8", etag: '"x"' } }),
  "/sandbox/sandbox.js": new Response("console.log(1)", { headers: { "content-type": "text/javascript; charset=utf-8" } }),
  "/sandbox/sandbox.css": new Response("body{}", { headers: { "content-type": "text/css; charset=utf-8" } }),
});

async function get(url: string, e = testEnv) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("沙箱子網域", () => {
  it("判式：c<roleId>.hearthroom.club 算沙箱主機、也算自己人；主站與別的子網域不算", () => {
    expect(isSandboxHost("c320396.hearthroom.club")).toBe(true);
    expect(sandboxRoleIdOf("c320396.hearthroom.club")).toBe("320396");
    expect(isSandboxHost("hearthroom.club")).toBe(false);
    expect(isSandboxHost("www.hearthroom.club")).toBe(false);
    expect(isSandboxHost("c1.evil.test")).toBe(false);
    expect(isSelfHost("c1.hearthroom.club")).toBe(true);
  });

  it("/sandbox/ 出殼頁並補 CSP、frame-ancestors、no-cache；js/css 帶自己的 content-type", async () => {
    const page = await get("https://c1.hearthroom.club/sandbox/");
    expect(page.status).toBe(200);
    expect((await get("https://c1.hearthroom.club/sandbox/index.html")).status).toBe(200);
    expect(await page.text()).toContain("<title>chat sandbox</title>");
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors https://hearthroom.club https://www.hearthroom.club");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' https:");
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(page.headers.get("etag")).toBe('"x"');
    const js = await get("https://c1.hearthroom.club/sandbox/sandbox.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(js.headers.get("content-security-policy")).toContain("frame-ancestors");
    // 部署後不能配到舊殼：js/css 也每次重新驗證
    expect(js.headers.get("cache-control")).toBe("no-cache");
    const css = await get("https://c1.hearthroom.club/sandbox/sandbox.css");
    expect(css.headers.get("content-type")).toContain("css");
  });

  it("沙箱子網域上其餘路徑一律 404：主站不在別的源上多一個鏡像", async () => {
    for (const path of ["/", "/cards/x", "/v1/cards", "/assets/a.js", "/sandbox/other.js"]) {
      expect((await get(`https://c1.hearthroom.club${path}`)).status, path).toBe(404);
    }
  });

  it("殼沒建進資源層（SPA 回退給了主站的 index.html）→ 503，不把主站頁當殼出去", async () => {
    const spa = envWithAssets({ "/sandbox/": new Response("<!doctype html><title>Hearthroom</title>", { headers: { "content-type": "text/html" } }), "/sandbox/sandbox.js": new Response("<!doctype html>", { headers: { "content-type": "text/html" } }) });
    expect((await get("https://c1.hearthroom.club/sandbox/", spa)).status).toBe(503);
    expect((await get("https://c1.hearthroom.club/sandbox/sandbox.js", spa)).status).toBe(503);
  });

  it("主站網域上的 /sandbox/ 不受影響（照 SPA 規則）", async () => {
    const res = await get("https://hearthroom.club/sandbox/");
    expect(res.status).not.toBe(404);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});

it("validates the current shell before returning a bodyless 304 for matching weak/list ETags", async () => {
  for (const tag of ['"x"', 'W/"x"', '"old", W/"x"', '*']) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://c1.hearthroom.club/sandbox/", {headers: {"If-None-Match": tag}}), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("etag")).toBe('"x"');
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  }
});

it("does not reuse a stale shell or mask the SPA fallback with a 304", async () => {
  for (const [e, tag, status] of [[testEnv, '"old"', 200], [envWithAssets({}, {etag: '"x"'}), '"x"', 503]] as const) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://c1.hearthroom.club/sandbox/", {headers: {"If-None-Match": tag}}), e, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(status);
  }
});
