/**
 * Harbor 部署或抖一下時 /v1/auth/session 會回 5xx。那不是登出：不能把人當成沒登入、
 * 也不能把「這個瀏覽器是誰登入」的記號清掉。短暫重試一次就恢復。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { resetManagedAuthForTest } from "@/lib/managed-auth";
import { useSession } from "@/lib/session";

let sessionReplies: Array<() => Response> = [];
beforeEach(() => {
  resetManagedAuthForTest(); localStorage.clear(); sessionStorage.clear(); sessionReplies = [];
  setActivePinia(createPinia());
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/v1/auth/config") return Response.json({ managed: true });
    if (url === "/v1/auth/session") return (sessionReplies.shift() ?? (() => Response.json({ error: "gone" }, { status: 503 })))();
    if (url === "/v1/auth/token") return Response.json({ accessToken: "t", expiresAt: Date.now() + 3_600_000 });
    return Response.json({});
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const site = { provider: "harbor", me: { accountNumId: 22, nickName: "n", avatar: "" }, profile: { identities: [] }, token: { accessToken: "t", expiresAt: Date.now() + 3_600_000 } };

it("rides out a brief server error instead of looking signed out", async () => {
  sessionReplies = [() => Response.json({ error: "auth_provider_unavailable" }, { status: 503 }), () => Response.json(site)];
  const session = useSession();
  const restoring = session.restore();
  await vi.runAllTimersAsync();
  await restoring;
  expect(session.me?.accountNumId).toBe(22);
});

it("does not forget who signed in on this browser when the server stays down", async () => {
  localStorage.setItem("hearthroom.signedIn", "22");
  const before = { ...localStorage };
  const session = useSession();
  const restoring = session.restore();
  await vi.runAllTimersAsync();
  await restoring;
  expect(session.me).toBeNull();
  expect({ ...localStorage }).toEqual(before);
});
