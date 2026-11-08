import { afterEach, expect, it } from "vitest";
import { createApp, h, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import MyCardTile from "../src/components/MyCardTile.vue";

// 重新審核（審核員 2026-11-08）：作者只看到卡正在重審、照常公開；看不到理由與發起人
let app: App | null = null;
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = ""; });

async function mount(card: Record<string, unknown>) {
  const el = document.createElement("div");
  document.body.append(el);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push("/mine");
  app = createApp({ render: () => h(MyCardTile, { card: card as never, busy: false }) }).use(router).use(i18n);
  app.mount(el);
  return el;
}
const base = { roleId: "r1", num: 100855, name: "雨夜書店", summary: "", avatarUrl: null, zone: "zh", talkNum: 0, visibility: "", registered: true, status: "approved", note: "", rating: null };

it("a published card under re-review shows the re-review badge and that it stays public", async () => {
  const el = await mount({ ...base, reReview: true });
  expect(el.textContent).toContain(i18n.global.t("mine.badge.reReview"));
  expect(el.querySelector("[data-re-review]")?.textContent).toContain(i18n.global.t("mine.note.reReview"));
  expect(el.textContent).not.toContain(i18n.global.t("mine.badge.listed"));
});

it("without a re-review the card reads as published", async () => {
  const el = await mount(base);
  expect(el.textContent).toContain(i18n.global.t("mine.badge.listed"));
  expect(el.querySelector("[data-re-review]")).toBeNull();
});
