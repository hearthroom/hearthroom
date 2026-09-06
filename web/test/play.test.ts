/**
 * /play/:roleId：舞台套件當成普通元件掛進站內。
 *
 * 套件本身（stage/）有自己的測試；這裡只驗接線：套件是動態載入、只裝一次、拿到的是本站的
 * token 與 API 位址、畫布收到路由上的 roleId、卡片頁的「開始對話」是站內連結。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { useSession } from "../src/lib/session";

const installMoonStage = vi.fn(async () => {});
const mergeStageMessages = vi.fn();
const MoonStage = defineComponent({
  name: "MoonStage",
  props: { roleId: { type: String, default: "" } },
  setup: (props) => () => h("div", { class: "stage-stub", "data-role": props.roleId }, "stage"),
});
vi.mock("moonstage/stage", () => ({
  installMoonStage,
  mergeStageMessages,
  browserHost: (o: Record<string, unknown>) => ({ storage: {}, clipboard: {}, events: {}, scrollTo() {}, ...o }),
  MoonStage,
}));
vi.mock("moonstage/stage.css", () => ({}));
vi.mock("../src/lib/api", () => ({
  fetchMe: vi.fn(async () => ({ accountNumId: 1, nickName: "測試", avatar: "" })),
  fetchWallet: vi.fn(async () => ({ score: 0, tempScore: 0, plans: [] })),
}));

let app: App | null = null;
let router: Router;
let root: HTMLElement;
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

async function mount(path: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSession();
  session.token = { accessToken: "tok-1", refreshToken: "r", expiresAt: Date.now() + 3600_000 } as never;
  session.me = { accountNumId: 1, nickName: "測試", avatar: "" } as never;
  const { default: PlayPage } = await import("../src/pages/PlayPage.vue");
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/play/:roleId", component: PlayPage, meta: { auth: true, bare: true } },
      { path: "/cards/:id", component: { template: "<div class='card-stub' />" } },
      { path: "/", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp({ template: "<RouterView />" }).use(pinia).use(i18n).use(router);
  app.mount(root);
  await flush();
}

beforeEach(() => {
  installMoonStage.mockClear();
  mergeStageMessages.mockClear();
});
afterEach(() => {
  app?.unmount();
  app = null;
  root?.remove();
});

describe("/play/:roleId", () => {
  it("動態載入套件、以本站的 token 與 API 位址安裝，畫布拿到路由上的 roleId", async () => {
    await mount("/play/role-9");
    expect(installMoonStage).toHaveBeenCalledTimes(1);
    const [, options] = installMoonStage.mock.calls[0] as unknown as [unknown, { auth: { getAccessToken(): Promise<string | null> }; api: { base: string }; host: { ui: { toast(t: string): void } } }];
    expect(options.api.base).toMatch(/^https?:\/\//);
    await expect(options.auth.getAccessToken()).resolves.toBe("tok-1");
    // 畫布送訊息前看的是登入的人：宿主要把 session 裡的人交出去
    expect((options.auth as { user?: { id: string } }).user).toEqual({ id: "1", nickName: "測試", avatar: "" });
    const stub = root.querySelector<HTMLElement>(".stage-stub");
    expect(stub?.dataset.role).toBe("role-9");
    // 舞台丟出來的提示畫在頁面上
    options.host.ui.toast("已複製");
    await flush();
    expect(root.textContent).toContain("已複製");
  });

  it("套件只裝一次：換卡再進來不重裝（安裝狀態跨測試共用，所以比的是前後差值）", async () => {
    await mount("/play/role-1");
    const installs = installMoonStage.mock.calls.length;
    await router.push("/play/role-2");
    await flush();
    expect(installMoonStage.mock.calls.length).toBe(installs);
    expect(root.querySelector<HTMLElement>(".stage-stub")?.dataset.role).toBe("role-2");
  });
});
