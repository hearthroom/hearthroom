import { expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchReviewDetail: vi.fn(), fetchCard: vi.fn(), fetchCardPlatforms: vi.fn() }));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<object>()), ...api }));
import { resolvePlayCard } from "../src/lib/play-card";

it("trial-playing an extension review opens the base card the extension was made for", async () => {
  api.fetchReviewDetail.mockResolvedValue({ subjectKind: "workshop", baseCard: { id: 100001, roleId: "hosted-base", name: "燈塔", rating: "G" }, submission: {}, workshop: {} });
  await expect(resolvePlayCard("100001", "harbor", "zh", false, { id: "rv-1", token: "t" })).resolves.toMatchObject({ number: "100001", roleId: "hosted-base" });
  await expect(resolvePlayCard("999", "harbor", "zh", false, { id: "rv-1", token: "t" })).rejects.toThrow("review_card_mismatch");
});

it("card reviews still resolve through the card", async () => {
  api.fetchReviewDetail.mockResolvedValue({ card: { id: 100002, roleId: "hosted-card" } });
  await expect(resolvePlayCard("100002", "harbor", "zh", false, { id: "rv-2", token: "t" })).resolves.toMatchObject({ number: "100002", roleId: "hosted-card" });
});
