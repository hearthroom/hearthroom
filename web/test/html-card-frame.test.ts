/**
 * 開場白是 HTML 卡時，卡片頁用沙盒 iframe 畫；沙盒只給 allow-scripts。
 */
import { describe, expect, it } from "vitest";
import { createApp, h, nextTick } from "vue";
import HtmlCardFrame from "../src/components/HtmlCardFrame.vue";
import { buildSrcdoc } from "../src/lib/html-card-frame";
import { hasHtml } from "../src/lib/welcome-render";

function mountFrame(props: { html: string; title?: string }) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const app = createApp({ render: () => h(HtmlCardFrame, props) });
  app.mount(el);
  return { iframe: el.querySelector("iframe") as HTMLIFrameElement, unmount: () => { app.unmount(); el.remove(); } };
}

describe("HTML 卡開場白", () => {
  it("認得 HTML：有真正的標籤才算，純文字裡的 < 不算", () => {
    expect(hasHtml('<section class="hc-c"><hc-stat label="x" value="1"></hc-stat></section>')).toBe(true);
    expect(hasHtml("<b>粗</b>")).toBe(true);
    expect(hasHtml("3 < 5，而且 a<b 也不是標籤")).toBe(false);
    expect(hasHtml("")).toBe(false);
  });

  it("srcdoc 帶著元件庫、樣式與作者的 HTML；沙盒只有 allow-scripts", () => {
    const html = '<hc-tag bg="#000">案件 F-707</hc-tag>';
    const doc = buildSrcdoc(html, { color: "#f2f2f5", font: "system-ui" });
    expect(doc).toContain(html);
    expect(doc).toContain("--hc-primary");
    expect(doc).toContain("customElements.define('hc-stat'");
    expect(doc).toContain("hc-card-size");

    const { iframe, unmount } = mountFrame({ html, title: "開場白" });
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("srcdoc")).toContain(html);
    expect(iframe.getAttribute("title")).toBe("開場白");
    unmount();
  });

  it("高度只聽自己那個 iframe 報的數", async () => {
    const { iframe, unmount } = mountFrame({ html: "<b>x</b>" });
    window.dispatchEvent(new MessageEvent("message", { data: { type: "hc-card-size", height: 333 }, source: null }));
    await nextTick();
    expect(iframe.style.height).toBe("120px");
    window.dispatchEvent(new MessageEvent("message", { data: { type: "hc-card-size", height: 333 }, source: iframe.contentWindow }));
    await nextTick();
    expect(iframe.style.height).toBe("333px");
    unmount();
  });
});
