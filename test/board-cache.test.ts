import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BOARD_TTL, boardCache, boardKey, readBoardCache, writeBoardCache } from "../src/board-cache";
import type { Env } from "../src/types";

beforeEach(() => { boardCache.namespace = `board-cache-${crypto.randomUUID()}`; });
afterEach(() => vi.restoreAllMocks());
const url = "https://c.test/v1/cards?sort=hot&zone=zh";

it("an edge miss reuses KV and warms the edge without extending the five-minute deadline", async () => {
  const key = await boardKey(url, 1, true);
  const write = createExecutionContext();
  writeBoardCache(env, write, key, '{"items":[]}');
  await waitOnExecutionContext(write);
  const stored = await env.CACHE.get<{ body: string; expiresAt: number }>(key.kv, "json");
  expect(stored!.expiresAt - Date.now()).toBeGreaterThan(290_000);
  expect(stored!.expiresAt - Date.now()).toBeLessThanOrEqual(BOARD_TTL * 1000);
  await (await caches.open(boardCache.namespace)).delete(key.edge);
  const read = createExecutionContext();
  expect(await readBoardCache(env, read, key)).toEqual({ body: '{"items":[]}', layer: "kv" });
  await waitOnExecutionContext(read);
  const next = createExecutionContext();
  expect((await readBoardCache(env, next, key))?.layer).toBe("edge");
  await waitOnExecutionContext(next);
  const edge = await (await caches.open(boardCache.namespace)).match(key.edge);
  expect((await edge!.json() as { expiresAt: number }).expiresAt).toBe(stored!.expiresAt);
});

it("an expired KV snapshot cannot get a fresh five minutes from a new edge", async () => {
  const key = await boardKey(url, 1, false);
  const now = Date.now();
  await env.CACHE.put(key.kv, JSON.stringify({ body: '{"items":[]}', expiresAt: now + 300_000 }));
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 300_001);
  const ctx = createExecutionContext();
  expect(await readBoardCache(env, ctx, key)).toBeNull();
  clock.mockRestore();
  await waitOnExecutionContext(ctx);
});

it("adult/general, moderation, locales and filters stay isolated across both caches", async () => {
  const original = await boardKey(url, 1, true);
  const write = createExecutionContext();
  writeBoardCache(env, write, original, '{"items":["adult"]}');
  await waitOnExecutionContext(write);
  for (const key of [
    await boardKey(url, 1, false), await boardKey(url, 2, true),
    await boardKey(url + "&lang=en", 1, true), await boardKey(url + "&hide=horror", 1, true),
    await boardKey(url + "&tag=horror", 1, true), await boardKey(url + "&offset=24", 1, true),
  ]) {
    const ctx = createExecutionContext();
    expect(await readBoardCache(env, ctx, key)).toBeNull();
    await waitOnExecutionContext(ctx);
  }
});

it("cache failures fall back to origin instead of failing the request", async () => {
  const key = await boardKey(url, 1, false);
  vi.spyOn(caches, "open").mockRejectedValue(new Error("edge unavailable"));
  const failed = { ...env, CACHE: {
    get: async () => { throw new Error("KV unavailable"); },
    put: async () => { throw new Error("KV unavailable"); },
  } } as unknown as Env;
  const ctx = createExecutionContext();
  expect(await readBoardCache(failed, ctx, key)).toBeNull();
  writeBoardCache(failed, ctx, key, '{"items":[]}');
  await expect(waitOnExecutionContext(ctx)).resolves.toBeUndefined();
});

it("query keys exclude credentials and canonicalize repeated tag order", async () => {
  const a = await boardKey(url + "&tag=b&tag=a&tag=b&nsfw=1&token=secret&_access=general", 1, true);
  const b = await boardKey(url + "&tag=a&tag=b", 1, true);
  expect(a.kv).toBe(b.kv);
  expect(a.edge.url).toBe(b.edge.url);
  expect([...a.edge.headers]).toEqual([]);
  expect(a.edge.url).not.toContain("secret");
  expect(a.edge.url).toContain("_access=adult");
});
