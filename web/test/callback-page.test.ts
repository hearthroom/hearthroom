/**
 * 登入回呼失敗時：拒絕授權要說「你拒絕了授權」（以前丟的是已翻好的句子，畫面再比對 "denied"
 * 在中日韓永遠比不到，只顯示通用錯誤）；「重新登入」要帶著原本要回去的那一頁。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "@/lib/i18n";
import { resetManagedAuthForTest } from "@/lib/managed-auth";
import { beginLogin, completeLogin } from "@/lib/oauth";

beforeEach(() => { resetManagedAuthForTest(); sessionStorage.clear(); setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); i18n.global.locale.value = "en"; });

function managedServer() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/v1/auth/config") return Response.json({ managed: true });
    if (url === "/v1/auth/start") return Response.json({ url: "https://api.example/oauth/authorize?x=1" });
    return Response.json({ ok: true });
  }));
  vi.stubGlobal("location", { hostname: "hearthroom.club", host: "hearthroom.club", origin: "https://hearthroom.club", protocol: "https:", pathname: "/auth/callback", href: "https://hearthroom.club/auth/callback?error=access_denied&state=s", search: "?error=access_denied&state=s", hash: "", assign: vi.fn(), replace: vi.fn(), reload: vi.fn() });
}

it("reports a denied consent with a stable code", async () => {
  managedServer();
  i18n.global.locale.value = "ja";
  await expect(completeLogin(new URLSearchParams("error=access_denied&state=s"))).rejects.toThrow("oauth_denied");
});

it("says the player declined, and the retry goes back to the page they came from", async () => {
  managedServer();
  await beginLogin("/cards/42");
  i18n.global.locale.value = "zh-Hant";
  const { default: CallbackPage } = await import("@/pages/CallbackPage.vue");
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/:lang?/auth/callback", component: CallbackPage },
    { path: "/:pathMatch(.*)*", component: { render: () => null } },
  ] });
  await router.push("/auth/callback?error=access_denied&state=s");
  await router.isReady();
  const el = document.createElement("div");
  document.body.appendChild(el);
  const app = createApp(CallbackPage).use(createPinia()).use(router).use(i18n);
  app.mount(el);
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  await nextTick();
  expect(el.textContent).toContain(i18n.global.t("auth.denied"));
  const retry = el.querySelector("a");
  expect(decodeURIComponent(retry?.getAttribute("href") ?? "")).toContain("returnTo=/cards/42");
  app.unmount();
  el.remove();
});
