/**
 * 沙箱殼的位址：正式站給每張卡一個子網域，標籤一律小寫（瀏覽器與 postMessage 的 origin 都是小寫）；
 * 不合 DNS 標籤的 roleId 與非正式站退回同站 opaque 殼。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/api", () => ({ fetchCardSaves: vi.fn(), putCardSave: vi.fn(), deleteCardSave: vi.fn() }));

const session = { accessToken: async () => "t" } as unknown as Parameters<typeof import("../src/lib/stage-host").sandboxOptions>[1];

describe("sandboxOptions", () => {
  it("正式站：子網域殼，標籤小寫", async () => {
    const { sandboxOptions } = await import("../src/lib/stage-host");
    const o = sandboxOptions("hearthroom.club", session);
    expect(o.shellUrl("a7A2-b00b")).toBe("https://ca7a2-b00b.hearthroom.club/sandbox/");
    expect(o.origin("a7A2-b00b")).toBe("https://ca7a2-b00b.hearthroom.club");
    expect(sandboxOptions("www.hearthroom.club", session).origin("1")).toBe("https://c1.hearthroom.club");
  });

  it("不合 DNS 標籤的 roleId、或不在正式站 → 同站 opaque 殼", async () => {
    const { sandboxOptions } = await import("../src/lib/stage-host");
    const prod = sandboxOptions("hearthroom.club", session);
    for (const bad of ["a_b", "a.b", "", "x".repeat(63)]) {
      expect(prod.shellUrl(bad), bad).toBe("/sandbox/index.html");
      expect(prod.origin(bad), bad).toBe("null");
    }
    const local = sandboxOptions("localhost", session);
    expect(local.shellUrl("abc")).toBe("/sandbox/index.html");
    expect(local.origin("abc")).toBe("null");
  });
});
