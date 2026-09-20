import { beforeEach, expect, it, vi } from "vitest";
import {
  communityRequest,
  captureDiscordReturn,
  takeDiscordReceipt,
} from "../src/lib/community";
beforeEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
it("clears the callback receipt from history before routing and consumes it once", () => {
  history.replaceState({}, "", "/me#discord_receipt=temporary-proof");
  captureDiscordReturn();
  expect(location.hash).toBe("");
  expect(takeDiscordReceipt()).toBe("temporary-proof");
  expect(takeDiscordReceipt()).toBeNull();
});
it("does not send a bearer to a different origin and uses the current provider header", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  await communityRequest("/me/community", "private-test-token");
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toContain("/v1/me/community");
  expect(options.headers.Authorization).toBe("Bearer private-test-token");
  expect(options.headers["X-Provider"]).toBeTruthy();
});
it("preserves a local card-report return path but refuses external redirects", () => {
  sessionStorage.setItem(
    "community.discord.return",
    "/en/me?reportCard=100001",
  );
  history.replaceState({}, "", "/me#discord_receipt=proof");
  captureDiscordReturn();
  expect(location.pathname + location.search).toBe("/en/me?reportCard=100001");
  sessionStorage.setItem(
    "community.discord.return",
    "https://example.com/steal",
  );
  history.replaceState({}, "", "/me#discord_receipt=proof");
  captureDiscordReturn();
  expect(location.pathname).toBe("/me");
});
it("keeps case retry IDs across component reloads without persisting report text", async () => {
  const { communityRequestId, forgetCommunityRequest } = await import(
    "../src/lib/community"
  );
  const body = { action: "create", body: "private report body" };
  const a = await communityRequestId("member-scope", body),
    b = await communityRequestId("member-scope", body);
  expect(a).toBe(b);
  expect(await communityRequestId("different-member", body)).not.toBe(a);
  expect(JSON.stringify(sessionStorage)).not.toContain("private report body");
  await forgetCommunityRequest("member-scope", body);
  expect(await communityRequestId("member-scope", body)).not.toBe(a);
});
