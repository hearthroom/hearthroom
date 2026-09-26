/**
 * 卡片主頁只露出開場白的開頭（owner 2026-09-26：長開場白佔掉整頁，玩家不會在這裡讀完），
 * 作者圖片捲到附近才載，評論摘要放在主頁上。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { i18n } from "../src/lib/i18n";
import ClampBlock from "../src/components/ClampBlock.vue";
import { lazyImages } from "../src/lib/html-card-frame";

describe("作者圖片延後載入", () => {
  it("沒寫 loading 的圖改成捲到附近才載；作者自己寫了的照他的", () => {
    expect(lazyImages('<p>hi</p><img src="a.png"><IMG class="x" src=b.png>')).toBe('<p>hi</p><img loading="lazy" decoding="async" src="a.png"><img loading="lazy" decoding="async" class="x" src=b.png>');
    expect(lazyImages('<img src="a.png" loading="eager">')).toBe('<img src="a.png" loading="eager">');
    expect(lazyImages("<imgur>not an image</imgur>")).toBe("<imgur>not an image</imgur>");
  });
});

describe("收起過長的內容", () => {
  let app: App | null = null;
  let el: HTMLElement | null = null;
  let resize: (() => void) | null = null;
  afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });

  function mount(contentHeight: number) {
    vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resize = cb; } observe() {} disconnect() {} });
    el = document.createElement("div");
    document.body.appendChild(el);
    app = createApp({ components: { ClampBlock }, template: `<ClampBlock :max="360" more-label="展開" less-label="收起"><div class="content" /></ClampBlock>` }).use(i18n);
    app.mount(el);
    const inner = el.querySelector(".content")!.parentElement!;
    Object.defineProperty(inner, "offsetHeight", { configurable: true, get: () => contentHeight });
    resize!();
  }

  it("短內容照原樣顯示，不多一個按鈕", async () => {
    mount(380);
    await nextTick();
    expect(el!.querySelector("button")).toBeNull();
    expect(el!.querySelector(".clamp__view--cut")).toBeNull();
  });

  it("長內容收在上限內並淡出；按一下展開、再按收起", async () => {
    mount(4000);
    await nextTick();
    const view = el!.querySelector<HTMLElement>(".clamp__view")!;
    const button = el!.querySelector<HTMLButtonElement>("button")!;
    expect(view.classList.contains("clamp__view--cut")).toBe(true);
    expect(view.style.maxHeight).toBe("408px");
    expect(button.textContent).toContain("展開");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.click();
    await nextTick();
    expect(view.style.maxHeight).toBe("");
    expect(view.classList.contains("clamp__view--cut")).toBe(false);
    expect(button.textContent).toContain("收起");
    button.click();
    await nextTick();
    expect(view.style.maxHeight).toBe("408px");
  });
});

describe("主頁的評論摘要", () => {
  let app: App | null = null;
  let el: HTMLElement | null = null;
  afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });
  const comment = (n: number) => ({ commentId: `c${n}`, content: `第 ${n} 則`, parentId: "", rootId: "", replyToNickName: "", likeCount: 0, replyCount: 0, createTime: new Date().toISOString(), accountNickName: `人${n}`, accountAvatar: "", handle: "", isLiked: false, isOwner: false, isCreator: false, canDelete: false });

  async function mount(body: unknown, status = 200) {
    const { default: CommentPreview } = await import("../src/components/CommentPreview.vue");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    const events: string[] = [];
    el = document.createElement("div");
    document.body.appendChild(el);
    app = createApp({ components: { CommentPreview }, template: `<CommentPreview card-id="abc" @open="events.push('open')" @count="events.push('count:' + $event)" />`, data: () => ({ events }) }).use(i18n);
    app.mount(el);
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    await nextTick();
    return events;
  }

  it("只畫前三則、帶總數；「查看全部」切到評論分頁", async () => {
    const events = await mount({ total: 14, isRoleCreator: false, comments: [1, 2, 3, 4, 5].map(comment) });
    expect(el!.querySelectorAll(".cprev__item")).toHaveLength(3);
    expect(events).toContain("count:14");
    const all = el!.querySelector<HTMLButtonElement>(".btn")!;
    expect(all.textContent).toContain("14");
    all.click();
    expect(events).toContain("open");
  });

  it("沒有評論：邀請寫第一則；讀不到：整塊不畫", async () => {
    await mount({ total: 0, isRoleCreator: false, comments: [] });
    expect(el!.textContent).toContain(i18n.global.t("comment.empty"));
    app!.unmount(); el!.remove();
    await mount({ error: "adult_content" }, 403);
    expect(el!.querySelector(".cprev")).toBeNull();
  });
});
