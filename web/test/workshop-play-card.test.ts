import { expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchReviewDetail: vi.fn(), fetchCard: vi.fn(), fetchCardPlatforms: vi.fn() }));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<object>()), ...api }));
import { resolvePlayCard } from "../src/lib/play-card";

it("card reviews still resolve through the card", async () => {
  api.fetchReviewDetail.mockResolvedValue({ card: { id: 100002, roleId: "hosted-card" } });
  await expect(resolvePlayCard("100002", "harbor", "zh", false, { id: "rv-2", token: "t" })).resolves.toMatchObject({ number: "100002", roleId: "hosted-card" });
});
