import { afterEach, describe, expect, it, vi } from "vitest";
import { generationClient } from "../src/lib/media-generation";
import { ApiError } from "../src/lib/api";

// 以登入身分生圖（Harbor /open/v1/generations）：OpenAI 錯誤信封、Idempotency-Key、202 改查任務、存進資源庫。
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const harborError = (status: number, type: string, code?: string) => json({ error: { type, code, message: "x" } }, status);
afterEach(() => vi.unstubAllGlobals());

function stub(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => handler(url, init));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const client = (token = async () => "tok") => generationClient("harbor", token);

describe("generation models", () => {
  it("lists image models only, cheapest first, with the lowest price per image", async () => {
    stub(() => json({ object: "list", data: [
      { id: "gpt-image-2", name: "GPT Image 2", type: "image", pricing: { credits: { standard: 52, "2048": 90 } }, capabilities: { sizes: ["1024x1024"], max_images: 4 } },
      { id: "seedance", name: "Seedance", type: "video", pricing: { credits: { "720p": 10 } }, capabilities: { resolutions: ["720p"] } },
      { id: "gpt-image-2-dawn", name: "GPT Image 2", type: "image", pricing: { credits: { standard: 35 } }, capabilities: { sizes: ["1024x1024", "1536x1024"], max_images: 2 } },
    ] }));
    const models = await client().models();
    expect(models.map((m) => [m.id, m.credits, m.priced, m.maxImages])).toEqual([
      ["gpt-image-2-dawn", 35, 1, 2],
      ["gpt-image-2", 52, 2, 4],
    ]);
  });

  it("reports a sign-in without media.generate as 403 so the page can ask to sign in again", async () => {
    stub(() => harborError(403, "permission_error"));
    await expect(client().models()).rejects.toMatchObject({ status: 403, code: "permission_error" });
  });

  it("renews a rejected token once", async () => {
    const tokens = vi.fn(async (rejected?: string) => (rejected ? "renewed" : "old"));
    const fetcher = stub((_, init) =>
      new Headers(init.headers).get("Authorization") === "Bearer old" ? harborError(401, "authentication_error") : json({ data: [] }),
    );
    await client(tokens).models();
    expect(tokens).toHaveBeenCalledWith("old");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("generating and saving", () => {
  const input = { model: "gpt-image-2-dawn", prompt: "a lighthouse", size: "1024x1024", n: 2 };

  it("sends the order key and returns a finished task when Harbor answers within its wait", async () => {
    const fetcher = stub(() => json({ created: 1, data: [{ url: "https://assets.test/a.png" }, { url: "https://assets.test/b.png" }], harbor: { id: "t1", status: "completed" } }));
    const task = await client().create(input, "key-1");
    expect(task).toEqual({ id: "t1", status: "completed", urls: ["https://assets.test/a.png", "https://assets.test/b.png"] });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.harperharbor.com/open/v1/generations/images");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("key-1");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("polls a 202 task until it completes", async () => {
    let polls = 0;
    stub((url) => {
      if (url.endsWith("/images")) return json({ id: "t2", status: "queued" }, 202);
      polls++;
      return json(polls < 2 ? { id: "t2", status: "in_progress" } : { id: "t2", status: "completed", data: [{ url: "https://assets.test/c.png" }] });
    });
    const c = client();
    const first = await c.create(input, "key-2");
    expect(first.status).toBe("queued");
    const done = await c.wait(first, () => false, 0);
    expect(done).toMatchObject({ status: "completed", urls: ["https://assets.test/c.png"] });
    expect(polls).toBe(2);
  });

  it("keeps the failure code of a refused task", async () => {
    stub(() => json({ id: "t3", status: "failed", error: { code: "content_policy_violation", message: "no" } }));
    expect(await client().get("t3")).toMatchObject({ status: "failed", code: "content_policy_violation" });
  });

  it.each([
    [402, "insufficient_quota", undefined, "insufficient_quota"],
    [400, "invalid_request_error", "content_policy_violation", "content_policy_violation"],
    [507, "insufficient_quota", undefined, "insufficient_quota"],
  ])("surfaces HTTP %i with its code", async (status, type, code, expected) => {
    stub(() => harborError(status, type, code));
    const error = await client().create(input, "k").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code: expected });
  });

  it("saves into the folder that is open", async () => {
    const fetcher = stub(() => json({ id: "t1", object: "media.saved", asset_ids: ["a1", "a2"] }));
    expect(await client().save("t1", { folderIds: ["f-art"] })).toEqual(["a1", "a2"]);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.harperharbor.com/open/v1/generations/t1/save");
    expect(JSON.parse(String(init.body))).toEqual({ folderIds: ["f-art"] });
  });
});
