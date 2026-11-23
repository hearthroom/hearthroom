// 分享選單拿不到剪貼簿時，改跳視窗讓人自己複製連結：這也是產生了一條分享連結，新手七日「分享一張卡」要算到（2026-11-23）。
import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { i18n } from "../src/lib/i18n";

const noted = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../src/lib/share-ref", () => ({ noteShareLinkCreated: noted }));
vi.mock("../src/lib/track", () => ({ track: vi.fn() }));
const dialog = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../src/lib/confirm", () => ({ confirmDialog: dialog }));
import ShareMenu from "../src/components/ShareMenu.vue";

let app: ReturnType<typeof createApp> | undefined;
afterEach(() => { app?.unmount(); vi.unstubAllGlobals(); noted.mockClear(); dialog.mockClear(); });

it("剪貼簿寫不進去、改成手動複製：照樣記下產生了分享連結", async () => {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
  app = createApp(ShareMenu, { url: "https://sukisuki.ai/cards/12", title: "卡", subject: "role-1" }).use(i18n);
  const root = document.createElement("div");
  document.body.appendChild(root);
  app.mount(root);
  root.querySelector<HTMLButtonElement>(".sh__btn")!.click();
  await nextTick();
  const copy = [...root.querySelectorAll<HTMLButtonElement>("button.sh__item")].find((b) => b.textContent?.includes(i18n.global.t("share.copyLink")));
  copy!.click();
  await vi.waitFor(() => expect(dialog).toHaveBeenCalled());
  expect(noted).toHaveBeenCalledWith("role-1");
});
