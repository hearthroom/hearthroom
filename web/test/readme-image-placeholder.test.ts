/**
 * 介紹裡的圖延遲載入，但 Markdown 不帶寬高：載好之前每張高 0，九張全擠在首屏附近、
 * 全部落進瀏覽器的延遲載入範圍，一進頁就一起下載（100257 實測 944 KB，九張全下）。
 * 所以載好之前先佔一塊 3:4 的位置（data-pending），載好或載失敗就換回原本的大小。
 */
import { afterEach, expect, it } from "vitest";
import { createApp, nextTick, type App } from "vue";
import ReadmeView from "../src/components/ReadmeView.vue";

let app: App | null = null;
let el: HTMLElement | null = null;
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; });

it("圖載好之前佔位，載好或載失敗就拿掉佔位", async () => {
  el = document.createElement("div"); document.body.appendChild(el);
  app = createApp(ReadmeView, { source: "![a](https://cdn.test/a.webp)\n\n![b](https://cdn.test/b.webp)" });
  app.mount(el); await nextTick();
  const [a, b] = [...el.querySelectorAll("img")];
  expect(a!.hasAttribute("data-pending")).toBe(true);
  expect(b!.hasAttribute("data-pending")).toBe(true);
  a!.dispatchEvent(new Event("load"));
  b!.dispatchEvent(new Event("error"));
  expect(a!.hasAttribute("data-pending")).toBe(false);
  expect(b!.hasAttribute("data-pending")).toBe(false);
});
