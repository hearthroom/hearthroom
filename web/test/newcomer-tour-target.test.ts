import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { newcomerTour } from "../src/lib/newcomer-tour";
import NewcomerTour from "../src/components/NewcomerTour.vue";

vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board" }));
vi.mock("../src/lib/api", () => ({ fetchBoard: vi.fn() }));
let app: ReturnType<typeof createApp>;
let root: HTMLElement;
let phone = true;
let top = 60;

beforeEach(async () => {
  vi.useFakeTimers(); phone = true; top = 60;
  newcomerTour.day = 2; newcomerTour.index = 0;
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".phone")) return phone ? new DOMRect(140, top, 110, 44) : new DOMRect();
    if (this.matches(".desktop")) return phone ? new DOMRect() : new DOMRect(260, 8, 110, 44);
    return new DOMRect();
  });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { render: () => null } }] });
  await router.push("/");
  root = document.body.appendChild(document.createElement("div"));
  app = createApp({ render: () => [
    h("a", { class: "desktop", "data-tour": "library" }, "desktop library"),
    h("a", { class: "phone", "data-tour": "library" }, "phone library"),
    h(NewcomerTour),
  ] }).use(router).use(i18n);
  app.mount(root); await nextTick();
});
afterEach(() => { app.unmount(); root.remove(); newcomerTour.day = 0; newcomerTour.index = 0; vi.restoreAllMocks(); vi.useRealTimers(); });

it("frames the visible library link and follows scroll and a phone-to-desktop resize", async () => {
  const hole = () => document.querySelector<HTMLElement>(".coach__hole");
  expect(hole()?.style.transform).toBe("translate(132px, 52px)");
  expect(hole()?.style.width).toBe("126px");
  top = 20; window.dispatchEvent(new Event("scroll")); await nextTick();
  expect(hole()?.style.transform).toBe("translate(132px, 12px)");
  phone = false; window.dispatchEvent(new Event("resize")); await nextTick();
  expect(hole()?.style.transform).toBe("translate(252px, 0px)");
  document.querySelector(".desktop")!.setAttribute("inert", "");
  await vi.advanceTimersByTimeAsync(200);
  expect(hole()).toBeNull();
});

it("remeasures after text/layout changes and clears the old frame when the target disappears", async () => {
  top = 100; await vi.advanceTimersByTimeAsync(200);
  expect(document.querySelector<HTMLElement>(".coach__hole")?.style.transform).toBe("translate(132px, 92px)");
  document.querySelector(".phone")!.remove();
  await vi.advanceTimersByTimeAsync(200);
  expect(document.querySelector(".coach__hole")).toBeNull();
  expect(document.querySelector("#coach-title")?.textContent).toBe(i18n.global.t("newcomer.tour.2.resume.title"));
});
