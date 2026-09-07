/**
 * 舊部署的 hash 檔：資源層（當前版）找不到時，從 ASSET_ARCHIVE 回退。
 * 讓部署前就開著的分頁還拿得到自己那一版的區塊；當前版有的檔照資源層走，不碰 KV。
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { envWithAssets, fakeAssets } from "./helpers";

async function get(path: string, present: Record<string, string>) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://c.test${path}`), envWithAssets(present), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// 假資源層的契約本身也要釘住：缺檔是 200 + HTML。這條紅了代表 helper 被改回 404，上面的回退測試就會變成自欺。
describe("fakeAssets 契約", () => {
  it("缺檔回 200 的 index.html，不是 404", async () => {
    const res = await fakeAssets().fetch("https://c.test/assets/missing.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

describe("/assets/* 回退到舊版歸檔", () => {
  it("當前版有的檔照資源層回，不碰 KV", async () => {
    const res = await get("/assets/PlayPage-new.js", { "/assets/PlayPage-new.js": "new()" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("new()");
  });

  it("當前版沒有、歸檔裡有 → 200，帶原本的 content-type 與 immutable 快取頭", async () => {
    await env.ASSET_ARCHIVE.put("/assets/PlayPage-old.js", "old()", { metadata: { contentType: "text/javascript; charset=utf-8" } });
    const res = await get("/assets/PlayPage-old.js", {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("old()");
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("兩邊都沒有 → 真正的 404，不是 200 的 index.html", async () => {
    const res = await get("/assets/Nope-xyz.js", {});
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
  });
});
