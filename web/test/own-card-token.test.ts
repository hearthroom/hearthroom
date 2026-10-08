/**
 * 作者點開自己還沒上榜的卡：卡片頁常常比「恢復登入」早一步讀卡，那時還不知道是誰，
 * 讀卡就沒帶 token，伺服器只能當陌生人回 404（2026-10-08 owner 從「我的卡片」點進自己被退回的卡）。
 * 這個瀏覽器登入過，就先等登入恢復再讀；從沒登入過的訪客不等，也不因此多問一次。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { resetManagedAuthForTest } from "@/lib/managed-auth";
import { useSession } from "@/lib/session";
import { rememberSignedIn } from "@/lib/signin-hint";
import { fetchCard, setLoginViewer } from "@/lib/api";

const calls: { url: string; auth: string | null }[] = [];
beforeEach(() => {
  resetManagedAuthForTest(); localStorage.clear(); sessionStorage.clear(); calls.length = 0;
  setActivePinia(createPinia());
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("Authorization");
    calls.push({ url, auth });
    if (url === "/v1/auth/config") return Response.json({ managed: true });
    if (url === "/v1/auth/session") {
      await new Promise((r) => setTimeout(r, 20));
      return Response.json({ provider: "harbor", me: { accountNumId: 2, nickName: "n", avatar: "" }, profile: { identities: [] }, token: { accessToken: "author-token", expiresAt: Date.now() + 3_600_000 } });
    }
    if (url.startsWith("/v1/cards/100005")) {
      return auth === "Bearer author-token"
        ? Response.json({ id: "100005", name: "draft", status: "rejected" })
        : Response.json({ error: "card not found" }, { status: 404 });
    }
    return Response.json({});
  }));
});
afterEach(() => { vi.unstubAllGlobals(); setLoginViewer(null); });

it("waits for a remembered sign-in to come back before reading the card", async () => {
  rememberSignedIn(2);
  const session = useSession();
  const restoring = session.restore();
  const card = await fetchCard("100005");
  await restoring;
  expect(card.status).toBe("rejected");
  expect(calls.find((c) => c.url.startsWith("/v1/cards/100005"))?.auth).toBe("Bearer author-token");
});

it("does not hold up or sign in a visitor who never signed in here", async () => {
  useSession();
  await expect(fetchCard("100005")).rejects.toBeTruthy();
  expect(calls.find((c) => c.url.startsWith("/v1/cards/100005"))?.auth ?? null).toBeNull();
  expect(calls.some((c) => c.url === "/v1/auth/session")).toBe(false);
});
