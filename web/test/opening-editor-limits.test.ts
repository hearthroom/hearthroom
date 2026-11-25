/**
 * 網頁內容欄位只有文字框的用法（工坊開場仍存在 JSON 裡，上限 512 KB）：沒有上傳、下載與檔案卡，
 * 貼上不換成檔案；契約放寬一般卡的上限時，工坊照舊。
 */
import { afterEach, expect, it } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import { i18n } from "../src/lib/i18n";
import OpeningEditor from "../src/components/editor/OpeningEditor.vue";
import { setOpeningPageLimitsForTest, workshopOpeningPageMaxBytes } from "../src/lib/opening-page";

let app: App | undefined;
let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); setOpeningPageLimitsForTest({ max: null, workshop: null }); });

async function mountEditor(page: string, maxBytes?: number) {
  const value = ref(page);
  root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp({
    render: () => h(OpeningEditor, {
      mode: "page", savedMode: "page", welcome: "", alternates: [], prologue: ["出發"], openingPage: value.value,
      pageAvailable: true, rules: [], roleName: "測試", welcomeMax: 3000, missing: false, maxBytes,
      "onUpdate:openingPage": (v: string) => { value.value = v; },
    }),
  }).use(i18n);
  app.mount(root);
  await nextTick();
  return value;
}

it("工坊：沒有上傳與檔案卡，上限照工坊的 512 KB，契約放寬一般卡也不變", async () => {
  setOpeningPageLimitsForTest({ max: 100_000_000 });
  expect(workshopOpeningPageMaxBytes()).toBe(524288);
  const big = "<p>" + "a".repeat(600 * 1024) + "</p>";
  await mountEditor(big, workshopOpeningPageMaxBytes());
  expect(root.querySelector("[data-opening-upload]")).toBeNull();
  expect(root.querySelector("[data-opening-file]")).toBeNull();
  expect(root.querySelector<HTMLTextAreaElement>("#f-opening-page")!.value).toBe(big);
  expect(root.textContent).toContain(i18n.global.t("editor.openingPage.tooLong", { max: "0.5" }));
  const paste = new Event("paste", { cancelable: true });
  Object.defineProperty(paste, "clipboardData", { value: { getData: () => big } });
  root.querySelector("#f-opening-page")!.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(false);
});

it("64 KB 以下不顯示計數器；以上以 KB／MB 顯示", async () => {
  await mountEditor("<p>小</p>");
  expect(root.querySelector("#f-opening-page-usage")).toBeNull();
  app?.unmount(); root.remove();
  await mountEditor("<p>" + "a".repeat(100 * 1024) + "</p>", 100_000_000);
  expect(root.querySelector("#f-opening-page-usage")!.textContent).toContain("102.5 KB / 100 MB");
  expect(root.querySelector('[role="alert"]')).toBeNull();
});
