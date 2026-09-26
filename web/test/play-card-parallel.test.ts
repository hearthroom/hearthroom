/** 開卡：卡片、續玩紀錄、可玩平台一起問，不等卡片回來才問下一件。 */
import { beforeEach, expect, it, vi } from "vitest";

const started: string[] = [];
let releaseCard!: () => void;
vi.mock("../src/lib/api", () => ({
  fetchCard: vi.fn((id: string) => { started.push(`card:${id}`); return new Promise(resolve => { releaseCard = () => resolve({ id: "c", num: Number(id) === 5 ? 6 : Number(id), roleId: "r", provider: "harbor" }); }); }),
  fetchCardPlatforms: vi.fn(async (n: string) => { started.push(`platforms:${n}`); return [{ provider: "harbor", roleId: `role-${n}`, playable: true }]; }),
  fetchReviewDetail: vi.fn(),
}));
vi.mock("../src/lib/library", () => ({
  libraryRequest: vi.fn(async (path: string) => { started.push(`conversation:${path.split("?")[0]}`); return { cardNumber: 100076, provider: "harbor", roleId: "resumed-role" }; }),
}));
vi.mock("../src/lib/distribution", () => ({ copies: vi.fn() }));

import { resolvePlayCard } from "../src/lib/play-card";

beforeEach(() => { started.length = 0; });

it("asks for the platforms while the card is still loading", async () => {
  const done = resolvePlayCard("100076", "harbor", "zh");
  await Promise.resolve();
  expect(started).toEqual(["platforms:100076", "card:100076"]);
  releaseCard();
  expect(await done).toMatchObject({ number: "100076", roleId: "role-100076" });
});

it("asks for the resumed conversation while the card is still loading, and still checks it belongs to the card", async () => {
  const done = resolvePlayCard("100076", "harbor", "zh", false, undefined, { id: "conv-1", token: "t" });
  await Promise.resolve();
  expect(started).toEqual(["conversation:conversations/conv-1", "card:100076"]);
  releaseCard();
  expect(await done).toMatchObject({ number: "100076", roleId: "resumed-role" });
});

it("asks again with the card's own number when the link used a different one", async () => {
  const done = resolvePlayCard("5", "harbor", "zh");
  await Promise.resolve();
  releaseCard();
  expect(await done).toMatchObject({ number: "6", roleId: "role-6" });
  expect(started).toEqual(["platforms:5", "card:5", "platforms:6"]);
});
