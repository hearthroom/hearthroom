/**
 * 「打字找候選」的一格：打字停一下就列候選加「照這樣填」；點候選對上編號，點照打的就沒有編號；輸入法組字中不查。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { i18n } from "../src/lib/i18n";
import LookupField from "../src/components/LookupField.vue";

let app: App | null = null;
let el: HTMLElement | null = null;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
const settle = async () => { await new Promise((r) => setTimeout(r, 300)); await flush(); };
const lookup = vi.fn(async (q: string) => (q.includes("星") ? [{ id: "Q1", label: "崩壞：星穹鐵道", description: "2023 年電子遊戲" }] : []));
let value: { id?: string; label: string } = { label: "" };

async function mount(initial: { id?: string; label: string } = { label: "" }) {
  value = initial;
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createApp({ components: { LookupField }, data: () => ({ v: initial }), watch: { v(n: { id?: string; label: string }) { value = n; } }, template: '<LookupField v-model="v" :lookup="lookup" label="原作" />', setup: () => ({ lookup }) });
  app.use(i18n);
  app.mount(el);
  await flush();
}
const input = () => document.querySelector<HTMLInputElement>("input[data-lookup]")!;
const options = () => [...document.querySelectorAll<HTMLElement>("[role=option]")];
async function type(text: string) { input().value = text; input().dispatchEvent(new Event("input")); await nextTick(); }

beforeEach(() => { lookup.mockClear(); });
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; document.body.innerHTML = ""; });

describe("LookupField", () => {
  it("打字停一下才查；列候選（名字加說明）和「照這樣填」", async () => {
    await mount();
    await type("星鐵");
    expect(lookup).not.toHaveBeenCalled();
    await settle();
    expect(lookup).toHaveBeenCalledWith("星鐵");
    expect(options().map((o) => o.textContent?.trim())).toEqual(["崩壞：星穹鐵道2023 年電子遊戲", i18n.global.t("lookup.free", { q: "星鐵" })]);
  });

  it("點候選就對上編號、框裡換成正式名；再改字編號就掉了；點「照這樣填」沒有編號", async () => {
    await mount();
    await type("星鐵");
    await settle();
    options()[0]!.click();
    await flush();
    expect(value).toEqual({ id: "Q1", label: "崩壞：星穹鐵道" });
    expect(input().value).toBe("崩壞：星穹鐵道");
    expect(document.querySelector(".lookup__linked")).not.toBeNull();
    await type("星鐵同人");
    expect(value).toEqual({ label: "星鐵同人" });
    await settle();
    options()[1]!.click();
    await flush();
    expect(value).toEqual({ label: "星鐵同人" });
    expect(document.querySelector(".lookup__linked")).toBeNull();
  });

  it("鍵盤：往下到候選、Enter 選；Esc 關", async () => {
    await mount();
    await type("星");
    await settle();
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    await flush();
    expect(input().getAttribute("aria-activedescendant")).toMatch(/-1$/);
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush();
    expect(value.id).toBe("Q1");
    await type("星x");
    await settle();
    expect(input().getAttribute("aria-expanded")).toBe("true");
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("先填好的值連編號一起帶進來", async () => {
    await mount({ id: "Q1", label: "崩壞：星穹鐵道" });
    expect(input().value).toBe("崩壞：星穹鐵道");
    expect(document.querySelector(".lookup__linked")).not.toBeNull();
  });
});
