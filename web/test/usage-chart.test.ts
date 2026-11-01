import { afterEach, expect, it } from "vitest";
import { createApp, h, type App } from "vue";
import { i18n } from "../src/lib/i18n";
import UsageChart from "../src/components/UsageChart.vue";
import type { UsageBar } from "../src/lib/score-usage";

const t = i18n.global.t;
let app: App, root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); });
function mount(bars: UsageBar[], weekly = false) {
  root = document.createElement("div"); document.body.append(root);
  app = createApp({ render: () => h(UsageChart, { bars, weekly }) }).use(i18n); app.mount(root);
  return root;
}
const day = (i: number, spent: number, earned: number): UsageBar => {
  const date = new Date(2026, 9, 3 + i).toLocaleDateString("sv-SE");
  return { key: date, start: date, end: date, spent, earned, count: 1 };
};

it("shows income above the zero line and spending below it, with a legend", () => {
  const page = mount([day(0, 0, 0), day(1, 500, 50), day(2, 2000, 100)]);
  expect(page.querySelector(".usage-chart__legend")?.textContent).toContain(t("wallet.records.income"));
  expect(page.querySelector(".usage-chart__legend")?.textContent).toContain(t("wallet.records.expense"));
  const col = page.querySelectorAll(".usage-chart__col")[1];
  expect(col.querySelector<HTMLElement>(".usage-chart__bar--earned")?.style.height).toBe("50%");
  expect(col.querySelector<HTMLElement>(".usage-chart__bar--spent")?.style.height).toBe("25%");
  expect(col.getAttribute("aria-label")).toContain("50");
  expect(col.getAttribute("aria-label")).toContain("500");
});

it("days with only income are not reported as empty", () => {
  const page = mount([day(0, 0, 0), day(1, 0, 50)]);
  expect(page.querySelector(".usage-chart__empty")).toBeNull();
  expect(page.querySelectorAll(".usage-chart__bar--earned")).toHaveLength(2);
});

it("thirty days get a date every third day counted back from today", () => {
  const page = mount(Array.from({ length: 30 }, (_, i) => day(i, 10, 0)));
  const labels = [...page.querySelectorAll(".usage-chart__x")].map((e) => e.textContent?.trim());
  expect(labels).toHaveLength(10);
  expect(labels.at(-1)).toBe(t("time.today"));
  expect(labels.at(-2)).toBe("10/29");
  expect(page.querySelectorAll(".usage-chart__x--minor")).toHaveLength(5);
});
