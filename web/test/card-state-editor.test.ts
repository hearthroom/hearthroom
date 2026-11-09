/**
 * 卡片變數編輯區：插入範例、寫法切換、解析錯誤與每輪大小的提示、面板預覽。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import { i18n } from "../src/lib/i18n";
import CardStateEditor from "../src/components/editor/CardStateEditor.vue";
import type { CardStateDraft } from "../src/lib/card-state";

let app: App | null = null;
let root: HTMLElement;

function mount(initial: CardStateDraft, language = "zh-Hant") {
  const model = ref<CardStateDraft>(initial);
  const slotProps = ref<{ template: string; data: unknown } | null>(null);
  root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp({
    render: () => h(CardStateEditor, {
      modelValue: model.value,
      language,
      "onUpdate:modelValue": (next: CardStateDraft) => { model.value = next; },
    }, { preview: (p: { template: string; data: unknown }) => { slotProps.value = p; return null; } }),
  }).use(i18n);
  app.mount(root);
  return { model, slotProps };
}
const t = (key: string, params: Record<string, unknown> = {}) => i18n.global.t(key, params);
const button = (text: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
const empty = (): CardStateDraft => ({ convention: "mvu", dataText: "", rulesText: "", template: "" });

afterEach(() => {
  app?.unmount();
  app = null;
  root.remove();
});

describe("CardStateEditor", () => {
  it("空骨架插入範例；再插一個併進去；只有值的寫法拿掉規則", async () => {
    const { model } = mount(empty());
    button(t("editor.state.example.affection")).click();
    await nextTick();
    expect(JSON.parse(model.value.dataText)).toEqual({ 好感度: [0, "0 到 100；對方被打動時加 1 到 5，被冒犯時減少"] });
    button(t("editor.state.example.quests")).click();
    await nextTick();
    expect(Object.keys(JSON.parse(model.value.dataText))).toEqual(["好感度", "任務"]);

    button(t("editor.state.convention.plain")).click();
    await nextTick();
    expect(model.value.convention).toBe("plain");
    model.value = { ...model.value, dataText: "" };
    await nextTick();
    button(t("editor.state.example.inventory")).click();
    await nextTick();
    expect(JSON.parse(model.value.dataText)).toEqual({ 背包: ["短刀", "鐵護腕"] });
  });

  it("切換寫法時轉換骨架：清單不會變成一對，規則搬到變數規則不會掉", async () => {
    const { model } = mount({ convention: "plain", dataText: '{"背包": ["短刀", "鐵護腕"]}', rulesText: "", template: "" });
    button(t("editor.state.convention.mvu")).click();
    await nextTick();
    expect(model.value.convention).toBe("mvu");
    expect(JSON.parse(model.value.dataText)).toEqual({ 背包: [["短刀", "鐵護腕"], ""] });

    model.value = { ...model.value, dataText: '{"生命": [100, "受傷時減少"]}' };
    await nextTick();
    button(t("editor.state.convention.plain")).click();
    await nextTick();
    expect(model.value.convention).toBe("plain");
    expect(JSON.parse(model.value.dataText)).toEqual({ 生命: 100 });
    expect(model.value.rulesText).toBe("生命: 受傷時減少");

    model.value = { ...model.value, dataText: '{"a": ' };
    await nextTick();
    button(t("editor.state.convention.mvu")).click();
    await nextTick();
    expect(model.value).toMatchObject({ convention: "mvu", dataText: '{"a": ' });
    expect(root.querySelector("#f-state-data-error")).not.toBeNull();
  });

  it("範例跟著卡片語言", async () => {
    const { model } = mount(empty(), "en");
    button(t("editor.state.example.inventory")).click();
    await nextTick();
    expect(Object.keys(JSON.parse(model.value.dataText))).toEqual(["inventory"]);
  });

  it("解析錯誤指出行數；解得開時顯示每輪大小，超過 4 KB 換成提醒", async () => {
    const { model } = mount({ ...empty(), dataText: '{\n  "a": 1,\n}' });
    await nextTick();
    const error = root.querySelector("#f-state-data-error")?.textContent ?? "";
    expect(error === t("editor.state.data.errorAt", { line: 3 }) || error === t("editor.state.data.error")).toBe(true);
    expect(root.querySelector("#f-state-data")?.getAttribute("aria-invalid")).toBe("true");

    model.value = { ...model.value, dataText: '{"好感度": [10, "規則"]}' };
    await nextTick();
    expect(root.querySelector("#f-state-data-error")).toBeNull();
    expect(root.textContent).toContain(t("editor.state.size", { n: "10" }));

    model.value = { ...model.value, dataText: JSON.stringify({ a: "x".repeat(1500), b: "x".repeat(1500), c: "x".repeat(1500) }) };
    await nextTick();
    expect(root.querySelector(".cstate__warn")?.textContent).toContain(t("editor.state.size.warn", { n: (4522).toLocaleString(String(i18n.global.locale.value)) }));
  });

  it("預覽用正規化後的值畫皮膚", async () => {
    mount({ convention: "mvu", dataText: '{"好感度": [10, "規則"]}', rulesText: "", template: "<b>{{好感度}}</b>" });
    await nextTick();
    expect(root.querySelector("iframe")?.getAttribute("srcdoc")).toContain("<b>10</b>");
  });
  it("預覽跟遊玩畫布同一套畫法：皮膚放在面板容器裡，樣式只套在容器之內", async () => {
    mount({ convention: "plain", dataText: '{"a": 1}', rulesText: "", template: "<style>b { color: red; }</style><b>{{a}}</b>" });
    await nextTick();
    const doc = new DOMParser().parseFromString(root.querySelector("iframe")?.getAttribute("srcdoc") ?? "", "text/html");
    const skin = doc.querySelector(".lt-state-skin");
    expect(skin?.querySelector("b")?.textContent).toBe("1");
    const css = skin?.querySelector("style")?.textContent ?? "";
    expect(css).toMatch(/\.lt-state-skin\s+b\b/);
    for (const [, selector] of css.matchAll(/([^{}]+)\{/g)) expect(selector.trim()).toMatch(/^\.lt-state-skin\b/);
  });
  it("皮膚寫壞時標出第幾行，不畫空白框", async () => {
    mount({ convention: "plain", dataText: '{"金錢": 1}', rulesText: "", template: "{{#if 金錢}}<b>" });
    await nextTick();
    expect(root.querySelector("iframe")).toBeNull();
    expect(root.querySelector(".ppreview [role=alert]")?.textContent).toContain("1");
  });
});
