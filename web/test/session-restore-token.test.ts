/**
 * 開頁：授權跟著本站 session 一起回來，就不再另外問一次 /v1/auth/token。
 * 兩趟往返原本串在所有需要登入的頁面前面（2026-09-26 量到 session 0.5 s → token 0.7 s）。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { resetManagedAuthForTest } from "@/lib/managed-auth";
import { useSession } from "@/lib/session";

const calls: string[] = [];
let sessionBody: Record<string, unknown> = {};
beforeEach(() => {
  resetManagedAuthForTest(); localStorage.clear(); sessionStorage.clear(); calls.length = 0;
  setActivePinia(createPinia());
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === "/v1/auth/config") return Response.json({ managed: true });
    if (url === "/v1/auth/session") return Response.json(sessionBody);
    if (url === "/v1/auth/token") return Response.json({ accessToken: "from-token-endpoint", expiresAt: Date.now() + 3_600_000 });
    return Response.json({});
  }));
});
afterEach(() => vi.unstubAllGlobals());

const site = { provider: "harbor", me: { accountNumId: 22, nickName: "n", avatar: "" }, profile: { identities: [] } };

it("uses the token that came back with the session instead of asking again", async () => {
  sessionBody = { ...site, token: { accessToken: "with-session", expiresAt: Date.now() + 3_600_000 } };
  const session = useSession();
  await session.restore();
  expect(await session.accessToken()).toBe("with-session");
  expect(calls).not.toContain("/v1/auth/token");
});

it("still asks for a token when the server did not include one", async () => {
  sessionBody = { ...site };
  const session = useSession();
  await session.restore();
  expect(await session.accessToken()).toBe("from-token-endpoint");
  expect(calls).toContain("/v1/auth/token");
});
