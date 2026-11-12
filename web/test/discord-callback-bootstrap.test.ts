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
it.each(["en", "ja", "ko", "zh-Hans", "zh-Hant"])("keeps the initiating %s page language after browser proof is lost", async locale => {
  vi.resetModules(); localStorage.clear(); sessionStorage.clear();
  const prefix = locale === "zh-Hant" ? "" : "/" + locale;
  const { saveDiscordAttempt } = await import("../src/lib/discord-attempt");
  saveDiscordAttempt("harbor:synthetic-member", "n".repeat(40), prefix + "/me/community");
  localStorage.removeItem("community.discord.attempt"); sessionStorage.clear();
  history.replaceState({}, "", "/me#discord_receipt=unmatched-synthetic-receipt");
  await import("../src/lib/community-return");
  const { router, localeOf } = await import("../src/router");
  expect(router.options.history.location).toBe(prefix + "/me/community");
  expect(localeOf(router.resolve(router.options.history.location))).toBe(locale);
  expect(location.hash).toBe("");
  router.options.history.destroy();
});
