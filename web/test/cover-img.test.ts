/**
 * 小縮圖（首頁面板「接著聊」、對話紀錄的頭像）也走卡片清單同一條退路：
 * 會動的縮圖 → 靜態縮圖 → 原圖 → 空框。直接載原圖的話，5 MB、110 格的動圖會在 32 px 的框裡全尺寸逐格解碼，整塊閃。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import CoverImg from "../src/components/CoverImg.vue";

const ART = "https://assets.harperharbor.com/versions/cover-1";
let app: App | null = null;
let el: HTMLElement | null = null;
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });

describe("CoverImg", () => {
  it("縮圖 → 靜態縮圖 → 原圖 → 空框，class 一路帶著", async () => {
    vi.stubGlobal("location", { ...window.location, hostname: "sukisuki.ai" });
    el = document.createElement("div");
    document.body.appendChild(el);
    app = createApp({ render: () => h(CoverImg, { src: ART, class: "thumb", loading: "lazy" }) });
    app.mount(el);
    await nextTick();
    const img = () => el!.querySelector("img");
    expect(img()!.getAttribute("src")).toContain("anim=true");
    expect(img()!.className).toBe("thumb");
    expect(img()!.getAttribute("loading")).toBe("lazy");
    img()!.dispatchEvent(new Event("error")); await nextTick();
    expect(img()!.getAttribute("src")).toContain("anim=false");
    img()!.dispatchEvent(new Event("error")); await nextTick();
    expect(img()!.getAttribute("src")).toBe(ART);
    img()!.dispatchEvent(new Event("error")); await nextTick();
    expect(img()).toBeNull();
    expect(el!.querySelector("span.thumb")).not.toBeNull();
  });
});
