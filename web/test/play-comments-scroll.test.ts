/**
 * 評論單上的滑動不穿到底下的聊天頁：手指底下有東西還能往那個方向捲才放行，否則吃掉。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { i18n } from "../src/lib/i18n";
import PlayComments from "../src/components/PlayComments.vue";
import { playSocial, registerPlayCard } from "../src/lib/play-social";

vi.mock("../src/components/CommentPanel.vue", () => ({
  default: defineComponent({ render: () => h("div", { class: "cmt-stub" }, "comments") }),
}));

function geometry(el: HTMLElement, box: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: box.scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: box.clientHeight });
  el.scrollTop = box.scrollTop ?? 0;
  Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: box.scrollTop ?? 0 });
}

/** 一指從 fromY 滑到 toY；回傳這一下有沒有被吃掉。 */
function swipe(target: Element, fromY: number, toY: number): boolean {
  const touch = (y: number) => [{ clientX: 100, clientY: y }];
  const start = new Event("touchstart", { bubbles: true, cancelable: true });
  Object.defineProperty(start, "touches", { value: touch(fromY) });
  target.dispatchEvent(start);
  const move = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(move, "touches", { value: touch(toY) });
  target.dispatchEvent(move);
  return move.defaultPrevented;
}

async function open() {
  registerPlayCard({ roleId: "role", cardId: "c1", provider: "harbor" });
  const host = document.body.appendChild(document.createElement("div"));
  const app = createApp(PlayComments).use(i18n);
  app.mount(host);
  const wrapper = { unmount: () => app.unmount() };
  playSocial.commentsOpen = true;
  await nextTick(); await nextTick();
  const body = document.querySelector<HTMLElement>(".play-comments__body")!;
  body.style.overflowY = "auto";
  return { wrapper, body, list: document.querySelector(".cmt-stub")!, overlay: document.querySelector(".play-comments")!, head: document.querySelector(".play-comments__head")! };
}

describe("PlayComments scroll", () => {
  afterEach(() => { registerPlayCard(null); document.body.innerHTML = ""; });

  it("swallows a swipe when the comments are too short to scroll", async () => {
    const { wrapper, body, list } = await open();
    geometry(body, { scrollHeight: 200, clientHeight: 400 });
    expect(swipe(list, 300, 200)).toBe(true);
    expect(swipe(list, 200, 300)).toBe(true);
    wrapper.unmount();
  });

  it("lets the list scroll while it has room, and swallows once it reaches the end", async () => {
    const { wrapper, body, list } = await open();
    geometry(body, { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });
    expect(swipe(list, 300, 200)).toBe(false); // 往下捲：還有內容
    expect(swipe(list, 200, 300)).toBe(true); // 已在頂端再往上拉：不傳下去
    geometry(body, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    expect(swipe(list, 300, 200)).toBe(true); // 已到底
    expect(swipe(list, 200, 300)).toBe(false); // 往回捲
    wrapper.unmount();
  });

  it("swallows swipes on the title bar and the dimmed backdrop", async () => {
    const { wrapper, body, head, overlay } = await open();
    geometry(body, { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
    expect(swipe(head, 300, 200)).toBe(true);
    expect(swipe(overlay, 300, 200)).toBe(true);
    wrapper.unmount();
  });

  it("does the same for the mouse wheel", async () => {
    const { wrapper, body, list } = await open();
    geometry(body, { scrollHeight: 200, clientHeight: 400 });
    const wheel = new WheelEvent("wheel", { deltaY: 40, bubbles: true, cancelable: true });
    list.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    wrapper.unmount();
  });
});
