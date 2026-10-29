import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick, reactive } from "vue";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import TaskPanel from "../src/components/checkin/TaskPanel.vue";
import type { RewardTask } from "../src/lib/rewards";
import zhHant from "../src/locales/zh-Hant.json";
import zhHans from "../src/locales/zh-Hans.json";
import en from "../src/locales/en.json";
import ja from "../src/locales/ja.json";
import ko from "../src/locales/ko.json";

vi.mock("../src/lib/use-locale", () => ({ useLocalePath: () => ({ lp: (path: string) => path }) }));

const locales = ["zh-Hant", "zh-Hans", "en", "ja", "ko"];
const messages = { "zh-Hant": zhHant, "zh-Hans": zhHans, en, ja, ko };
let app: ReturnType<typeof createApp> | undefined;
afterEach(() => app?.unmount());

it.each(locales)("%s: comment requirements show both server thresholds, including after a plan update", async (locale) => {
  // This isolates interpolation from editorial wording: the language of a page
  // cannot tell us which script the player will use in a future comment.
  const i18n = createI18n({
    legacy: false, locale, missingWarn: false, fallbackWarn: false,
    messages: Object.fromEntries(locales.map((code) => [code, {
      "task.comment.title": "CJK {cjkMin}; Latin {latinMin}",
    }])),
  });
  const tasks = reactive<RewardTask[]>([{
    id: "rotation", type: "comment", target: 1, progress: 0,
    minTextUnits: { cjk: 15, latin: 40 }, reward: { credits: 20 },
    status: "locked", period: "2026-10-29",
  }]);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  app = createApp(TaskPanel, {
    kind: "daily", tasks, plan: null, resetLabel: "", claiming: new Set<string>(), failed: new Set<string>(),
  }).use(i18n).use(router);
  const root = document.createElement("div");
  app.mount(root);
  expect(root.querySelector(".task__title")?.textContent).toBe("CJK 15; Latin 40");

  tasks[0].minTextUnits = { cjk: 23, latin: 57 };
  await nextTick();
  expect(root.querySelector(".task__title")?.textContent).toBe("CJK 23; Latin 57");

  i18n.global.locale.value = locale === "en" ? "zh-Hant" : "en";
  await nextTick();
  expect(root.querySelector(".task__title")?.textContent).toBe("CJK 23; Latin 57");
});

it.each(locales)("%s: the shipped comment title explains both configured thresholds", async (locale) => {
  const i18n = createI18n({ legacy: false, locale, messages });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  const task: RewardTask = {
    id: "rotation", type: "comment", target: 1, progress: 0,
    minTextUnits: { cjk: 23, latin: 57 }, reward: { credits: 20 },
    status: "locked", period: "2026-10-29",
  };
  app = createApp(TaskPanel, {
    kind: "daily", tasks: [task], plan: null, resetLabel: "", claiming: new Set<string>(), failed: new Set<string>(),
  }).use(i18n).use(router);
  const root = document.createElement("div");
  app.mount(root);
  const title = root.querySelector(".task__title")?.textContent;
  expect(title).toContain("23");
  expect(title).toContain("57");
  expect(title).toMatch(/(?:^|\D)3(?=\D|$)/);
  expect(title).not.toMatch(/\{(?:min|cjkMin|latinMin|minTurns)\}/);
});

it.each([
  { target: 1, progress: 0, expected: "0/1 rating" },
  { target: 1, progress: 1, expected: "1/1 rating" },
  { target: 2, progress: 0, expected: "0/2 ratings" },
  { target: 2, progress: 1, expected: "1/2 ratings" },
  { target: 2, progress: 2, expected: "2/2 ratings" },
])("rating progress $expected keeps its unit separate from comments and replies", async ({ target, progress, expected }) => {
  const i18n = createI18n({ legacy: false, locale: "en", messages });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  const tasks: RewardTask[] = ["rating", "comment", "author_replies"].map(type => ({
    id: type, type, target: type === "rating" ? target : 1, progress: type === "rating" ? progress : 0,
    reward: { credits: 20 }, status: "locked", period: "2026-10-29",
    ...(type === "comment" ? { minTextUnits: { cjk: 15, latin: 40 } } : {}),
  }));
  app = createApp(TaskPanel, {
    kind: "daily", tasks, plan: null, resetLabel: "", claiming: new Set<string>(), failed: new Set<string>(),
  }).use(i18n).use(router);
  const root = document.createElement("div");
  app.mount(root);
  const labels = [...root.querySelectorAll(".task__progress")].map(e => e.textContent);
  expect(labels[0]).toBe(expected);
  expect(labels[0]).not.toContain("comment");
  expect(labels[1]).toContain("comments");
  expect(labels[2]).toContain("comments");
});
