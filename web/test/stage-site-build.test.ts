import { expect, it, vi } from "vitest";

vi.mock("../src/pages/BoardPage.vue", () => ({ default: {} }));
vi.mock("../src/lib/track", () => ({ setSurface() {} }));
import { router } from "../src/router";

it("self-host mode exposes only routes that can load without Stage", () => {
  const publicBuild = import.meta.env.MODE === "public-site";
  for (const path of ["/", "/search", "/en/cards/100021"]) {
    expect(router.resolve(path).matched.at(-1)?.path).not.toContain("pathMatch");
  }
  for (const [path, route] of [
    ["/en/play/100021", "play/:roleId"],
    ["/cards/100021/edit", "cards/:roleId/edit"],
    ["/mine/workshops/new", "mine/workshops/new"],
    ["/review/42", "review/:id"],
  ]) {
    expect(router.resolve(path).matched.at(-1)?.path).toContain(publicBuild ? "pathMatch" : route);
  }
});
