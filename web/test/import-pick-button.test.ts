/**
 * 匯入面板的「選擇檔案」按鈕必須真的打開檔案選擇器。
 *
 * 作者回報「點了沒反應」。這種缺陷不會有錯誤、不會有紅字：按鈕畫得出來、點得到，
 * 只是背後那個隱藏的 file input 沒被叫起來，所以什麼都不發生。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createApp, nextTick } from "vue";
import ImportPanel from "../src/components/editor/ImportPanel.vue";
import { i18n } from "../src/lib/i18n";

function mountPanel() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const app = createApp(ImportPanel, { language: "zh-Hant" }).use(i18n);
  app.mount(el);
  return { el, app, teardown: () => { app.unmount(); el.remove(); } };
}

/** 記錄隱藏 input 被 click 幾次——這才是「有沒有打開選擇器」的判準。 */
function watchInputClicks(el: HTMLElement) {
  const calls: HTMLInputElement[] = [];
  for (const input of el.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    input.click = () => { calls.push(input); };
  }
  return calls;
}

const pickButton = (el: HTMLElement) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("import.pick"))!;

describe("匯入面板 · 選擇檔案", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("首次進來就點，會打開檔案選擇器", async () => {
    const { el, teardown } = mountPanel();
    await nextTick();
    const calls = watchInputClicks(el);
    pickButton(el).click();
    await nextTick();
    expect(calls.length, "點了沒反應：隱藏的 file input 沒有被叫起來").toBe(1);
    teardown();
  });

  it("切到 MMD 再切回酒館之後，按鈕仍然打得開選擇器", async () => {
    const { el, teardown } = mountPanel();
    await nextTick();
    const [tavernTab, mmdTab] = [...el.querySelectorAll<HTMLElement>(".seg__item")];
    mmdTab.click();
    await nextTick();
    tavernTab.click();
    await nextTick();
    const calls = watchInputClicks(el);
    pickButton(el).click();
    await nextTick();
    expect(calls.length, "切過分頁之後按鈕失效").toBe(1);
    teardown();
  });

  it("在 MMD 分頁上按鈕一樣打得開選擇器", async () => {
    const { el, teardown } = mountPanel();
    await nextTick();
    const mmdTab = [...el.querySelectorAll<HTMLElement>(".seg__item")][1];
    mmdTab.click();
    await nextTick();
    const calls = watchInputClicks(el);
    pickButton(el).click();
    await nextTick();
    expect(calls.length, "MMD 分頁上點了沒反應").toBe(1);
    expect(calls[0].multiple, "MMD 收三個檔，input 必須是 multiple").toBe(true);
    teardown();
  });
});
