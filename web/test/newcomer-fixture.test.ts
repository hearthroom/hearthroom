import { afterEach, expect, it } from "vitest";
import { createApp } from "vue";
import { i18n } from "../src/lib/i18n";
import { newcomerView } from "../src/lib/checkin";
import { stageDone, type RewardsPanel } from "../src/lib/rewards";
import NewcomerCard from "../src/components/checkin/NewcomerCard.vue";

// Matches Provider's read-only test projection: completed fixture stages were never granted.
function fixture(stage: number, testFixture = true): RewardsPanel & { testFixture: boolean } {
  return {
    serverNow: "2026-10-25T00:00:00Z", testFixture,
    newcomer: {
      active: true, stage, deadline: "2026-11-05T00:00:00Z",
      today: { stage: stage + 1, goal: "comment_or_rating", progress: 0, target: 1, status: "locked" },
      stages: Array.from({ length: 7 }, (_, i) => ({
        stage: i + 1, goal: "turns", target: 1,
        reward: i < 6 ? { credits: 300 } : { chest: "newcomer" },
        status: i < stage ? "not_granted" : "locked",
      })),
    },
  } as RewardsPanel & { testFixture: boolean };
}

let app: ReturnType<typeof createApp> | undefined;
afterEach(() => app?.unmount());

it.each([0, 1, 2, 3, 4, 5, 6])("projects reset stage %s without turning fixture progress into a grant", (stage) => {
  const panel = fixture(stage);
  expect(newcomerView(panel)).toMatchObject({ done: stage, day: stage + 1, claimable: false, todayDone: false, grand: stage === 6 });
  expect(panel.newcomer!.stages.some(stageDone)).toBe(false);
});

it("does not infer ordinary-account completion from an ungranted stage counter", () => {
  expect(newcomerView(fixture(3, false))).toMatchObject({ done: 0, day: 1 });
});

it("renders the reset stage3 progress, fourth goal, dots and guide destination together", () => {
  const guide: number[] = [];
  app = createApp(NewcomerCard, { panel: fixture(3), busy: false, onGuide: (day: number) => guide.push(day) }).use(i18n);
  const root = document.createElement("div");
  app.mount(root);
  expect(root.querySelector(".nc__progress")?.textContent).toBe(i18n.global.t("newcomer.progress", { n: 3 }));
  expect(root.querySelector(".nc__text")?.textContent).toBe(i18n.global.t("newcomer.goal.4", { n: 1 }, 1));
  expect(root.querySelectorAll(".nc__dot--done")).toHaveLength(3);
  expect(root.querySelector(".nc__dot--today .nc__bead")?.textContent?.trim()).toBe("4");
  (root.querySelector(".nc__cta") as HTMLButtonElement).click();
  expect(guide).toEqual([4]);
});
