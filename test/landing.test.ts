/**
 * 首頁把第一屏的榜單放進 HTML（新訪客冷開原本要等主程式跑完再讀榜，約多 0.5 s），
 * 第一張卡的縮圖也先叫瀏覽器下載。作者寫的字要跳脫，關不掉 <script>。
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import worker, { boardCache } from "../src/index";
import { envWithAssets, resetDb, restoreUpstream, rolesOnProviders, role } from "./helpers";
import { upsertCard } from "../src/cards";
import { cardThumbUrl } from "../shared/card-thumb";
import { PRIMARY_HOST } from "../shared/site-hosts";

const testEnv = envWithAssets({});
async function page(url: string, headers: Record<string, string> = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url, { headers }), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return { res, html: await res.text() };
}
const inline = (html: string) => {
  const m = /<script id="board-inline" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  return m ? JSON.parse(m[1]!) : null;
};

beforeEach(async () => {
  await resetDb();
  rolesOnProviders({});
  await upsertCard(env.DB, role({ roleId: "r-1", name: "夜行偵探", desc: "雨夜的上海。</script><script>alert(1)</script>", authorNumId: 7, authorName: "月光" }), Date.now());
});
afterEach(restoreUpstream);

it("首頁的 HTML 帶著第一屏的榜單與第一張縮圖的 preload；沒有 cookie 就是一般版本、不進快取", async () => {
  const { res, html } = await page("https://hearthroom.club/");
  expect(res.status).toBe(200);
  const data = inline(html);
  expect(data.query).toEqual({ zone: "zh", lang: "zh", sort: "day", offset: 0 });
  expect(data.page.items.map((i: { name: string }) => i.name)).toEqual(["夜行偵探"]);
  expect(data.page.adult).toBe(false);
  const thumb = cardThumbUrl(PRIMARY_HOST, data.page.items[0].avatarUrl);
  expect(thumb).not.toBeNull();
  // 先下載但不搶主程式的頻寬（慢網路上動圖可能上 MB）
  expect(html).toContain(`<link rel="preload" as="image" href="${thumb}">`);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(html).toContain('<div id="app"></div>');
});

it("作者寫的 </script> 關不掉那一段：原樣留在資料裡，HTML 裡找不到它", async () => {
  const { html } = await page("https://hearthroom.club/");
  const block = /<script id="board-inline"[\s\S]*?<\/script>/.exec(html)![0];
  expect(block).not.toContain("<script>alert");
  expect(html.match(/<script>alert/g)).toBeNull();
  expect(inline(html).page.items[0].summary).toContain("</script><script>alert(1)</script>");
});

it("其他語言用自己的語區；帶了篩選、不是正式網域、或卡片 App 網域：不放", async () => {
  expect(inline((await page("https://sukisuki.ai/en/")).html).query).toEqual({ zone: "en", lang: "en", sort: "day", offset: 0 });
  for (const url of ["https://hearthroom.club/?sort=week", "https://hearthroom.club/?tag=x", "https://hearthroom.club/?mode=following", "https://c.test/", "https://play.hearthroom.club/"]) {
    expect(inline((await page(url)).html), url).toBeNull();
  }
});

it("讀榜趕不上（快取沒命中）：馬上回純殼，但那次讀取照樣在背景跑完、填進快取", async () => {
  const slow = (db: D1Database): D1Database => new Proxy(db, { get(target, prop) {
    if (prop === "prepare") return (sql: string) => {
      const statement = target.prepare(sql);
      return new Proxy(statement, { get(st, p) {
        const value = Reflect.get(st, p);
        if (p === "bind") return (...args: unknown[]) => slowStatement((value as (...a: unknown[]) => D1PreparedStatement).apply(st, args));
        return typeof value === "function" ? value.bind(st) : value;
      } });
    };
    if (prop === "withSession") return (c?: string) => slow(target.withSession(c as never) as unknown as D1Database);
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const slowStatement = (st: D1PreparedStatement): D1PreparedStatement => new Proxy(st, { get(t, p) {
    const value = Reflect.get(t, p);
    if (p === "all" || p === "first") return async (...args: unknown[]) => { await new Promise((r) => setTimeout(r, 400)); return (value as (...a: unknown[]) => unknown).apply(t, args); };
    return typeof value === "function" ? value.bind(t) : value;
  } });
  boardCache.namespace = `board-${Math.random()}`;
  const ctx = createExecutionContext();
  const started = Date.now();
  const res = await worker.fetch(new Request("https://hearthroom.club/"), { ...testEnv, DB: slow(env.DB) }, ctx);
  const html = await res.text();
  expect(Date.now() - started).toBeLessThan(1000);
  expect(inline(html)).toBeNull();
  await waitOnExecutionContext(ctx);
  // 背景那次填好了快取：下一個人的 HTML 就帶得到
  expect(inline((await page("https://hearthroom.club/")).html)?.page.items.length).toBe(1);
});
