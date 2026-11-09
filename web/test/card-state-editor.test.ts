/**
 * 卡片變數編輯區：插入範例、表格與原始碼兩個分頁、解析錯誤與每輪大小的提示、面板預覽。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import { i18n } from "../src/lib/i18n";
import CardStateEditor from "../src/components/editor/CardStateEditor.vue";
import { normalizeState, type CardStateDraft } from "../src/lib/card-state";

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
  it("空骨架插入範例；再插一個併進去；併進只有值的骨架時改成 MVU 寫法，原本的清單不會變成一對", async () => {
    const { model } = mount(empty());
    button(t("editor.state.example.affection")).click();
    await nextTick();
    expect(JSON.parse(model.value.dataText)).toEqual({ 好感度: [0, "0 到 100；對方被打動時加 1 到 5，被冒犯時減少"] });
    button(t("editor.state.example.quests")).click();
    await nextTick();
    expect(Object.keys(JSON.parse(model.value.dataText))).toEqual(["好感度", "任務"]);

    model.value = { convention: "plain", dataText: '{"標籤": ["溫柔", "嘴硬"]}', rulesText: "", template: "" };
    await nextTick();
    button(t("editor.state.example.inventory")).click();
    await nextTick();
    expect(model.value.convention).toBe("mvu");
    expect(normalizeState("mvu", JSON.parse(model.value.dataText)).data).toEqual({ 標籤: ["溫柔", "嘴硬"], 背包: ["短刀", "鐵護腕"] });
  });

  it("表格：打開不改原文；改一格寫回原文；寫了「什麼時候變」就換成 MVU，清掉又回到只有值", async () => {
    const original: CardStateDraft = { convention: "plain", dataText: '{"好感度":10,"背包":["短刀","鐵護腕"]}', rulesText: "", template: "" };
    const { model } = mount(original);
    await nextTick();
    // 原文是緊湊寫法，表格只要寫回過就會重新排版
    expect(model.value.dataText).toBe(original.dataText);
    expect(root.querySelector("#f-state-tab-table")?.getAttribute("aria-selected")).toBe("true");

    const inputs = () => [...root.querySelectorAll<HTMLInputElement>(".ctable__row:not(.ctable__head) input.input")];
    const set = async (el: HTMLInputElement, v: string) => { el.value = v; el.dispatchEvent(new Event("input")); await nextTick(); };
    // 第一列：名稱、開局值、什麼時候變
    await set(inputs()[1], "20");
    expect(model.value.convention).toBe("plain");
    expect(JSON.parse(model.value.dataText)).toEqual({ 好感度: 20, 背包: ["短刀", "鐵護腕"] });

    await set(inputs()[2], "被打動時加");
    expect(model.value.convention).toBe("mvu");
    expect(JSON.parse(model.value.dataText)).toEqual({ 好感度: [20, "被打動時加"], 背包: [["短刀", "鐵護腕"], ""] });

    await set(inputs()[2], "");
    expect(model.value.convention).toBe("plain");

    // 數字打錯時不寫回，錯誤標在那一格下面
    const before = model.value.dataText;
    await set(inputs()[1], "abc");
    inputs()[1].dispatchEvent(new Event("blur"));
    await nextTick();
    expect(model.value.dataText).toBe(before);
    expect(inputs()[1].getAttribute("aria-invalid")).toBe("true");
  });

  it("原文解不開或表格放不下時表格分頁停用，只開原始碼；放不下時原始碼上方有一行說明", async () => {
    const { model } = mount({ ...empty(), dataText: '{"a": 1,' });
    await nextTick();
    const tableTab = () => root.querySelector<HTMLButtonElement>("#f-state-tab-table")!;
    expect(tableTab().getAttribute("aria-disabled")).toBe("true");
    expect(tableTab().title).toBe(t("editor.state.view.invalid"));
    expect(root.querySelector("#f-state-tab-source")?.getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector(".cstate__note")).toBeNull();

    model.value = { ...model.value, dataText: '{"a": {"b": {"c": 1}}}' };
    await nextTick();
    expect(tableTab().title).toBe(t("editor.state.view.unsupported"));
    expect(root.querySelector(".cstate__note")?.textContent).toContain(t("editor.state.view.unsupported"));
    tableTab().click();
    await nextTick();
    expect(root.querySelector("#f-state-tab-source")?.getAttribute("aria-selected")).toBe("true");

    // 修好之後停在原始碼，不自動跳回表格；按了表格才換
    model.value = { ...model.value, dataText: '{"a": 1}' };
    await nextTick();
    expect(tableTab().getAttribute("aria-disabled")).toBeNull();
    expect(root.querySelector("#f-state-tab-source")?.getAttribute("aria-selected")).toBe("true");
    tableTab().click();
    await nextTick();
    expect(tableTab().getAttribute("aria-selected")).toBe("true");
  });

  it("皮膚空白時預覽框說明沒有面板，按「用範例皮膚」放進範例", async () => {
    const { model } = mount({ ...empty(), dataText: '{"好感度": 10}' });
    await nextTick();
    expect(root.querySelector("iframe")).toBeNull();
    expect(root.querySelector(".cstate__skinempty")?.textContent).toContain(t("editor.state.preview.empty"));
    button(t("editor.state.template.example")).click();
    await nextTick();
    expect(model.value.template).toContain("{{#each this}}");
    expect(root.querySelector("iframe")?.getAttribute("srcdoc")).toContain("好感度");
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
