import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { currentProvider, setProvider } from "../src/lib/provider";
import { persist, restorePersisted } from "../src/lib/oauth";
import { useSession } from "../src/lib/session";
import { finishConnection } from "../src/lib/connections";
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setProvider("lunatalk");
  setActivePinia(createPinia());
});
afterEach(() => vi.unstubAllGlobals());
const pair = (accessToken: string) => ({
  accessToken,
  expiresAt: Date.now() + 60000,
});
it("a rejected second account cannot replace either saved credential", async () => {
  persist(pair("luna"), "lunatalk");
  persist(pair("original-harbor"), "harbor");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "provider_already_connected" }), {
          status: 409,
        })
    )
  );
  await expect(
    finishConnection("harbor", "lunatalk", pair("wrong-harbor"))
  ).rejects.toThrow("provider_already_connected");
  expect(restorePersisted("harbor")?.accessToken).toBe("original-harbor");
  expect(restorePersisted("lunatalk")?.accessToken).toBe("luna");
  expect(currentProvider()).toBe("lunatalk");
});
it("signing out clears every connected provider credential", async () => {
  persist(pair("luna"), "lunatalk");
  persist(pair("harbor"), "harbor");
  await useSession().logout();
  expect(restorePersisted("lunatalk")).toBeNull();
  expect(restorePersisted("harbor")).toBeNull();
});
