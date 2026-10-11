import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import { i18n } from "../src/lib/i18n";
const fixture = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../src/lib/track", () => ({ track: fixture.track }));
import TipMenu from "../src/components/TipMenu.vue";

const tips = [
  { platform: "fanbox", handle: "nightferry", url: "https://www.fanbox.cc/@nightferry" },
  { platform: "kofi", handle: "nightferry", url: "https://ko-fi.com/nightferry" },
] as const;
let app: App, el: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  el = document.createElement("div");
  document.body.append(el);
  app = createApp({ render: () => h(TipMenu, { tips: [...tips], variant: "pill" }) }).use(i18n);
  app.mount(el);
});
afterEach(() => { app.unmount(); el.remove(); });

it("opens a panel of the author's tip pages that leave the site in a new tab", async () => {
  expect(el.querySelector(".tip__panel")).toBeNull();
  el.querySelector<HTMLButtonElement>(".tip__btn")!.click();
  await nextTick();
  const links = [...el.querySelectorAll<HTMLAnchorElement>(".tip__item")];
  expect(links.map((a) => a.href)).toEqual(tips.map((t) => t.url));
  for (const a of links) {
    expect(a.target).toBe("_blank");
    expect(a.rel.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer", "nofollow"]));
  }
  expect(links[0].textContent).toContain("pixiv FANBOX");
  expect(fixture.track).toHaveBeenCalledWith("tip_open");
});

it("records which platform was picked, never the author, and closes", async () => {
  el.querySelector<HTMLButtonElement>(".tip__btn")!.click();
  await nextTick();
  const kofi = el.querySelectorAll<HTMLAnchorElement>(".tip__item")[1];
  kofi.addEventListener("click", (e) => e.preventDefault());
  kofi.click();
  await nextTick();
  expect(fixture.track).toHaveBeenLastCalledWith("tip_click", { subject: "kofi" });
  expect(el.querySelector(".tip__panel")).toBeNull();
});
