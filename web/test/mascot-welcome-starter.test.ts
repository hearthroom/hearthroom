// 歡迎橫幅：有入門卡的語言說「先從我挑的入門卡開始」；沒有的語言（en/ja/ko 目前）改說從榜單最上面開始（copy.md §13）
import { afterEach, expect, it, vi } from "vitest";
import { createApp, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/mascot-home", () => ({ useMascotWelcome: () => ({ visible: ref(true), dismiss: () => {} }) }));
vi.mock("../src/lib/track", () => ({ track: () => {} }));
import MascotWelcome from "../src/components/MascotWelcome.vue";

let app: ReturnType<typeof createApp> | undefined;
afterEach(() => app?.unmount());

async function body(locale: "zh-Hant" | "en") {
  i18n.global.locale.value = locale;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  const root = document.createElement("div");
  app = createApp(MascotWelcome).use(router).use(i18n); app.mount(root);
  return { text: root.querySelector(".welcome__body")?.textContent, start: !!root.querySelector(".welcome__start") };
}

it("points to the starter card where one exists", async () => {
  expect(await body("zh-Hant")).toEqual({ text: i18n.global.t("mascot.welcome.body"), start: true });
});

it("points to the board where there is no starter card", async () => {
  expect(await body("en")).toEqual({ text: i18n.global.t("mascot.welcome.bodyBoard"), start: false });
});
