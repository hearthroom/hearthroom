/**
 * 朋友的分享連結落在卡片頁（/cards/<卡號>?share=<碼>）：按「開始玩」要把情境碼帶進遊玩頁，
 * 不然卡片讀不到（lib/play-share）。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
const mocks = vi.hoisted(() => ({ platforms: vi.fn() }));
vi.mock("../src/lib/api", () => ({ fetchCardPlatforms: mocks.platforms }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: null, profile: null, wallet: null }) }));
vi.mock("../src/lib/connections", () => ({ accountToken: vi.fn(), connectedBalance: vi.fn(), connectAccount: vi.fn() }));
import CardPlatforms from "../src/components/CardPlatforms.vue";

let app: ReturnType<typeof createApp>, root: HTMLElement;
let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mocks.platforms.mockResolvedValue([{ provider: "harbor", roleId: "harbor-copy", playable: true }]);
  assign = vi.spyOn(window.location, "assign").mockImplementation(() => {}) as unknown as ReturnType<typeof vi.fn>;
});
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); });

async function clickPlay(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/cards/:id", component: CardPlatforms, props: (r) => ({ cardId: String(r.params.id) }) }] });
  await router.push(path);
  root = document.createElement("div");
  document.body.append(root);
  app = createApp({ template: "<RouterView />" }).use(i18n).use(router);
  app.mount(root);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await nextTick();
  (root.querySelector("button.btn--primary") as HTMLButtonElement).click();
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

it("帶著朋友的情境碼進遊玩頁", async () => {
  await clickPlay("/cards/100271?share=p1-4.b");
  expect(assign).toHaveBeenCalledWith("/play/100271?provider=harbor&share=p1-4.b");
});

it("沒有或格式不對的情境碼不帶", async () => {
  await clickPlay("/cards/100271?share=%3Cb%3E");
  expect(assign).toHaveBeenCalledWith("/play/100271?provider=harbor");
});
