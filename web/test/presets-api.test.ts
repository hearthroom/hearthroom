import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api";
import { i18n, loadLocale } from "../src/lib/i18n";
import { createPreset, exportRevision, previewImport, readLocalProfiles, revisePreset } from "../src/lib/presets";
import { newDocument } from "../src/lib/st-preset";

const calls: { url: string; init: RequestInit }[] = [];
let reply: () => Response;

beforeEach(async () => {
  await loadLocale("en");
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return reply(); }));
});
afterEach(() => vi.unstubAllGlobals());

const file = (body: unknown, name = "p.json") => new File([typeof body === "string" ? body : JSON.stringify(body)], name, { type: "application/json" });

describe("預設 API", () => {
  it("寫入帶呼叫端給的 Idempotency-Key，重送時是同一把", async () => {
    reply = () => new Response(JSON.stringify({ presetId: "p", revisionId: "r", version: 1 }), { status: 201 });
    const input = { title: "我的", document: newDocument("main"), recommendedModels: [] };
    await createPreset("t", input, "key-1");
    await createPreset("t", input, "key-1");
    expect(calls.map((c) => (c.init.headers as Record<string, string>)["Idempotency-Key"])).toEqual(["key-1", "key-1"]);
    expect(calls[0]!.url).toMatch(/\/open\/v1\/presets$/);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ title: "我的", document: { schemaVersion: "hearthroom.st-preset.v1" } });
  });

  it("版本衝突拋出帶碼的錯誤，畫面拿碼分情況", async () => {
    reply = () => new Response(JSON.stringify({ error: "preset_conflict" }), { status: 409 });
    const err = await revisePreset("t", "p", { title: "x", document: newDocument("main"), recommendedModels: [], expectedVersion: 1 }, "k").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "preset_conflict" });
    expect(err.message).not.toContain("preset_conflict");
  });

  it("匯出檔名用上游的 Content-Disposition，沒有就用預設名稱", async () => {
    reply = () => new Response("{}", { headers: { "Content-Disposition": "attachment; filename*=UTF-8''%E6%96%87%E9%A2%A8.json" } });
    expect((await exportRevision("t", "p", "r", "fallback")).filename).toBe("文風.json");
    reply = () => new Response("{}");
    expect((await exportRevision("t", "p", "r", "fallback")).filename).toBe("fallback.json");
  });

  it("本機先讀出排序設定：完整預設列 character_id，條目包是 0，不是預設就說不是", async () => {
    // 每組附條目數與前三條自訂條目的名稱（由綺夢社提供的不算），讓玩家分得出是哪一組
    const prompts = [{ identifier: "a", name: "甲" }, { identifier: "b", name: "乙" }, { identifier: "chatHistory", name: "Chat History", marker: true }, { identifier: "c", name: "丙" }, { identifier: "d" }];
    expect(await readLocalProfiles(file({ prompts, prompt_order: [
      { character_id: 100000, order: [{ identifier: "a", enabled: true }, { identifier: "chatHistory", enabled: true }] },
      { character_id: 100001, order: ["a", "b", "chatHistory", "c", "d"].map((identifier) => ({ identifier, enabled: true })) },
    ] }))).toEqual({ ok: true, profiles: [{ id: 100000, count: 1, names: ["甲"], more: false }, { id: 100001, count: 4, names: ["甲", "乙", "丙"], more: true }] });
    expect(await readLocalProfiles(file({ version: 1, type: "prompts", data: { prompts: [{ identifier: "a", name: "甲" }], prompt_order: [{ identifier: "a", enabled: true }] } }))).toEqual({ ok: true, profiles: [{ id: 0, count: 1, names: ["甲"], more: false }] });
    expect(await readLocalProfiles(file("{not json"))).toEqual({ ok: false, reason: "not_json" });
    expect(await readLocalProfiles(file({ name: "card", data: { description: "x" } }))).toEqual({ ok: false, reason: "not_preset" });
    // 有條目卻沒有任何排序設定：讀不出要用哪些、怎麼排，不上傳
    expect(await readLocalProfiles(file({ prompts: [{ identifier: "a" }] }))).toEqual({ ok: false, reason: "not_preset" });
    expect(await readLocalProfiles(file("x".repeat(1024 * 1024 + 1)))).toEqual({ ok: false, reason: "too_large" });
  });

  it("細碼對到文案的句子，數字用變數帶進去", async () => {
    reply = () => new Response(JSON.stringify({ error: "preset_invalid", reason: "preset_invalid_json" }), { status: 422 });
    const bad = await previewImport("t", file("{}"), null).catch((e) => e);
    expect(bad).toMatchObject({ code: "preset_invalid", reason: "preset_invalid_json", message: i18n.global.t("preset.error.json") });
    reply = () => new Response(JSON.stringify({ error: "invalid_request" }), { status: 413 });
    const big = await previewImport("t", file("{}"), null).catch((e) => e);
    expect(big.message).toBe(i18n.global.t("preset.error.tooLarge", { limit: "1 MB" }));
    expect(big.message).toContain("1 MB");
  });
});
