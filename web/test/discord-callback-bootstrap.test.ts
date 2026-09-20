import { expect, it, vi } from "vitest";
it("restores the report destination before router history snapshots its initial location", async () => {
  vi.resetModules();
  sessionStorage.clear();
  sessionStorage.setItem(
    "community.discord.return",
    "/en/me?reportCard=100001",
  );
  history.replaceState({}, "", "/me#discord_receipt=callback-proof");
  await import("../src/lib/community-return");
  const { router } = await import("../src/router");
  expect(router.options.history.location).toBe("/en/me?reportCard=100001");
  expect(sessionStorage.getItem("community.discord.receipt")).toBe(
    "callback-proof",
  );
  expect(location.hash).toBe("");
  router.options.history.destroy();
});
