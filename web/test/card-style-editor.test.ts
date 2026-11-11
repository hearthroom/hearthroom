import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import CardStyleEditor from "../src/components/editor/CardStyleEditor.vue";
import { i18n, loadLocale } from "../src/lib/i18n";
import { readAppearance, writeAppearance, CARD_CSS_MAX_BYTES } from "../src/lib/card-appearance";
import { confirmState, settleConfirm } from "../src/lib/confirm";

let app: App | undefined;
let root: HTMLElement | undefined;
const t = (key: string) => i18n.global.t(`editor.cardCss.${key}`);
function mount(css = "", cssDialect?: string, invalid = false) {
  const model = ref(css);
  const parentInvalid = ref(invalid);
  const removed = vi.fn();
  root = document.createElement("div"); document.body.append(root);
  app = createApp({ render: () => h(CardStyleEditor, { modelValue: model.value, cssDialect, invalid: parentInvalid.value,
    "onUpdate:modelValue": (value: string) => { model.value = value; }, onRemove: removed }) }).use(i18n);
  app.mount(root);
  return { model, parentInvalid, removed };
}
const click = async (selector: string) => { root!.querySelector<HTMLButtonElement>(selector)!.click(); await nextTick(); };
const input = async (selector: string, value: string) => {
  const el = root!.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); await nextTick(); return el;
};
beforeEach(() => {
  i18n.global.locale.value = "zh-Hant";
  vi.stubGlobal("CSS", { supports: vi.fn((_property: string, value: string) => !value.includes("!invalid")) });
});
afterEach(() => { settleConfirm(false); app?.unmount(); root?.remove(); app = undefined; root = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("CardStyleEditor", () => {
  it("starts collapsed, adding opens eight appearance fields without changing the card", async () => {
    const { model } = mount();
    expect(root!.textContent).toContain(t("unused"));
    expect(root!.querySelector("textarea")).toBeNull();
    await click("[data-card-css-toggle]");
    expect(root!.querySelectorAll("[data-appearance-field]")).toHaveLength(8);
    expect(document.activeElement).toBe(root!.querySelector('[data-appearance-field="aiBg"]'));
    expect(model.value).toBe("");
    expect(root!.querySelector("select")).toBeNull();
  });

  it("keeps imported CSS unchanged until an edit, validates fields locally, and lets valid edits continue", async () => {
    const original = '#ai-chat-input{color:red}\n.author{color:blue}';
    const { model } = mount(original, "fengyue");
    await click("[data-card-css-toggle]");
    expect(model.value).toBe(original);
    expect(root!.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(original);
    const bad = await input('[data-appearance-field="aiBg"]', "!invalid");
    expect(bad.getAttribute("aria-invalid")).toBe("true");
    expect(model.value).toBe(original);
    await input("textarea", original + "\n.next{color:green}");
    expect(model.value).toContain(".next{color:green}");
    expect(root!.querySelector<HTMLInputElement>('[data-appearance-field="aiBg"]')!.value).toBe("!invalid");
    await input('[data-appearance-field="aiBg"]', "#123456");
    expect(CSS.supports).toHaveBeenCalledWith("color", "#123456");
    expect(readAppearance(model.value).values.aiBg).toBe("#123456");
    expect(readAppearance(model.value).customCss).toBe(original + "\n.next{color:green}");
  });

  it("round-trips the managed block, font values and clearing one field without deleting custom CSS", async () => {
    const { model } = mount(writeAppearance({ bubbleText: "#ffffff", font: "Georgia, serif" }, ".mine{padding:8px}"));
    await click("[data-card-css-toggle]");
    expect(root!.querySelector<HTMLInputElement>('[data-appearance-field="font"]')!.value).toBe("Georgia, serif");
    await input('[data-appearance-field="font"]', "system-ui, sans-serif");
    expect(CSS.supports).toHaveBeenCalledWith("font-family", "system-ui, sans-serif");
    await click('[data-appearance-clear="bubbleText"]');
    expect(readAppearance(model.value).values.bubbleText).toBeUndefined();
    expect(readAppearance(model.value).values.font).toBe("system-ui, sans-serif");
    expect(readAppearance(model.value).customCss).toBe(".mine{padding:8px}");
  });

  it("removal requires confirmation, cancellation keeps content, acceptance emits remove and clears CSS", async () => {
    const { model, removed } = mount(".mine{color:red}", "fengyue");
    await click("[data-card-css-toggle]");
    await click("[data-card-css-remove]");
    expect(confirmState.current?.danger).toBe(true);
    expect(confirmState.current?.dangerAppearance).toBe("subdued");
    settleConfirm(false); await nextTick();
    expect(model.value).toBe(".mine{color:red}");
    expect(removed).not.toHaveBeenCalled();
    await click("[data-card-css-remove]"); settleConfirm(true); await Promise.resolve(); await nextTick();
    expect(model.value).toBe(""); expect(removed).toHaveBeenCalledOnce();
    expect(root!.querySelector("textarea")).toBeNull();
  });

  it("copies reference selectors with inline success and failure feedback", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText } as unknown as Clipboard);
    mount(); await click("[data-card-css-toggle]"); await click("[data-card-css-reference-toggle]");
    await click('[data-copy-selector="ai"]');
    expect(writeText).toHaveBeenCalledWith('.mes[data-lt-role="ai"] .mes_text');
    expect(root!.querySelector('[data-copy-selector="ai"]')!.textContent).toContain(t("copied"));
    await vi.advanceTimersByTimeAsync(2000); await nextTick();
    expect(root!.querySelector('[data-copy-selector="ai"]')!.textContent).toContain(t("copy"));
    writeText.mockRejectedValueOnce(new Error("permission"));
    await click('[data-copy-selector="ai"]'); await nextTick();
    expect(root!.querySelector('[role="status"]')!.textContent).toContain(t("copyFailed"));
    expect(root!.querySelector(".toast")).toBeNull();
  });

  it("counts UTF-8 bytes and expands when the parent marks the CSS invalid", async () => {
    const { model, parentInvalid } = mount();
    parentInvalid.value = true; await nextTick();
    expect(root!.querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
    parentInvalid.value = false; await nextTick();
    const value = "中".repeat(Math.floor(CARD_CSS_MAX_BYTES / 3) + 1);
    await input("textarea", value);
    expect(model.value).toBe(value);
    expect(root!.querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
    expect(root!.querySelector("[data-card-css-usage]")?.textContent).toContain("512");
    expect(root!.textContent).toContain(i18n.global.t("editor.cardCss.tooLong", { max: 512 }));
  });

  it("offers all five locales and guide anchors without raw keys", async () => {
    mount(); await click("[data-card-css-toggle]"); await click("[data-card-css-reference-toggle]");
    for (const [locale, anchor] of Object.entries({ "zh-Hant": "常用外觀變數", "zh-Hans": "常用外观变量", en: "common-style-variables", ja: "よく使う外観変数", ko: "자주-쓰는-스타일-변수" })) {
      await loadLocale(locale); i18n.global.locale.value = locale; await nextTick();
      expect(root!.textContent).not.toContain("editor.cardCss.");
      expect(root!.querySelector("[data-card-css-guide]")!.getAttribute("href")).toContain(`?way=web#${anchor}`);
      expect(root!.querySelectorAll("[data-appearance-field]")).toHaveLength(8);
    }
  });
});
