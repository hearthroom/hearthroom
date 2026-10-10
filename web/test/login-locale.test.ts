/** Harbor 的登入／同意頁用玩家在這裡的介面語言，Harbor 也據此記下成員的語言。 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetManagedAuthForTest } from "@/lib/managed-auth";
import { beginLogin } from "@/lib/oauth";
import { i18n } from "@/lib/i18n";

beforeEach(() => { resetManagedAuthForTest(); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());

it("tells the server which language the player is using when sign-in starts", async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/v1/auth/config") return Response.json({ managed: true });
    if (url === "/v1/auth/start") { bodies.push(JSON.parse(String(init?.body))); return Response.json({ url: "https://api.example/oauth/authorize?x=1" }); }
    return Response.json({});
  }));
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  i18n.global.locale.value = "ja";
  await beginLogin("/me");
  expect(bodies[0]?.locale).toBe("ja");
  expect(assign).toHaveBeenCalledWith("https://api.example/oauth/authorize?x=1");
});
