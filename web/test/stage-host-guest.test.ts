/**
 * 遊客模式的舞台接線（owner 2026-10-10）：遊客進場只看開場，萬一有請求被拒也不能把他送去登入頁；
 * 他按了送出，舞台叫的是宿主給的 onSignInRequired（對話頁原地彈登入框）。
 */
import { expect, it, vi } from "vitest";
import { createApp } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { useSession } from "../src/lib/session";

const installMoonStage = vi.fn(async () => {});
vi.mock("moonstage/stage", () => ({
  installMoonStage,
  mergeStageMessages: vi.fn(),
  browserHost: (o: Record<string, unknown>) => ({ storage: {}, clipboard: {}, events: { on: vi.fn() }, scrollTo() {}, ...o }),
  MoonStage: { template: "<div />" },
}));
vi.mock("moonstage/stage.css", () => ({}));

it("遊客：被拒的請求不換頁；送出要登入時叫宿主給的 onSignInRequired；不交出 player", async () => {
  const { ensureStage } = await import("../src/lib/stage-host");
  const pinia = createPinia(); setActivePinia(pinia);
  const session = useSession();
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/play/role-1");
  const push = vi.spyOn(router, "push");
  const app = createApp({}).use(pinia).use(router).use(i18n);
  const onSignInRequired = vi.fn();
  await ensureStage({ app, router, session, provider: "harbor", accessToken: async () => null, player: null,
    currentPath: () => "/play/role-1", currentRoleId: () => "role-1", lp: (p) => p, guest: true, onSignInRequired });
  const options = (installMoonStage.mock.calls[0] as unknown as [unknown, { auth: { onUnauthorized(): void; onSignInRequired?(): void; user?: unknown } }])[1];
  options.auth.onUnauthorized();
  await new Promise((r) => setTimeout(r, 0));
  expect(push).not.toHaveBeenCalled();
  expect(options.auth.onSignInRequired).toBe(onSignInRequired);
  expect(options.auth.user).toBeUndefined();
});
