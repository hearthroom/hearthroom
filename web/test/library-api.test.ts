import { afterEach, expect, it, vi } from "vitest";
import { fetchConversations, libraryRequest } from "../src/lib/library";

afterEach(() => vi.unstubAllGlobals());
it("reads the provider's existing conversations with explicit paging and language", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ conversations: null, hasNextPage: false })));
  vi.stubGlobal("fetch", fetcher);
  expect((await fetchConversations("test-token", "en", 2)).conversations).toEqual([]);
  expect(fetcher.mock.calls[0][0]).toContain("/open/v1/conversation/list?pageNum=2&pageSize=24");
  expect(fetcher.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer test-token", language: "en" });
});
it("does not turn an authentication failure into an empty library", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 })));
  await expect(libraryRequest("favorites", "expired")).rejects.toMatchObject({ status: 401 });
});
