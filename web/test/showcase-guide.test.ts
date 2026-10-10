import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import { i18n } from "../src/lib/i18n";
import FieldText from "../src/components/editor/FieldText.vue";
import ShowcaseGuide from "../src/components/editor/ShowcaseGuide.vue";

let app: App | null = null;
let el: HTMLElement | null = null;
afterEach(() => { app?.unmount(); el?.remove(); document.body.innerHTML = ""; app = null; el = null; });

function mount(render: () => ReturnType<typeof h>) {
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createApp({ render }).use(i18n);
  app.mount(el);
}

describe("一句話簡介的建議長度", () => {
  it("超過建議長度才提醒；不擋輸入，計數也不染成錯誤的紅", async () => {
    const text = ref("短");
    mount(() => h(FieldText, { id: "f", label: "簡介", modelValue: text.value, max: 500, advise: 10, adviseText: "會被截斷" }));
    expect(document.querySelector(".advise")).toBeNull();
    text.value = "字".repeat(11);
    await nextTick();
    expect(document.querySelector(".advise")?.textContent).toBe("會被截斷");
    expect(document.querySelector(".count")?.className).not.toContain("over");
  });

  it("超過上限時只顯示上限的紅字，不再疊一條建議", async () => {
    mount(() => h(FieldText, { id: "f", label: "簡介", modelValue: "字".repeat(501), max: 500, advise: 10, adviseText: "會被截斷" }));
    expect(document.querySelector(".advise")).toBeNull();
    expect(document.querySelector(".count")?.className).toContain("over");
  });
});

describe("顯示在哪裡？", () => {
  it("示意圖用作者正在寫的名字、簡介與標籤；Esc 關閉", async () => {
    const open = ref(true);
    mount(() => h(ShowcaseGuide, {
      open: open.value, name: "燈塔守人", summary: "港口的燈每晚都亮著", tags: ["奇幻", "日常"], cover: "", banner: "", advise: 80,
      onClose: () => { open.value = false; },
    }));
    await nextTick();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelectorAll(".tile__name, .page__name")[0]?.textContent).toBe("燈塔守人");
    expect(dialog.querySelector(".tile__summary")?.textContent).toBe("港口的燈每晚都亮著");
    expect(dialog.textContent).toContain("奇幻");
    // 三個標號都對得上下面的說明
    expect(dialog.querySelectorAll(".guide__list li")).toHaveLength(3);
    expect(dialog.textContent).toContain(i18n.global.t("editor.showcase.summaryHow", { n: 80 }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
