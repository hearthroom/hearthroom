import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n, applyLocale } from "../src/lib/i18n";
import { captureDiscordReturn } from "../src/lib/community";
const fixture = vi.hoisted(() => ({ request: vi.fn(), handle: "member-one" }));
vi.mock("../src/lib/community", async original => ({ ...await original<object>(), communityRequest: fixture.request }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({
  get profile() { return { handle: fixture.handle }; },
  ensureProfile: async () => {}, accessToken: async () => "synthetic-token",
}) }));
vi.mock("../src/components/BadgeShowcase.vue", () => ({ default: { template: "<div/>" } }));
import DiscordCommunity from "../src/components/DiscordCommunity.vue";
const view = { enabled: true, invite: null, link: null, xp: 0, level: 0, badges: [], xpEnabled: true,
  preferences: { public_badges: 0, public_level: 0, discord_dm: 0, case_access: 0 } };
let app: App | undefined, host: HTMLDivElement;
const settle = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); };
async function mount() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: DiscordCommunity }] });
  await router.push("/en/me/community");
  app = createApp(DiscordCommunity).use(router).use(i18n); app.mount(host); await settle();
}
async function start() {
  await mount();
  (host.querySelector(".community__identity button") as HTMLButtonElement).click(); await settle();
  const nonce = fixture.request.mock.calls.find(([path]) => path.endsWith("/link"))![3].nonce;
  expect(location.assign).toHaveBeenCalledOnce();
  app!.unmount(); app = undefined; return nonce;
}
beforeEach(async () => {
  fixture.handle = "member-one"; fixture.request.mockReset();
  fixture.request.mockImplementation(async (path: string) => path.endsWith("/link") ? { url: "https://discord.com/oauth2/authorize?state=synthetic" } : view);
  sessionStorage.clear(); localStorage.clear(); await applyLocale("en");
  history.replaceState({}, "", "/en/me/community");
  vi.spyOn(location, "assign").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host);
});
afterEach(() => { app?.unmount(); app = undefined; host.remove(); vi.restoreAllMocks(); });
it("completes a same-member return in a new tab without sessionStorage", async () => {
  const nonce = await start(); sessionStorage.clear();
  history.replaceState({}, "", "/me#discord_receipt=synthetic-receipt"); captureDiscordReturn();
  await mount();
  expect(fixture.request).toHaveBeenCalledWith("/me/community/complete", "synthetic-token", "POST", { receipt: "synthetic-receipt", nonce });
  expect(location.pathname).toBe("/en/me/community");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("preserves a same-tab receipt on /me until the community page consumes it", async () => {
  const nonce = await start();
  history.replaceState({}, "", "/me#discord_receipt=synthetic-receipt"); captureDiscordReturn();
  expect(sessionStorage.getItem("community.discord.receipt")).toBe("synthetic-receipt");
  await mount();
  expect(fixture.request).toHaveBeenCalledWith("/me/community/complete", "synthetic-token", "POST", { receipt: "synthetic-receipt", nonce });
  expect(sessionStorage.getItem("community.discord.receipt")).toBeNull();
});
it("tells a return without browser proof to finish in the same browser", async () => {
  history.replaceState({}, "", "/me#discord_receipt=unmatched-receipt"); captureDiscordReturn();
  expect(location.pathname).toBe("/me/community");
  await mount();
  expect(fixture.request.mock.calls.some(([path]) => path.endsWith("/complete"))).toBe(false);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.global.t("community.sameBrowser"));
});
it("shows cancellation separately from expiry", async () => {
  await start(); history.replaceState({}, "", "/me#discord_error=cancelled"); captureDiscordReturn(); await mount();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.global.t("community.linkCancelled"));
  expect(fixture.request.mock.calls.some(([path]) => path.endsWith("/complete"))).toBe(false);
});
it("rejects a return after the short proof lifetime and consumes the expired proof", async () => {
  await start(); sessionStorage.clear();
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 600001);
  history.replaceState({}, "", "/me#discord_receipt=expired-receipt"); captureDiscordReturn(); await mount();
  expect(fixture.request.mock.calls.some(([path]) => path.endsWith("/complete"))).toBe(false);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.global.t("community.expired"));
  expect(localStorage.getItem("community.discord.attempt")).toBeNull();
});
it("does not expose another member's browser proof or consume it", async () => {
  const nonce = await start(); const pending = localStorage.getItem("community.discord.attempt");
  fixture.handle = "member-two"; sessionStorage.clear();
  history.replaceState({}, "", "/me#discord_receipt=other-member-receipt"); captureDiscordReturn(); await mount();
  expect(fixture.request.mock.calls.some(([path]) => path.endsWith("/complete"))).toBe(false);
  expect(localStorage.getItem("community.discord.attempt")).toBe(pending);
  expect(pending).toContain(nonce);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.global.t("community.sameBrowser"));
});
it("discards a stale error when a fresh successful callback arrives and consumes proof once", async () => {
  const nonce = await start();
  sessionStorage.setItem("community.discord.error", "oauth");
  history.replaceState({}, "", "/me#discord_receipt=successful-receipt"); captureDiscordReturn(); await mount();
  expect(fixture.request).toHaveBeenCalledWith("/me/community/complete", "synthetic-token", "POST", { receipt: "successful-receipt", nonce });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  app!.unmount(); app = undefined;
  await mount();
  expect(fixture.request.mock.calls.filter(([path]) => path.endsWith("/complete"))).toHaveLength(1);
});
it("continues an in-flight same-tab attempt from the previous version", async () => {
  sessionStorage.setItem("community.discord.nonce", "legacy-proof-" + "n".repeat(40));
  history.replaceState({}, "", "/me#discord_receipt=legacy-receipt"); captureDiscordReturn(); await mount();
  expect(fixture.request).toHaveBeenCalledWith("/me/community/complete", "synthetic-token", "POST", { receipt: "legacy-receipt", nonce: "legacy-proof-" + "n".repeat(40) });
});
it("refuses an external return target saved in browser storage", async () => {
  await start(); const pending = JSON.parse(localStorage.getItem("community.discord.attempt")!);
  localStorage.setItem("community.discord.attempt", JSON.stringify({ ...pending, returnPath: "https://evil.example/receive" }));
  sessionStorage.clear(); history.replaceState({}, "", "/me#discord_receipt=synthetic-receipt"); captureDiscordReturn();
  expect(location.pathname).toBe("/me/community"); expect(location.hash).toBe("");
});
it("does not let an old expired callback in another tab erase the active shared proof", async () => {
  const nonce = await start(); sessionStorage.clear();
  history.replaceState({}, "", "/me#discord_error=expired"); captureDiscordReturn(); await mount();
  app!.unmount(); app = undefined;
  history.replaceState({}, "", "/me#discord_receipt=valid-current-receipt"); captureDiscordReturn(); await mount();
  expect(fixture.request).toHaveBeenCalledWith("/me/community/complete", "synthetic-token", "POST", { receipt: "valid-current-receipt", nonce });
});
it("removes proof after cancellation so an old receipt cannot reuse it", async () => {
  await start(); history.replaceState({}, "", "/me#discord_error=cancelled"); captureDiscordReturn(); await mount();
  expect(localStorage.getItem("community.discord.attempt")).toBeNull();
  app!.unmount(); app = undefined;
  history.replaceState({}, "", "/me#discord_receipt=stale-receipt"); captureDiscordReturn(); await mount();
  expect(fixture.request.mock.calls.some(([path]) => path.endsWith("/complete"))).toBe(false);
});
