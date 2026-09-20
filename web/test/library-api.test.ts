import { afterEach, expect, it, vi } from "vitest";
import { fetchConversations, libraryRequest } from "../src/lib/library";

afterEach(() => vi.unstubAllGlobals());
it("reads only the community conversation index with explicit paging and language", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ conversations: [], hasNextPage: false })));
  vi.stubGlobal("fetch", fetcher);
  expect((await fetchConversations("test-token", "en", 2)).conversations).toEqual([]);
  expect(fetcher.mock.calls[0][0]).toContain("/v1/me/conversations?pageNum=2&lang=en");
  expect(fetcher.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer test-token", 'X-Provider': 'lunatalk' });
});
it("does not turn an authentication failure into an empty library", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 })));
  await expect(libraryRequest("favorites", "expired")).rejects.toMatchObject({ status: 401 });
});
