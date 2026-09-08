/**
 * 建卡頁的分類籤跟榜單同一份目錄：籤名照介面語言顯示，落到卡上的字用卡片語言，
 * 已經打了任一語言名字的籤要亮起來、再點一下拿掉的是原本那個字。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import TagPicker from "../src/components/editor/TagPicker.vue";

let app: App | null = null;
let root: HTMLElement;
const emitted: string[] = [];

async function mount(props: { selected: string[]; language: string; max?: number }) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
  await router.push("/");
  await router.isReady();
  root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp({ template: `<TagPicker :selected="selected" :language="language" :max="max" @toggle="onToggle" />`, components: { TagPicker },
    data: () => ({ selected: props.selected, language: props.language, max: props.max ?? 10 }),
    methods: { onToggle(name: string) { emitted.push(name); } } })
    .use(createPinia()).use(i18n).use(router);
  app.mount(root);
  await nextTick();
}
const chip = (text: string) => [...root.querySelectorAll<HTMLButtonElement>(".chip")].find((b) => b.textContent?.trim() === text)!;

afterEach(() => { app?.unmount(); app = null; root.remove(); emitted.length = 0; });

describe("TagPicker", () => {
  it("目錄全部鋪開（52 個，沒有類NTR），籤名照介面語言（預設繁體）", async () => {
    await mount({ selected: [], language: "zh-Hans" });
    const names = [...root.querySelectorAll(".chip")].map((b) => b.textContent?.trim());
    expect(names.length).toBe(52);
    expect(names).toContain("調教&強迫");
    expect(names).not.toContain("類NTR");
  });

  it("點一個籤：落到卡上的字用卡片語言（簡體卡拿到簡體名）", async () => {
    await mount({ selected: [], language: "zh-Hans" });
    chip("調教&強迫").click();
    await nextTick();
    expect(emitted).toEqual(["调教&强迫"]);
  });

  it("卡上已有任一語言的名字 → 籤亮起；再點拿掉的是卡上原本那個字", async () => {
    await mount({ selected: ["Roleplay"], language: "zh-Hans" });
    const c = chip("角色扮演");
    expect(c.getAttribute("aria-pressed")).toBe("true");
    c.click();
    await nextTick();
    expect(emitted).toEqual(["Roleplay"]);
  });

  it("滿了就不能再加，但已選的還能拿掉", async () => {
    await mount({ selected: ["百合"], language: "zh-Hant", max: 1 });
    expect(chip("催眠").disabled).toBe(true);
    expect(chip("百合").disabled).toBe(false);
  });
});
