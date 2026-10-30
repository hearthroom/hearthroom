/**
 * 「測試過的模型」選單：只到系列與模型兩層，兩層都能搜、都能選；存 series:／model: 值。
 * 編輯器與公開列表的篩選共用這一個元件。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { i18n, SOURCE_LOCALE } from "../src/lib/i18n";
import PresetModelPicker from "../src/components/preset/PresetModelPicker.vue";
import type { ModelCatalogGroup } from "../src/lib/presets";

const t = i18n.global.t;
const groups: ModelCatalogGroup[] = [
  { group: "DeepSeek", families: ["DeepSeek V4 Pro", "DeepSeek V4.1 Flash"] },
  { group: "Gemini", families: ["Gemini 3 Pro"] },
];

let app: App | null = null;
let el: HTMLElement | null = null;
let value: string[] = [];
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await nextTick(); };

async function mount(initial: string[] = [], multiple = true) {
  i18n.global.locale.value = SOURCE_LOCALE;
  value = initial;
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createApp({
    components: { PresetModelPicker },
    data: () => ({ v: initial, groups, multiple }),
    watch: { v(n: string[]) { value = n; } },
    template: '<PresetModelPicker v-model="v" :groups="groups" :multiple="multiple" input-id="pick" />',
  });
  app.use(i18n);
  app.mount(el);
  await flush();
}
const input = () => document.querySelector<HTMLInputElement>("#pick")!;
const options = () => [...document.querySelectorAll<HTMLElement>("[role=option]")];
const texts = () => options().map((o) => o.textContent?.replace(/\s+/g, " ").trim());
const chips = () => [...document.querySelectorAll<HTMLElement>("[data-testid=model-chip]")].map((c) => c.textContent?.replace(/\s+/g, " ").trim());
async function open() { input().focus(); input().dispatchEvent(new Event("focus")); await flush(); }
async function type(q: string) { input().value = q; input().dispatchEvent(new Event("input")); await flush(); }
async function key(k: string) { input().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); await flush(); }

afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; document.body.innerHTML = ""; });

describe("PresetModelPicker", () => {
  it("一打開就列出系列與其下的模型，不用先打字；系列那一列標「全系列」", async () => {
    await mount();
    await open();
    const all = t("preset.models.seriesAll");
    expect(texts()).toEqual([`DeepSeek ${all}`, "DeepSeek V4 Pro", "DeepSeek V4.1 Flash", `Gemini ${all}`, "Gemini 3 Pro"]);
  });

  it("搜模型名只留那個模型和它的系列；搜系列名留整個系列", async () => {
    await mount();
    await open();
    await type("flash");
    expect(texts()).toEqual([`DeepSeek ${t("preset.models.seriesAll")}`, "DeepSeek V4.1 Flash"]);
    await type("gemini");
    expect(texts()).toEqual([`Gemini ${t("preset.models.seriesAll")}`, "Gemini 3 Pro"]);
    await type("claude");
    expect(options()).toHaveLength(0);
    expect(document.querySelector("[data-testid=model-pick-empty]")?.textContent).toContain(t("preset.models.empty"));
  });

  it("選模型存 model:，選系列存 series:；選了整個系列，那個系列的模型就不再列出", async () => {
    await mount();
    await open();
    options()[2]!.click(); await flush();
    expect(value).toEqual(["model:DeepSeek V4.1 Flash"]);
    expect(texts()).not.toContain("DeepSeek V4.1 Flash");
    options().find((o) => o.textContent?.includes("Gemini"))!.click(); await flush();
    expect(value).toEqual(["model:DeepSeek V4.1 Flash", "series:Gemini"]);
    expect(texts().some((x) => x?.includes("Gemini"))).toBe(false);
    expect(chips()).toEqual(["DeepSeek V4.1 Flash", t("preset.models.series", { name: "Gemini" })]);
  });

  it("標籤上的移除鍵拿掉那一個；目錄裡找不到的舊值照原字顯示，也能拿掉", async () => {
    await mount(["series:DeepSeek", "old-lane-code"]);
    expect(chips()).toEqual([t("preset.models.series", { name: "DeepSeek" }), "old-lane-code"]);
    const remove = document.querySelectorAll<HTMLButtonElement>("[data-testid=model-chip] button")[1]!;
    expect(remove.getAttribute("aria-label")).toBe(t("preset.models.remove", { name: "old-lane-code" }));
    remove.click(); await flush();
    expect(value).toEqual(["series:DeepSeek"]);
  });

  it("鍵盤：下鍵走清單、Enter 選、Esc 關", async () => {
    await mount();
    await open();
    await key("ArrowDown");
    await key("Enter");
    expect(value).toEqual(["model:DeepSeek V4 Pro"]);
    await key("Escape");
    expect(options()).toHaveLength(0);
    await key("ArrowDown");
    expect(options().length).toBeGreaterThan(0);
  });

  it("空框按退格拿掉最後一個標籤；框裡有字時退格只刪字", async () => {
    await mount(["series:DeepSeek", "model:Gemini 3 Pro"]);
    await open();
    await type("ge");
    await key("Backspace");
    expect(value).toEqual(["series:DeepSeek", "model:Gemini 3 Pro"]);
    await type("");
    await key("Backspace");
    expect(value).toEqual(["series:DeepSeek"]);
  });

  it("單選（公開列表篩選）：選了就換掉原本的值並收起，目前選的那一列標為已選", async () => {
    await mount(["series:DeepSeek"], false);
    await open();
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    options().find((o) => o.textContent === "Gemini 3 Pro")!.click(); await flush();
    expect(value).toEqual(["model:Gemini 3 Pro"]);
    expect(options()).toHaveLength(0);
    expect(chips()).toEqual(["Gemini 3 Pro"]);
  });
});
